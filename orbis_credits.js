'use strict';

// ゲーム内クレジット／ライセンス画面のデータ。
// 素材の置換・削除は行わず、現状の出典と確認状態をそのまま記録する。
globalThis.ORBIS_CREDITS = Object.freeze({
  updated: '2026-11-14',
  intro: '本作が利用している第三者素材・データ源・ソフトウェアの一覧です。ライセンスの最終確認は配布形態の決定時に行います。',
  sections: Object.freeze([
    {
      title: '地図・統治データ',
      items: Object.freeze([
        {
          name: 'Natural Earth 10m Admin-1 States & Provinces',
          source: 'Natural Earth（https://www.naturalearthdata.com/）',
          license: 'パブリックドメイン',
          usage: '州・省の行政区分。scripts/build_orbis_states.mjs で簡略化し orbis_states.js を生成。',
          status: '商用利用可',
          note: 'パブリックドメインのため表示義務はないが、出典を明記する。'
        },
        {
          name: 'aourednik/historical-basemaps world_1930.geojson',
          source: 'GitHub — historical-basemaps（https://github.com/aourednik/historical-basemaps）',
          license: 'GNU GPL v3',
          usage: '1932年当時の統治割当（点-in-多角形判定）。境界形状の主データは Natural Earth。',
          status: '要判断',
          note: 'GPL v3 のコピーレフト条件が配布形態に影響し得る。切り離し・置換・明示の判断は未了で、素材は現状のまま保持している。'
        },
        {
          name: '首都座標 data/orbis_capitals.json',
          source: '本プロジェクトの手作り近似データ',
          license: 'プロジェクト内データ（第三者のライセンス表示なし）',
          usage: '1932年当時の政府所在地を想定したラベル配置。',
          status: '商用利用可',
          note: '外部素材の複製ではなく、オーナー提供の手作りデータとして扱う。'
        }
      ])
    },
    {
      title: '史実イベント・シナリオ',
      items: Object.freeze([
        {
          name: '史実イベント orbis_events.js / WORLD_EVENT_DB',
          source: 'オーナー提供（272件）',
          license: 'プロジェクト内データ（第三者のライセンス表示なし）',
          usage: '史実タイムライン、分岐判定、月次情勢の参照。',
          status: '商用利用可',
          note: '外部データベースの転載ではなく、オーナー作成のシナリオデータとして扱う。'
        }
      ])
    },
    {
      title: '画像素材',
      items: Object.freeze([
        {
          name: '国旗画像 flags/（111点）',
          source: '出典不明（リポジトリ内に個別の作者・出典・ライセンス記録なし）',
          license: '未確認',
          usage: '国家選択、HUD、国名リンクの国旗表示。',
          status: '要判断',
          note: '出典が不明なため、パブリックドメイン等と推測で断定しない。商用配布前に個別の権利確認または置換が必要。素材の削除・置換は行っていない。'
        },
        {
          name: '指導者肖像 portraits/（8点）',
          source: 'Wikimedia Commons 由来（日本語版Wikipediaの各人物ページ。CREDITS にURLを記載）',
          license: '各ファイルのライセンスは Wikimedia Commons の該当ページに従う（個別記録は未整備）',
          usage: '国家選択画面の指導者肖像。',
          status: '要判断',
          note: 'ファイルごとの作者・ライセンス・撮影年を台帳化する必要がある。CC BY-SA 等の表示義務がある場合は配布時に追加表示する。'
        }
      ])
    },
    {
      title: 'フォント',
      items: Object.freeze([
        {
          name: 'Inter / JetBrains Mono / Noto Sans JP（Google Fonts）',
          source: 'Google Fonts（ソースHTMLの @import。オフライン配布物では読み込みを除去）',
          license: 'SIL Open Font License 1.1（各フォント配布元の表記に従う）',
          usage: 'ソース表示時の書体。配布物にはフォントファイルを同梱せず、端末のフォールバック書体を使う。',
          status: '商用利用可',
          note: 'オフライン構築では外部フォントURLを削除するため、配布物はCDNに依存しない。'
        }
      ])
    },
    {
      title: 'ソフトウェア（構築・開発用）',
      items: Object.freeze([
        {
          name: 'Turf.js（@turf/area, boolean-point-in-polygon, difference, distance, helpers, intersect）',
          source: 'https://turfjs.org/',
          license: 'MIT',
          usage: '州データの構築・形状計算。ゲーム実行時には読み込まない。',
          status: '商用利用可',
          note: '開発・構築専用。配布フォルダには node_modules を含めない。'
        },
        {
          name: 'topojson-client / topojson-server / topojson-simplify',
          source: 'https://github.com/topojson',
          license: 'ISC',
          usage: '州データの位相構築と簡略化。ゲーム実行時には読み込まない。',
          status: '商用利用可',
          note: '開発・構築専用。'
        },
        {
          name: 'polylabel',
          source: 'https://github.com/mapbox/polylabel',
          license: 'ISC',
          usage: '州の代表点計算。ゲーム実行時には読み込まない。',
          status: '商用利用可',
          note: '開発・構築専用。'
        },
        {
          name: 'Playwright',
          source: 'https://playwright.dev/',
          license: 'Apache-2.0',
          usage: 'スモークテスト、スクリーンショット、性能測定。',
          status: '商用利用可',
          note: '開発・検証専用。配布物には含めない。'
        },
        {
          name: 'Electron / @electron/packager',
          source: 'https://www.electronjs.org/',
          license: 'MIT / BSD-2-Clause',
          usage: 'デスクトップ包装の足場とローカル検証ビルド。',
          status: '商用利用可',
          note: '開発・包装専用。署名・公開ビルドは行わない。'
        }
      ])
    }
  ])
});
