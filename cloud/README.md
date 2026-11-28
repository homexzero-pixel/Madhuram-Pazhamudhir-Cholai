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
   The printed bill follows the shop's own bill: name, address, phone and GSTIN at the top; No / Product / Qty / GST% / Rate / Amount;
   total, tax, net total, the amount in words, the GST table, the payment, "THANK U VISIT AGAIN" and the bill number between stars.
   Bill numbers look like `MU/1126/T2/107`: prefix / month and year / counter / number, and each counter starts again at 1 every
   month. Set the prefix to `MU` from the 1st of the month you stop using the old billing machine, so no two bills share a number.
   **At the counter:** the shift opens by itself (no opening cash to type; the drawer is counted at closing). Keys: F6 cash exact,
   F3 UPI, F12 payment, F7 customer (also inside the payment window, and after the sale to send the bill on WhatsApp), F10 hold,
   F11 bills on hold (numbered 1, 2, 3; press the number to bring one back; they also show as chips at the top), F9 cancel.
   Under the bill are three big buttons, **Cash**, **UPI** and **Card** (each takes the whole bill), and **Payment** for cash given /
   change / split. The payment window opens with the same three big choices.
   **Who can do what:** only the **owner** sees the Dashboard and Reports (and the day summary), changes GST (a product's GST rate,
   type and HSN, the GSTIN, the GST rule for billing), manages staff logins, downloads backups and uses Start fresh. Every other login
   (**counter person**) can do everything else: billing, prices and discounts, returns, credit, online orders, products and stock,
   customers, daily tools and settings. A product a counter person adds starts with GST "Not set yet" for the owner to fill in.
   **Start fresh** (Settings & backup, owner): after testing, removes every bill, return, online order, cash drawer and expense in one go;
   a backup is saved on the server first; products, customers, staff and settings stay; the stock the test bills took goes back;
   bill numbers start again from 1.
   **Low stock** (menu) lists products at or below their low stock alert (set in each product) and best sellers with no stock.
   **Daily tools, Today's prices**: price per kg, per 250 g … or **per piece**, today's offer, and the stock on the shelf in kg, g or
   pieces (1, 2, 3), saved together. Choosing *per piece* (or *pcs* for the stock) makes the product sold by the piece at the counters and
   online after Save; choosing a weight makes it sold by kg again. The first list has the loose items sold by kg and the fruit and
   vegetables sold by the piece.
   **More than one selling price** (Products, open a product, **+ Add another selling price**): for two MRPs of the same product (old
   and new stock), small and big, or a wholesale price. Each extra price has its own MRP (empty = the product's MRP) and an optional name.
   At billing, scanning or tapping the product shows all its prices: press 1, 2, 3 … or tap one (Enter takes the first). No manager
   approval is needed for these prices, and the bill line shows the name of the price chosen. A barcode scanned while the prices are
   showing is kept and goes on the bill right after the choice.
   **Offers**: after a festival offer, "Tell your customers" shares the message on WhatsApp. **Customers**: download all (Excel).
   **Reports**: sales by day, categories by day, best products, payments and busy hours for any period; detailed reports below.
   **Product photos from a list:** Settings, Product photos, *Photos from a list (Excel or CSV)*: choose a sheet with `Product code` (or
   `Barcodes`) and `Image URL`, such as `Madhuram_Product_Images.xlsx`. The billing server downloads each photo (internet addresses
   only), the PC makes it small and it becomes the product's photo; prices, stock and photos you took yourself are not changed.
   Keep the page open while it runs (about 2 photos a second); Continue picks up where it stopped, and links that fail are listed.
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
- **Changing a quantity on the bill:** every line has **−**, the quantity and **+**. Plus / minus change it by one piece (250 g for a
  loose item); minus on the last piece shows a bin and takes the line off. Tap the quantity to type it (or press F4). The + and −
  keys do the same for the chosen line. The cursor goes back to the scan box, so the next barcode goes straight on the bill.

## Online shop look

- **Opening screen:** both sites open with the shop's logo driving in, the name and a line, then the page (about 1.5 seconds; longer
  only while a slow phone is still loading). The customers' site uses its own logo and app icon (`public/img/shop-logo.webp`,
  `shop-icon-192.png`, `shop-icon-512.png`, `shop-icon-maskable-512.png`, `shop-icon-180.png`); the billing software keeps
  `logo-full.webp` and `icon-*.png`.
- **No login needed to look around.** A first-time visitor sees *Log in* or *Continue as guest* (one tap). Logging in is asked only
  when the order is placed.
- **Get the app:** on Android phones and on PCs (Chrome / Edge) the shop offers *Install* (home page card, Profile, and a button in
  the top bar on PCs). On iPhones it shows how: Share, then *Add to Home Screen*.
- **Fast:** the home page comes in one call; the next visit opens at once from what the phone saw last time and is refreshed a moment
  later. Fonts (Poppins), program files and pictures are kept by the phone.

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
- **Quick-delivery layout (27 Nov 2026):** the home page starts with the next delivery time and the address, a search bar with a
  microphone, the customer's open order with *Track*, and the categories in one row. Section pages show the other sections on the
  left. Loose items have 250 g / 500 g / 1 kg / 2 kg buttons. The basket is one short page: the earliest time is chosen, and the
  customer picks what to do if an item is not available (call me / replace / remove) and notes for the delivery person; staff see
  both on the order and the packing list. Customers can cancel their order until the shop bills it. Search understands Tamil and
  Tanglish words (thakkali, தக்காளி, paruppu, ennai…).
- **Pay online by UPI:** Settings → *UPI QR code* (a screenshot of your GPay / PhonePe QR). Customers who choose "Pay online"
  see the QR and your UPI ID after ordering, and type the UPI transaction number; the Online orders screen shows it so you can
  check it in your UPI app before packing. (Card / netbanking through a payment gateway such as Cashfree needs their App ID
  and Secret Key; ask for it to be connected.)

## Two websites: billing and customers

| Site | Address | Hostinger web app |
|---|---|---|
| Billing (staff) | `mps.madhurampazhamudhirsolai.com` | `SITE_ROLE` = `billing` |
| Customers' shop | `madhurampazhamudhirsolai.com` | `SITE_ROLE` = `shop` |

(Until November 2026 the addresses were `mpc.zeravista.com` and `mpccustomer.zeravista.com`; see *Moving to a new domain* below.)
Both sites run the same code on the same database. The staff screens and staff API do not exist on the customers' address, and
the customers' API does not exist on the billing address.

**Recommended: a second Web App for the customers' address (same GitHub repository, same database).** The Business plan allows
5 Node.js apps. Do the steps in this order, so customers always have a working shop:

1. **Billing app (the one you have) → Redeploy** with the new code. Nothing else changes yet: the shop still opens at `/shop/`.
   The version at the bottom left of the staff screens shows `v2026.11.27` or later.
2. hPanel → **Websites → Add Website → Node.js web app**. Use the customers' domain (`madhurampazhamudhirsolai.com`) as its own
   website (if the domain's DNS is managed elsewhere, add the records hPanel shows there). **Import Git repository →
   Connect with GitHub** → this repository, branch `main`, the same root folder / entry file (`server.js`) / Node version as the
   billing app. **Environment variables:** the same `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` as the billing app
   (and `SMS_PROVIDER`, `SMS_API_KEY` if you use SMS codes), plus `SITE_ROLE` = `shop` and
   `EVENTS_SECRET` = a long random password you make up (20+ letters and numbers; never send it to anyone). Leave every other
   variable empty. Deploy, then turn on **SSL** for the new address. Product photos come over from the billing app by themselves
   (the billing site notes its own address in the shared database when staff use it, so the shop app finds it).
3. Billing app → **Environment variables**: add `SITE_ROLE` = `billing` and `EVENTS_SECRET` = the same password as step 2 →
   **Redeploy**.
4. Billing → **Settings → Customer website address**: type the customers' address and save (it is checked first: the shop must
   already open there). `/shop/` on the billing address forwards customers there, and the QR poster and WhatsApp tracking links
   use it.
5. Print a new QR poster: **Online orders → QR poster**.

*If your panel lets one Node.js app answer two addresses instead,* set `SHOP_HOST` = `madhurampazhamudhirsolai.com` and
`BILLING_HOST` = `mps.madhurampazhamudhirsolai.com` on that one app (no `SITE_ROLE`); every other address is refused.

### Moving to a new domain

No code or environment variable changes are needed. In this order:

1. Billing → **Settings → Backup → Download today's backup** (a safety copy of all the shop's data).
2. hPanel → **Websites** → the customers' website (old address) → **⋯ → Change domain** (or **Connect domain** on its dashboard)
   → the new customers' domain. If the domain was bought at another company, add the DNS records hPanel shows at that company.
   Wait until the new address opens the shop with the padlock (SSL is installed by itself; DNS can take up to 24 hours).
3. The same for the billing website → the new billing address (a subdomain such as `mps.` of the new domain works).
4. Open the new billing address and log in. The billing site notes its new address by itself (the shop app needs it for photos
   and instant order alerts).
5. **Settings → Customer website address** → the new customers' address → **Save**. The save is refused until the shop really
   opens there, so a wrong address never reaches posters or WhatsApp links.
6. **Online orders → QR poster** → print and replace the old posters. If you set up the Hostinger cron job for backups, copy the new
   command from **Settings → Backup** (it contains the address).
7. Staff log in once on the new address; on counter PCs and phones remove the old app shortcut and install it again from the new
   address. Customers log in once on the new site (accounts, orders and points are kept).

Old `SHOP_URL` / `BILLING_URL` values in the environment variables are not needed any more and can be deleted: the address in
Settings and the address the billing site noted come first. Keep `SITE_ROLE`, `EVENTS_SECRET` and the `DB_*` variables.

**Product photos after a move.** Photos are kept in the database as well as on the app's disk (from November 2026), so a new domain or
hosting folder cannot lose them again. Photos saved before that were files only: when the app starts it looks for them in the other
`madhuram_images` folders of the same hosting account (the old domain's folder) and keeps them in the database. Photos that are gone
from everywhere are taken off the products (so no broken pictures); the ones that came from your photo list are fetched again: open
**Settings → Product photos** and press **Continue** (keep the page open while it works).

| Setting | Where | Meaning |
|---|---|---|
| `SITE_ROLE` | each app | `billing` or `shop` (two apps) |
| `SHOP_HOST`, `BILLING_HOST` | one app | the two addresses (one app answering both) |
| `SHOP_URL` | billing app, optional | only used when **Settings → Customer website address** is empty |
| `EVENTS_SECRET` | both apps | the shop app wakes the billing app at once after an order (signed); without it the billing app still sees new orders within a second |
| `BILLING_URL` | shop app, optional | only used until staff have opened the billing site once (it notes its own address in the database) |
| `EVENTS_WEBHOOK_URL` | billing app, optional | every order event is also sent there, signed (for an automation) |
| `ANTHROPIC_API_KEY` | leave empty | the AI helpers were taken out of the screens (November 2026). Without this key nothing uses AI; "Ask the shop" answers from the shop's own search. |
| `AI_SHOP=off`, `AI_BILLING=off`, `AI_ALL=off` | optional | stop the AI at once on that site |
| `CORS_ALLOW` | optional | other web addresses allowed to call the API from a browser (normally none) |

**Which products appear online.** Products in the sections chosen in **Settings → Online orders → Always in stock online**
(Fresh Vegetables, Fresh Fruits and Dairy, Bread & Eggs at first) always show and can be ordered, with no stock count needed,
because the shop has them every day. Every other product shows only while *stock − stock held for open orders* is above 0:
enter its stock with Products → Stock in or a stock count. Billing at the counter is never blocked by stock.

Online orders shows how each customer pays: **UPI paid** (with the reference to check), **UPI · not paid yet**, or **Cash on
delivery / Pay at pickup**. Held stock is corrected by itself when the app starts.

**After an update or a restart** both sites open as usual: the opening screen stays a few seconds longer while the server connects
to the database, then the page appears (no "almost there" page). The tables are checked only when an update changed them, so a
restart is quick. The explanation page appears only when the database really cannot be reached (wrong password, database down).

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
