# Low-cost online hosting on a Hostinger VPS

Use this if you want to open the store system from anywhere (owner at home, a second branch later), not only on the counter PC.

> **Read first: billing needs the internet when the system is hosted online.** If the shop's connection or Hostinger is down,
> the counter cannot bill until it comes back. Keep a mobile hotspot as backup internet, and a paper bill book for emergencies.
> If offline billing matters more, keep running it on the counter PC (no hosting cost) as described in the README.

## What it costs (checked November 2026 – confirm on hostinger.in before buying)

| Item | Cost |
|---|---|
| Hostinger **VPS KVM 1** (1 vCPU, 4 GB RAM, 50 GB NVMe) | about **₹599/month on a 24-month term** (≈ ₹14,400 paid upfront), plus 18 % GST; renews at about ₹999/month |
| Domain (e.g. `madhuramstore.in`) | about ₹500–900/year, or use a subdomain of a domain you already own |
| HTTPS certificate | free (Let's Encrypt, installed by the setup script) |

KVM 1 is plenty for one shop: the system used about 0.4 ms per barcode lookup and 9 ms per scan in testing.

**Do not buy Hostinger's "Web Hosting" / shared plans** for this. They are built for PHP websites. Python/Django apps need a
VPS, where the program can run all the time.

Cheaper options exist, but they are not recommended for billing:
- **PythonAnywhere's free plan** limits CPU time per day and storage, and may stop the site if it is unused for a month.
- **"Always free" cloud servers** (e.g. Oracle Cloud) need a credit card and more technical setup.

## Steps

### 1. Buy and prepare the VPS (hPanel)

1. Buy **VPS → KVM 1**. Choose a server location in **India** (Mumbai), if offered, for speed.
2. Operating system: **Ubuntu 24.04** (plain OS, no control panel).
3. Set a strong root password. Note the server's **IP address** from hPanel → VPS → Overview.

### 2. Point your domain at the server

In your domain's DNS settings, add an **A record**: name `billing` (or `@`) → the VPS IP address.
Wait 5–30 minutes. `billing.yourshop.in` should then open nginx's or Hostinger's default page.

### 3. Copy the program and run the setup script

On the shop PC, open **PowerShell** in the folder that contains `Madhuram_Store_System.zip`:

```powershell
scp Madhuram_Store_System.zip root@YOUR_SERVER_IP:/root/
ssh root@YOUR_SERVER_IP
```

On the server (after `ssh`):

```bash
apt-get install -y unzip && unzip -o Madhuram_Store_System.zip && cd Madhuram_Store_System
sudo bash deploy/setup_vps.sh billing.yourshop.in you@example.com
```

The script takes 2–5 minutes. It:
- installs Python, nginx, a firewall (only SSH and web traffic allowed) and the free HTTPS certificate;
- runs the app as a background service that restarts on its own;
- loads the 20,000-SKU catalogue;
- schedules a checked backup every night at 23:30 India time.

### 4. Create the owner login

```bash
sudo -u madhuram env $(xargs < /etc/madhuram.env) /opt/madhuram/app/.venv/bin/python /opt/madhuram/app/manage.py create_owner
```

Open `https://billing.yourshop.in/`, log in, and continue with "First configuration" in [WINDOWS_SETUP.md](WINDOWS_SETUP.md#4-first-configuration-owner).
On the counter PC, open the address in Edge and use **⋯ → Apps → Install this site as an app** for a full-screen billing window.

## Moving your data from the counter PC

To carry over the store database you already use on the PC:

1. On the PC, run `Backup_Now.bat`. Note the backup file name in `%LOCALAPPDATA%\MadhuramPOS\store\backups\`.
2. Copy it to the server: `scp "C:\Users\<you>\AppData\Local\MadhuramPOS\store\backups\<file>.sqlite3" root@YOUR_SERVER_IP:/root/`
3. Restore it on the server:

```bash
systemctl stop madhuram
sudo -u madhuram env $(xargs < /etc/madhuram.env) /opt/madhuram/app/.venv/bin/python /opt/madhuram/app/manage.py restore_backup /root/<file>.sqlite3
systemctl start madhuram
```

## Day to day

- **Backups**: one is made every night, plus one at every shift close. **Once a week, download one to the shop PC** (Settings → Backups →
  Download) so a copy exists outside Hostinger. If your plan includes Hostinger's automatic VPS backups, they are an extra safety net, not a replacement.
- **Security built in**:
  - HTTPS only, with secure cookies.
  - Logins and approval PINs lock for 15 minutes after 5 wrong tries; every failed login is in the audit log.
  - The firewall allows only web and SSH traffic.
  - Give every staff member their own login, and disable logins for people who leave.
- **Check it is running**: `systemctl status madhuram`. **Errors**: `/var/lib/madhuram/store/app.log`.
- **Update the program**: copy the new zip, unzip, and run the same `setup_vps.sh` command again. It keeps your data and settings.

## Not tested yet

The setup script and service files were checked for syntax, and the HTTPS-behind-proxy behaviour was tested locally. Tested:
- secure cookies and HSTS;
- forged-site (CSRF) requests refused;
- wrong host names refused;
- lockout by the real client IP.

The script has **not yet been run on a real Hostinger VPS**. The first run there should be watched, and the `systemctl status madhuram`
output checked.
