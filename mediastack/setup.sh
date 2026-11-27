#!/usr/bin/env bash
# Creates the directory tree that docker-compose.yml expects.
# Run once before `docker compose up -d`.
set -euo pipefail

: "${CONFIG_DIR:?CONFIG_DIR must be set in .env}"
: "${DATA_DIR:?DATA_DIR must be set in .env}"

dirs=(
  "$CONFIG_DIR/jellyfin"
  "$CONFIG_DIR/radarr"
  "$CONFIG_DIR/sonarr"
  "$CONFIG_DIR/prowlarr"
  "$CONFIG_DIR/qbittorrent"
  "$DATA_DIR/media/movies"
  "$DATA_DIR/media/tv"
  "$DATA_DIR/torrents/complete"
  "$DATA_DIR/torrents/incomplete"
)

for d in "${dirs[@]}"; do
  mkdir -p "$d"
  echo "  ok  $d"
done

echo ""
echo "Directory tree ready. Next: docker compose up -d"
