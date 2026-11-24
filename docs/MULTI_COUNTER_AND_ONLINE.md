# Several counters, owner on mobile, and online orders

```
                 internet (free Cloudflare Tunnel, https://billing.yourshop.in)
                    │                                  │
          owner's mobile / home                customers' phones
          (dashboard, reports,                 (/shop/ – see stock,
           Owner tools)                          order takeaway / delivery)
                    │                                  │
  ┌──────────────── SHOP SERVER PC (Counter 1) ──────────────────┐
  │  Madhuram Store + the database + both backups + the tunnel    │
  └───────────────────────────┬───────────────────────────────────┘
          shop Wi-Fi / network (works even when the internet is down)
      ┌──────────┬──────────────┼──────────────┬──────────┐
  Counter 2   Counter 3     Counter 4      Counter 5   Counter 6 …
  (Edge window only – nothing to install)
```

**Cost:** ₹0 for software and the tunnel. A web address (domain) costs about ₹500–900 a year. A spare PC or a small mini PC can be the
server; any of the counter PCs can do it too.

- All counters share **one stock and one bill series**; each counter has **its own shift and cash drawer**.
- If the **internet** is down, every counter keeps billing over the shop network. Only the owner's remote access and online orders stop.
- If the **shop server PC** is off, no counter can bill: keep it on a UPS and switched on during opening hours.

## 1. The shop server (once)

1. Install as usual on the server PC (`Install_Madhuram.bat`, see [WINDOWS_SETUP.md](WINDOWS_SETUP.md)).
2. Double-click **`Setup_Shop_Server.bat`**. Click **Yes** when Windows asks. Write down the address it shows, e.g. `192.168.1.20`.
3. Ask whoever installed the Wi-Fi router to give this PC a **fixed address** (DHCP reservation), and set the network to **Private** in
   Windows Settings → Network.
4. In the store: **Settings → Counters & online shop → Counter names** lists the counters (Counter 1 … Counter 6 by default).

## 2. Each extra counter PC (2 minutes each)

1. Copy **`Setup_Counter_PC.bat`** to the PC (USB stick or WhatsApp to yourself) and double-click it.
2. Type the server address (e.g. `192.168.1.20`) and this counter's number (2, 3, 4 …).
3. A desktop shortcut **Madhuram Counter 2** is created and also starts with Windows. Bills print straight to this PC's default printer.
4. Log in, then **Cash Closing → Open shift** with this drawer's float. The billing screen shows the counter name at the top; click it to
   change. Each counter closes its own shift.

## 3. Online: owner from home and customer orders

You need: a free Cloudflare account and a domain (e.g. `madhuramstore.in`, about ₹500–900/year from any registrar).

1. Sign up at **dash.cloudflare.com** (free plan) → **Add a site** → your domain → follow the steps to change the domain's
   nameservers at the registrar (it can take a few hours).
2. Cloudflare → **Zero Trust** → **Networks → Tunnels** → **Create a tunnel** → *Cloudflared* → name it `madhuram` → on the
   "Install connector" page **copy the token** (the long text after `service install`).
3. On the shop server double-click **`Setup_Online_Access.bat`**, paste the token, press Enter, click **Yes**.
4. Back in Cloudflare, **Public hostname**: subdomain `billing`, domain `madhuramstore.in`, **Service `HTTP`**, URL `localhost:8765` → Save.
5. In the store: **Settings → Counters & online shop → Public web address** `https://billing.madhuramstore.in`, then restart
   Madhuram Store.
6. Test on your mobile **using mobile data** (not the shop Wi-Fi): open the address and log in.

**Owner on mobile:** open the address in Chrome → ⋮ → **Add to Home screen**. The dashboard, Online orders, Owner tools and reports work on
the phone (menu button at the top).

**Safety:** the login page is now on the internet. Use strong passwords, one login per person, and disable logins of people who leave.
Five wrong passwords lock that login for 15 minutes. For extra safety Cloudflare **Access** (free up to 50 people) can ask staff for an
email code before the login page; leave `/shop/` and `/static/` open for customers.

## 4. Online orders

**Settings → Counters & online shop:** turn on **Online orders**, choose Takeaway and/or Home delivery, delivery area, minimum order,
delivery charge (and "free above"), order hours, slot length, how soon the first slot starts and how many days ahead.

**Customers** scan the QR poster (**Online orders → QR poster for customers**, print and stick it up) or open
`https://billing.yourshop.in/shop/`:
- see what is **in stock now** with prices, in English and Tamil; search, or **Scan** a pack's barcode with the phone camera
  (Android Chrome; others type the number);
- add to cart, choose **Takeaway** or **Home delivery**, the day and time slot, name, mobile, address, cash or UPI;
- get a tracking page that updates by itself (New → Accepted → Ready / Out for delivery → Completed).

What is ordered is **held** for the customer: the online shop shows less available until the order is billed or cancelled.

**Staff:** a red count appears on **Online orders** and a chime sounds on every staff screen when an order arrives.
1. Open the order → **Accept – start packing** → **Print packing list** and pack.
2. **WhatsApp the customer** sends the status message (free, from the shop's WhatsApp).
3. **Packed – ready for pickup** or **Out for delivery**.
4. When the customer collects / the delivery person returns: **Bill this order at this counter**. Every item (and the delivery charge)
   goes onto this counter's bill with the customer; correct weighed items with **F4**, take payment (**F10** cash / **F3** UPI), the
   receipt prints, stock goes down and the order shows **Completed**.
5. **Cancel order** needs a reason, which the customer sees; the held stock is released.

Delivery charge appears on the bill as the product "Home delivery charge" (Services). Ask the accountant how GST applies to it.

## Not tested yet

Everything above was tested on the development machine, including several counters billing into one database, an order placed from a
phone-sized browser and billed at Counter 2, and the online-shop checks. **Not yet tested:** the Windows firewall and counter-PC
shortcuts on real PCs, the Cloudflare tunnel with your domain, and camera scanning on your customers' phones.
