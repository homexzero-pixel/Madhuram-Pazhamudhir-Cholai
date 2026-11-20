"""End-to-end acceptance run against REAL server processes and database files.

    python scripts/run_acceptance.py            (needs: pip install requests)

It creates throw-away data folders, so the store and practice databases are never touched.
Results are written to docs/ACCEPTANCE_RESULTS.md and printed.

Covers the specification's acceptance tests:
  1  two rice packs + 0.375 kg apples, cash ₹250            (over HTTP, as the billing screen does)
  2  unknown barcode leaves the bill intact                 (over HTTP)
  3  barcode starting with 0: import, restart app, scan     (server process stopped and started)
  4–9                                                       (automated test suite, run first)
  10 restore a backup into a separate database, compare last bill, stock and shift totals
  11 20,000 SKUs: barcode lookup and product search timings
"""
import json
import os
import platform
import random
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
from datetime import date
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable
RESULTS = []


def env_for(data_dir, mode="store", db_file=None):
    e = dict(os.environ, MPC_MODE=mode, MPC_DATA_DIR=str(data_dir), PYTHONIOENCODING="utf-8")
    e.pop("MPC_DB_FILE", None)
    if db_file:
        e["MPC_DB_FILE"] = str(db_file)
    return e


def manage(env, *args, check=True, timeout=600):
    r = subprocess.run([PY, "manage.py", *args], cwd=ROOT, env=env, capture_output=True, text=True, timeout=timeout)
    if check and r.returncode:
        raise RuntimeError(f"manage.py {' '.join(args)} failed:\n{r.stdout}\n{r.stderr}")
    return r


def shell_json(env, code):
    r = manage(env, "shell", "-c", code)
    return json.loads(r.stdout.strip().splitlines()[-1])


class Server:
    def __init__(self, env, port):
        self.env, self.port, self.proc = env, port, None
        self.base = f"http://127.0.0.1:{port}"

    def start(self):
        t0 = time.perf_counter()
        self.log = open(Path(self.env["MPC_DATA_DIR"]) / f"server-{self.port}.log", "a", encoding="utf-8")
        self.proc = subprocess.Popen([PY, "manage.py", "serve", "--no-browser", "--port", str(self.port)], cwd=ROOT, env=self.env,
                                     stdout=self.log, stderr=subprocess.STDOUT)
        for _ in range(600):
            try:
                if requests.get(self.base + "/accounts/login/", timeout=2).status_code == 200:
                    return time.perf_counter() - t0
            except requests.ConnectionError:
                pass
            if self.proc.poll() is not None:
                raise RuntimeError("Server exited early; see " + self.log.name)
            time.sleep(0.25)
        raise RuntimeError("Server did not start")

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        if getattr(self, "log", None):
            self.log.close()


def login(base, user, password):
    s = requests.Session()
    s.get(base + "/accounts/login/")
    r = s.post(base + "/accounts/login/", data={"username": user, "password": password, "csrfmiddlewaretoken": s.cookies["csrftoken"], "next": "/"})
    assert "sessionid" in s.cookies, "login failed"
    return s


def post_form(s, base, url, data, files=None):
    data = dict(data, csrfmiddlewaretoken=s.cookies["csrftoken"])
    return s.post(base + url, data=data, files=files, allow_redirects=False)


def api(s, base, url, body=None):
    if body is None:
        return s.get(base + url, headers={"Accept": "application/json"}).json()
    return s.post(base + url, data=json.dumps(body), headers={"Content-Type": "application/json", "X-CSRFToken": s.cookies["csrftoken"],
                                                               "Accept": "application/json"}).json()


def record(num, name, passed, detail):
    RESULTS.append({"num": num, "name": name, "passed": bool(passed), "detail": detail})
    print(f"[{'PASS' if passed else 'FAIL'}] {num} {name}: {detail}")


def pct(values, p):
    values = sorted(values)
    return values[min(len(values) - 1, int(round(p / 100 * (len(values) - 1))))]


STATE = """
import json
from django.db.models import Sum
from catalog.models import Item
from sales.models import Sale, Shift
from sales.services import cash_summary
last = Sale.objects.order_by('-id').first()
sh = Shift.objects.order_by('-id').first()
cs = cash_summary(sh) if sh else {}
print(json.dumps({
 'last_bill': last.bill_no if last else None, 'last_total': str(last.total) if last else None, 'bills': Sale.objects.count(),
 'stock': {i.sku: str(i.on_hand.normalize()) for i in Item.objects.exclude(on_hand=0).order_by('sku')},
 'shift': {'id': sh.id, 'status': sh.status, 'expected': str(sh.expected), 'counted': str(sh.counted), 'variance': str(sh.variance),
           'cash_sales': str(cs['cash_sales']), 'upi': str(cs['tenders']['upi'])} if sh else None,
}))
"""


def main():
    work = Path(tempfile.mkdtemp(prefix="madhuram-acceptance-"))
    print("Working folder:", work)
    started = time.strftime("%Y-%m-%d %H:%M")

    # ---- 4–9 and others: the automated suite
    t0 = time.perf_counter()
    r = manage(env_for(work / "unit", mode="test"), "test", "--noinput", check=False, timeout=1800)
    tail = (r.stdout + r.stderr).strip().splitlines()
    ran = next((l for l in tail if l.startswith("Ran ")), "")
    ok = r.returncode == 0
    record("4–9", "Automated test suite (carton conversion, FEFO/expiry, all-or-nothing sale, reprint, partial return, shift close, and more)",
           ok, f"{ran} – {'OK' if ok else 'FAILED'} in {time.perf_counter() - t0:.0f}s")
    if not ok:
        print("\n".join(tail[-40:]))

    live = work / "live"
    env = env_for(live)
    manage(env, "migrate", "-v0")
    manage(env, "create_owner", "--username", "owner", "--password", "acceptance-1", "--pin", "4321")
    server = Server(env, 8791)
    perf_server = None
    try:
        boot = server.start()
        record("—", "First start in store mode (migrate, load 20,000-SKU catalogue, first daily backup)", True, f"ready in {boot:.1f}s")
        base = server.base
        s = login(base, "owner", "acceptance-1")
        post_form(s, base, "/purchases/suppliers/new/", {"name": "Acceptance Supplier", "phone": "", "gstin": "", "address": "",
                                                        "payment_terms_days": "0", "opening_balance": "0", "is_active": "on", "notes": ""})
        csv = ("SKU,Barcode,PLU,English name,Department,Category,Sale unit,Selling price,MRP,GST treatment,Active,Status\n"
               "ACC-RICE,8901000000019,,Ponni rice · test brand · 1 kg,Pantry,Rice & millets,pcs,75,80,exempt,yes,verified\n"
               "ACC-APPLE,,101,Apple · loose,Fresh produce,Fruit,kg,180,180,exempt,yes,verified\n"
               "ACC-OIL,0890105800007,,Sunflower oil · test brand · 1 L,Pantry,Oils,pcs,165,175,unset,yes,verified\n")
        post_form(s, base, "/products/import/", {}, files={"file": ("acceptance.csv", csv.encode("utf-8"), "text/csv")})
        s.get(base + "/products/import/preview/")
        post_form(s, base, "/products/import/apply/", {})
        sup = shell_json(env, "import json; from purchasing.models import Supplier; print(json.dumps(Supplier.objects.get(name='Acceptance Supplier').pk))")
        grn = {"supplier": sup, "invoice_no": "ACC-INV-1", "invoice_date": date.today().isoformat(), "invoice_total": "4040", "lcount": 3}
        for i, (code, q, c) in enumerate([("ACC-RICE", "20", "60"), ("ACC-APPLE", "12", "120"), ("ACC-OIL", "10", "140")]):
            grn.update({f"l{i}-code": code, f"l{i}-qty": q, f"l{i}-unit_cost": c, f"l{i}-units_per_purchase": "1"})
        post_form(s, base, "/purchases/grn/new/", grn)
        post_form(s, base, "/cash/open/", {"opening": "500"})

        # ---- 1
        api(s, base, "/api/pos/scan/", {"code": "8901000000019"})
        api(s, base, "/api/pos/scan/", {"code": "8901000000019"})
        need = api(s, base, "/api/pos/scan/", {"code": "ACC-APPLE"})
        st = api(s, base, "/api/pos/scan/", {"code": "ACC-APPLE", "qty": "0.375"})
        done = api(s, base, "/api/pos/checkout/", {"draft": st["draft"], "payments": [{"method": "cash", "tendered": "250"}]})
        record(1, "Two rice packs at ₹75 + 0.375 kg apples at ₹180/kg, cash ₹250", need.get("needs_qty") and st["total"] == "217.50"
               and done.get("sale_total") == "217.50" and done.get("change") == "32.50",
               f"weight asked: {bool(need.get('needs_qty'))}; total ₹{st['total']}; bill {done.get('bill_no')} saved; change ₹{done.get('change')}")

        # ---- 2
        before = api(s, base, "/api/pos/scan/", {"code": "8901000000019"})
        unk = api(s, base, "/api/pos/scan/", {"code": "8909999999994"})
        record(2, "Unknown barcode keeps the bill intact", (not unk["ok"]) and unk.get("unknown") == "8909999999994"
               and unk["lines"] == before["lines"] and unk["total"] == before["total"],
               f"refused with '{unk['error']}'; bill still {len(unk['lines'])} line, ₹{unk['total']}")
        api(s, base, "/api/pos/cancel/", {"reason": "acceptance test"})

        # ---- 3: restart the application, then scan the leading-zero barcode
        stored = shell_json(env, "import json; from catalog.models import Barcode; print(json.dumps(Barcode.objects.get(item__sku='ACC-OIL').code))")
        server.stop()
        restart = server.start()
        s = login(base, "owner", "acceptance-1")
        r3 = api(s, base, "/api/pos/scan/", {"code": "0890105800007"})
        wrong = api(s, base, "/api/pos/scan/", {"code": "890105800007"})
        paid = api(s, base, "/api/pos/checkout/", {"draft": r3["draft"], "payments": [{"method": "upi", "amount": "165"}]})
        record(3, "Barcode beginning with 0: import, restart, scan", stored == "0890105800007" and r3["ok"]
               and r3["lines"][0]["sku"] == "ACC-OIL" and not wrong["ok"] and paid["ok"],
               f"stored as '{stored}'; app restarted in {restart:.1f}s; scan found {r3['lines'][0]['name']}; the same digits without the 0 are refused; "
               f"paid by UPI ({paid.get('bill_no')})")

        # ---- close the shift, back up, restore into a separate database
        pre = shell_json(env, STATE)
        exp = pre["shift"]["cash_sales"]
        post_form(s, base, f"/cash/shift/{pre['shift']['id']}/close/", {"counted": "717.50", "retained": "500"})
        post_form(s, base, "/settings/backups/now/", {})
        live_state = shell_json(env, STATE)
        backup = sorted((live / "store" / "backups").glob("*manual*.sqlite3"))[-1]
        restore_dir = work / "restore-test"
        renv = env_for(restore_dir)
        manage(renv, "migrate", "-v0")
        manage(renv, "restore_backup", str(backup), "--yes")
        restored = shell_json(renv, STATE)
        same = restored == live_state
        record(10, "Restore a backup into a separate test database", same and live_state["shift"]["expected"] == "717.50",
               f"backup {backup.name}; restored DB matches live: last bill {restored['last_bill']} ₹{restored['last_total']}, "
               f"{len(restored['stock'])} items with stock (e.g. ACC-RICE {restored['stock'].get('ACC-RICE')}, ACC-APPLE {restored['stock'].get('ACC-APPLE')}), "
               f"shift {restored['shift']['id']} expected ₹{restored['shift']['expected']} counted ₹{restored['shift']['counted']} "
               f"variance ₹{restored['shift']['variance']} (cash sales ₹{exp}, UPI ₹{restored['shift']['upi']} not in drawer)")

        # ---- 11: performance with 20,000 SKUs, each given a synthetic test barcode (copy of the database only)
        server.stop()
        perf_dir = work / "perf"
        (perf_dir / "test").mkdir(parents=True)
        perf_db = perf_dir / "perf.sqlite3"
        for ext in ("", "-wal", "-shm"):  # include the write-ahead log so nothing recent is lost
            src_file = live / "store" / f"madhuram.sqlite3{ext}"
            if src_file.exists():
                shutil.copy2(src_file, Path(str(perf_db) + ext))
        penv = env_for(perf_dir, mode="test", db_file=perf_db)
        timing = shell_json(penv, PERF)
        perf_server = Server(penv, 8792)
        perf_server.start()
        s = login(perf_server.base, "owner", "acceptance-1")
        manage(penv, "shell", "-c", "from sales.services import start_shift; from accounts.models import User; start_shift(User.objects.get(username='owner'), 0)")
        lat = []
        for i in range(200):
            t = time.perf_counter()
            r = api(s, perf_server.base, "/api/pos/scan/", {"code": "8901000000019" if i % 2 else "0890105800007"})
            lat.append((time.perf_counter() - t) * 1000)
            assert r["ok"], r
            if len(r["lines"]) >= 2 and i % 10 == 9:
                api(s, perf_server.base, "/api/pos/cancel/", {"reason": "performance test"})
        slat = []
        for q in ["ponni", "toor dal 1 kg", "பொன்னி", "MPC12345", "basmati 5 kg", "sunflower", "curd", "0890105800007"] * 5:
            t = time.perf_counter()
            r = s.get(perf_server.base + "/api/pos/search/?all=1&q=" + requests.utils.quote(q), headers={"Accept": "application/json"}).json()
            slat.append((time.perf_counter() - t) * 1000)
        timing["http_scan_ms"] = {"median": round(statistics.median(lat), 1), "p95": round(pct(lat, 95), 1), "max": round(max(lat), 1), "n": len(lat)}
        timing["http_search_ms"] = {"median": round(statistics.median(slat), 1), "p95": round(pct(slat, 95), 1), "max": round(max(slat), 1), "n": len(slat)}
        ok11 = timing["items"] >= 20000 and timing["barcodes"] >= 20000 and timing["http_scan_ms"]["p95"] < 300
        record(11, "20,000 SKUs: barcode lookup and product search", ok11,
               f"{timing['items']} SKUs, {timing['barcodes']} barcodes. Barcode lookup: median {timing['lookup_ms']['median']} ms, "
               f"p95 {timing['lookup_ms']['p95']} ms ({timing['lookup_ms']['n']} lookups). Scan → bill updated over HTTP: median "
               f"{timing['http_scan_ms']['median']} ms, p95 {timing['http_scan_ms']['p95']} ms. Product search (English/Tamil/SKU over all 20,000): "
               f"median {timing['search_ms']['median']} ms, p95 {timing['search_ms']['p95']} ms; over HTTP median {timing['http_search_ms']['median']} ms.")
    finally:
        server.stop()
        if perf_server:
            perf_server.stop()

    write_report(started, work)
    return 0 if all(r["passed"] for r in RESULTS) else 1


PERF = """
import json, random, statistics, time
from catalog.models import Barcode, Item
from sales.services import resolve_code, search_items
have = set(Barcode.objects.values_list('item_id', flat=True))
new = [Barcode(code='977' + str(i.pk).zfill(10), item=i, note='PERFORMANCE TEST ONLY') for i in Item.objects.exclude(pk__in=have)]
Barcode.objects.bulk_create(new, batch_size=5000)
codes = list(Barcode.objects.values_list('code', flat=True))
random.seed(1)
sample = random.sample(codes, 2000)
lt = []
for c in sample:
    t = time.perf_counter(); r = resolve_code(c); lt.append((time.perf_counter() - t) * 1000); assert r is not None
st = []
for q in ['ponni', 'toor dal 1 kg', 'பொன்னி', 'MPC12345', 'basmati 5 kg', 'sunflower', 'curd', 'seeraga samba', 'organic', '101'] * 5:
    t = time.perf_counter(); search_items(q, limit=30, active_only=False); st.append((time.perf_counter() - t) * 1000)
p = lambda v, q: sorted(v)[min(len(v) - 1, int(round(q / 100 * (len(v) - 1))))]
print(json.dumps({'items': Item.objects.count(), 'barcodes': Barcode.objects.count(),
  'lookup_ms': {'median': round(statistics.median(lt), 2), 'p95': round(p(lt, 95), 2), 'max': round(max(lt), 2), 'n': len(lt)},
  'search_ms': {'median': round(statistics.median(st), 1), 'p95': round(p(st, 95), 1), 'max': round(max(st), 1), 'n': len(st)}}))
"""


def write_report(started, work):
    cpu = ""
    try:
        cpu = next(l.split(":", 1)[1].strip() for l in open("/proc/cpuinfo") if l.startswith("model name"))
    except (OSError, StopIteration):
        cpu = platform.processor()
    lines = [
        "# Acceptance test results",
        "",
        f"Run: {started} · machine: {platform.system()} {platform.release()}, {cpu}, {os.cpu_count()} CPUs, Python {platform.python_version()}",
        "",
        "Produced by `python scripts/run_acceptance.py`, which uses real server processes and database files in a throw-away folder. "
        "Timings are from the machine above; the Windows counter PC will differ. Hardware (scanner, scale, thermal printer) was **not** "
        "part of this run – see docs/HARDWARE.md.",
        "",
        "| # | Test | Result | What happened |",
        "|---|------|--------|---------------|",
    ]
    for r in RESULTS:
        lines.append(f"| {r['num']} | {r['name']} | {'✅ Pass' if r['passed'] else '❌ Fail'} | {r['detail']} |")
    lines += ["", "Tests 4–9 are in `sales/tests/test_acceptance.py`:", "",
              "- 4 `A04_CartonConversion`: 2 cartons × 24 received → 48 in stock; 3 sold → 45; duplicate supplier invoice refused.",
              "- 5 `A05_FEFO`: lot expiring in 1 day sold before the lot expiring in 5 days; an expired lot is refused at the scanner; receiving already-expired stock is refused.",
              "- 6 `A06_AllOrNothing`: a bill with one valid and one short line fails at payment; no sale, payment or stock movement is written. A double-clicked payment makes one sale.",
              "- 7 `A07_PrinterFailureReprint`: the sale exists once; reprinting twice is marked DUPLICATE, counted, and creates no new sale, payment or stock change.",
              "- 8 `A08_PartialReturn`: 3 rice at the ₹70 offer price (₹75 list); returning 1 refunds ₹70, 2 remain returnable, the unit goes back to sellable stock; "
              "returning more than remains is refused; weighed 0.500 kg return refunds ₹90 and reverses 0.67 loyalty points.",
              "- 9 `A09_ShiftClose`: ₹1,000 float + ₹300 cash sales − ₹100 cash refund − ₹50 cash expense = ₹1,150 expected; UPI, card, a UPI refund and a UPI expense do not change it.",
              ""]
    out = ROOT / "docs" / "ACCEPTANCE_RESULTS.md"
    out.parent.mkdir(exist_ok=True)
    out.write_text("\n".join(lines), encoding="utf-8")
    (work / "results.json").write_text(json.dumps(RESULTS, indent=2, ensure_ascii=False), encoding="utf-8")
    print("\nWritten:", out)


if __name__ == "__main__":
    sys.exit(main())
