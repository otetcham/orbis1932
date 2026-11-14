import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';

const artifactDir = '/opt/cursor/artifacts';
await mkdir(artifactDir, { recursive: true });
const pageUrl = pathToFileURL(new URL('../orbis_simulator.html', import.meta.url).pathname).href;

const opening = {
  headline: '軍縮と復興のあいだ',
  briefing: 'ロビー直後のスモークテスト用の概況です。',
  telegrams: [
    { actorId: 'domestic:ig_military', subject: '防衛', text: '予算協議をお願いします。', urgency: 'important', choices: [{ label: '了承', text: '了解しました。' }, { label: '保留', text: '検討します。' }] },
    { actorId: 'ministry:usa', subject: '通商', text: '通商協議の準備があります。', urgency: 'important', choices: [{ label: '了承', text: '了解しました。' }, { label: '保留', text: '検討します。' }] },
    { actorId: 'client:manchukuo', subject: '自治', text: '開発援助の条件を協議したい。', urgency: 'important', choices: [{ label: '了承', text: '了解しました。' }, { label: '保留', text: '検討します。' }] },
  ],
};
const reply = () => ({ reply: '条件を確認しました。月末の裁定を待ちます。', stance: 'consider', memory: '協議を継続。', choices: [{ label: '了承', text: '了解しました。' }, { label: '保留', text: '検討します。' }] });
function evaluationFromContext(ctx = {}) {
  const national = ctx.nationalAction;
  const actionResults = national ? [{
    actionId: national.id,
    text: '国内の生活価格安定に向けた準備が進んだ。',
    outcome: 'partial',
    effects: { mil: 0, eco: 1, stb: 1, treasury: 0, prestige: 0, tension: 0 },
    evidence: [national.id],
    relations: [],
  }] : [];
  return {
    headline: '月が進む', article: '国内の調整が続いた。', delta: { mil: 0, eco: 0, stb: 0, treasury: 0, prestige: 0, tension: 0 },
    reasoning: [{ text: '今月の提出と交渉を踏まえた。', sourceActionIds: [] }],
    developments: [{ headline: '欧州', body: '予算協議。' }, { headline: '南米', body: '資源市場の変化。' }],
    groups: [], relations: [], otherNations: [], actorUpdates: [], treaties: [], commitments: [], territoryChanges: [], clientChanges: [], leadershipChanges: [], memory: '継続', npcEvents: [], conflictChanges: [], actionResults,
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.route('**/*', async route => {
  const req = route.request();
  if (req.method() !== 'POST' || !req.url().includes('127.0.0.1')) return route.continue();
  let body = {};
  try { body = req.postDataJSON() || {}; } catch { body = {}; }
  const texts = (body.messages || []).filter(m => m.role === 'user').map(m => m.content);
  const payload = texts.map(t => { try { return JSON.parse(t); } catch { return null; } }).find(v => v?.operation);
  const op = payload?.operation;
  const data = op === 'BRIEFING' ? opening : op === 'ACTOR' ? reply() : op === 'RESOLUTION' ? evaluationFromContext(payload?.context || {}) : { ok: true };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) }, finish_reason: 'stop' }] }) });
});

const page = await context.newPage();
await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof Orbis !== 'undefined' && window.ORBIS_STATES_DB?.length);
await page.screenshot({ path: `${artifactDir}/walkthrough-01-lobby.png`, fullPage: true });

await page.evaluate(() => {
  Orbis.configure({ provider: 'custom', endpoint: 'http://127.0.0.1/mock', model: 'mock', apiKey: 'TEST_ONLY_NOT_A_REAL_KEY', remember: false });
});
await page.click('#btn-lobby-open-api');
await page.waitForTimeout(200);
await page.keyboard.press('Escape');

const siam = page.locator('[data-nation-id="siam"]');
await siam.click();
await page.click('#btn-start-campaign');
await page.waitForFunction(() => document.getElementById('lobby-overlay')?.classList.contains('hidden'), { timeout: 120000 });
await page.waitForFunction(() => Orbis.snapshot()?.phase === 'playing', { timeout: 120000 });
await page.screenshot({ path: `${artifactDir}/walkthrough-02-started-1932-03.png`, fullPage: true });
await page.evaluate(() => Orbis.completeOnboarding());
await page.waitForSelector('#modal-onboarding', { state: 'hidden', timeout: 30000 });

await page.evaluate(() => Orbis.submitAction('国内の生活価格を安定させる準備を指示する。'));
await page.click('#dock-chat');
await page.waitForSelector('#window-chat:not([hidden])');
await page.evaluate(() => Orbis.openActor('client:manchukuo'));
await page.waitForSelector('#chat-conversation-view:not([hidden])');
await page.screenshot({ path: `${artifactDir}/walkthrough-03-manchukuo-destination.png`, fullPage: true });
await page.keyboard.press('Escape');

await page.click('#btn-advance-month');
await page.waitForSelector('#turn-review[open]');
await page.click('#btn-confirm-end-turn');
await page.waitForFunction(() => (Orbis.snapshot()?.completedTurns ?? 0) >= 1, { timeout: 180000 });
await page.screenshot({ path: `${artifactDir}/walkthrough-04-april-1932.png`, fullPage: true });

await page.evaluate(() => {
  state.mapProjection = 'flat';
  state.mapTransform.scale = 1;
  state.mapTransform.x = 0;
  state.mapTransform.y = 0;
  applyFlatTransform();
  updateMapVisuals();
});
await page.screenshot({ path: `${artifactDir}/walkthrough-05-flat-map.png`, fullPage: true });

await page.evaluate(() => {
  state.mapProjection = 'globe';
  state.globe.lon = 10;
  state.globe.lat = 48;
  state.globe.zoom = 1.2;
  updateMapVisuals();
});
await page.screenshot({ path: `${artifactDir}/walkthrough-06-globe.png`, fullPage: true });

await page.evaluate(() => {
  state.mapProjection = 'flat';
  state.mapTransform.scale = 7.5;
  state.mapTransform.x = -480;
  state.mapTransform.y = 140;
  applyFlatTransform();
  updateMapVisuals();
});
await page.screenshot({ path: `${artifactDir}/walkthrough-07-europe-max-zoom.png`, fullPage: true });

await page.evaluate(() => {
  state.mapTransform.scale = 9;
  state.mapTransform.x = -1120;
  state.mapTransform.y = 60;
  applyFlatTransform();
  updateMapVisuals();
});
await page.screenshot({ path: `${artifactDir}/walkthrough-08-east-asia-max-zoom.png`, fullPage: true });

await page.evaluate(() => {
  state.mapProjection = 'flat';
  const lon = -53;
  const lat = -12;
  const mapX = (lon + 180) * (2000 / 360);
  const mapY = (90 - lat) * 9.32 + 60;
  const vp = document.getElementById('map-viewport');
  const scale = 5;
  state.mapTransform.scale = scale;
  state.mapTransform.x = vp.clientWidth / 2 - mapX * scale;
  state.mapTransform.y = vp.clientHeight / 2 - mapY * scale;
  applyFlatTransform();
  updateMapVisuals();
});
await page.screenshot({ path: `${artifactDir}/walkthrough-09-brazil-provinces.png`, fullPage: true });

await page.evaluate(() => {
  const lon = -98;
  const lat = 56;
  const mapX = (lon + 180) * (2000 / 360);
  const mapY = (90 - lat) * 9.32 + 60;
  const vp = document.getElementById('map-viewport');
  const scale = 3.8;
  state.mapTransform.scale = scale;
  state.mapTransform.x = vp.clientWidth / 2 - mapX * scale;
  state.mapTransform.y = vp.clientHeight / 2 - mapY * scale;
  applyFlatTransform();
  updateMapVisuals();
});
await page.screenshot({ path: `${artifactDir}/walkthrough-10-canada-provinces.png`, fullPage: true });

await page.evaluate(() => {
  state.mapTransform.scale = 5.5;
  state.mapTransform.x = -420;
  state.mapTransform.y = 120;
  applyFlatTransform();
  updateMapVisuals();
});
await page.screenshot({ path: `${artifactDir}/walkthrough-11-country-labels-europe.png`, fullPage: true });

await browser.close();
console.log('Walkthrough screenshots saved under', artifactDir);
