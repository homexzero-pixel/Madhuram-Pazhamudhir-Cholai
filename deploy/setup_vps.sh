#!/usr/bin/env bash
# Madhuram store system – one-time setup on a fresh Ubuntu 22.04 / 24.04 VPS (e.g. Hostinger KVM 1).
# Run from the unzipped program folder, as root:
#     sudo bash deploy/setup_vps.sh billing.yourshop.in you@example.com
# It installs Python, nginx and a free HTTPS certificate, runs the app as a service,
# and makes a checked backup every night. Safe to run again after updating the program.
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "Usage: sudo bash deploy/setup_vps.sh <domain> <email for the HTTPS certificate>"; exit 1
fi
if [[ $EUID -ne 0 ]]; then echo "Run with sudo / as root."; exit 1; fi
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/madhuram/app
DATA=/var/lib/madhuram

echo "== Packages"
apt-get update -q
DEBIAN_FRONTEND=noninteractive apt-get install -yq python3-venv python3-pip nginx certbot python3-certbot-nginx ufw sqlite3 rsync

echo "== Service user and folders"
id madhuram >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/madhuram --shell /usr/sbin/nologin madhuram
mkdir -p "$APP" "$DATA"
rsync -a --delete --exclude .venv --exclude staticfiles --exclude '__pycache__' "$SRC/" "$APP/"
chown -R madhuram:madhuram /opt/madhuram "$DATA"
chmod 750 "$DATA"

echo "== Python environment"
sudo -u madhuram python3 -m venv "$APP/.venv"
if [[ -d "$APP/wheels" ]]; then
  sudo -u madhuram "$APP/.venv/bin/pip" install -q --no-index --find-links "$APP/wheels" -r "$APP/requirements.txt" \
    || sudo -u madhuram "$APP/.venv/bin/pip" install -q -r "$APP/requirements.txt"
else
  sudo -u madhuram "$APP/.venv/bin/pip" install -q -r "$APP/requirements.txt"
fi

echo "== Settings (/etc/madhuram.env)"
if [[ ! -f /etc/madhuram.env ]]; then
  cat > /etc/madhuram.env <<ENV
MPC_MODE=store
MPC_DATA_DIR=$DATA
DJANGO_ALLOWED_HOSTS=$DOMAIN
MPC_HTTPS=1
ENV
fi
chown root:madhuram /etc/madhuram.env; chmod 640 /etc/madhuram.env
run() { sudo -u madhuram env $(grep -v '^#' /etc/madhuram.env | xargs) "$APP/.venv/bin/python" "$APP/manage.py" "$@"; }
run migrate -v0
run collectstatic --noinput -v0

echo "== Service"
install -m 644 "$APP/deploy/madhuram.service" /etc/systemd/system/madhuram.service
install -m 644 "$APP/deploy/madhuram-backup.service" /etc/systemd/system/madhuram-backup.service
install -m 644 "$APP/deploy/madhuram-backup.timer" /etc/systemd/system/madhuram-backup.timer
systemctl daemon-reload
systemctl enable --now madhuram.service madhuram-backup.timer
systemctl restart madhuram.service

echo "== nginx"
sed "s/__DOMAIN__/$DOMAIN/g" "$APP/deploy/nginx-madhuram.conf" > /etc/nginx/sites-available/madhuram
ln -sf /etc/nginx/sites-available/madhuram /etc/nginx/sites-enabled/madhuram
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "== Firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

echo "== HTTPS certificate (the domain must already point to this server)"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || {
  echo "!! Certificate not issued yet. Point $DOMAIN's A record to this server's IP, wait a few minutes, then run:"
  echo "   certbot --nginx -d $DOMAIN --redirect"; }

echo
echo "Done. Next:"
echo "  1. Create the owner login:  sudo -u madhuram env \$(xargs < /etc/madhuram.env) $APP/.venv/bin/python $APP/manage.py create_owner"
echo "  2. Open https://$DOMAIN/ and log in."
echo "  3. Download a backup to the shop PC every week (Settings → Backups → Download)."
