# ORBIS//1932 デスクトップ包装（足場）

Tauri を第一候補として確認したが、この環境には `pkg-config` と `libwebkit2gtk-4.1-dev` がなく、Tauri の Linux ビルドに必要な WebKitGTK 開発ヘッダーを用意できない。そのため Electron で未署名のローカル検証ビルドを行う。詳細は `/workspace/pm/orbis1932/m7/packaging-notes.md`。

## ビルド

```sh
cd /workspace/pm/orbis1932/repo
node scripts/build_dist.mjs
cd desktop
npm install
npm run build
```

- 入力: `dist/orbis1932/`（オフライン配布物）
- 出力: `desktop/release/ORBIS-1932-linux-x64/`
- 検証用ZIP: `/workspace/pm/orbis1932/m7/ORBIS-1932-0.7.0-linux-x64-unsigned.zip`
- 生成物は `.gitignore` 対象。署名・公証・公開・ストア提出は行わない。
- アプリは `file://` で同梱HTMLを読み、外部への遷移は既定ブラウザへ渡す。
- APIキーはアプリに同梱しない。利用者が設定画面で入力し、保存を選んだ場合だけ端末の localStorage に残る。
