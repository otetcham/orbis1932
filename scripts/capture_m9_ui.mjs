#!/usr/bin/env node
/** M9 変更後スクリーンショット。モックHTTPのみ。外部APIは呼ばない。 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const outDir = '/workspace/pm/orbis1932/m9/after';
const html = '/workspace/pm/orbis1932/repo/orbis_simulator.html';
const camera = JSON.parse(await readFile('/workspace/pm/orbis1932/m8b/europe-default-camera.json', 'utf8'));
await mkdir(outDir, { recursive: true });

const { chromium } = await import('playwright');
const choices = [
  { label: '了承', text: '了解しました。' },
  { label: '保留', text: '検討します。' }
];
const opening = {
  headline: '概況', briefing: '撮影用のモック概況です。',
  telegrams: [{ actorId: 'adviser', subject: '確認', text: '確認します。', urgency: 'important', choices }]
};
const evaluation = () => ({
  headline: '裁定', article: 'モック。',
  delta: { mil: 0, eco: 0, stb: 0, treasury: 0, prestige: 0, tension: 0 },
  reasoning: [{ text: 'モック。', sourceActionIds: [] }],
  developments: [], groups: [], relations: [], otherNations: [], actorUpdates: [],
  treaties: [], commitments: [], territoryChanges: [], clientChanges: [], leadershipChanges: [],
  memory: '継続', npcEvents: [], conflictChanges: [], actionResults: []
});

const sizes = [
  { w: 1280, h: 800, tag: '1280x800' },
  { w: 1920, h: 1080, tag: '1920x1080' }
];
const report = { mode: 'mock-http', liveProviderCredentialsUsed: false, sizes: [] };

const browser = await chromium.launch({
  headless: true,
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox']
});

async function shoot(page, size, name) {
  const path = `${outDir}/${name}-${size.tag}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log('saved', path);
}

for (const size of sizes) {
  const errors = [];
  const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1 });
  await context.route('**/*', async route => {
    const request = route.request();
    if (request.method() !== 'POST' || !request.url().includes('127.0.0.1')) return route.continue();
    let body = {};
    try { body = request.postDataJSON() || {}; } catch { body = {}; }
    const texts = (body.messages || []).filter(item => item.role === 'user').map(item => item.content);
    const payload = texts.map(value => { try { return JSON.parse(value); } catch { return null; } }).find(value => value?.operation);
    const data = payload?.operation === 'BRIEFING' ? opening
      : payload?.operation === 'ACTOR' ? { reply: '確認しました。', stance: 'consider', memory: '', choices }
        : payload?.operation === 'CONNECTION_TEST' ? { ok: true } : evaluation();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) }, finish_reason: 'stop' }] }) });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await page.goto(pathToFileURL(html).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof Orbis !== 'undefined' && window.ORBIS_STATES_DB?.length, { timeout: 120000 });

  await page.evaluate(() => Orbis.configure({ provider: 'custom', endpoint: 'http://127.0.0.1/mock', model: 'mock', apiKey: 'TEST_ONLY_NOT_A_REAL_KEY', remember: false }));
  await page.evaluate(async () => {
    await Orbis.start({ nationId: 'japan', difficulty: 'standard', mandate: 'recovery', maxTurns: 0, replace: true });
  });
  await page.waitForTimeout(500);
  if (!await page.evaluate(() => document.getElementById('modal-onboarding')?.open)) {
    await page.evaluate(() => Orbis.openOnboarding());
    await page.waitForTimeout(200);
  }
  await shoot(page, size, 'onboarding');

  await page.evaluate(() => {
    Orbis.completeOnboarding();
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    document.body.classList.remove('dialog-open');
    const toast = document.getElementById('game-toast');
    if (toast) toast.hidden = true;
    window.ORBIS_PLAYBACK?.stop?.();
    document.getElementById('turn-playback-card')?.remove();
    Orbis.openTab('map');
    state.mapProjection = 'flat';
    state.mapTransform.scale = 1;
    state.mapTransform.x = 0;
    state.mapTransform.y = 0;
    applyFlatTransform();
    updateMapVisuals();
  });
  await page.waitForTimeout(300);
  await shoot(page, size, 'map-default');

  await page.evaluate(({ lon, lat, scale }) => {
    const vp = document.getElementById('map-viewport');
    const svg = document.getElementById('orbis-world-svg');
    const mapX = (lon + 180) * (2000 / 360);
    const mapY = (90 - lat) * 9.32 + 60;
    // JSON の x,y は 1440 用。SVG の viewBox と preserveAspectRatio: meet から
    // ビューポート中央に来る変換を毎回計算し直す。
    const baseScale = Math.min(vp.clientWidth / 2000, vp.clientHeight / 1158);
    const offsetX = (vp.clientWidth - 2000 * baseScale) / 2;
    const offsetY = (vp.clientHeight - 1158 * baseScale) / 2;
    Orbis.openTab('map');
    state.mapProjection = 'flat';
    state.mapTransform.scale = scale;
    state.mapTransform.x = (vp.clientWidth / 2 - offsetX) / baseScale - mapX * scale;
    state.mapTransform.y = (vp.clientHeight / 2 - offsetY) / baseScale - mapY * scale;
    applyFlatTransform();
    updateMapVisuals();
    if (svg) svg.dataset.cameraCenter = `${lon},${lat}`;
  }, { lon: camera.lon, lat: camera.lat, scale: camera.scale });
  await page.waitForTimeout(250);
  const europeCheck = await page.evaluate(() => {
    const cityCount = document.querySelectorAll('#labels-layer .map-label-city').length;
    const countryLabels = [...document.querySelectorAll('#labels-layer .map-label-country')].map(node => node.textContent);
    const soviet = [...document.querySelectorAll('#labels-layer .map-label-country')].find(node => node.textContent === 'ソビエト連邦');
    const overlaps = (a, b) => Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
    const target = soviet?.getBoundingClientRect();
    const blockers = ['.orbis-topbar', '#shell-dock', '.shell-nav', '.map-toolbar']
      .map(selector => document.querySelector(selector))
      .filter(element => element && !element.hidden && getComputedStyle(element).visibility !== 'hidden')
      .map(element => element.getBoundingClientRect());
    return { cityCount, countryLabels, hasSoviet: Boolean(soviet), sovietOverlapsChrome: blockers.some(rect => overlaps(target, rect)) };
  });
  if (europeCheck.cityCount !== 0) throw new Error(`欧州ズームで都市名が出ています: ${europeCheck.cityCount}`);
  if (!europeCheck.hasSoviet) throw new Error(`欧州ズームでソビエト連邦の国名が見つかりません: ${europeCheck.countryLabels.join(',')}`);
  if (europeCheck.sovietOverlapsChrome) throw new Error('ソビエト連邦の国名が UI と重なっています。');
  await shoot(page, size, 'map-europe');

  await page.evaluate(() => {
    Orbis.openTab('map');
    state.mapProjection = 'flat';
    state.mapTransform.scale = 1;
    state.mapTransform.x = 0;
    state.mapTransform.y = 0;
    applyFlatTransform();
    updateMapVisuals();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => Orbis.openTab('map'));
  await page.waitForTimeout(150);
  await shoot(page, size, 'nav-map');

  const tabs = [
    ['domestic', 'nav-domestic', '#window-state'],
    ['diplomacy', 'nav-diplomacy', '#window-chat'],
    ['military', 'nav-military', '#window-war'],
    ['plan', 'nav-plan', '#window-plan']
  ];
  for (const [tab, name, selector] of tabs) {
    await page.evaluate(value => Orbis.openTab(value), tab);
    await page.waitForSelector(`${selector}:not([hidden])`, { timeout: 30000 });
    await page.waitForTimeout(250);
    await shoot(page, size, name);
  }

  await page.evaluate(() => Orbis.openFocusPanel());
  await page.waitForSelector('#modal-focus[open]', { timeout: 30000 });
  await page.waitForTimeout(250);
  await shoot(page, size, 'focus');
  await page.evaluate(() => document.getElementById('modal-focus')?.close());

  const peaceReady = await page.evaluate(() => {
    const snapshot = Orbis.snapshot();
    let war = Object.entries(snapshot?.wars || {}).find(([, item]) => item.status === 'active');
    if (!war) {
      Orbis.declareWar('china', 'M9撮影用');
      war = Object.entries(Orbis.snapshot()?.wars || {}).find(([, item]) => item.status === 'active');
    }
    if (!war) return false;
    return Boolean(Orbis.openPeaceConference?.(war[0]));
  });
  if (!peaceReady) throw new Error('和平会議を開けませんでした。');
  await page.waitForSelector('#modal-peace[open]', { timeout: 30000 });
  await page.waitForTimeout(250);
  await shoot(page, size, 'peace');
  await page.evaluate(() => document.getElementById('modal-peace')?.close());

  await page.evaluate(() => Orbis.openSettings());
  await page.waitForSelector('#modal-ai-settings[open]', { timeout: 30000 });
  await page.waitForTimeout(200);
  const keyCheck = await page.evaluate(() => ({
    inputValue: document.getElementById('input-api-key')?.value || '',
    visibleText: document.getElementById('modal-ai-settings')?.innerText || ''
  }));
  if (keyCheck.inputValue) throw new Error('設定画面に API キーが入力されています。');
  if (keyCheck.visibleText.includes('TEST_ONLY_NOT_A_REAL_KEY')) throw new Error('設定画面に API キーが表示されています。');
  await shoot(page, size, 'settings');
  await page.evaluate(() => document.getElementById('modal-ai-settings')?.close());

  await page.evaluate(() => Orbis.openOnboarding());
  await page.waitForSelector('#modal-onboarding[open]', { timeout: 30000 });
  await page.waitForTimeout(200);
  await shoot(page, size, 'onboarding');
  await page.evaluate(() => document.getElementById('modal-onboarding')?.close());

  if (errors.length) {
    console.error('console errors:', errors);
    await context.close();
    await browser.close();
    throw new Error(`コンソールエラーが ${errors.length} 件あります。`);
  }
  report.sizes.push({ ...size, europe: europeCheck, consoleErrors: 0 });
  await context.close();
}

await browser.close();
await writeFile('/workspace/pm/orbis1932/m9/after/capture-report.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log('M9 after screenshots done');
