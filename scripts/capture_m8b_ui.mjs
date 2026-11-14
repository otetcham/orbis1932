#!/usr/bin/env node
/**
 * M8b UI/UX スクリーンショット。モックHTTPのみ。
 * 出力先はリポジトリ外の /workspace/pm/orbis1932/m8b/。
 * 変更前の PNG と europe-default-camera.json は上書きしない。
 */
import { mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const artifactDir = '/workspace/pm/orbis1932/m8b';
const cameraPath = `${artifactDir}/europe-default-camera.json`;
await mkdir(artifactDir, { recursive: true });
const camera = JSON.parse(await readFile(cameraPath, 'utf8'));
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
  headline: 'M8b 撮影用',
  briefing: 'M8b UI/UX 撮影用のモック概況です。',
  telegrams: [
    { actorId: 'adviser', subject: '確認', text: '地図と国策を確認します。', urgency: 'important', choices },
    { actorId: 'domestic:ig_military', subject: '軍備', text: '配備を確認します。', urgency: 'important', choices },
    { actorId: 'ministry:usa', subject: '外交', text: '情勢を確認します。', urgency: 'routine', choices }
  ]
};
const reply = () => ({ reply: '確認しました。', stance: 'consider', memory: '撮影。', choices });
const evaluation = () => ({
  headline: '撮影用裁定', article: 'モック裁定。',
  delta: { mil: 0, eco: 0, stb: 0, treasury: 0, prestige: 0, tension: 0 },
  reasoning: [{ text: 'モック。', sourceActionIds: [] }],
  developments: [], groups: [], relations: [], otherNations: [], actorUpdates: [],
  treaties: [], commitments: [], territoryChanges: [], clientChanges: [], leadershipChanges: [],
  memory: '継続', npcEvents: [], conflictChanges: [], actionResults: []
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

async function prepare(nationId = 'germany') {
  await page.evaluate(async id => {
    await Orbis.start({ nationId: id, difficulty: 'standard', mandate: 'recovery', maxTurns: 0, replace: true });
    Orbis.completeOnboarding();
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    document.body.classList.remove('dialog-open');
    const toast = document.getElementById('game-toast');
    if (toast) toast.hidden = true;
    window.ORBIS_PLAYBACK?.stop?.();
    document.getElementById('turn-playback-card')?.remove();
  }, nationId);
  await page.waitForTimeout(300);
}

async function flatCamera(lon, lat, scale) {
  return page.evaluate(({ lon, lat, scale }) => {
    const viewport = document.getElementById('map-viewport');
    const mapX = (lon + 180) * (2000 / 360);
    const mapY = (90 - lat) * 9.32 + 60;
    state.mapProjection = 'flat';
    state.mapTransform.scale = scale;
    state.mapTransform.x = viewport.clientWidth / 2 - mapX * scale;
    state.mapTransform.y = viewport.clientHeight / 2 - mapY * scale;
    applyFlatTransform();
    updateMapVisuals();
    return {
      scale: state.mapTransform.scale,
      x: state.mapTransform.x,
      y: state.mapTransform.y,
      labels: document.querySelectorAll('.map-label').length,
      formations: document.querySelectorAll('.formation-marker, .formation-cluster').length
    };
  }, { lon, lat, scale });
}

async function assertDateChipHidden() {
  const chip = await page.evaluate(() => {
    document.getElementById('turn-playback-card')?.remove();
    const card = document.createElement('div');
    card.id = 'turn-playback-card';
    card.className = 'turn-playback-card visible';
    card.innerHTML = '<div class="tp-date">1948年8月（前半）</div><strong>日付チップの重なり確認</strong>';
    document.body.appendChild(card);
    const date = card.querySelector('.tp-date');
    const dialog = document.querySelector('dialog[open]');
    if (!dialog) return { dialogOpen: false };
    const style = getComputedStyle(card);
    const rect = date.getBoundingClientRect();
    const dialogRect = dialog.getBoundingClientRect();
    const overlaps = rect.width > 0 && rect.height > 0 && !(rect.right < dialogRect.left || rect.left > dialogRect.right || rect.bottom < dialogRect.top || rect.top > dialogRect.bottom);
    return { dialogOpen: true, visibility: style.visibility, opacity: style.opacity, overlaps };
  });
  await page.evaluate(() => document.getElementById('turn-playback-card')?.remove());
  if (!chip.dialogOpen) throw new Error('対象のダイアログが開いていない');
  const hidden = chip.visibility === 'hidden' || Number(chip.opacity) === 0;
  if (!hidden) throw new Error(`日付チップがダイアログに重なっている: ${JSON.stringify(chip)}`);
}

async function assertGraph(path) {
  const result = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('#focus-panel-body [data-focus-node]')].map(node => {
      const rect = node.getBoundingClientRect();
      return { id: node.getAttribute('data-focus-node'), left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    });
    const edges = [...document.querySelectorAll('#focus-panel-body [data-focus-edge]')];
    let crossings = 0;
    for (const edge of edges) {
      const length = edge.getTotalLength();
      const from = edge.getAttribute('data-focus-edge')?.split('-')[0];
      const to = edge.getAttribute('data-focus-edge')?.split('-').slice(-1)[0];
      const matrix = edge.getScreenCTM();
      for (let index = 0; index <= 32; index++) {
        const point = edge.getPointAtLength(length * index / 32);
        const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
        for (const node of nodes) {
          if (node.id === from || node.id === to) continue;
          if (screen.x > node.left + 1 && screen.x < node.right - 1 && screen.y > node.top + 1 && screen.y < node.bottom - 1) crossings++;
        }
      }
    }
    return {
      nodes: nodes.length,
      edges: edges.length,
      crossings,
      detail: document.getElementById('focus-detail')?.getAttribute('data-focus-detail-id') || '',
      detailText: document.getElementById('focus-detail')?.textContent?.trim() || '',
      zoom: document.getElementById('focus-zoom-label')?.textContent || ''
    };
  });
  if (result.nodes < 25) throw new Error(`${path}: ノードが25件未満 (${result.nodes})`);
  if (result.edges < 10) throw new Error(`${path}: 前提線が少なすぎる (${result.edges})`);
  if (result.crossings) throw new Error(`${path}: 前提線がカードを横切る (${result.crossings})`);
  if (!result.detail || !result.detailText) throw new Error(`${path}: 効果の詳細パネルが空`);
  return result;
}

try {
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof Orbis !== 'undefined' && window.ORBIS_STATES_DB?.length, { timeout: 120000 });
  await page.evaluate(() => Orbis.configure({ provider: 'custom', endpoint: 'http://127.0.0.1/mock', model: 'mock', apiKey: 'TEST_ONLY_NOT_A_REAL_KEY', remember: false }));

  await prepare('germany');
  const europe = await flatCamera(camera.lon, camera.lat, camera.scale);
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${artifactDir}/europe-default-after.png`, fullPage: false });
  console.log('europe-default-after', JSON.stringify(europe));

  await prepare('japan');
  await page.evaluate(async () => {
    const snap = JSON.parse(JSON.stringify(Orbis.snapshot()));
    const focus = snap.nationalFocus.japan;
    focus.completed = ['jp_manchukuo', 'jp_league_withdrawal', 'jp_china_incident', 'jp_southern_advance'];
    focus.current = { id: 'jp_wartime_economy', progress: 22 };
    focus.politicalPower = 210;
    if (!(await Orbis.restore(snap))) throw new Error('国策状態の復元に失敗しました。');
    Orbis.openFocusPanel();
  });
  await page.waitForSelector('#modal-focus[open]', { timeout: 30000 });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const viewport = document.getElementById('focus-graph-viewport');
    const graph = document.getElementById('focus-graph');
    if (!viewport || !graph) throw new Error('国策グラフがない');
    const scale = Math.min(1, Math.max(0.62, Math.min(viewport.clientWidth / graph.offsetWidth, viewport.clientHeight / graph.offsetHeight) * 0.98));
    Orbis.setFocusGraphView({ scale, x: 8, y: 8 });
    Orbis.showFocusDetail('jp_china_incident');
  });
  await page.waitForTimeout(250);
  const japanGraph = await assertGraph('japan-focus-tree-after');
  await assertDateChipHidden();
  await page.screenshot({ path: `${artifactDir}/japan-focus-tree-after.png`, fullPage: false });
  console.log('japan-focus-tree-after', JSON.stringify(japanGraph));

  await page.evaluate(() => document.querySelector('[data-close-dialog="modal-focus"]')?.click());
  await prepare('japan');
  const korea = await page.evaluate(async () => {
    const snap = JSON.parse(JSON.stringify(Orbis.snapshot()));
    snap.completedTurns = 322;
    if (!(await Orbis.restore(snap))) throw new Error('日付の復元に失敗しました。');
    const result = Orbis.forceWorldArc('ww2_end_pacific');
    if (result.status !== 'fired') throw new Error('太平洋戦争の終結に失敗しました。');
    Orbis.render();
    return {
      date: document.getElementById('hud-date')?.textContent,
      south: Orbis.snapshot().territories.japan_empire_kor,
      north: Orbis.snapshot().territories.japan_empire_prk
    };
  });
  const koreaCamera = await flatCamera(127.8, 38.2, 4.8);
  await page.waitForTimeout(450);
  const koreaLabels = await page.evaluate(() => ({
    south: document.querySelector('#labels-layer text[data-label-key="c:korea"]')?.textContent || '',
    north: document.querySelector('#labels-layer text[data-label-key="c:korea_communist"]')?.textContent || '',
    labels: [...document.querySelectorAll('#labels-layer text.map-label-country')].map(node => node.textContent)
  }));
  if (korea.south !== 'korea' || korea.north !== 'korea_communist') throw new Error(`朝鮮の南北分離に失敗: ${JSON.stringify(korea)}`);
  await page.screenshot({ path: `${artifactDir}/korea-split.png`, fullPage: false });
  console.log('korea-split', JSON.stringify({ ...korea, camera: koreaCamera, labels: koreaLabels }));

  await page.evaluate(() => {
    Orbis.openSettings();
    const mute = document.getElementById('toggle-audio-muted');
    if (mute) mute.checked = false;
    const key = document.getElementById('input-api-key');
    if (key) key.value = '';
    document.querySelector('#modal-ai-settings .settings-section-label:last-of-type')?.scrollIntoView?.({ block: 'center' });
  });
  await page.waitForSelector('#modal-ai-settings[open]', { timeout: 30000 });
  await page.waitForTimeout(250);
  await assertDateChipHidden();
  await page.screenshot({ path: `${artifactDir}/settings-mute.png`, fullPage: false });
  console.log('settings-mute', JSON.stringify(await page.evaluate(() => ({
    muteVisible: Boolean(document.getElementById('toggle-audio-muted')),
    muteChecked: document.getElementById('toggle-audio-muted')?.checked,
    keyVisibleOnScreen: false
  }))));

  if (errors.length) throw new Error(`コンソールエラー: ${errors.join(' | ')}`);
  console.log(`スクリーンショット保存: ${artifactDir}`);
} finally {
  await browser.close();
}
