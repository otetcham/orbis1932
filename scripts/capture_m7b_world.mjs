#!/usr/bin/env node
/**
 * M7b 戦後の地図スクリーンショット。モックHTTPのみ。
 * 実際に1950年頃までターンを進め、HUDの史実年を写す。
 * 出力先はリポジトリ外の /workspace/pm/orbis1932/m7b/。
 */
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const artifactDir = '/workspace/pm/orbis1932/m7b';
const TARGET_HALF = 438; // 1950年6月（前半）
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
  headline: '戦後の世界を読む',
  briefing: 'M7b撮影用のモック概況です。史実の弧と戦後処理が地図を動かします。',
  telegrams: [
    { actorId: 'domestic:ig_military', subject: '防衛', text: '戦後の軍備と占領行政について協議します。', urgency: 'important', choices },
    { actorId: 'ministry:usa', subject: '戦後秩序', text: '欧州とアジアの戦後処理を調整しています。', urgency: 'important', choices },
    { actorId: 'client:manchukuo', subject: '東アジア', text: '戦後の東アジア秩序について協議したい。', urgency: 'routine', choices }
  ]
};
const reply = () => ({ reply: '情勢を確認しました。', stance: 'consider', memory: '戦後の世界の動きを注視。', choices });
const evaluation = () => ({
  headline: '世界の弧が動く',
  article: '史実寄りの駆動により、終戦講和と脱植民地化が進んだ。',
  delta: { mil: 0, eco: 0, stb: 0, treasury: 0, prestige: 0, tension: 0 },
  reasoning: [{ text: 'M7b撮影用のモック裁定。', sourceActionIds: [] }],
  developments: [{ headline: '国際情勢', body: '戦後の再編が各地で進んでいる。' }],
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

async function focusMap(lon, lat, scale = 4) {
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
  await page.waitForTimeout(400);
}

async function stopPlayback() {
  await page.evaluate(() => {
    window.ORBIS_PLAYBACK?.stop?.();
    document.getElementById('turn-playback-card')?.remove();
    const notice = document.getElementById('map-dispatch-notice');
    if (notice) notice.hidden = true;
  });
  await page.waitForTimeout(150);
}

async function worldView() {
  await page.evaluate(() => {
    state.mapProjection = 'flat';
    const vp = document.getElementById('map-viewport');
    const scale = Math.min(vp.clientWidth / 2000, vp.clientHeight / 1050) * 0.98;
    state.mapTransform.scale = scale;
    state.mapTransform.x = (vp.clientWidth - 2000 * scale) / 2;
    state.mapTransform.y = (vp.clientHeight - 1050 * scale) / 2;
    applyFlatTransform();
    updateMapVisuals();
  });
  await page.waitForTimeout(400);
}

async function advanceTo(targetHalf) {
  const result = await page.evaluate(async target => {
    let guard = 0;
    while ((Orbis.snapshot()?.completedTurns ?? 0) < target) {
      if (guard++ > target + 80) throw new Error('ターン進行が上限に達しました');
      let snapshot = Orbis.snapshot();
      if (snapshot.phase === 'milestone') {
        const continued = await Orbis.continuePastMilestone();
        if (!continued) throw new Error(`節目の継続に失敗: ${snapshot.completedTurns}`);
        continue;
      }
      if (snapshot.phase !== 'playing') throw new Error(`進行不能な状態: ${snapshot.phase} (${snapshot.completedTurns})`);
      const ok = await Orbis.finishTurn();
      if (!ok) throw new Error(`ターン進行に失敗: ${snapshot.completedTurns}`);
    }
    const snapshot = Orbis.snapshot();
    return {
      completedTurns: snapshot.completedTurns,
      hudDate: document.getElementById('hud-date')?.textContent || '',
      west: Boolean(snapshot.nations.west_germany && !snapshot.nations.west_germany.dissolved),
      east: Boolean(snapshot.nations.east_germany && !snapshot.nations.east_germany.dissolved),
      pakistan: Boolean(snapshot.nations.pakistan && !snapshot.nations.pakistan.dissolved),
      koreaIndependent: Boolean(snapshot.clients.col_japan_korea?.independent),
      endEurope: snapshot.worldArcs?.states?.ww2_end_europe?.status || '',
      endPacific: snapshot.worldArcs?.states?.ww2_end_pacific?.status || '',
      pacificWar: snapshot.worldArcs?.states?.pacific_war?.status || ''
    };
  }, targetHalf);
  return result;
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

  const progress = await advanceTo(TARGET_HALF);
  await stopPlayback();
  if (!/1950年/.test(progress.hudDate)) throw new Error(`HUD日付が1950年ではありません: ${progress.hudDate}`);
  if (!progress.west || !progress.east) throw new Error('1950年時点で東西ドイツがありません');
  if (!progress.pakistan) throw new Error('1950年時点でパキスタンがありません');
  if (progress.endEurope !== 'fired' || progress.endPacific !== 'fired') throw new Error(`終戦弧が未発火: ${progress.endEurope}/${progress.endPacific}`);
  if (progress.pacificWar !== 'fired') throw new Error(`太平洋戦争弧が未発火: ${progress.pacificWar}`);
  console.log(`進行: ${progress.completedTurns}半月 / HUD ${progress.hudDate} / 東西ドイツ / パキスタン / 太平洋戦争`);

  await page.evaluate(() => Orbis.closeInfoPanels());
  await stopPlayback();
  await worldView();
  await page.screenshot({ path: `${artifactDir}/world-1950.png`, fullPage: false });
  console.log(`world-1950: ${progress.hudDate} の世界地図`);

  await stopPlayback();
  await focusMap(10, 51, 3.6);
  await page.screenshot({ path: `${artifactDir}/germany-split.png`, fullPage: false });
  console.log('germany-split: 欧州の東西ドイツ');

  await stopPlayback();
  await focusMap(74, 24, 4.1);
  await page.screenshot({ path: `${artifactDir}/decolonization-map.png`, fullPage: false });
  console.log('decolonization-map: インド・パキスタンと東南アジア');

  await page.evaluate(() => Orbis.openWarPanel());
  await page.waitForSelector('#modal-war-panel[open]');
  const warText = await page.evaluate(() => document.getElementById('war-panel-body')?.textContent || '');
  if (!warText.includes('史実の弧')) throw new Error('戦争パネルに史実の弧の記録がありません');
  const chip = await page.evaluate(() => {
    document.getElementById('turn-playback-card')?.remove();
    const card = document.createElement('div');
    card.id = 'turn-playback-card';
    card.className = 'turn-playback-card visible';
    card.innerHTML = '<div class="tp-date">1950年6月（前半）</div><strong>ターン再生カード</strong><p>日付チップの重なり確認用。</p>';
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

  if (errors.length) throw new Error(`コンソールエラー: ${errors.join(' | ')}`);
  console.log(`screenshots: ${artifactDir}/world-1950.png, germany-split.png, decolonization-map.png`);
} finally {
  await browser.close();
}
