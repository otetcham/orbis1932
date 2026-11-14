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
  state.mapProjection = 'flat';
  state.mapTransform.scale = 1;
  state.mapTransform.x = 0;
  state.mapTransform.y = 0;
  applyFlatTransform();
  updateMapVisuals();
  const flat = [...document.querySelectorAll('#formations-layer .formation-marker')].filter(node => node.style.display !== 'none').length;
  state.mapProjection = 'globe';
  state.globe.lon = 124;
  state.globe.lat = 33;
  state.globe.zoom = 1.85;
  updateMapVisuals();
  const globe = [...document.querySelectorAll('#formations-layer .formation-marker')].filter(node => node.style.display !== 'none').length;
  return { flat, globe };
});
console.log(`Visible formation markers: flat ${markerProjectionCounts.flat}, globe ${markerProjectionCounts.globe}`);

// 1. 開始直後、日本と満洲方面の部隊マーカーが見える状態。
await page.evaluate(() => {
  state.mapProjection = 'globe';
  state.globe.lon = 124;
  state.globe.lat = 33;
  state.globe.zoom = 1.85;
  updateMapVisuals();
});
await page.waitForTimeout(700);
await page.evaluate(() => { const toast = document.getElementById('game-toast'); if (toast) toast.hidden = true; });
await page.screenshot({ path: `${artifactDir}/formations-visible.png`, fullPage: false });

// 2. 対中国戦争で攻勢・防御命令を出し、州パネルに部隊命令を表示。
const plan = await page.evaluate(() => {
  Orbis.declareWar('china', '満州国境の戦線');
  const snapshot = Orbis.snapshot();
  const formations = Orbis.listFormations().filter(item => item.nationId === 'japan');
  const field = formations.find(item => item.type === 'field' && Orbis.formationTargets(item.id).some(target => {
    const region = window.ORBIS_STATES_DB.find(entry => entry.id === target.regionId);
    return region && (snapshot.territories[target.regionId] || region.country) === 'china';
  })) || formations.find(item => item.type === 'field' && Orbis.formationTargets(item.id).length);
  if (!field) return { ok: false };
  const target = Orbis.formationTargets(field.id).find(item => {
    const region = window.ORBIS_STATES_DB.find(entry => entry.id === item.regionId);
    return region && (snapshot.territories[item.regionId] || region.country) === 'china';
  }) || Orbis.formationTargets(field.id)[0];
  const offensive = Orbis.setFormationOrder(field.id, { kind: 'offensive', targetRegionId: target.regionId });
  const defendField = formations.find(item => item.id !== field.id && item.type === 'field');
  const defend = defendField ? Orbis.setFormationOrder(defendField.id, { kind: 'defend' }) : false;
  const region = window.ORBIS_STATES_DB.find(entry => entry.id === field.regionId);
  state.globe.lon = region?.lon ?? state.globe.lon;
  state.globe.lat = region?.lat ?? state.globe.lat;
  state.globe.zoom = 2.35;
  updateMapVisuals();
  handleStateSelect(field.regionId);
  return { ok: offensive, defend, field, target, before: Object.keys(Orbis.snapshot().occupations).length };
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
  if (moved) {
    state.globe.lon = region?.lon ?? state.globe.lon;
    state.globe.lat = region?.lat ?? state.globe.lat;
    state.globe.zoom = 2.5;
    updateMapVisuals();
    handleStateSelect(moved.regionId);
  }
  return { occupations, moved, gain: occupations - previous.before };
}, plan);
await page.waitForTimeout(800);
await page.screenshot({ path: `${artifactDir}/occupation-after-front.png`, fullPage: false });

console.log(`Screenshots saved to ${artifactDir}`);
console.log(`Occupation before/after: ${plan.before} -> ${after.occupations} (+${after.gain})`);
if (after.moved) console.log(`Advanced formation: ${after.moved.id} -> ${after.moved.regionId} (strength ${after.moved.strength})`);
if (consoleErrors.length) {
  console.error('Console errors:');
  for (const error of consoleErrors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('No console errors.');
}
await browser.close();
