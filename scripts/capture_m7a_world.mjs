#!/usr/bin/env node
/**
 * M7a 世界の動態スクリーンショット。モックHTTPのみ。
 * 出力先はリポジトリ外の /workspace/pm/orbis1932/m7a/。
 */
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const artifactDir = '/workspace/pm/orbis1932/m7a';
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
  headline: '世界の動態を読む',
  briefing: 'M7a撮影用のモック概況です。史実の弧が地図と戦争を動かします。',
  telegrams: [
    { actorId: 'domestic:ig_military', subject: '防衛', text: '欧州の軍備拡張について協議します。', urgency: 'important', choices },
    { actorId: 'ministry:usa', subject: '欧州情勢', text: 'ドイツの動向を注視しています。', urgency: 'important', choices },
    { actorId: 'client:manchukuo', subject: '自治', text: '東アジアの安定について協議したい。', urgency: 'routine', choices }
  ]
};
const reply = () => ({ reply: '情勢を確認しました。', stance: 'consider', memory: '世界の動態を注視。', choices });
const evaluation = () => ({
  headline: '世界の弧が動く',
  article: '史実寄りの駆動により、欧州とアジアの戦線が動いた。',
  delta: { mil: 0, eco: 0, stb: 0, treasury: 0, prestige: 0, tension: 0 },
  reasoning: [{ text: 'M7a撮影用のモック裁定。', sourceActionIds: [] }],
  developments: [{ headline: '国際情勢', body: '各国の部隊が国境へ集結している。' }],
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
  const data = payload?.operation === 'BRIEFING' ? opening : payload?.operation === 'ACTOR' ? reply() : payload?.operation === 'CONNECTION_TEST' ? { ok: true } : evaluation();
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) }, finish_reason: 'stop' }] }) });
});

const page = await context.newPage();
const errors = [];
page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));

async function focusMap(lon, lat, scale = 6) {
  await page.evaluate(({ lon, lat, scale }) => {
    state.mapProjection = 'flat';
    const mapX = (lon + 180) * (2000 / 360);
    const mapY = (90 - lat) * 9.32 + 60;
    const vp = document.getElementById('map-viewport');
    state.mapTransform.scale = scale;
    state.mapTransform.x = vp.clientWidth / 2 - mapX * scale;
    state.mapTransform.y = vp.clientHeight / 2 - mapY * scale;
    applyFlatTransform();
    updateMapVisuals();
  }, { lon, lat, scale });
  await page.waitForTimeout(350);
}

try {
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof Orbis !== 'undefined' && window.ORBIS_STATES_DB?.length, { timeout: 120000 });
  await page.evaluate(() => {
    localStorage.removeItem('orbis_campaign_v6');
    localStorage.removeItem('orbis_campaign_v5');
    window.confirm = () => true;
    Orbis.configure({ provider: 'custom', endpoint: 'http://127.0.0.1/mock', model: 'mock', apiKey: 'TEST_ONLY_NOT_A_REAL_KEY', remember: false });
  });
  await page.evaluate(() => Orbis.start({ nationId: 'uk', difficulty: 'story', mandate: 'recovery', maxTurns: 0, replace: true }));
  await page.waitForFunction(() => Orbis.snapshot()?.phase === 'playing', { timeout: 120000 });
  await page.evaluate(() => Orbis.completeOnboarding());
  await page.waitForSelector('#modal-onboarding', { state: 'hidden', timeout: 30000 });

  // 1. 政治併合で地図が変わる。オーストリア・ズデーテン・チェコをドイツへ。
  for (const id of ['germany_anschluss', 'germany_sudeten', 'germany_prague']) {
    const result = await page.evaluate(arcId => Orbis.forceWorldArc(arcId), id);
    if (result.status !== 'fired') throw new Error(`${id} が発火しません: ${result.status}`);
  }
  await page.evaluate(() => Orbis.closeInfoPanels());
  await focusMap(12, 49, 7);
  const changed = await page.evaluate(() => {
    const snap = Orbis.snapshot();
    return ['austria_at_1', 'austria_at_2', 'austria_at_3', 'austria_at_4', 'austria_at_5', 'austria_at_6', 'austria_at_7', 'austria_at_8', 'austria_at_9', 'czechoslovakia_cz_us']
      .filter(id => snap.territories[id] === 'germany').length;
  });
  if (changed < 10) throw new Error(`政治併合の地図変化が不足: ${changed}`);
  await page.screenshot({ path: `${artifactDir}/world-changed.png`, fullPage: false });
  console.log(`world-changed: ドイツへ移管された州 ${changed}`);

  // 2. 史実の戦争。ポーランド戦線を開き、数ターン進めて戦争パネルを見せる。
  const warResult = await page.evaluate(() => Orbis.forceWorldArc('germany_poland'));
  if (warResult.status !== 'fired') throw new Error(`ポーランド戦線が発火しません: ${warResult.status}`);
  for (let turn = 0; turn < 3; turn++) {
    const ok = await page.evaluate(() => Orbis.finishTurn());
    if (!ok) throw new Error(`ターン進行に失敗: ${turn}`);
    await page.waitForFunction(count => (Orbis.snapshot()?.completedTurns || 0) >= count, turn + 1, { timeout: 120000 });
  }
  await page.evaluate(() => Orbis.openWarPanel());
  await page.waitForSelector('#modal-war-panel[open]');
  const warText = await page.evaluate(() => document.getElementById('war-panel-body')?.textContent || '');
  if (!warText.includes('ドイツ') || !warText.includes('ポーランド')) throw new Error('戦争パネルにドイツ・ポーランド戦線がありません');
  if (!warText.includes('史実の弧')) throw new Error('戦争パネルに弧の記録がありません');
  await page.evaluate(() => document.querySelector('[data-close-dialog="modal-war-panel"]')?.click());
  await focusMap(20, 52, 6);
  await page.evaluate(() => Orbis.openWarPanel());
  await page.waitForSelector('#modal-war-panel[open]');
  await page.screenshot({ path: `${artifactDir}/historical-war.png`, fullPage: false });
  console.log('historical-war: ドイツ・ポーランド戦線と弧の記録');

  // 日付チップがダイアログに重ならないこと。
  const chip = await page.evaluate(() => {
    document.getElementById('turn-playback-card')?.remove();
    const card = document.createElement('div');
    card.id = 'turn-playback-card';
    card.className = 'turn-playback-card visible';
    card.innerHTML = '<div class="tp-date">1940年5月（前半）</div><strong>ターン再生カード</strong><p>日付チップの重なり確認用。</p>';
    document.body.appendChild(card);
    const date = card.querySelector('.tp-date');
    const dialog = document.getElementById('modal-war-panel');
    const style = getComputedStyle(card);
    const rect = date.getBoundingClientRect();
    const dialogRect = dialog.getBoundingClientRect();
    const overlaps = rect.width > 0 && rect.height > 0 && !(rect.right < dialogRect.left || rect.left > dialogRect.right || rect.bottom < dialogRect.top || rect.top > dialogRect.bottom);
    return { visibility: style.visibility, opacity: style.opacity, overlaps, dialogOpen: dialog.open };
  });
  if (!chip.dialogOpen) throw new Error('確認用ダイアログが開いていません');
  const hidden = chip.visibility === 'hidden' || Number(chip.opacity) === 0;
  if (!hidden && chip.overlaps) throw new Error(`日付チップがダイアログに重なっています: ${JSON.stringify(chip)}`);
  if (!hidden) throw new Error(`ダイアログ中の日付チップが非表示になっていません: ${JSON.stringify(chip)}`);
  await page.evaluate(() => { document.getElementById('turn-playback-card')?.remove(); document.querySelector('[data-close-dialog="modal-war-panel"]')?.click(); });

  // 3. 脱植民地化。インドシナを独立させ、戦争パネルの弧の記録と地図を見せる。
  const independence = await page.evaluate(() => Orbis.forceWorldArc('indochina_independence'));
  if (independence.status !== 'fired') throw new Error(`インドシナ独立が発火しません: ${independence.status}`);
  await focusMap(106, 16, 5.2);
  await page.evaluate(() => Orbis.openWarPanel());
  await page.waitForSelector('#modal-war-panel[open]');
  const decolonizationText = await page.evaluate(() => document.getElementById('war-panel-body')?.textContent || '');
  if (!decolonizationText.includes('インドシナ')) throw new Error('脱植民地化の記録が表示されていません');
  await page.screenshot({ path: `${artifactDir}/decolonization-or-peace.png`, fullPage: false });
  console.log('decolonization-or-peace: インドシナ独立の記録と地図');

  if (errors.length) throw new Error(`コンソールエラー: ${errors.join(' | ')}`);
  console.log(`screenshots: ${artifactDir}/world-changed.png, historical-war.png, decolonization-or-peace.png`);
} finally {
  await browser.close();
}
