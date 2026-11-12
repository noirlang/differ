# CLAUDE.md

## Kurallar

1. **Commit mesajlarına ve PR açıklamalarına Claude'u co-author olarak ekleme.** `Co-Authored-By: Claude ...` satırı veya "Generated with Claude Code" imzası kullanılmaz. Commit'ler yalnızca kullanıcının kimliğiyle atılır.

## Proje

Differ — Tauri 2 tabanlı masaüstü Git değişiklik gezgini.

- Frontend: `src/` (vanilla JS — `main.js`, `index.html`, `styles.css`)
- Backend: `src-tauri/src/lib.rs` (Rust, Tauri komutları)
- Geliştirme: `npm run dev` (Linux'ta `npm run dev:linux` / `dev:wayland`)
- Test: `cd src-tauri && cargo test`

## Sürüm artırma

Sürüm numarası şu dosyalarda birlikte güncellenir:

- `package.json`
- `package-lock.json` (2 yer)
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock` (`name = "differ"` paketi)
- `src-tauri/tauri.conf.json`
