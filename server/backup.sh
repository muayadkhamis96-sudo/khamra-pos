#!/usr/bin/env bash
# Khamra POS — nightly SQLite snapshot. The DB runs in WAL mode, so a plain
# file copy misses everything still in the -wal journal; VACUUM INTO produces
# a consistent single-file snapshot regardless. Keeps 30 dated files.
set -euo pipefail
OUT=/opt/khamra-pos/backups
mkdir -p "$OUT"
NAME="khamra-$(date +%F).db"
rm -f "$OUT/$NAME"    # same-day rerun: VACUUM INTO refuses to overwrite
docker run --rm -v khamra_khamra_data:/data -v "$OUT":/out alpine sh -c \
  "apk add -q sqlite && sqlite3 /data/khamra.db \"VACUUM INTO '/out/$NAME'\""
ls -1t "$OUT"/khamra-*.db 2>/dev/null | tail -n +31 | xargs -r rm --
echo "$(date '+%F %T') backup ok: $NAME ($(stat -c%s "$OUT/$NAME") bytes)"
