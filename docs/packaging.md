# 配布・包装手順（M7）

## オフライン配布物

```sh
cd /workspace/pm/orbis1932/repo
node scripts/build_dist.mjs
```

- フォルダ: `dist/orbis1932/`
- ZIP: `dist/orbis1932-0.7.0-offline.zip`
- 同梱: HTML（index / orbis_simulator）、実行JS、version / credits、`data/`、`flags/`、`portraits/`、`CREDITS`
- 構築時に Google Fonts の `@import` を除去する。外部スクリプト・外部フォントに依存しない。
- テスト、`scripts/`、`node_modules`、セーブ、APIキーは同梱しない。
- バージョンの正本は `orbis_version.js` の `ORBIS_VERSION`。

## デスクトップ包装

Tauri を第一候補として確認したが、この環境には `pkg-config` がなく、`libwebkit2gtk-4.1-dev` も入手できないため WebKitGTK 依存のビルドが成立しない。Electron の未署名ローカルビルドを足場とする。理由と確認結果は `/workspace/pm/orbis1932/m7/packaging-notes.md` に記録する。

```sh
cd /workspace/pm/orbis1932/repo/desktop
npm install
npm run build
```

- 出力: `desktop/release/ORBIS-1932-linux-x64/`
- 検証用ZIP: `/workspace/pm/orbis1932/m7/ORBIS-1932-0.7.0-linux-x64-unsigned.zip`
- `main.js` は `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- 署名・公証・公開・ストア提出は行わない。生成バイナリは git に含めない（`.gitignore`）。

## キーの扱い

- APIキーは設定画面で入力し、保存を選んだ場合だけ `localStorage` の `orbis_ai_config` に残す。
- セーブJSON、配布フォルダ、ZIP、デスクトップアプリには含めない。
- テストとスクリーンショットはモックHTTPのみ。実キーは使わない。
