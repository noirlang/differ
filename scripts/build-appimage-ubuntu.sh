#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${DIFFER_APPIMAGE_UBUNTU_IMAGE:-ubuntu:22.04}"
read -r -a docker_cmd <<< "${DOCKER:-docker}"
host_uid="$(id -u)"
host_gid="$(id -g)"

"${docker_cmd[@]}" run --rm \
  --env APPIMAGE_EXTRACT_AND_RUN=1 \
  --env CI=1 \
  --env DEBIAN_FRONTEND=noninteractive \
  --env HOST_UID="${host_uid}" \
  --env HOST_GID="${host_gid}" \
  --volume "${project_dir}:/work" \
  --workdir /work \
  "${image}" \
  bash -lc '
    set -euo pipefail

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
      gstreamer1.0-libav \
      gstreamer1.0-plugins-bad \
      gstreamer1.0-plugins-base \
      gstreamer1.0-plugins-good \
      gstreamer1.0-tools

    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y --no-install-recommends nodejs

    if ! getent group "${HOST_GID}" >/dev/null; then
      groupadd --gid "${HOST_GID}" builder
    fi

    if ! getent passwd "${HOST_UID}" >/dev/null; then
      useradd --uid "${HOST_UID}" --gid "${HOST_GID}" --create-home builder
    fi

    builder_name="$(getent passwd "${HOST_UID}" | cut -d: -f1)"

    su "${builder_name}" -s /bin/bash -c "
      set -euo pipefail
      cd /work
      curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal
      . \"\${HOME}/.cargo/env\"
      npm ci
      node --check src/main.js
      cargo check --manifest-path src-tauri/Cargo.toml --locked
      npm run tauri -- build --ci --bundles appimage
    "
  '
