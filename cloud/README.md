# Madhuram Store – cloud edition (Hostinger Business plan)

One store on the internet: every counter PC, the owner's phone and the home PC use the same products, stock, bills and cash.
Node.js 20+ and MySQL / MariaDB. No build step. Start file: `server.js`.

**Billing and stock:** login and staff roles, products (add, edit, barcodes, CSV import of the 20,000-product list), stock in /
write-off with expiry (first-expiry-first-out), fast billing (barcode, PLU, weighing-scale labels, tap tiles, search in English and
Tamil, customer, price change and discount with manager PIN, hold, cancel), cash / UPI / card / credit / split payment, 80 mm or
58 mm printed bill for every sale, reprint, cash closing per counter, **Install on this PC**.

**Stage 2 (version 2026.11.25):**
- **Purchases & suppliers:** enter the supplier's bill line by line (qty, free qty, rate or amount, expiry, new selling price). Stock
  goes up, cost is worked out including free goods. Supplier balances, payments (cash from a counter drawer, UPI or bank).
- **Returns:** find the bill, choose quantities, back on the shelf or damaged, money back by cash / UPI / off the customer's credit.
  Manager PIN, credit-note number (MCN/…), printed return slip.
- **Customers & credit (udhaar):** credit sale with manager approval, what each customer owes, payment received (cash goes into the
  drawer), WhatsApp reminder in English and Tamil.
- **Online orders:** customers open `your-address/shop/` (or scan the QR poster), see what is in stock with prices, search or scan a
  barcode with the phone camera, choose takeaway or home delivery and a time slot, and track the order. Ordered stock is held.
  Staff get a red count and a chime, accept, print the packing list, WhatsApp the customer, and **Bill this order at this counter**.
- **WhatsApp bills (free):** after a sale with a customer's mobile, a "WhatsApp bill" button opens the shop's WhatsApp with the bill
  ready. The paper bill still always prints.
- **Reports:** sales by day / product / category / hour / cashier, GST summary and HSN summary for the accountant, bill register,
  returns, purchases, write-offs, cash closing, stock value, expiring soon, not sold in 30 days, credit outstanding, supplier
  balances. Every report downloads for Excel (CSV).
- **Owner tools:** day summary on WhatsApp, today's prices (fast rate change + printable price board), buy list from real sales
  (WhatsApp the order to the supplier), loss watch (cancelled bills, removed items, price changes, discounts, refunds, reprints,
  cash short – per person).
- **Automatic backups on the server** every evening after 9 pm (kept 14 days + 12 months, outside the app folder), "Save a backup
  now", download any of them, and an optional Hostinger cron job address for extra safety.

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
5. **Settings & backup:** fill in the shop details (printed on the bill), counter names, bill prefix, WhatsApp, UPI ID, and – when you
   are ready – **Online orders** (hours, slot length, delivery charge, minimum order). Print the QR poster from **Online orders**.
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
- Evening: the server saves a backup by itself. Once a week also **Settings & backup → Download backup to this PC** and keep the
  file in Google Drive. Hostinger also keeps its own daily backups.
- Evening: **Owner tools → Day summary → Send on WhatsApp** to see the day on your phone.
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

## Customers' accounts and SMS codes (optional)

Customers sign up in the online shop with their mobile number and a password; they must be logged in to place an order.
To check that the mobile number really belongs to them (a 6-digit code by SMS at sign-up, and "Forgot password"):

1. Make an account at **fast2sms.com**, add some balance, and copy your **API key** (Dev API).
2. Hostinger → your Web App → **Environment variables**: add `SMS_PROVIDER` = `fast2sms` and `SMS_API_KEY` = your key → **Redeploy**.

Without these, accounts still work (mobile + password); staff see "phone not verified" on such orders and can call to confirm,
and a customer who forgets the password calls the shop: **Customers & credit → the customer → Set online password**.
