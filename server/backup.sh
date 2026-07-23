#!/usr/bin/env bash
# Khamra POS — nightly SQLite snapshot. The DB lives on the khamra_data
# volume; copy it out with a throwaway container, keep 30 dated files.
set -euo pipefail
OUT=/opt/khamra-pos/backups
mkdir -p "$OUT"
docker run --rm -v khamra_data:/data -v "$OUT":/out alpine \
  sh -c 'cp /data/khamra.db "/out/khamra-$(date +%F).db"'
ls -1t "$OUT"/khamra-*.db 2>/dev/null | tail -n +31 | xargs -r rm --
echo "$(date '+%F %T') backup ok"
