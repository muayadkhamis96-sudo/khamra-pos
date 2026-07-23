#!/usr/bin/env bash
# Khamra POS — ONE-TIME VPS setup. Run ON the VPS as root:
#   curl -fsSL https://raw.githubusercontent.com/muayadkhamis96-sudo/khamra-pos/main/server/vps-setup.sh | bash
# (or clone first and run server/vps-setup.sh). Idempotent — safe to re-run.
set -euo pipefail

REPO=https://github.com/muayadkhamis96-sudo/khamra-pos.git
APP_DIR=/opt/khamra-pos
CADDYFILE=/opt/spintt-academy/Caddyfile
CADDY_CONTAINER=spintt-academy-caddy-1
URL=https://khamra.38.54.116.48.sslip.io

# 1) checkout
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin main && git -C "$APP_DIR" reset --hard -q origin/main
else
  git clone -q "$REPO" "$APP_DIR"
fi
echo "✓ checkout at $(git -C "$APP_DIR" log --oneline -1)"

# 2) build + start the container (app + API, data on the khamra_data volume)
(cd "$APP_DIR/server" && docker compose up -d --build 2>&1 | tail -1)
echo "✓ khamra-api up"

# 3) Caddy vhost (append once, then reload)
if ! grep -q "khamra.38.54.116.48.sslip.io" "$CADDYFILE"; then
  cat "$APP_DIR/server/Caddyfile.khamra" >> "$CADDYFILE"
  docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile
  echo "✓ Caddy vhost added + reloaded"
else
  echo "✓ Caddy vhost already present"
fi

# 4) nightly DB backup at 03:30 (30 dated copies kept)
mkdir -p "$APP_DIR/backups"
chmod +x "$APP_DIR/server/backup.sh"
CRON_LINE="30 3 * * * $APP_DIR/server/backup.sh >> $APP_DIR/backups/backup.log 2>&1"
( crontab -l 2>/dev/null | grep -v khamra-pos/server/backup.sh ; echo "$CRON_LINE" ) | crontab -
echo "✓ nightly backup cron installed"

# 5) health check
sleep 2
app=$(curl -s -o /dev/null -w '%{http_code}' "$URL/")
api=$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/health")
if [ "$app" = "200" ] && [ "$api" = "200" ]; then
  echo "✓ LIVE: $URL (app $app, api $api)"
else
  echo "✗ app=$app api=$api — logs: docker logs khamra-api --tail 30; docker logs $CADDY_CONTAINER --tail 30"
  exit 1
fi
