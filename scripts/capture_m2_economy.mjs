#!/usr/bin/env node
/**
 * ORBIS//1932 — M2 動員・生産・補給とNPC攻勢のスクリーンショット。
 * Playwright (chromium) が必要。PNG はリポジトリ外の m2/ に保存する。
 */
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const artifactDir = '/workspace/pm/orbis1932/m2';
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
  headline: '動員と生産が戦線を支える',
  article: '動員段階の引き上げと軍需生産の配分を受け、前線への補充と装備の蓄積が進んだ。',
  delta: { mil: 0, eco: 0, stb: 0, treasury: 0, prestige: 0, tension: 0 },
  reasoning: [{ text: '動員・生産・補給の骨格を既存の隣接占領ルールに接続した。', sourceActionIds: [] }],
  developments: [{ headline: '軍需工場の稼働', body: '軍需寄りの配分で装備の生産と補充が進んだ。' }],
  groups: [], relations: [], otherNations: [], actorUpdates: [], treaties: [], commitments: [],
  territoryChanges: [], clientChanges: [], leadershipChanges: [], memory: '動員・生産・補給の状況を記憶した。'
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
      ? { reply: '前線と生産の状況を確認しました。月末の裁定を待ちます。', stance: 'consider', memory: '動員・生産を確認。', choices }
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

// 1. 動員・生産パネル。動員を上げ、軍需寄りに配分して1ターン進める。
await page.evaluate(() => {
  Orbis.setMobilization(2);
  Orbis.setProductionSplit(75);
});
await page.evaluate(() => Orbis.finishTurn());
await page.evaluate(() => globalThis.ORBIS_PLAYBACK?.skipAll?.());
await page.waitForFunction(() => Orbis.snapshot()?.completedTurns >= 1 && Orbis.snapshot()?.phase === 'playing', { timeout: 120000 });
const openedFromDock = await page.evaluate(() => {
  const toast = document.getElementById('game-toast');
  if (toast) toast.hidden = true;
  const body = document.querySelector('#state-inspector .insp-body');
  if (body) body.scrollTop = 0;
  document.getElementById('state-inspector')?.classList.remove('open');
  const button = document.querySelector('[data-open-economy]');
  button?.click();
  return Boolean(button);
});
if (!openedFromDock) throw new Error('内政ドックの動員・生産ボタンがありません。');
await page.waitForFunction(() => document.getElementById('modal-economy')?.open);
await page.waitForTimeout(500);
const economyState = await page.evaluate(() => Orbis.economySummary());
if (!economyState || economyState.manpower <= 0 || economyState.equipment <= 0) throw new Error('動員・生産パネルの数値がありません。');
if (!economyState.lastProduction) throw new Error('生産結果がパネルへ反映されていません。');
await page.screenshot({ path: `${artifactDir}/production-panel.png`, fullPage: false });
console.log(`production-panel: 動員 ${economyState.mobilizationLabel}, 兵力 ${economyState.manpower}, 装備 ${economyState.equipment}, 軍需 ${economyState.militaryShare}%`);

// 2. NPCの攻勢。プレイヤーは命令せず、中国NPCの前進だけを観察する。
await page.evaluate(() => {
  document.querySelector('[data-close-dialog="modal-economy"]')?.click();
  Orbis.declareWar('china', '満州国境の戦線');
});
const npcBefore = await page.evaluate(() => Orbis.snapshot());
await page.evaluate(() => Orbis.finishTurn());
await page.evaluate(() => globalThis.ORBIS_PLAYBACK?.skipAll?.());
await page.waitForFunction(() => Orbis.snapshot()?.completedTurns >= 2 && Orbis.snapshot()?.phase === 'playing', { timeout: 120000 });
const npcResult = await page.evaluate(before => {
  const snapshot = Orbis.snapshot();
  const adjacency = Orbis.landAdjacency();
  const db = id => window.ORBIS_STATES_DB.find(region => region.id === id);
  const playersMoved = snapshot.formations.filter(formation => {
    if (formation.nationId !== 'japan') return false;
    const previous = before.formations.find(item => item.id === formation.id);
    return previous && previous.regionId !== formation.regionId;
  });
  const moved = snapshot.formations.filter(formation => {
    if (formation.nationId === 'japan') return false;
    const previous = before.formations.find(item => item.id === formation.id);
    return previous && previous.regionId !== formation.regionId;
  }).map(formation => {
    const previous = before.formations.find(item => item.id === formation.id);
    return {
      id: formation.id,
      nationId: formation.nationId,
      from: previous.regionId,
      to: formation.regionId,
      adjacent: (adjacency.get(previous.regionId) || new Set()).has(formation.regionId),
      region: db(formation.regionId)
    };
  });
  const target = moved[0];
  if (target) {
    state.globe.lon = target.region?.lon ?? state.globe.lon;
    state.globe.lat = target.region?.lat ?? state.globe.lat;
    state.globe.zoom = 2.5;
    updateMapVisuals();
    handleStateSelect(target.to);
  }
  return { moved, playersMoved, target };
}, npcBefore);
if (npcResult.playersMoved.length) throw new Error('プレイヤー部隊が自動で前進しています。');
if (!npcResult.target) throw new Error('NPCの攻勢による前進がありませんでした。');
if (!npcResult.target.adjacent) throw new Error('NPCが隣接しない州へ前進しています。');
if (npcResult.target.to === 'china_cn_js') throw new Error('NPCが南京付近へ飛んでいます。');
const movedPastOne = npcResult.moved.some(item => !item.adjacent);
if (movedPastOne) throw new Error('NPCの前進が1州を超えています。');
await page.evaluate(() => {
  const toast = document.getElementById('game-toast');
  if (toast) toast.hidden = true;
  const body = document.querySelector('#state-inspector .insp-body');
  if (body) body.scrollTop = body.scrollHeight;
});
await page.waitForTimeout(700);
await page.screenshot({ path: `${artifactDir}/npc-offensive.png`, fullPage: false });
console.log(`npc-offensive: ${npcResult.target.nationId} ${npcResult.target.from} -> ${npcResult.target.to} (${npcResult.target.region?.nameJa || ''})`);

// 3. 補給が伸びた部隊と孤立した部隊。占領地の連なりを作り、パネルに表示する。
const supplyPlan = await page.evaluate(() => {
  const snapshot = Orbis.snapshot();
  const adjacency = Orbis.landAdjacency();
  const db = id => window.ORBIS_STATES_DB.find(region => region.id === id);
  const isLand = region => region && !region.isSea && !region.isSeaZone && region.type !== 'sea';
  const holder = region => snapshot.territories[region.id] || region.country;
  const sphere = new Set(['japan']);
  for (const [id, client] of Object.entries(snapshot.clients || {})) {
    if (client.sponsorId === 'japan' && !client.dissolved) sphere.add(id);
  }
  let chain = null;
  for (const region of window.ORBIS_STATES_DB) {
    if (!isLand(region) || !sphere.has(holder(region))) continue;
    for (const firstId of adjacency.get(region.id) || []) {
      const first = db(firstId);
      if (!isLand(first) || holder(first) !== 'china') continue;
      const previous = new Map([[firstId, null]]);
      const queue = [[firstId, 1]];
      let last = null;
      while (queue.length) {
        const [id, depth] = queue.shift();
        if (depth >= 6) { last = id; break; }
        for (const nextId of adjacency.get(id) || []) {
          const next = db(nextId);
          if (!isLand(next) || holder(next) !== 'china' || previous.has(nextId)) continue;
          previous.set(nextId, id);
          queue.push([nextId, depth + 1]);
        }
      }
      if (!last) continue;
      const path = [];
      for (let current = last; current; current = previous.get(current)) path.unshift(current);
      chain = path;
      break;
    }
    if (chain) break;
  }
  if (!chain) return { ok: false };
  for (const id of chain) {
    snapshot.territories[id] = 'japan';
    snapshot.occupations[id] = 'china';
    snapshot.conflicts[id] = { attacker: 'japan', defender: 'china', months: 1, reason: '補給線の突出' };
  }
  const isolatedRegion = window.ORBIS_STATES_DB.find(region => isLand(region) && (snapshot.territories[region.id] || region.country) === 'china' && !chain.includes(region.id));
  if (!isolatedRegion) return { ok: false };
  const stretchedRegion = chain[chain.length - 1];
  snapshot.formations = snapshot.formations.filter(formation => !['formation-test-stretched', 'formation-test-isolated'].includes(formation.id));
  snapshot.formations.push({ id: 'formation-test-stretched', nationId: 'japan', type: 'field', regionId: stretchedRegion, strength: 82, order: { kind: 'defend' } });
  snapshot.formations.push({ id: 'formation-test-isolated', nationId: 'japan', type: 'field', regionId: isolatedRegion.id, strength: 76, order: { kind: 'defend' } });
  return { ok: true, snapshot, chain, stretchedRegion, isolatedRegion: isolatedRegion.id };
});
if (!supplyPlan.ok) throw new Error('補給の突出シナリオを作成できませんでした。');
await page.evaluate(plan => Orbis.restore(plan.snapshot), supplyPlan);
await page.waitForFunction(() => Orbis.snapshot()?.formations.some(item => item.id === 'formation-test-stretched'));
const supplyState = await page.evaluate(() => ({
  stretched: Orbis.formationSupply('formation-test-stretched'),
  isolated: Orbis.formationSupply('formation-test-isolated')
}));
if (supplyState.stretched.status === 'full') throw new Error('突出部隊の補給が十分のままです。');
if (supplyState.isolated.status !== 'isolated') throw new Error('孤立部隊の補給が不足になっていません。');
await page.evaluate(() => {
  document.querySelector('[data-close-dialog="modal-war-panel"]')?.click();
  document.getElementById('state-inspector')?.classList.remove('open');
  Orbis.openEconomyPanel();
});
await page.waitForFunction(() => document.getElementById('modal-economy')?.open);
await page.waitForTimeout(400);
const scrolled = await page.evaluate(() => {
  const badge = [...document.querySelectorAll('#economy-panel-body .supply-badge')].find(node => node.textContent.includes('伸びた'));
  const card = badge?.closest('.formation-row');
  card?.scrollIntoView({ block: 'center' });
  return Boolean(card);
});
if (!scrolled) throw new Error('補給が伸びた部隊がパネルに表示されませんでした。');
await page.waitForTimeout(400);
await page.screenshot({ path: `${artifactDir}/supply-stretched.png`, fullPage: false });
console.log(`supply-stretched: 伸びた ${supplyState.stretched.label} (距離 ${supplyState.stretched.distance}), 孤立 ${supplyState.isolated.label}`);

if (consoleErrors.length) {
  console.error('Console errors:');
  for (const error of consoleErrors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('No console errors.');
}
console.log(`Screenshots saved to ${artifactDir}`);
await browser.close();
