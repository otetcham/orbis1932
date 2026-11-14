#!/usr/bin/env node
/**
 * ORBIS//1932 — M1 部隊マーカー・戦線命令・攻勢後の占領のスクリーンショット。
 * Playwright (chromium) が必要。PNG はリポジトリ外の m1/ に保存する。
 */
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const artifactDir = '/workspace/pm/orbis1932/m1';
await mkdir(artifactDir, { recursive: true });
const pageUrl = pathToFileURL(new URL('../orbis_simulator.html', import.meta.url).pathname).href;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    console.error('Playwright が見つからないため、スクリーンショット取得をスキップしました。');
    process.exit(0);
  }
}

const choices = [
  { label: '条件を詰める', text: '予算の上限を明確にした上で、実施条件を協議しましょう。' },
  { label: '見送る', text: '今月の実施は見送ります。代替案を示してください。' }
];
const opening = {
  headline: '軍縮と復興のあいだ',
  briefing: '大恐慌が続くなか、外務省と国内勢力が相反する条件を提示した。財政の範囲で決断が求められる。',
  telegrams: [
    { actorId: 'domestic:ig_military', subject: '防衛費の折衝', text: '防衛を維持するための予算を協議したい。軍縮を進める場合も、指揮権の保障を求める。', urgency: 'urgent', choices },
    { actorId: 'ministry:usa', subject: '通商の予備協議', text: '資源通商と極東の安定について協議する用意があります。条件をご提示ください。', urgency: 'important', choices },
    { actorId: 'client:manchukuo', subject: '自治と開発', text: '開発資金の援助と、現地政府の裁量を確保したい。', urgency: 'important', choices }
  ]
};
const evaluation = {
  headline: '前線の命令が戦線を動かす',
  article: '部隊への防御・攻勢命令を受け、前線では限定的な進軍と占領が進んだ。',
  delta: { mil: 0, eco: 0, stb: 0, treasury: 0, prestige: 0, tension: 0 },
  reasoning: [{ text: '命令のある戦線だけを既存の隣接占領ルールで解決した。', sourceActionIds: [] }],
  developments: [{ headline: '前線の部隊が移動', body: '攻勢命令を受けた部隊が隣接する敵領へ前進した。' }],
  groups: [], relations: [], otherNations: [], actorUpdates: [], treaties: [], commitments: [],
  territoryChanges: [], clientChanges: [], leadershipChanges: [], memory: '前線命令を実行し、戦線の状況を記憶した。'
};

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--no-sandbox']
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await context.route('**/*', async route => {
  const req = route.request();
  if (req.method() !== 'POST' || !req.url().includes('127.0.0.1')) return route.continue();
  let operation = 'RESOLUTION';
  try {
    const body = req.postDataJSON() || {};
    const texts = (body.messages || []).filter(item => item.role === 'user').map(item => item.content);
    const payload = texts.map(value => { try { return JSON.parse(value); } catch { return null; } }).find(value => value?.operation);
    operation = payload?.operation || operation;
  } catch { /* mock */ }
  const data = operation === 'BRIEFING'
    ? opening
    : operation === 'ACTOR'
      ? { reply: '前線の命令を確認しました。月末の裁定を待ちます。', stance: 'consider', memory: '戦線命令を確認。', choices }
      : evaluation;
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) }, finish_reason: 'stop' }] }) });
});

const page = await context.newPage();
const consoleErrors = [];
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => consoleErrors.push(String(error)));
await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof Orbis !== 'undefined' && window.ORBIS_STATES_DB?.length, { timeout: 120000 });
await page.evaluate(() => Orbis.configure({ provider: 'custom', endpoint: 'http://127.0.0.1/mock', model: 'mock', apiKey: '', remember: false }));
await page.evaluate(() => Orbis.start({ nationId: 'japan', difficulty: 'standard', mandate: 'recovery', maxTurns: 24, replace: true }));
await page.waitForFunction(() => Orbis.snapshot()?.phase === 'playing', { timeout: 120000 });
await page.waitForFunction(() => document.querySelectorAll('#formations-layer .formation-marker').length > 0, { timeout: 20000 });
const markerProjectionCounts = await page.evaluate(() => {
  const measure = () => {
    const visible = nodes => [...nodes].filter(node => node.style.display !== 'none');
    const clusters = visible(document.querySelectorAll('#formations-layer .formation-cluster'));
    return {
      individual: visible(document.querySelectorAll('#formations-layer .formation-marker')).length,
      clusters: clusters.length,
      clusteredMembers: clusters.reduce((sum, node) => sum + (node._members?.length || 0), 0)
    };
  };
  state.mapProjection = 'flat';
  resetMapTransformForProjection();
  state.mapTransform.scale = 1;
  state.mapTransform.x = 0;
  state.mapTransform.y = 0;
  applyFlatTransform();
  updateMapVisuals();
  const flatOut = measure();
  state.mapTransform.scale = 2;
  applyFlatTransform();
  updateMapVisuals();
  const flatIn = measure();
  state.mapProjection = 'globe';
  resetMapTransformForProjection();
  state.globe.lon = 118;
  state.globe.lat = 32;
  state.globe.zoom = 1.18;
  updateMapVisuals();
  const globeOut = measure();
  state.globe.zoom = 2.2;
  updateMapVisuals();
  const globeIn = measure();
  return { flatOut, flatIn, globeOut, globeIn };
});
for (const [label, counts] of Object.entries(markerProjectionCounts)) {
  console.log(`Formation markers ${label}: individual ${counts.individual}, clusters ${counts.clusters} (${counts.clusteredMembers} members)`);
}
if (!markerProjectionCounts.globeOut.clusters || !markerProjectionCounts.flatOut.clusters) throw new Error('ズームアウト時の集約マーカーが表示されませんでした。');
if (markerProjectionCounts.globeIn.clusters || markerProjectionCounts.flatIn.clusters) throw new Error('ズームイン時に集約マーカーが残っています。');

// 1. 開始直後、ズームアウト気味で集約された部隊マーカーが見える状態。
await page.evaluate(() => {
  state.mapProjection = 'globe';
  resetMapTransformForProjection();
  state.globe.lon = 118;
  state.globe.lat = 32;
  state.globe.zoom = 1.18;
  updateMapVisuals();
});
await page.waitForTimeout(700);
await page.evaluate(() => { const toast = document.getElementById('game-toast'); if (toast) toast.hidden = true; });
const visibleCamera = await page.evaluate(() => ({
  projection: state.mapProjection,
  lon: state.globe.lon,
  lat: state.globe.lat,
  zoom: state.globe.zoom,
  clusters: document.querySelectorAll('#formations-layer .formation-cluster').length
}));
console.log(`formations-visible camera: ${visibleCamera.projection} lon ${visibleCamera.lon.toFixed(1)}, lat ${visibleCamera.lat.toFixed(1)}, zoom ${visibleCamera.zoom.toFixed(2)}, clusters ${visibleCamera.clusters}`);
await page.screenshot({ path: `${artifactDir}/formations-visible.png`, fullPage: false });

// 拡大時は個別マーカーに戻ることを確認する。
await page.evaluate(() => {
  state.globe.zoom = 2.2;
  updateMapVisuals();
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${artifactDir}/formations-visible-zoom-in.png`, fullPage: false });

// 集約マーカーのクリックで拡大し、中身の個別マーカーへ移行できることを確認する。
const clusterClick = await page.evaluate(() => {
  state.globe.lon = 118;
  state.globe.lat = 32;
  state.globe.zoom = 1.18;
  updateMapVisuals();
  const node = [...document.querySelectorAll('#formations-layer .formation-cluster')].find(item => item.style.display !== 'none');
  const beforeZoom = state.globe.zoom;
  node?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return {
    found: Boolean(node),
    beforeZoom,
    afterZoom: state.globe.zoom,
    clustersAfter: [...document.querySelectorAll('#formations-layer .formation-cluster')].filter(item => item.style.display !== 'none').length,
    selectedStateId: state.selectedStateId
  };
});
if (!clusterClick.found) throw new Error('クリックできる集約マーカーがありませんでした。');
if (!(clusterClick.afterZoom > clusterClick.beforeZoom)) throw new Error('集約マーカーのクリックで拡大しませんでした。');
if (clusterClick.clustersAfter) throw new Error('集約マーカーのクリック後も集約が残っています。');
console.log(`Cluster click: zoom ${clusterClick.beforeZoom.toFixed(2)} -> ${clusterClick.afterZoom.toFixed(2)}, selected ${clusterClick.selectedStateId}`);

// 2. 満洲方面の部隊から遠い江蘇省を方向目標にし、州パネルに部隊命令を表示。
const plan = await page.evaluate(async () => {
  Orbis.declareWar('china', '満州国境の戦線');
  const snapshot = Orbis.snapshot();
  // 宣戦時の自動占領で満洲の前面が埋まるため、接する中国領を1州だけ戻して前線を作る。
  snapshot.territories['china_cn_he'] = 'china';
  delete snapshot.occupations['china_cn_he'];
  delete snapshot.conflicts['china_cn_he'];
  await Orbis.restore(snapshot);
  const current = Orbis.snapshot();
  const adjacency = Orbis.landAdjacency();
  const formations = Orbis.listFormations().filter(item => item.nationId === 'japan');
  const field = formations.find(item => item.type === 'field' && item.regionId.startsWith('manchukuo_')
    && (adjacency.get(item.regionId) || new Set()).has('china_cn_he'))
    || formations.find(item => item.type === 'field' && (adjacency.get(item.regionId) || new Set()).has('china_cn_he'));
  if (!field) return { ok: false };
  const target = { regionId: 'china_cn_js', regionName: '江蘇省', nationId: 'china', nationName: '中華民国' };
  const offensive = Orbis.setFormationOrder(field.id, { kind: 'offensive', targetRegionId: target.regionId, targetNationId: 'china' });
  const defendField = formations.find(item => item.id !== field.id && item.type === 'field');
  const defend = defendField ? Orbis.setFormationOrder(defendField.id, { kind: 'defend' }) : false;
  const region = window.ORBIS_STATES_DB.find(entry => entry.id === field.regionId);
  state.globe.lon = region?.lon ?? state.globe.lon;
  state.globe.lat = region?.lat ?? state.globe.lat;
  state.globe.zoom = 2.35;
  updateMapVisuals();
  handleStateSelect(field.regionId);
  return { ok: offensive, defend, field, target, before: Object.keys(current.occupations).length, startRegionId: field.regionId };
});
if (!plan.ok) throw new Error('攻勢命令を作成できませんでした。');
await page.waitForFunction(() => document.getElementById('state-inspector')?.classList.contains('open'));
await page.waitForTimeout(500);
await page.evaluate(() => {
  const toast = document.getElementById('game-toast');
  if (toast) toast.hidden = true;
  const body = document.querySelector('#state-inspector .insp-body');
  if (body) body.scrollTop = body.scrollHeight;
});
await page.waitForTimeout(300);
await page.screenshot({ path: `${artifactDir}/front-order.png`, fullPage: false });

// 州パネルと戦争パネルの命令ボタンが実際に動くことを確認する。
const uiDefend = await page.evaluate(id => {
  const button = document.querySelector(`[data-formation-defend="${id}"]`);
  button?.click();
  return Orbis.snapshot().formations.find(item => item.id === id)?.order?.kind;
}, plan.field.id);
if (uiDefend !== 'defend') throw new Error('州パネルの防御命令が反映されませんでした。');
const uiWarPanel = await page.evaluate(() => {
  Orbis.openWarPanel();
  const rows = document.querySelectorAll('#war-panel-body [data-formation-offensive]').length;
  document.querySelector('[data-close-dialog="modal-war-panel"]')?.click();
  return rows;
});
if (!uiWarPanel) throw new Error('戦争パネルに部隊命令が表示されませんでした。');
await page.evaluate(({ id, targetId }) => Orbis.setFormationOrder(id, { kind: 'offensive', targetRegionId: targetId }), { id: plan.field.id, targetId: plan.target.regionId });

// 3. 半月を進め、攻勢した戦線沿いの占領と前進した部隊を表示。
const turnResult = await page.evaluate(() => Orbis.finishTurn());
if (!turnResult) throw new Error('ターン解決に失敗しました。');
await page.evaluate(() => globalThis.ORBIS_PLAYBACK?.skipAll?.());
await page.waitForFunction(() => Orbis.snapshot()?.completedTurns >= 1 && Orbis.snapshot()?.phase === 'playing', { timeout: 120000 });
await page.waitForTimeout(500);
const after = await page.evaluate(previous => {
  const snapshot = Orbis.snapshot();
  const moved = snapshot.formations.find(item => item.id === previous.field.id);
  const region = window.ORBIS_STATES_DB.find(entry => entry.id === moved?.regionId);
  const occupations = Object.keys(snapshot.occupations).length;
  const jiangsuHolder = snapshot.territories['china_cn_js']
    || window.ORBIS_STATES_DB.find(entry => entry.id === 'china_cn_js')?.country;
  const adjacency = Orbis.landAdjacency();
  if (moved) {
    state.globe.lon = region?.lon ?? state.globe.lon;
    state.globe.lat = region?.lat ?? state.globe.lat;
    state.globe.zoom = 2.5;
    updateMapVisuals();
    handleStateSelect(moved.regionId);
  }
  return {
    occupations,
    moved,
    gain: occupations - previous.before,
    jiangsuHolder,
    jiangsuOccupied: Object.hasOwn(snapshot.occupations, 'china_cn_js'),
    adjacentToStart: moved && moved.regionId !== previous.startRegionId
      ? (adjacency.get(previous.startRegionId) || new Set()).has(moved.regionId)
      : true
  };
}, plan);
await page.waitForTimeout(800);
await page.screenshot({ path: `${artifactDir}/occupation-after-front.png`, fullPage: false });

console.log(`Screenshots saved to ${artifactDir}`);
console.log(`Occupation before/after: ${plan.before} -> ${after.occupations} (+${after.gain})`);
if (after.moved) console.log(`Advanced formation: ${after.moved.id} -> ${after.moved.regionId} (strength ${after.moved.strength})`);
if (after.moved?.regionId === 'china_cn_js') throw new Error('部隊マーカーが江蘇省へ飛んでいます。');
if (after.jiangsuHolder === 'japan' || after.jiangsuOccupied) throw new Error('江蘇省が1ターンで占領されています。');
if (after.gain > 1) throw new Error(`1ターンの占領が隣接1州を超えています (+${after.gain})。`);
if (!after.adjacentToStart) throw new Error('前進先が命令前の州に隣接していません。');
if (consoleErrors.length) {
  console.error('Console errors:');
  for (const error of consoleErrors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('No console errors.');
}
await browser.close();
