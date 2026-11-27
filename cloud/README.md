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
- **Online orders:** customers open the customers' site (or scan the QR poster), see only what is available with prices, search or
  scan a barcode with the phone camera, choose takeaway or home delivery and a time slot, and track the order. Ordered stock is
  reserved at once, so two customers can never buy the last piece. Staff get a chime and a red count at once, then:
  **Accept → Bill & pack** (GST invoice at the counter, "Cash on delivery" or UPI) **→ Out for delivery** (delivery person's name,
  phone, tracking) or **Ready for pickup → Process completed** (stock leaves, cash on delivery goes into the drawer, the customer can
  download the invoice). Cancel before billing frees the stock; after billing a manager approves a credit note.
  See [ARCHITECTURE.md](ARCHITECTURE.md) for the whole design.
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

## Online shop look

- The shop (`/shop/`) works on phones and PCs: home with banners, categories, offers and best sellers; search with sort and
  filters; product details with "Add to Basket"; basket with delivery or takeaway and a time; order tracking; profile with
  loyalty points and saved items.
- **Banner photos** (optional): Settings & backup → Online orders → *Banner photos*. Take a wide photo of your fresh stock or a
  festival offer, write a small line, big words and a last line, choose what the button opens, then **Save**. Without photos the
  shop shows its own banners (offers, fresh produce, free delivery, loyalty points).
- Products without a photo show a picture chosen from the name (tomato, onion, banana, soap…). These pictures are Microsoft
  Fluent Emoji, free to use under the MIT licence (`public/fe/LICENSE.txt`). A photo you add for a product always replaces it.
- **Real photos everywhere:** run *Products & stock → Find photos by barcode* once. Packaged products get their real photos, and
  the banners and category tiles start using them. For fruits and vegetables, photograph your own stock (Products → photo button,
  or many at once with file names = barcode / product code).
- **Sections:** the shop groups products like Grocery & Kitchen, Snacks & Drinks, Beauty & Personal Care, Household Essentials,
  worked out from the product names. To move a product, open it in Products & stock → *Section in the online shop*.
- **Festival:** Settings → *Festival banner* (name, dates, photo). Empty name = the next festival from the calendar. For a real
  festival discount use Daily tools → Offers → *Offer on a whole category*; the counters and the shop both use it on those dates.
- **Price stores** (₹9, ₹19, ₹29, ₹49, ₹99, ₹119 — change them in Settings), **New launch** (products added after the first
  import, last 45 days), **Suggested for you** and **Buy again** (from the customer's own bills and orders).
- **Customers' profile:** orders with items, wishlist, address book with a default address, edit name / mobile / email,
  help & support (call or WhatsApp: Settings → *WhatsApp number for customer help*), refer a friend (Settings → *Points when a
  referred friend shops*; needs loyalty points on).
- **Pay online by UPI:** Settings → *UPI QR code* (a screenshot of your GPay / PhonePe QR). Customers who choose "Pay online"
  see the QR and your UPI ID after ordering, and type the UPI transaction number; the Online orders screen shows it so you can
  check it in your UPI app before packing. (Card / netbanking through a payment gateway such as Cashfree needs their App ID
  and Secret Key; ask for it to be connected.)

## Two websites: billing and customers (mpccustomer.zeravista.com)

The staff keep the current address. Customers get their own address, `mpccustomer.zeravista.com`, served by the same code and the same
database. The staff screens and staff API do not exist on the customers' address, and the customers' API does not exist on the
billing address.

**Recommended: a second Web App for the customers' address (same GitHub repository, same database).** The Business plan allows
5 Node.js apps. Do the steps in this order, so customers always have a working shop:

1. **Billing app (the one you have) → Redeploy** with the new code. Nothing else changes yet: the shop still opens at `/shop/`.
   The version at the bottom left of the staff screens shows `v2026.11.27` or later.
2. hPanel → **Websites → Add Website → Node.js web app**. Use the domain `mpccustomer.zeravista.com` as its own website (not a folder
   of zeravista.com; if the domain's DNS is managed elsewhere, add the record hPanel shows there). **Import Git repository →
   Connect with GitHub** → this repository, branch `main`, the same root folder / entry file (`server.js`) / Node version as the
   billing app. **Environment variables:** the same `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` as the billing app
   (and `SMS_PROVIDER`, `SMS_API_KEY` if you use SMS codes), plus `SITE_ROLE` = `shop`, `BILLING_URL` = `https://<your billing address>`,
   `EVENTS_SECRET` = a long random password you make up (20+ letters and numbers; never send it to anyone). Leave every other
   variable empty. Deploy, then turn on **SSL** for the new address. Product photos come over from the billing app by themselves.
3. Billing app → **Environment variables**: add `SITE_ROLE` = `billing`, `SHOP_URL` = `https://mpccustomer.zeravista.com`,
   `EVENTS_SECRET` = the same password as step 2 → **Redeploy**. From now on `/shop/` on the billing address forwards customers to
   the new address.
4. Print a new QR poster: **Online orders → QR poster** now points to `https://mpccustomer.zeravista.com/`.

*If your panel lets one Node.js app answer two addresses instead,* set `SHOP_HOST` = `mpccustomer.zeravista.com` and
`BILLING_HOST` = `<your billing address>` on that one app (no `SITE_ROLE`); every other address is refused.

| Setting | Where | Meaning |
|---|---|---|
| `SITE_ROLE` | each app | `billing` or `shop` (two apps) |
| `SHOP_HOST`, `BILLING_HOST` | one app | the two addresses (one app answering both) |
| `SHOP_URL` | billing app | the customers' address, for QR posters, WhatsApp tracking links and redirects |
| `BILLING_URL`, `EVENTS_SECRET` | shop app (secret on both) | the shop app wakes the billing app at once after an order (signed); without them the billing app still sees new orders within a second |
| `EVENTS_WEBHOOK_URL` | billing app, optional | every order event is also sent there, signed (for an automation) |
| `ANTHROPIC_API_KEY` | optional, either app | turns on the AI in "Ask the shop" (shop app) and the AI summary on Checks & AI (billing app). Without it everything works and "Ask the shop" answers from the shop's own search. Put the key only in hPanel. |
| `AI_SHOP=off`, `AI_BILLING=off`, `AI_ALL=off` | optional | stop the AI at once on that site |
| `CORS_ALLOW` | optional | other web addresses allowed to call the API from a browser (normally none) |

**Important: products need stock to appear online.** The customers' site shows a product only while
*stock − stock held for open orders* is above 0. Products whose stock was never entered (0) are not shown. Enter stock with
Purchases, Products → Stock in, or a stock count. Billing at the counter is still never blocked by stock.

**Checks & AI** (Online orders → Checks & AI): products with more held than in stock, orders waiting too long, cash on delivery not
handed in, a **Correct held stock** button, the AI switches and the AI log (personal details masked).

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
