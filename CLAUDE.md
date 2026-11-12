# CLAUDE.md

## Kurallar

1. **Commit mesajlarına ve PR açıklamalarına Claude'u co-author olarak ekleme.** `Co-Authored-By: Claude ...` satırı veya "Generated with Claude Code" imzası kullanılmaz. Commit'ler yalnızca kullanıcının kimliğiyle atılır.

## Proje

Differ — Tauri 2 tabanlı masaüstü Git değişiklik gezgini.

- Frontend: `src/` — vanilla JS, `src/js/*.js` klasik script'ler olarak `index.html` içinde sırayla yüklenir ve global kapsamı paylaşır (`core.js` ilk, `init.js` son). Yeni dosya eklersen `index.html`'deki sıraya ekle.
- Backend: `src-tauri/src/` — `lib.rs` sadece modülleri ve `run()`'ı içerir; her özellik kendi modülünde (`repo.rs`, `sync.rs`, `github.rs`, `ai.rs`, ...). Modüller `use crate::*;` ile ortak tipleri alır. Yeni Tauri komutunu `lib.rs`'teki `generate_handler!` listesine ekle.
- Geliştirme: `npm run dev` (Linux'ta `npm run dev:linux` / `dev:wayland`)
- Test: `cd src-tauri && cargo test`

## Sürüm artırma

Sürüm numarası şu dosyalarda birlikte güncellenir:

- `package.json`
- `package-lock.json` (2 yer)
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock` (`name = "differ"` paketi)
- `src-tauri/tauri.conf.json`
