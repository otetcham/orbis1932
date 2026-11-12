#!/usr/bin/env node
/**
 * ORBIS//1932 — プロビンス窓・Wikipedia/国旗表示・ロビー球体選択のスクリーンショット。
 * Playwright (chromium) が必要。スクリーンショットはリポジトリ外の feat_panel/ に保存する。
 */
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const artifactDir = '/workspace/pm/orbis1932/feat_panel';
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
      ? { reply: '条件を確認しました。月末の裁定を待ちます。', stance: 'consider', memory: '協議を継続。', choices }
      : { headline: '月が進む', article: '国内の調整が続いた。', delta: { mil: 0, eco: 0, stb: 0, treasury: 0, prestige: 0, tension: 0 }, reasoning: [], developments: [], groups: [], relations: [], otherNations: [], actorUpdates: [], treaties: [], commitments: [], territoryChanges: [], clientChanges: [], leadershipChanges: [], memory: '' };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) }, finish_reason: 'stop' }] }) });
});

const page = await context.newPage();
await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof Orbis !== 'undefined' && window.ORBIS_STATES_DB?.length, { timeout: 120000 });
await page.evaluate(() => Orbis.configure({ provider: 'custom', endpoint: 'http://127.0.0.1/mock', model: 'mock', apiKey: '', remember: false }));

// 1. ロビー: 球体上の日本の可視ピクセルを実際にクリックする。
await page.evaluate(() => {
  state.globe.lon = 139.7;
  state.globe.lat = 35.7;
  state.globe.zoom = 1.6;
  updateMapVisuals();
});
await page.waitForTimeout(500);
const tokyoPoint = await page.evaluate(() => {
  const svg = document.getElementById('orbis-world-svg');
  const rect = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const scale = Math.min(rect.width / vb.width, rect.height / vb.height);
  const offsetX = (rect.width - vb.width * scale) / 2;
  const offsetY = (rect.height - vb.height * scale) / 2;
  const { cx, cy, baseR, zoom, lon: cLon, lat: cLat } = state.globe;
  const p0 = cLat * Math.PI / 180;
  const l0 = cLon * Math.PI / 180;
  const phi = 35.7 * Math.PI / 180;
  const lam = 139.7 * Math.PI / 180;
  const cosPhi = Math.cos(phi);
  const px = cosPhi * Math.cos(lam);
  const py = cosPhi * Math.sin(lam);
  const pz = Math.sin(phi);
  const meridian = px * Math.cos(l0) + py * Math.sin(l0);
  const sx = py * Math.cos(l0) - px * Math.sin(l0);
  const sy = Math.cos(p0) * pz - Math.sin(p0) * meridian;
  const x = cx + baseR * zoom * sx;
  const y = cy - baseR * zoom * sy;
  return { x: rect.left + offsetX + (x - vb.x) * scale, y: rect.top + offsetY + (y - vb.y) * scale };
});
await page.mouse.click(tokyoPoint.x, tokyoPoint.y);
await page.waitForFunction(() => state.lobbyNationId === 'japan', { timeout: 10000 });
await page.waitForTimeout(900);
await page.screenshot({ path: `${artifactDir}/globe-select.png`, fullPage: false });

// 2. キャンペーン開始後、プロビンス情報ウィンドウを開く。
await page.click('#btn-start-campaign');
await page.waitForFunction(() => document.getElementById('lobby-overlay')?.classList.contains('hidden'), { timeout: 120000 });
await page.waitForFunction(() => Orbis.snapshot()?.phase === 'playing', { timeout: 120000 });
await page.evaluate(() => {
  state.mapProjection = 'flat';
  state.mapTransform.scale = 1;
  state.mapTransform.x = 0;
  state.mapTransform.y = 0;
  applyFlatTransform();
  updateMapVisuals();
  document.getElementById('prov-jp_kanto')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await page.waitForFunction(() => document.getElementById('state-inspector')?.classList.contains('open'));
await page.waitForTimeout(400);
await page.screenshot({ path: `${artifactDir}/province-window.png`, fullPage: false });
await page.click('#btn-toggle-inspector');

// 3. 記事/イベント本文に Wikipedia リンクと国旗＋正式国名を同時表示する。
await page.evaluate(() => {
  const snapshot = Orbis.snapshot();
  snapshot.briefing.headline = 'ルーズベルトと満州事変：アメリカ合衆国の選択';
  snapshot.briefing.briefing = 'ルーズベルト米大統領は満州事変後の東京情勢を注視した。アメリカ合衆国と大日本帝国は、蒋介石の南京国民政府を含む極東秩序を協議する。';
  snapshot.articles.unshift({
    id: 'article-wiki-flag-demo',
    kind: 'world',
    turn: 1,
    date: '1932年3月（前半）',
    headline: 'ルーズベルト、満州事変後の東京とアメリカ合衆国を語る',
    body: 'ルーズベルトは満州事変をめぐる東京の動向を注視し、アメリカ合衆国と大日本帝国の通商関係に言及した。蒋介石の南京国民政府も反応を示している。'
  });
  Orbis.restore(snapshot);
  Orbis.render();
});
await page.click('#dock-history');
await page.waitForSelector('#window-history:not([hidden])');
await page.waitForTimeout(500);
await page.screenshot({ path: `${artifactDir}/event-wiki-flag.png`, fullPage: false });

await browser.close();
console.log(`Screenshots saved to ${artifactDir}`);
