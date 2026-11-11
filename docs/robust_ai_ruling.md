# 壊れた AI 応答への耐性

`orbis_game.js` の裁定・ブリーフィング経路。

1. **JSON 解析** — `tryParseGameJson` → `repairTruncatedJson`（括弧・文字列の自動閉じ）
2. **是正** — `coerceOpening` / `coerceEvaluation`（不正 `actorId` 除外・電報補完、提出行動 ID の補正、空フィールドの中立値）
3. **再試行** — 検証失敗時に LLM へフォーマット修正を 1 回依頼
4. **フォールバック** — 依然失敗、または HTTP 障害時に `fallbackOpening` / `fallbackEvaluation`（ゲームは **止めない**）

フォールバック裁定も `MONTHLY_RULING_CAPS` と既存の財政・緊張フォールを通る。
