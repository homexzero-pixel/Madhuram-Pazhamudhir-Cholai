"""One-click update for the Madhuram store system (run by Update_Madhuram.bat; Python standard library only).

  1. Finds the new version: the newest Madhuram_Store_System*.zip in Downloads / Desktop, a ZIP dropped on the .bat,
     or the extracted folder the .bat was started from.
  2. Finds the installed program (the folder with .venv).
  3. Closes the store (server, its window and the billing window).
  4. Backs up the store database (SQLite online backup + integrity check) and the current program folder.
  5. Puts the new program in place (.venv, collected static files and shop data are never touched).
  6. Installs the new requirements (offline from wheels\\ if present), updates the databases, runs checks.
  7. If anything fails: puts the old program and the old database back, so the shop can bill as before.
  8. Starts the store again.

The shop's data is not in the program folder: %LOCALAPPDATA%\\MadhuramPOS\\store\\ is only read for the backup and only
written to when a failed update has to be rolled back.
"""
import argparse
import datetime as dt
import os
import re
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

WINDOWS = os.name == "nt"
KEEP_DIRS = {".venv", "staticfiles", "__pycache__", ".git"}   # never deleted or overwritten in the installed folder
PORT = 8765
LOG = []


# ------------------------------------------------------------------ small helpers
def data_base():
    return Path(os.environ.get("MPC_DATA_DIR") or (Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "MadhuramPOS"))


def say(msg="", kind=""):
    mark = {"ok": "  OK  ", "bad": " FAIL ", "warn": " NOTE ", "step": "\n==> "}.get(kind, "      ")
    line = f"{mark}{msg}"
    print(line, flush=True)
    LOG.append(f"{dt.datetime.now():%Y-%m-%d %H:%M:%S} {line.strip()}")


def write_log():
    try:
        p = data_base() / "update-log.txt"
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "a", encoding="utf-8") as f:
            f.write("\n".join(LOG) + "\n\n")
        return p
    except OSError:
        return None


def ask(question, default_yes=False):
    if os.environ.get("MPC_UPDATE_YES") == "1":
        return True
    try:
        a = input(f"{question} [{'Y/n' if default_yes else 'y/N'}]: ").strip().lower()
    except EOFError:
        return default_yes
    return (a in ("y", "yes")) or (default_yes and a == "")


class UpdateError(RuntimeError):
    pass


def venv_python(folder):
    return folder / ".venv" / ("Scripts/python.exe" if WINDOWS else "bin/python")


def is_program(folder):
    return folder and (folder / "manage.py").is_file() and (folder / "core" / "backup.py").is_file()


def version_of(folder):
    try:
        return (folder / "VERSION").read_text(encoding="utf-8").strip() or "unknown"
    except OSError:
        return "older (no version number)"


def run(args, cwd, mode="store", check=True, quiet=False):
    env = dict(os.environ, MPC_MODE=mode, PYTHONIOENCODING="utf-8")
    p = subprocess.run([str(a) for a in args], cwd=str(cwd), env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = (p.stdout + p.stderr).strip()
    if out and not quiet:
        for ln in out.splitlines()[-12:]:
            say(ln)
    if check and p.returncode != 0:
        raise UpdateError(f"'{' '.join(str(a) for a in args[1:4])}' failed (code {p.returncode}).")
    return p


# ------------------------------------------------------------------ finding things
def find_zip(explicit=None):
    if explicit:
        p = Path(explicit)
        if not p.exists():
            raise UpdateError(f"{p} not found.")
        return p
    home = Path.home()
    places = [home / "Downloads", home / "Desktop", home / "OneDrive" / "Desktop", home / "OneDrive" / "Downloads"]
    found = [z for d in places if d.is_dir() for z in d.glob("Madhuram_Store_System*.zip")]
    if not found:
        raise UpdateError("No new version found. Download Madhuram_Store_System.zip into Downloads (or drag the ZIP onto "
                          "Update_Madhuram.bat) and try again.")
    return max(found, key=lambda z: z.stat().st_mtime)


def program_in(folder):
    """The program folder inside an extracted ZIP (may be one level down)."""
    if is_program(folder):
        return folder
    for sub in sorted(folder.iterdir()):
        if sub.is_dir() and is_program(sub):
            return sub
    return None


def find_installed(hint=None):
    cands = []
    if hint:
        cands.append(Path(hint))
    rec = data_base() / "install_path.txt"
    if rec.exists():
        cands.append(Path(rec.read_text(encoding="utf-8").strip()))
    # the shortcuts made by Install_Madhuram.bat point at Start_Store.bat inside the installed folder
    home = Path.home()
    appdata = Path(os.environ.get("APPDATA") or home)
    for lnk in [home / "Desktop" / "Madhuram Store.lnk", home / "OneDrive" / "Desktop" / "Madhuram Store.lnk",
                appdata / "Microsoft/Windows/Start Menu/Programs/Startup/Madhuram Store.lnk"]:
        try:
            raw = lnk.read_bytes()
        except OSError:
            continue
        for text in (raw.decode("latin-1"), raw.decode("utf-16-le", errors="ignore")):
            for m in re.finditer(r"([A-Za-z]:\\[^\x00\r\n<>\"|?*]*?)\\Start_Store\.bat", text):
                cands.append(Path(m.group(1)))
    for base in [Path("C:/Madhuram"), Path("C:/Madhuram/Madhuram_Store_System"), home / "Desktop" / "Madhuram_Store_System",
                 home / "Documents" / "Madhuram_Store_System", home / "Madhuram_Store_System"]:
        cands.append(base)
    for c in cands:
        if is_program(c) and venv_python(c).exists():
            return c.resolve()
    return None


# ------------------------------------------------------------------ store on/off
def store_running():
    s = socket.socket()
    s.settimeout(0.5)
    try:
        return s.connect_ex(("127.0.0.1", PORT)) == 0
    finally:
        s.close()


def stop_store(target):
    if WINDOWS:
        ps = ("$t='" + str(target).replace("'", "''") + "';"
              "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ("
              " (($_.Name -like 'python*') -and $_.CommandLine -like '*manage.py*serve*') -or"
              " (($_.Name -eq 'cmd.exe') -and ($_.CommandLine -like '*Start_Store.bat*' -or $_.CommandLine -like '*Open_Billing_Window*')) -or"
              " (($_.Name -eq 'msedge.exe') -and $_.CommandLine -like '*edge-billing*') ) } |"
              " ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }")
        subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], capture_output=True)
    else:  # used by the automated test on Linux
        subprocess.run(["pkill", "-f", f"{target}.*manage.py serve"], capture_output=True)
    for _ in range(20):
        if not store_running():
            return True
        time.sleep(0.5)
    return not store_running()


def start_store(target):
    bat = target / "Start_Store.bat"
    if os.environ.get("MPC_UPDATE_NO_START") == "1":
        return
    if WINDOWS and bat.exists():
        subprocess.Popen(["cmd", "/c", "start", "", str(bat)], cwd=str(target), creationflags=0x00000008)  # DETACHED_PROCESS


# ------------------------------------------------------------------ backups and copying
def backup_database(stamp):
    db = data_base() / "store" / "madhuram.sqlite3"
    if not db.exists():
        say("No store database yet (nothing billed) – no data backup needed.", "warn")
        return None, None
    dest_dir = db.parent / "backups"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"madhuram-store-{stamp}-before-update.sqlite3"
    src = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=30)
    out = sqlite3.connect(str(dest))
    try:
        src.backup(out)
        ok = out.execute("PRAGMA integrity_check").fetchone()[0]
        bills = out.execute("SELECT COUNT(*) FROM sales_sale").fetchone()[0] if out.execute(
            "SELECT 1 FROM sqlite_master WHERE name='sales_sale'").fetchone() else 0
    finally:
        out.close()
        src.close()
    if ok != "ok":
        raise UpdateError(f"The backup copy failed its integrity check ({ok}). Nothing was changed.")
    return db, (dest, bills)


def walk_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in KEEP_DIRS]
        for f in filenames:
            yield Path(dirpath, f).relative_to(root)


def mirror(src, dst):
    """Make dst's program files identical to src's, leaving .venv, staticfiles and caches alone."""
    want = set(walk_files(src))
    for rel in list(walk_files(dst)):
        if rel not in want:
            (dst / rel).unlink()
    for rel in want:
        d = dst / rel
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src / rel, d)
    for dirpath, dirnames, _ in os.walk(dst, topdown=False):   # remove folders left empty
        for d in dirnames:
            p = Path(dirpath, d)
            if d not in KEEP_DIRS and not any(p.iterdir()):
                p.rmdir()


def prepare_and_check(target):
    py = venv_python(target)
    say("Installing the program's components …", "step")
    req = ["-m", "pip", "install", "--disable-pip-version-check", "-q", "-r", "requirements.txt"]
    if (target / "wheels").is_dir():
        req[4:4] = ["--no-index", "--find-links", "wheels"]
    run([py] + req, target)
    say("Updating the databases …", "step")
    run([py, "manage.py", "migrate", "--noinput"], target, "store")
    run([py, "manage.py", "migrate", "--noinput"], target, "demo", quiet=True)
    run([py, "manage.py", "collectstatic", "--noinput", "-v", "0"], target, "store")
    say("Checking that the store starts …", "step")
    run([py, "manage.py", "check"], target, "store")
    p = run([py, "manage.py", "shell", "-c",
             "from catalog.models import Item; from sales.models import Sale; from core.models import StoreSettings; "
             "StoreSettings.load(); print(f'products {Item.objects.count()}, bills {Sale.objects.count()}')"], target, "store", quiet=True)
    return p.stdout.strip().splitlines()[-1] if p.stdout.strip() else ""


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--here", help="folder Update_Madhuram.bat was started from")
    ap.add_argument("--target", help="installed program folder (normally found automatically)")
    ap.add_argument("zip", nargs="?", help="Madhuram_Store_System.zip (optional)")
    a = ap.parse_args()
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    here = Path(a.here).resolve() if a.here else None
    tmp = None
    print("\n  Madhuram Pazhamudhir Cholai – program update\n  -------------------------------------------")

    # what is installed, what is new
    if here and is_program(here) and venv_python(here).exists() and not a.target:
        target = here
        z = find_zip(a.zip if a.zip and a.zip.lower().endswith(".zip") else None)
        say(f"New version file: {z}", "step")
        tmp = Path(tempfile.mkdtemp(prefix="madhuram_update_"))
        try:
            with zipfile.ZipFile(z) as zf:
                bad = zf.testzip()
                if bad:
                    raise UpdateError(f"The ZIP is damaged ({bad}). Download it again.")
                zf.extractall(tmp)
        except zipfile.BadZipFile:
            raise UpdateError("This file is not a valid ZIP. Download it again.") from None
        source = program_in(tmp)
    else:
        source = here if is_program(here) else None
        target = find_installed(a.target)
        if a.zip and a.zip.lower().endswith(".zip"):
            tmp = Path(tempfile.mkdtemp(prefix="madhuram_update_"))
            with zipfile.ZipFile(a.zip) as zf:
                zf.extractall(tmp)
            source = program_in(tmp)
    if not source:
        raise UpdateError("The new version does not look like the Madhuram store program (manage.py missing).")
    if not target:
        raise UpdateError("The installed program was not found. Run Update_Madhuram.bat from the installed folder "
                          "(desktop shortcut 'Madhuram Update'), or install with Install_Madhuram.bat first.")
    if source.resolve() == target.resolve():
        raise UpdateError("This folder is already the installed program. Download the new ZIP and run the update again.")

    old_v, new_v = version_of(target), version_of(source)
    say(f"Installed program: {target}  (version {old_v})")
    say(f"New version:                       {new_v}")
    if new_v != "unknown" and old_v[:1].isdigit() and new_v <= old_v:
        if not ask(f"The new version ({new_v}) is not newer than the installed one ({old_v}). Install it anyway?"):
            raise UpdateError("Cancelled – nothing was changed.")
    if not ask("Billing will stop for about 2 minutes. Update now? Finish the current bill first.", default_yes=True):
        raise UpdateError("Cancelled – nothing was changed.")

    say("Closing the store …", "step")
    if not stop_store(target):
        raise UpdateError("The store is still running. Close the 'Madhuram STORE' window and try again. Nothing was changed.")
    say("Store closed.", "ok")

    say("Backing up the shop data …", "step")
    try:
        db, info = backup_database(stamp)
    except Exception:
        start_store(target)          # nothing changed: reopen the store as it was
        raise
    if info:
        say(f"Data backup checked: {info[0].name} ({info[1]} bills)", "ok")
    if venv_python(target).exists():   # also the normal double backup (PC + Google Drive), where the installed version has it
        p = run([venv_python(target), "manage.py", "auto_backup", "--label", "before-update"], target, "store", check=False, quiet=True)
        say("Google Drive copy made as well." if p.returncode == 0 and "Google Drive copy verified" in p.stdout
            else "Google Drive copy not made now (the local backup above is enough to roll back).", "ok" if p.returncode == 0 else "warn")

    say("Saving a copy of the current program …", "step")
    prev = data_base() / "program-previous"
    if prev.exists():
        shutil.rmtree(prev)
    prev.mkdir(parents=True)
    try:
        mirror(target, prev)
    except Exception:
        start_store(target)
        raise
    say(f"Saved in {prev}", "ok")

    try:
        say("Putting the new program in place …", "step")
        mirror(source, target)
        say("Files copied.", "ok")
        summary = prepare_and_check(target)
        say(f"Store checked: {summary}", "ok")
    except Exception as exc:  # noqa: BLE001 – anything at all: go back to the old version
        say(f"Update failed: {exc}", "bad")
        say("Putting the previous version back …", "step")
        mirror(prev, target)
        if db and info:
            for ext in ("-wal", "-shm"):
                Path(str(db) + ext).unlink(missing_ok=True)
            shutil.copy2(info[0], db)
            say("Shop data restored from the backup taken just before the update.", "ok")
        try:
            prepare_and_check(target)
            say("Previous version restored and checked.", "ok")
        except Exception as exc2:  # noqa: BLE001
            say(f"The previous version also needs attention: {exc2}. Run Setup_Windows.bat, then Start_Store.bat.", "bad")
        start_store(target)
        raise UpdateError("The update did not complete; the shop is back on the previous version. "
                          "Send the log file to whoever supplied the update.") from None
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)

    say(f"Updated from {old_v} to {new_v}. Starting the store …", "step")
    start_store(target)
    say("Done. Check the last bill in Sales & Returns and Settings → Backups.", "ok")
    return 0


if __name__ == "__main__":
    code = 0
    try:
        code = main()
    except UpdateError as exc:
        say(str(exc), "bad")
        code = 1
    except KeyboardInterrupt:
        say("Stopped by the user.", "bad")
        code = 1
    log = write_log()
    if log:
        print(f"\n  Log: {log}")
    sys.exit(code)
