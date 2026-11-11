# ORBIS//1932 ウォークスルー追補（2026-11-11）

## 前提

- **Phase C（オーナー `0953d5c`）** により、272件の史実データは `orbis_events.js`（`WORLD_EVENT_DB`）に集約され、`calendarNotes()` が `HISTORICAL_TIMELINE_EVENTS` と統合されます。本追補は **Phase B 以降のデータ分離・UI/通信改善** を前提としています。
- headless スモーク: `node scripts/walkthrough_smoke.mjs`（Playwright・`file://`・AIは `127.0.0.1` モック）。
- スクリーンショット（エージェント成果物）: `walkthrough-01-lobby.png` 〜 `walkthrough-04-april-1932.png`。

## データ監査（再実行ログ）

```
史実データ監査: { nations: 66, regions: 176, events: 9, history: 272 }
```

| 区分 | 件数 | ソース |
|------|------|--------|
| 国家 | 66 | `SCENARIOS.era_1932.nations` |
| 陸上州 | 176 | `orbis_states.js` (`ORBIS_STATES_DB`) |
| シナリオ危機 | 9 | `CRISIS_EVENTS` |
| 史実タイムライン | 272 | `orbis_events.js` |

## ハーネステスト（再実行ログ）

```
26 checks passed. Live provider credentials were not used.
```

主な追加・更新観点:

- 満洲国 `client:manchukuo` 宛送信（日本以外の従属クライアント開始ケース）
- 史実DB連携（GMプロンプト文脈への当月・当年ノート）
- SSE ストリーム解析と非ストリームへのフォールバック

## Phase サマリー（今回の未コミット分 → コミット予定）

| フェーズ | 内容 |
|---------|------|
| **B**（済 `405a496`） | タイムライン整理・ロビー日付・`orbis_states.js` 分離・監査更新 |
| **C**（済 `0953d5c`） | `orbis_events.js`・`calendarNotes` 統合（オーナー） |
| **F** | マルチタブ read-only ガード、AI SSE＋再試行、部分 `render()`、会話ストリームプレビュー |
| **G** | 地図ピンチズーム、占領斜線・ラベル整理、`orbis_states.js` 読込エラー表示 |
| **H** | テスト26件・Playwright ウォークスルー用 `scripts/walkthrough_smoke.mjs` |

## SHORT_NAMES（66カ国）

| ID | 短縮名 | 正式名 |
|----|--------|--------|
| afghanistan | アフガニスタン | アフガニスタン王国 |
| albania | アルバニア | アルバニア王国 |
| argentina | アルゼンチン | アルゼンチン共和国 |
| australia | オーストラリア | オーストラリア連邦 |
| austria | オーストリア | オーストリア連邦国 |
| belgium | ベルギー | ベルギー王国 |
| bolivia | ボリビア | ボリビア共和国 |
| brazil | ブラジル | ブラジル合衆国 |
| bulgaria | ブルガリア | ブルガリア王国 |
| canada | カナダ | カナダ自治領 |
| chile | チリ | チリ共和国 |
| china | 中国 | 中華民国 (南京国民政府) |
| colombia | コロンビア | コロンビア共和国 |
| costa_rica | コスタリカ | コスタリカ共和国 |
| cuba | キューバ | キューバ共和国 |
| czechoslovakia | チェコスロバキア | チェコスロバキア共和国 |
| denmark | デンマーク | デンマーク王国 |
| dominican | ドミニカ | ドミニカ共和国 |
| dutch_indies | 蘭領東インド | 蘭領東インド (バタヴィア政庁) |
| ecuador | エクアドル | エクアドル共和国 |
| egypt | エジプト | エジプト王国 |
| el_salvador | エルサルバドル | エルサルバドル共和国 |
| estonia | エストニア | エストニア共和国 |
| ethiopia | エチオピア | エチオピア帝国 (アビシニア) |
| finland | フィンランド | フィンランド共和国 |
| france | フランス | フランス第三共和政 |
| germany | ドイツ | ドイツ国 (ヴァイマル共和国) |
| greece | ギリシャ | ギリシャ第二共和政 |
| guatemala | グアテマラ | グアテマラ共和国 |
| haiti | ハイチ | ハイチ共和国 |
| honduras | ホンジュラス | ホンジュラス共和国 |
| hungary | ハンガリー | ハンガリー王国 |
| india | 英領インド | 英領インド帝国 (British Raj) |
| iran | ペルシア | パフラヴィー朝ペルシア (イラン) |
| ireland | アイルランド | アイルランド自由国 |
| italy | イタリア | イタリア王国 |
| japan | 日本 | 大日本帝国 |
| latvia | ラトヴィア | ラトヴィア共和国 |
| lithuania | リトアニア | リトアニア共和国 |
| luxembourg | ルクセンブルク | ルクセンブルク大公国 |
| manchukuo | 満洲国 | 満洲国 (奉天・新京政権) |
| mexico | メキシコ | メキシコ合衆国 |
| mongolia | モンゴル | モンゴル人民共和国 |
| netherlands | オランダ | オランダ王国 |
| new_zealand | ニュージーランド | ニュージーランド |
| nicaragua | ニカラグア | ニカラグア共和国 |
| norway | ノルウェー | ノルウェー王国 |
| panama | パナマ | パナマ共和国 |
| paraguay | パラグアイ | パラグアイ共和国 |
| peru | ペルー | ペルー共和国 |
| poland | ポーランド | ポーランド第二共和国 |
| portugal | ポルトガル | ポルトガル共和国 (エスタド・ノヴォ体制) |
| romania | ルーマニア | ルーマニア王国 |
| russia | ソ連 | ソビエト社会主義共和国連邦 |
| saudi_arabia | サウジアラビア | サウジアラビア王国 (ネジュド・ヒジャーズ) |
| siam | シャム | シャム王国 |
| south_africa | 南アフリカ | 南アフリカ連邦 |
| spain | スペイン | スペイン第二共和国 |
| sweden | スウェーデン | スウェーデン王国 |
| switzerland | スイス | スイス連邦 |
| turkey | トルコ | トルコ共和国 |
| uk | 英国 | グレートブリテン及び北アイルランド連合王国 |
| uruguay | ウルグアイ | ウルグアイ東方共和国 |
| usa | 米国 | アメリカ合衆国 |
| venezuela | ベネズエラ | ベネズエラ合衆国 |
| yugoslavia | ユーゴ | ユーゴスラビア王国 |

## ウォークスルー手順（要約）

1. ロビー表示（`walkthrough-01-lobby.png`）
2. モック AI 設定 → シャムで開始 → briefing 完了（`walkthrough-02-started-1932-03.png`）
3. 国家行動提出 → トークから満洲国スレッド（`walkthrough-03-manchukuo-destination.png`）
4. 月次裁定 → 1932年4月（`walkthrough-04-april-1932.png`）
