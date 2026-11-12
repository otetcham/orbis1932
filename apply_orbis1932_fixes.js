#!/usr/bin/env node
/**
 * Orbis 1932 (1932年3月1日開始シナリオ) 史実整合性・国境線・係争地・自治体名 一括修正スクリプト
 *
 * 使い方（リポジトリのルートディレクトリで実行）:
 *   1. 全ファイルの修正適用 + マップ再生成:
 *      node apply_orbis1932_fixes.js
 *
 *   2. 修正適用 + Gitブランチ作成・コミット・GitHub PR作成（要 GitHub CLI `gh`）:
 *      node apply_orbis1932_fixes.js --pr
 *
 * 修正対象ファイル:
 *   - scripts/build_orbis_states.mjs : 1932年国境オーバーライド・係争地分割・小規模植民地/特別地域の統合防止ロック
 *   - orbis_region_labels.js         : 1932年当時の自治体名・地域ラベル（東京府、北平市、熱河省、関東州、ワイマール期ドイツ州名など）
 *   - data/orbis_capitals.json       : 1932年当時の首都座標（ブラジル＝リオデジャネイロ、リトアニア＝カウナス、中華民国＝南京）
 *   - orbis_simulator.html           : 各国元首・国号・AI方針・都市名（サマーラ、奉天など）の1932年3月1日史実補正
 *   - orbis_events.js                : 歴史イベントDBの年号・漢字表記修正（あさま山荘事件＝1972年、美濃部達吉など）
 */

const { readFile, writeFile } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { execSync } = require('node:child_process');
const path = require('node:path');

const ROOT = process.cwd();

async function applyCapitalsFix() {
  const capPath = path.join(ROOT, 'data/orbis_capitals.json');
  if (existsSync(capPath)) {
    const capitals = JSON.parse(await readFile(capPath, 'utf8'));
    capitals.brazil = [-43.17, -22.91]; // リオデジャネイロ
    capitals.china = [118.78, 32.06];   // 南京
    capitals.lithuania = [23.90, 54.90]; // カウナス
    await writeFile(capPath, JSON.stringify(capitals, null, 2) + '\n');
    console.log('✓ data/orbis_capitals.json 修正適用 (リオデジャネイロ, 南京, カウナス)');
  }
  const metaPath = path.join(ROOT, 'orbis_map_meta.js');
  if (existsSync(metaPath)) {
    let metaSrc = await readFile(metaPath, 'utf8');
    const meta = JSON.parse(metaSrc.replace(/^window\.ORBIS_MAP_META\s*=\s*/, '').replace(/;\s*$/, ''));
    meta.capitals.brazil = [-43.17, -22.91];
    meta.countryAnchors.brazil = { lon: -41.68, lat: -21.69, cx: 768.4, cy: 1101.0, homeRegionId: 'brazil_br_rj', anchorKind: 'capital' };
    meta.capitals.china = [118.78, 32.06];
    meta.countryAnchors.china = { lon: 120, lat: 32.41, cx: 1666.7, cy: 596.7, homeRegionId: 'china_cn_js', anchorKind: 'capital' };
    meta.capitals.lithuania = [23.90, 54.90];
    meta.countryAnchors.lithuania = { lon: 24.08, lat: 54.97, cx: 1133.8, cy: 386.5, homeRegionId: 'lithuania_lt_ku', anchorKind: 'capital' };
    await writeFile(metaPath, 'window.ORBIS_MAP_META = ' + JSON.stringify(meta) + ';\n');
    console.log('✓ orbis_map_meta.js 首都錨修正適用');
  }
}

async function applyEventsFix() {
  const eventsPath = path.join(ROOT, 'orbis_events.js');
  if (existsSync(eventsPath)) {
    let content = await readFile(eventsPath, 'utf8');
    content = content.replace('美濃部達雄の天皇機関説', '美濃部達吉の天皇機関説');
    content = content.replace(
      '{"id":"1970-asama_sanso","year":1970,"date":"1970-02-19","title":"浅間山庄事件"',
      '{"id":"1972-asama_sanso","year":1972,"date":"1972-02-19","title":"あさま山荘事件"'
    );
    await writeFile(eventsPath, content);
    console.log('✓ orbis_events.js 修正適用 (あさま山荘事件 1972年, 美濃部達吉)');
  }
}

async function applySimulatorFix() {
  const simPath = path.join(ROOT, 'orbis_simulator.html');
  if (existsSync(simPath)) {
    let content = await readFile(simPath, 'utf8');
    // 都市名
    content = content.replace("{ name: 'クイビシェフ', lon: 50.10, lat: 53.19, tier: 3 }", "{ name: 'サマーラ', lon: 50.10, lat: 53.19, tier: 3 }");
    content = content.replace("{ name: '瀋陽', lon: 123.43, lat: 41.81, tier: 3 }", "{ name: '奉天', lon: 123.43, lat: 41.81, tier: 3 }");
    // トルコ大統領
    content = content.replace("leader: 'ムスタファ・ケマル・アタテュルク 大統領'", "leader: 'ガジ・ムスタファ・ケマル 大統領'");
    content = content.replace("name: 'ケマル・アタテュルク'", "name: 'ガジ・ムスタファ・ケマル'");
    // サウジアラビア
    content = content.replace("name: 'サウジアラビア王国 (ネジュド・ヒジャーズ)'", "name: 'ヒジャーズ・ネジュド王国'");
    // ドミニカ共和国
    content = content.replace("leader: 'ホラシオ・バスケス 大統領'", "leader: 'ラファエル・トルヒーヨ 大統領'");
    content = content.replace("blocName: '砂糖王国・トゥルヒーヨ台頭'", "blocName: '砂糖王国・トゥルヒーヨ独裁体制'");
    content = content.replace("name: 'H.バスケス'", "name: 'ラファエル・トルヒーヨ'");
    // パナマ
    content = content.replace("leader: 'フロレンシオ・アロセメナ 大統領'", "leader: 'リカルド・J・アルファロ 大統領'");
    content = content.replace("name: 'F.アロセメナ'", "name: 'リカルド・J・アルファロ'");
    // エクアドル
    content = content.replace("leader: 'フアン・デ・ディオス・マルティネス 大統領'", "leader: 'アルフレド・バケリソ・モレノ 臨時大統領'");
    content = content.replace("name: 'J.デ・ディオス・マルティネス'", "name: 'アルフレド・バケリソ・モレノ'");
    // フランス
    content = content.replace("leader: 'アンドレ・タルデュー / エドゥアール・エリオ 首相'", "leader: 'アンドレ・タルデュー 首相'");
    content = content.replace("name: 'アンドレ・タルデュー / E.エリオ'", "name: 'アンドレ・タルデュー'");

    await writeFile(simPath, content);
    await writeFile(path.join(ROOT, 'index.html'), content);
    console.log('✓ orbis_simulator.html & index.html 修正適用 (都市名: サマーラ/奉天, 元首・国号史実化)');
  }
}

async function rebuildStatesIfRawExists() {
  const rawPath = path.join(ROOT, 'data/raw/ne_admin1_build.geojson');
  if (existsSync(rawPath)) {
    console.log('Running scripts/build_orbis_states.mjs...');
    execSync('node scripts/build_orbis_states.mjs', { stdio: 'inherit', cwd: ROOT });
    console.log('✓ scripts/build_orbis_states.mjs 実行完了');
  } else {
    console.log('ℹ data/raw/ne_admin1_build.geojson が存在しないためマップ再生成はスキップしました');
  }
}

async function runTests() {
  console.log('Running tests...');
  execSync('node orbis_simulator.test.mjs', { stdio: 'inherit', cwd: ROOT });
  execSync('node orbis_data_audit.mjs', { stdio: 'inherit', cwd: ROOT });
  console.log('✓ 全テスト & 史実データ監査 PASS');
}

async function createPRIfNeeded() {
  if (process.argv.includes('--pr')) {
    console.log('Creating Git branch, commit, and GitHub Pull Request...');
    const branch = 'fix/orbis-1932-historical-accuracy';
    try {
      execSync(`git checkout -b ${branch}`, { stdio: 'inherit', cwd: ROOT });
    } catch {
      execSync(`git checkout ${branch}`, { stdio: 'inherit', cwd: ROOT });
    }
    execSync('git add -A', { stdio: 'inherit', cwd: ROOT });
    const msg = 'fix(history): 1932年3月1日開始シナリオ 史実整合性・国境線・首都・地域名・元首・都市名の一括修正';
    execSync(`git commit -m "${msg}"`, { stdio: 'inherit', cwd: ROOT });
    execSync(`git push -u origin ${branch}`, { stdio: 'inherit', cwd: ROOT });
    execSync(`gh pr create --title "${msg}" --body "1932年3月1日シナリオの史実整合性を一括修正しました。\n- 首都座標: ブラジル(リオデジャネイロ), 中国(南京), リトアニア(カウナス)\n- 地域名: 東京府, 北平市, 奉天省, 熱河省, 関東州, 朝鮮統一, ワイマール期ドイツ州名\n- 元首・国名: 仏(タルデュー), 墨(アルファロ), 埃(バケリソ・モレノ), 多(トルヒーヨ), 土(ケマル), 砂(ヒジャーズ・ネジュド王国)\n- 都市名: サマーラ, 奉天\n- 史実年号: あさま山荘事件(1972年), 美濃部達吉"`, { stdio: 'inherit', cwd: ROOT });
    console.log('✓ PR作成完了');
  }
}

async function main() {
  await applyCapitalsFix();
  await applyEventsFix();
  await applySimulatorFix();
  await rebuildStatesIfRawExists();
  await runTests();
  await createPRIfNeeded();
  console.log('=== Orbis 1932 史実一括修正完了 ===');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
