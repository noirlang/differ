#!/usr/bin/env bash
# Local Flatpak build for differ (mirrors .github/workflows flatpak-bundle job).
# Usage:
#   ./scripts/build-flatpak.sh [--install] [--sign KEYID] [--bundle-only]
# Output: dist/differ-linux-x64.flatpak
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

APP_ID="com.noirlang.differ"
RUNTIME="org.gnome.Platform//48"
SDK="org.gnome.Sdk//48"
RUST_EXT="org.freedesktop.Sdk.Extension.rust-stable//24.08"
NODE_EXT="org.freedesktop.Sdk.Extension.node22//24.08"
MANIFEST="flatpak/${APP_ID}.yaml"
BUILD_DIR="build-dir"
REPO_DIR="repo"
BUNDLE="dist/differ-linux-x64.flatpak"

INSTALL=0
SIGN_KEY=""
BUNDLE_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --install) INSTALL=1 ;;
    --sign=*) SIGN_KEY="${arg#--sign=}" ;;
    --bundle-only) BUNDLE_ONLY=1 ;;
    -h|--help)
      echo "Usage: $0 [--install] [--sign=KEYID] [--bundle-only]"
      exit 0
      ;;
    *) echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing required tool: $1" >&2; exit 1; }; }

if ! command -v flatpak >/dev/null 2>&1 || ! command -v flatpak-builder >/dev/null 2>&1; then
  echo "Installing flatpak + flatpak-builder..."
  if command -v pacman >/dev/null 2>&1; then
    sudo pacman -S --needed --noconfirm flatpak flatpak-builder
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y flatpak flatpak-builder
  else
    echo "Install flatpak and flatpak-builder manually." >&2
    exit 1
  fi
fi
need flatpak
need flatpak-builder

flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user -y flathub "$RUNTIME" "$SDK" "$RUST_EXT" "$NODE_EXT"

if [[ "$BUNDLE_ONLY" == "0" ]]; then
  flatpak-builder --user --share=network --force-clean \
    --ccache --repo="$REPO_DIR" "$BUILD_DIR" "$MANIFEST"
  flatpak build-finish "$BUILD_DIR" >/dev/null || true
fi

mkdir -p dist
BUNDLE_ARGS=(--runtime-repo=https://flathub.org/repo/flathub.flatpakrepo)
if [[ -n "$SIGN_KEY" ]]; then
  BUNDLE_ARGS+=(--gpg-sign="$SIGN_KEY")
fi
flatpak build-bundle "$REPO_DIR" "$BUNDLE" "$APP_ID" "${BUNDLE_ARGS[@]}"

if [[ "$INSTALL" == "1" ]]; then
  flatpak install --user -y --reinstall "$BUNDLE"
fi

ls -lh "$BUNDLE"
echo "Flatpak bundle ready: $BUNDLE"
echo "Install with: flatpak install --user $BUNDLE"
echo "Run with:     flatpak run $APP_ID"
