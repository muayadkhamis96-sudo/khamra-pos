#!/usr/bin/env bash
# Khamra POS — deploy the pushed main branch to the VPS.
#
# Healthy path: test locally (DEV=1 node server/server.js) → commit → git push
# → ./deploy.sh. Refuses to deploy anything not committed AND pushed, so
# what's live is always exactly what's on GitHub.
# First-time server setup is server/vps-setup.sh — this script is for updates.
set -euo pipefail

VPS=root@38.54.116.48
APP_DIR=/opt/khamra-pos
URL=https://khamra.38.54.116.48.sslip.io

# 1) refuse uncommitted / unpushed work
if [ -n "$(git status --porcelain)" ]; then
  echo "✗ Uncommitted changes — commit (and push) first."; exit 1
fi
git fetch -q origin main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "✗ HEAD is not pushed to origin/main — git push first."; exit 1
fi

# 2) local sanity: all JS parses (client and server)
for f in js/*.js server/server.js sw.js; do node --check "$f"; done
echo "✓ local checks passed — deploying $(git log --oneline -1)"

# 3) fast-forward the VPS checkout and rebuild the container (the image
#    carries the static app, so every deploy rebuilds — it's a fast COPY)
ssh "$VPS" "cd $APP_DIR && git fetch -q origin main && git reset --hard -q origin/main \
  && echo \"✓ VPS at \$(git log --oneline -1)\" \
  && cd server && docker compose up -d --build 2>&1 | tail -1"

# 4) verify the site and the API answer
code=$(curl -s -o /dev/null -w '%{http_code}' "$URL/")
api=$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/health")
if [ "$code" = "200" ] && [ "$api" = "200" ]; then
  echo "✓ live: $URL (app $code, api $api)"
else
  echo "✗ app=$code api=$api — logs: ssh $VPS 'docker logs khamra-api --tail 30'"; exit 1
fi
