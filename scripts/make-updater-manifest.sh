#!/usr/bin/env bash
# Signs the self-updatable bundles and writes latest.json for the Tauri updater.
#
# Usage: scripts/make-updater-manifest.sh <assets-dir> [notes]
# Env:   TAURI_SIGNING_PRIVATE_KEY           private key (content or path)
#        TAURI_SIGNING_PRIVATE_KEY_PASSWORD  its password
#
# Asset URLs point at releases/latest/download/<stable name>, so the manifest
# stays valid when a commit prerelease is promoted to the "Latest" release —
# as long as latest.json, the .sig files and the bundles come from the same build.
set -euo pipefail

assets_dir="${1:?assets dir required}"
notes="${2:-}"
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
base_url="https://github.com/noirlang/differ/releases/latest/download"

version="$(node -p "require('${project_dir}/src-tauri/tauri.conf.json').version")"

sign() {
  local file="$assets_dir/$1"
  [ -f "$file" ] || { echo "missing $file" >&2; exit 1; }
  (cd "$project_dir" && npx --no-install tauri signer sign "$file" >/dev/null)
  cat "$file.sig"
}

linux_sig="$(sign differ-linux-x64.AppImage)"
windows_sig="$(sign differ-windows-x64.msi)"

VERSION="$version" NOTES="$notes" PUB_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
LINUX_SIG="$linux_sig" WINDOWS_SIG="$windows_sig" BASE_URL="$base_url" \
node -e '
  const e = process.env;
  const manifest = {
    version: e.VERSION,
    notes: e.NOTES,
    pub_date: e.PUB_DATE,
    platforms: {
      "linux-x86_64": { signature: e.LINUX_SIG, url: `${e.BASE_URL}/differ-linux-x64.AppImage` },
      "windows-x86_64": { signature: e.WINDOWS_SIG, url: `${e.BASE_URL}/differ-windows-x64.msi` },
    },
  };
  process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
' > "$assets_dir/latest.json"

echo "latest.json written for v${version}"
