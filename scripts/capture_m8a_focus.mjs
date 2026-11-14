#!/usr/bin/env node
/**
 * M8a 国策ノードグラフのスクリーンショット。モックHTTPのみ。
 * 出力先はリポジトリ外の /workspace/pm/orbis1932/m8a/。
 */
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const artifactDir = '/workspace/pm/orbis1932/m8a';
await mkdir(artifactDir, { recursive: true });
const pageUrl = pathToFileURL(new URL('../orbis_simulator.html', import.meta.url).pathname).href;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    console.error('Playwright が見つかりません。');
    process.exit(1);
  }
}

const choices = [
  { label: '了承', text: '了解しました。' },
  { label: '保留', text: '検討します。' }
];
const opening = {
  headline: '国策の岐路',
  briefing: 'M8a 国策ノードグラフ撮影用のモック概況です。',
  telegrams: [
    { actorId: 'adviser', subject: '国策', text: '長期の国家方針を確認します。', urgency: 'important', choices },
    { actorId: 'domestic:ig_military', subject: '軍備', text: '軍備と産業の配分を協議します。', urgency: 'important', choices },
    { actorId: 'ministry:usa', subject: '外交', text: '各国との関係について協議します。', urgency: 'routine', choices }
  ]
};
const reply = () => ({ reply: '国策の進捗を確認しました。', stance: 'consider', memory: '国策グラフを確認。', choices });
const evaluation = () => ({
  headline: '国策が国家の針路を定める',
  article: '政治力を国策へ振り向け、長期の国家方針を整えた。',
  delta: { mil: 0, eco: 0, stb: 0, treasury: 0, prestige: 0, tension: 0 },
  reasoning: [{ text: 'M8a 撮影用のモック裁定。', sourceActionIds: [] }],
  developments: [{ headline: '国際情勢', body: '主要国の国策が動いている。' }],
  groups: [], relations: [], otherNations: [], actorUpdates: [], treaties: [], commitments: [],
  territoryChanges: [], clientChanges: [], leadershipChanges: [], memory: '継続',
  npcEvents: [], conflictChanges: [], actionResults: []
});

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--no-sandbox']
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await context.route('**/*', async route => {
  const request = route.request();
  if (request.method() !== 'POST' || !request.url().includes('127.0.0.1')) return route.continue();
  let body = {};
  try { body = request.postDataJSON() || {}; } catch { body = {}; }
  const texts = (body.messages || []).filter(item => item.role === 'user').map(item => item.content);
  const payload = texts.map(value => { try { return JSON.parse(value); } catch { return null; } }).find(value => value?.operation);
  const data = payload?.operation === 'BRIEFING' ? opening
    : payload?.operation === 'ACTOR' ? reply()
      : payload?.operation === 'CONNECTION_TEST' ? { ok: true } : evaluation();
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) }, finish_reason: 'stop' }] }) });
});

const page = await context.newPage();
const errors = [];
page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));

async function openFocusFor(nationId, completed, currentId) {
  await page.evaluate(async ({ nationId, completed, currentId }) => {
    await Orbis.start({ nationId, difficulty: 'standard', mandate: 'recovery', maxTurns: 24, replace: true });
    const snap = JSON.parse(JSON.stringify(Orbis.snapshot()));
    const state = snap.nationalFocus[nationId];
    state.completed = completed;
    state.current = currentId ? { id: currentId, progress: 0 } : null;
    state.politicalPower = 180;
    const ok = await Orbis.restore(snap);
    if (!ok) throw new Error('国策状態の復元に失敗しました。');
    Orbis.completeOnboarding();
    Orbis.openFocusPanel();
  }, { nationId, completed, currentId });
  await page.waitForSelector('#modal-focus[open]', { timeout: 30000 });
  await page.waitForTimeout(350);
}

async function assertGraph(path) {
  const check = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('#focus-panel-body [data-focus-node]')];
    const edges = [...document.querySelectorAll('#focus-panel-body [data-focus-edge]')];
    const svg = document.querySelector('#focus-panel-body .focus-graph-edges');
    const visibleEdges = edges.filter(edge => {
      const style = getComputedStyle(edge);
      return Number(style.strokeWidth.replace('px', '')) > 0 && style.stroke !== 'none';
    });
    return {
      nodes: nodes.length,
      edges: edges.length,
      visibleEdges: visibleEdges.length,
      svgWidth: svg?.getBoundingClientRect().width || 0,
      svgHeight: svg?.getBoundingClientRect().height || 0,
      completed: document.querySelectorAll('#focus-panel-body .focus-node.is-completed').length,
      current: document.querySelectorAll('#focus-panel-body .focus-node.is-current').length,
      locked: document.querySelectorAll('#focus-panel-body .focus-node.is-locked').length,
      available: document.querySelectorAll('#focus-panel-body .focus-node.is-available').length
    };
  });
  if (check.nodes < 25) throw new Error(`${path}: ノードが25件未満 (${check.nodes})`);
  if (check.edges < 5 || check.visibleEdges < 5) throw new Error(`${path}: 前提エッジが見えない (${check.edges}/${check.visibleEdges})`);
  if (!check.completed || !check.current || !check.locked || !check.available) throw new Error(`${path}: 状態表示が欠けている ${JSON.stringify(check)}`);
  return check;
}

async function assertDateChipHidden() {
  const chip = await page.evaluate(() => {
    document.getElementById('turn-playback-card')?.remove();
    const card = document.createElement('div');
    card.id = 'turn-playback-card';
    card.className = 'turn-playback-card visible';
    card.innerHTML = '<div class="tp-date">1947年1月（前半）</div><strong>日付チップの重なり確認</strong>';
    document.body.appendChild(card);
    const date = card.querySelector('.tp-date');
    const dialog = document.getElementById('modal-focus');
    const style = getComputedStyle(card);
    const rect = date.getBoundingClientRect();
    const dialogRect = dialog.getBoundingClientRect();
    const overlaps = rect.width > 0 && rect.height > 0 && !(rect.right < dialogRect.left || rect.left > dialogRect.right || rect.bottom < dialogRect.top || rect.top > dialogRect.bottom);
    return { visibility: style.visibility, opacity: style.opacity, overlaps, open: dialog.open };
  });
  await page.evaluate(() => document.getElementById('turn-playback-card')?.remove());
  if (!chip.open) throw new Error('国策ダイアログが開いていない');
  const hidden = chip.visibility === 'hidden' || Number(chip.opacity) === 0;
  if (!hidden) throw new Error(`ダイアログ中の日付チップが非表示になっていない: ${JSON.stringify(chip)}`);
  if (chip.overlaps && !hidden) throw new Error('日付チップが国策ダイアログに重なっている');
}

try {
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof Orbis !== 'undefined' && window.ORBIS_STATES_DB?.length, { timeout: 120000 });
  await page.evaluate(() => Orbis.configure({ provider: 'custom', endpoint: 'http://127.0.0.1/mock', model: 'mock', apiKey: 'TEST_ONLY_NOT_A_REAL_KEY', remember: false }));

  await openFocusFor('japan', ['jp_manchukuo', 'jp_league_withdrawal', 'jp_china_incident'], 'jp_southern_advance');
  const japan = await assertGraph('japan');
  await assertDateChipHidden();
  await page.screenshot({ path: `${artifactDir}/japan-focus-tree.png`, fullPage: false });
  console.log(`japan-focus-tree: ${JSON.stringify(japan)}`);

  await page.evaluate(() => document.querySelector('[data-close-dialog="modal-focus"]')?.click());
  await openFocusFor('germany', ['de_secret_rearmament', 'de_authoritarian_turn'], 'de_anschluss_prep');
  const germany = await assertGraph('germany');
  await assertDateChipHidden();
  await page.screenshot({ path: `${artifactDir}/germany-focus-tree.png`, fullPage: false });
  console.log(`germany-focus-tree: ${JSON.stringify(germany)}`);

  if (errors.length) throw new Error(`コンソールエラー: ${errors.join(' | ')}`);
  console.log(`スクリーンショット保存: ${artifactDir}`);
} finally {
  await browser.close();
}
