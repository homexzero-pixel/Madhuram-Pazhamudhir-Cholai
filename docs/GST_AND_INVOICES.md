# GST, invoices and what the accountant must confirm

**This software is not described as GST-compliant until the store's accountant has reviewed the settings below and a sample of
bills, credit notes and reports.** What follows is what the software does today, with the rules it was designed against.

## What the software does

| Topic | Behaviour |
|---|---|
| Bill numbers | `PREFIX/FY/00001`, e.g. `MPC/2627/00001` (14 characters). A new, gap-free, consecutive series starts each financial year (April–March). Numbers are taken inside the sale transaction, so a failed sale does not use up a number. Only letters, digits, `/` and `-` are used, and the length is checked against 16 characters. |
| Credit notes (returns) | Separate series `MCN/FY/00001`, each referring to the original bill number and date. |
| Document title | Store **without a GSTIN** set: "Cash memo". With a GSTIN: "Tax invoice" when every line is taxable, "Bill of supply" when none is, and "Invoice-cum-bill of supply" when a bill mixes taxable and exempt/nil items. |
| Prices | Treated as **GST-inclusive** (retail/MRP convention). Each line's taxable value and CGST/SGST (half each, intra-state Tamil Nadu) are worked out from the rate and stored on the bill line at the time of sale. |
| Tax data per item | HSN (4/6/8 digits), treatment (taxable / exempt / nil / non-GST / **not set**) and rate. **The starter catalogue has none of these**; they are blank until the store enters them. Items "not set" are printed and reported separately. |
| Snapshot | The store name, address and GSTIN, and each line's price, discount, HSN, rate and tax split, are frozen on the bill. Later changes to products or settings do not alter past bills. |
| Optional safety switch | *Block billing of items whose GST treatment is not set*: turn it on once tax data is complete. |
| Reports | Tax summary by treatment, HSN and rate (sales minus returns), plus the sales, returns and purchase registers. |

## Rules referred to

- CGST Rule 46 (tax invoice particulars). The invoice serial number must be consecutive, at most 16 characters, and use only
  letters, numerals, hyphen and slash, unique for the financial year:
  [CBIC Rule 46](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html).
  Practitioner notes on starting a new series each financial year: [TaxGuru](https://taxguru.in/goods-and-service-tax/commentary-tax-invoice-number-gst.html).
- CGST Rule 49 (bill of supply for exempt/nil supplies) and Rule 46A (single "invoice-cum-bill of supply" when a registered person
  supplies both taxable and exempt goods to an **unregistered** person):
  [Rule 46A text](https://www.gstzen.in/a/invoice-cum-bill-of-supply-cgst-rule-46a.html),
  [Rule 49 text](https://www.taxheal.com/rule-49-cgst-rules-2017.html).

These were read from secondary sources on 20-11-2026. The official CBIC text should be checked by the accountant.

## Accountant checklist

1. Registration type: regular or composition. A composition dealer issues a *bill of supply* only and charges no GST. **If the
   store is under composition, tell us: the document titles and tax lines must change.**
2. GSTIN, legal name and address as registered; state code 33 (Tamil Nadu).
3. Invoice prefix and series. Confirm whether one series per financial year is wanted, and whether a separate series is needed
   for a second counter (not supported yet).
4. HSN code, treatment and rate for every active item. Fresh fruit and vegetables are usually exempt; packaged, labelled goods
   often are not. **Do not copy rates from the internet; use the store's own classification.**
5. Whether the consolidated daily invoice for small unregistered sales (Rule 46 proviso) is used. The software issues a bill for
   every sale.
6. Business customers (B2B) with a GSTIN: the customer's GSTIN prints on the A4 invoice. Check the full B2B particulars, and
   whether e-invoicing applies to the store's turnover. **E-invoicing is not built.**
7. Credit notes for returns: confirm the format and that the "Returns register" gives what is needed for GSTR-1.
8. Cess, inter-state sales and reverse-charge are **not handled**.
9. Rounding: bills are exact to the paisa, with no rounding to the rupee. Confirm this is acceptable.
10. After review, switch on *Block billing of items whose GST treatment is not set*.

## Not built

E-invoice (IRN/QR), e-way bills, GSTR export files, cess, inter-state IGST, composition-scheme layouts, and purchase-side input-tax
reports (supplier invoices are recorded by total).
