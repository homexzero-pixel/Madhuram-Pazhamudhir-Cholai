# Acceptance test results

Run: 2026-11-22 15:43 · machine: Linux 6.18.44-fc-v726, Intel(R) Xeon(R) Processor @ 2.30GHz, 4 CPUs, Python 3.13.18

Produced by `python scripts/run_acceptance.py`, which uses real server processes and database files in a throw-away folder. Timings are from the machine above; the Windows counter PC will differ. Hardware (scanner, scale, thermal printer) was **not** part of this run – see docs/HARDWARE.md.

| # | Test | Result | What happened |
|---|------|--------|---------------|
| 4–9 | Automated test suite (carton conversion, FEFO/expiry, all-or-nothing sale, reprint, partial return, shift close, and more) | ✅ Pass | Ran 40 tests in 26.268s – OK in 28s |
| — | First start in store mode (migrate, load 20,000-SKU catalogue, first daily backup) | ✅ Pass | ready in 3.0s |
| 1 | Two rice packs at ₹75 + 0.375 kg apples at ₹180/kg, cash ₹250 | ✅ Pass | weight asked: True; total ₹217.50; bill MPC/2627/00001 saved; change ₹32.50 |
| 2 | Unknown barcode keeps the bill intact | ✅ Pass | refused with 'Unknown barcode 8909999999994. Nothing was added to the bill.'; bill still 1 line, ₹75.00 |
| 3 | Barcode beginning with 0: import, restart, scan | ✅ Pass | stored as '0890105800007'; app restarted in 0.5s; scan found Sunflower oil · test brand · 1 L; the same digits without the 0 are refused; paid by UPI (MPC/2627/00002) |
| 10 | Restore a backup into a separate test database | ✅ Pass | backup madhuram-store-20261122-211413-manual.sqlite3.gz; restored DB matches live: last bill MPC/2627/00002 ₹165.00, 3 items with stock (e.g. ACC-RICE 18, ACC-APPLE 11.625), shift 1 expected ₹717.50 counted ₹717.50 variance ₹0.00 (cash sales ₹217.50, UPI ₹165.00 not in drawer) |
| 11 | 20,000 SKUs: barcode lookup and product search | ✅ Pass | 20003 SKUs, 20003 barcodes. Barcode lookup: median 0.49 ms, p95 0.62 ms (2000 lookups). Scan → bill updated over HTTP: median 12.2 ms, p95 18.0 ms. Product search (English/Tamil/SKU over all 20,000): median 19.4 ms, p95 21.6 ms; over HTTP median 23.3 ms. |

Tests 4–9 are in `sales/tests/test_acceptance.py`:

- 4 `A04_CartonConversion`: 2 cartons × 24 received → 48 in stock; 3 sold → 45; duplicate supplier invoice refused.
- 5 `A05_FEFO`: lot expiring in 1 day sold before the lot expiring in 5 days; an expired lot is refused at the scanner; receiving already-expired stock is refused.
- 6 `A06_AllOrNothing`: a bill with one valid and one short line fails at payment; no sale, payment or stock movement is written. A double-clicked payment makes one sale.
- 7 `A07_PrinterFailureReprint`: the sale exists once; reprinting twice is marked DUPLICATE, counted, and creates no new sale, payment or stock change.
- 8 `A08_PartialReturn`: 3 rice at the ₹70 offer price (₹75 list); returning 1 refunds ₹70, 2 remain returnable, the unit goes back to sellable stock; returning more than remains is refused; weighed 0.500 kg return refunds ₹90 and reverses 0.67 loyalty points.
- 9 `A09_ShiftClose`: ₹1,000 float + ₹300 cash sales − ₹100 cash refund − ₹50 cash expense = ₹1,150 expected; UPI, card, a UPI refund and a UPI expense do not change it.
