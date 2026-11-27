#!/usr/bin/env bash
# Run once on brontosaurus before first `docker compose up`
set -e

# Load .env to get DATA_DIR and CONFIG_DIR
source .env

# Create data directory tree (qBittorrent, Radarr, Sonarr all share /data)
mkdir -p \
  "${DATA_DIR}/torrents/movies" \
  "${DATA_DIR}/torrents/tv" \
  "${DATA_DIR}/media/movies" \
  "${DATA_DIR}/media/tv"

# Create config dirs for each service
mkdir -p \
  "${CONFIG_DIR}/jellyfin" \
  "${CONFIG_DIR}/prowlarr" \
  "${CONFIG_DIR}/radarr" \
  "${CONFIG_DIR}/sonarr" \
  "${CONFIG_DIR}/qbittorrent"

echo "Done. Run: docker compose up -d"
