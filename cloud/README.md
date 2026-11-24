# Madhuram Store – cloud edition (Hostinger Business plan)

One store on the internet: every counter PC, the owner's phone and the home PC use the same products, stock, bills and cash.
Node.js 20+ and MySQL / MariaDB. No build step. Start file: `server.js`.

**Stage 1 (this version):** login and staff roles, products (add, edit, barcodes, CSV import of the 20,000-product list), stock in /
write-off with expiry (first-expiry-first-out), fast billing (barcode, PLU, weighing-scale labels, tap tiles, search in English and
Tamil, customer, price change and discount with manager PIN, hold, cancel), cash / UPI / card / split payment, 80 mm or 58 mm
printed bill for every sale, reprint, cash closing per counter, owner dashboard on the phone, backup download, bring-over of the
shop PC's data, and **Install on this PC**.

**Stage 2 (next):** purchases and suppliers, returns, reports, owner tools (today's prices, buy list, loss watch), online orders,
WhatsApp bills.

## Put it on Hostinger (about 20 minutes, once)

1. **hPanel → Databases → MySQL Databases.** Create a database, e.g. name `madhuram`, user `madhuram`, a strong password.
   Note the full names Hostinger shows (they start with `u123456789_`). Host is `localhost`.
2. **hPanel → Websites → Add website → Node.js Apps** (on newer panels: *Deploy a Node.js app*). Choose your domain or a
   subdomain such as `billing.yourshop.in`.
   - Upload: either connect this GitHub repository (root folder `cloud`) or upload `Madhuram_Cloud.zip`.
   - Node version **20** or newer. Entry file **`server.js`**. Install command `npm install` (default). Start: `npm start`.
   - **Environment variables:** `DB_HOST=localhost`, `DB_PORT=3306`, `DB_USER=…`, `DB_PASSWORD=…`, `DB_NAME=…` (from step 1).
3. Deploy. Open the address. The **first-time setup** page asks for the owner login and approval PIN.
4. Turn on **SSL** for the domain (hPanel → Security → SSL) so the address starts with `https://` – needed for "Install".
5. **Settings & backup:** fill in the shop details (printed on the bill), counter names, bill prefix.
6. Products – either
   - **Bring data from the shop PC:** on the shop PC double-click `Export_For_Cloud.bat` (it is in the Madhuram folder) and upload
     the file it puts on the desktop. Products, prices, barcodes, stock, customers and staff (with their passwords and PINs) come over.
     Only possible before the first cloud bill.
   - or **Products & stock → Import CSV** with `data/Madhuram_20000_SKUs.csv`, then give prices to what you sell.

## Each counter PC (2 minutes)

Open the address in Microsoft Edge, log in, **Install on this PC** → click your counter's button. Run the small file that
downloads. The desktop icon **Madhuram Counter N** opens the store in its own window and prints bills straight to the default
printer (no print window). Set the thermal printer as the Windows default printer.

Owner phone: open the address in Chrome → ⋮ → **Install app** / Add to Home screen → Owner dashboard.

## Daily

- Morning: each counter **opens its shift** (opening cash). Evening: **Cash closing** per counter.
- Evening: **Settings & backup → Download backup now**; keep the file in Google Drive. Hostinger also keeps daily backups.
- **Internet is needed to complete a bill.** If the internet stops, the open bill stays on the screen; complete it when the internet
  returns. Keep a mobile hotspot ready. (The shop PC version keeps working without internet, if you prefer that at the counter.)

## Updates

Push to GitHub (or upload a new ZIP) and press **Redeploy** in hPanel. Database tables are updated automatically at start. The PCs
pick up the new version by themselves.

## For developers

```
npm install
DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=… DB_PASSWORD=… DB_NAME=madhuram_test npm test   # database name must contain "test"; it is wiped
npm start
```
Money is kept in paise and quantities in thousandths (exact integers) in JavaScript, and as DECIMAL in MySQL. Every bill is saved in
one transaction that locks the stock lots (first expiry first) and the bill-number row, so several counters never share a number or
sell the same stock twice; a bill sent twice (network drop) is saved once.
