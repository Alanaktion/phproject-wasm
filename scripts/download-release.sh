#!/usr/bin/env bash
# Downloads the latest Phproject release zip into the releases/ directory,
# mirroring what the GitHub Pages deployment workflow does.

set -euo pipefail

command -v curl >/dev/null 2>&1 || { echo "Error: curl is required" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "Error: jq is required" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$REPO_ROOT/releases"

echo "Fetching latest Phproject release info..."
RELEASE_JSON=$(curl -sf -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/alanaktion/phproject/releases/latest")

RELEASE_TAG=$(echo "$RELEASE_JSON" | jq -r '.tag_name')
ASSET=$(echo "$RELEASE_JSON" | jq -r \
  'first(.assets[] | select(.name | endswith(".zip"))) | "\(.url)\t\(.name)\t\(.size)"')
ASSET_URL=$(echo "$ASSET" | cut -f1)
ASSET_NAME=$(echo "$ASSET" | cut -f2)
ASSET_SIZE=$(echo "$ASSET" | cut -f3)

if [ -z "$ASSET_URL" ] || [ "$ASSET_URL" = "null" ]; then
  echo "Error: No .zip asset found in the latest Phproject release" >&2
  exit 1
fi

echo "Downloading $ASSET_NAME ($RELEASE_TAG)..."
curl -sfL -H "Accept: application/octet-stream" "$ASSET_URL" \
  -o "$REPO_ROOT/releases/phproject.zip"

printf '{"name":"%s","size":%s,"version":"%s"}' \
  "$ASSET_NAME" "$ASSET_SIZE" "$RELEASE_TAG" > "$REPO_ROOT/releases/phproject.json"

echo "Done. Files written to releases/:"
echo "  phproject.zip  ($(du -sh "$REPO_ROOT/releases/phproject.zip" | cut -f1))"
echo "  phproject.json (version: $RELEASE_TAG)"
