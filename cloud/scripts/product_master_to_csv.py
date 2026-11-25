"""Turn the shop's "Madhuram Product Master" Excel workbook into the CSV the cloud store imports
(Products & stock -> Import CSV). Also writes a review list of rows the owner should check.

    python product_master_to_csv.py Madhuram_Product_Master.xlsx  out_folder
"""
import csv
import sys
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

import openpyxl


def rows(ws):
    it = ws.iter_rows(values_only=True)
    head = next(it)
    return [dict(zip(head, r)) for r in it]


def num(v):
    try:
        return Decimal(str(v)) if v not in (None, "") else None
    except Exception:  # noqa: BLE001
        return None


def money(v):
    return "" if v is None else f"{v.quantize(Decimal('0.01'))}"


def main(src, out_dir):
    wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
    products = rows(wb["Products"])
    codes = defaultdict(list)
    skipped_codes = []
    for b in rows(wb["Barcode Lookup"]):
        code, pc = str(b["barcode"] or "").strip(), str(b["product_code"] or "").strip()
        if not code or not pc:
            continue
        if b.get("reason") == "Linked to multiple products":
            skipped_codes.append((code, pc, b["product_name"], "same barcode on more than one product – link it by hand"))
            continue
        if len(code) < 3:                     # e.g. "15": same as the product code, which the counter finds anyway
            if code != pc:
                skipped_codes.append((code, pc, b["product_name"], "too short to be a barcode – left out"))
            continue
        if code not in codes[pc]:
            codes[pc].append(code)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    review = []
    plus = set()
    with open(out / "madhuram_products_for_cloud.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["Product code", "Product name", "Category", "Unit", "Barcodes", "MRP", "Selling price", "GST %", "Cost", "Reorder level", "PLU"])
        for p in products:
            pc = str(p["product_code"]).strip()
            name = " ".join(str(p["product_name"] or "").split()).rstrip(",")
            if not pc or not name:
                continue
            # the source marks some packs as "decimal" too: weighed = decimal AND (kg unit or a vegetable)
            weighed = bool(p.get("decimal_quantity")) and (p.get("unit") == "kg" or (p.get("family") or "").strip().lower() == "vegetables")
            price, mrp = num(p["selling_price"]), num(p["mrp"])
            gst = (num(p["sgst_percent"]) or 0) + (num(p["cgst_percent"]) or 0)
            cost = None
            for c in (num(p["unit_price"]), num(p["wsp"])):        # purchase price: unit price, else wholesale price
                if c and c > 0 and (price is None or c <= price):
                    cost = c
                    break
            plu = pc if weighed and pc.isdigit() and len(pc) <= 5 and pc not in plus else ""
            if plu:
                plus.add(plu)
            cat = (p.get("family") or p.get("category") or "").strip()
            w.writerow([pc, name, cat, "kg" if weighed else "pcs", "|".join(codes.get(pc, [])), money(mrp) if mrp and mrp > 0 else "",
                        money(price) if price and price > 0 else "", f"{gst.normalize():f}" if gst else "0", money(cost) if cost else "",
                        f"{num(p['reorder_level']) or 0}", plu])
            if not price or price <= 0:
                review.append((pc, name, "No selling price – will not sell until you set a price"))
            elif mrp and price > mrp:
                review.append((pc, name, f"Selling price {money(price)} is more than MRP {money(mrp)} – correct one of them"))
            if not codes.get(pc):
                review.append((pc, name, "No barcode – bill it by name, product code or tile"))
            if p.get("unit") is None and not weighed:
                review.append((pc, name, "Unit not confirmed – imported as pieces"))
    for r in rows(wb["Barcode Lookup"]):
        if r.get("reason") == "Check digit mismatch":
            review.append((r["product_code"], r["product_name"], f"Barcode {r['barcode']} has a wrong check digit – check the label"))
    for code, pc, name, why in skipped_codes:
        review.append((pc, name, f"Barcode {code}: {why}"))
    with open(out / "madhuram_products_to_check.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["Product code", "Product name", "Please check"])
        w.writerows(review)
    print(f"{len(products)} products, {sum(len(v) for v in codes.values())} barcodes, {len(plus)} loose (kg) items with PLU, {len(review)} rows to check")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
