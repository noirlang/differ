#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$project_dir"

apt-get update
apt-get install -y --no-install-recommends \
  build-essential \
  ca-certificates \
  curl \
  file \
  git \
  libayatana-appindicator3-dev \
  libgtk-3-dev \
  libjavascriptcoregtk-4.1-dev \
  librsvg2-dev \
  libsoup-3.0-dev \
  libssl-dev \
  libwebkit2gtk-4.1-dev \
  patchelf \
  wget \
  xdg-utils \
  xz-utils \
  zstd \
  gstreamer1.0-libav \
  gstreamer1.0-plugins-bad \
  gstreamer1.0-plugins-base \
  gstreamer1.0-plugins-good \
  gstreamer1.0-tools

curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y --no-install-recommends nodejs

curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal --component rustfmt
. "${HOME}/.cargo/env"

npm ci
node --check src/main.js
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo test --manifest-path src-tauri/Cargo.toml --locked

npm run tauri -- build --bundles appimage,deb,rpm

mkdir -p dist

bundle_dir="src-tauri/target/release/bundle"

if [ -f "$bundle_dir/appimage/"*.AppImage ]; then
  cp "$bundle_dir/appimage/"*.AppImage dist/differ-linux-x64.AppImage
  chmod +x dist/differ-linux-x64.AppImage
  appimage_extract_dir=$(mktemp -d)
  (
    cd "$appimage_extract_dir"
    "$project_dir/dist/differ-linux-x64.AppImage" --appimage-extract >/dev/null
    test -x squashfs-root/AppRun
    test -x squashfs-root/usr/bin/differ
  )
  rm -rf "$appimage_extract_dir"
fi

if [ -f "$bundle_dir/deb/"*.deb ]; then
  cp "$bundle_dir/deb/"*.deb dist/differ-linux-x64.deb
  deb_depends="$(dpkg-deb --field dist/differ-linux-x64.deb Depends)"
  [[ "$deb_depends" == *git* ]]
  [[ "$deb_depends" == *gnupg* ]]
fi

if [ -f "$bundle_dir/rpm/"*.rpm ]; then
  cp "$bundle_dir/rpm/"*.rpm dist/differ-linux-x64.rpm
fi

pkg_dir=$(mktemp -d)
pkg_root="$pkg_dir/pkgroot"
mkdir -p "$pkg_root/opt/differ"
mkdir -p "$pkg_root/usr/bin"
mkdir -p "$pkg_root/usr/share/applications"
mkdir -p "$pkg_root/usr/share/icons/hicolor/128x128/apps"

install -Dm755 src-tauri/target/release/differ "$pkg_root/opt/differ/differ"
ln -s /opt/differ/differ "$pkg_root/usr/bin/differ"

install -Dm644 src-tauri/icons/128x128.png "$pkg_root/usr/share/icons/hicolor/128x128/apps/differ.png"
cat > "$pkg_root/usr/share/applications/differ.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=differ
Comment=Git change explorer
Exec=differ %U
Icon=differ
Terminal=false
Categories=Development;RevisionControl;
StartupNotify=true
DESKTOP

cat > "$pkg_root/.PKGINFO" <<PKGINFO
pkgname = differ
pkgbase = differ
pkgver = 0.0.3-1
pkgdesc = Git change explorer for commit history, diffs, and repository sync
arch = x86_64
url = https://github.com/noirlang/differ
license = GPL-3.0-or-later
packager = GitHub Actions
builddate = $(date +%s)
size = $(du -sb "$pkg_root" | awk '{print $1}')
xdata = pkgtype=pkg
depend = ca-certificates
depend = git
depend = gnupg
depend = gtk3
depend = libsoup3
depend = openssl
depend = webkit2gtk-4.1
depend = xdg-utils
PKGINFO

if [ -f src/main.js ]; then
  cp src/main.js "$pkg_root/opt/differ/"
fi
if [ -f src/index.html ]; then
  cp src/index.html "$pkg_root/opt/differ/"
fi
if [ -d src/assets ]; then
  cp -r src/assets "$pkg_root/opt/differ/"
fi

tar --sort=name --owner=0 --group=0 --numeric-owner --zstd \
  -cf "dist/differ-linux-x64.pkg.tar.zst" -C "$pkg_root" .PKGINFO opt usr
pkg_entries="$(tar -tf "dist/differ-linux-x64.pkg.tar.zst")"
pkg_info="$(tar -xOf "dist/differ-linux-x64.pkg.tar.zst" .PKGINFO)"
[[ "$pkg_entries" == .PKGINFO$'\n'* ]]
[[ "$pkg_info" == *$'\ndepend = git\n'* ]]
[[ "$pkg_info" == *$'\ndepend = gnupg\n'* ]]

rm -rf "$pkg_dir"
