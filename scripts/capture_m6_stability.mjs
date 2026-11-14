import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const artifactDir = '/workspace/pm/orbis1932/m6';
await mkdir(artifactDir, { recursive: true });
const pageUrl = pathToFileURL(new URL('../orbis_simulator.html', import.meta.url).pathname).href;

const opening = {
  headline: '軍縮と復興のあいだ',
  briefing: 'M6撮影用のモック概況です。',
  telegrams: [
    { actorId: 'domestic:ig_military', subject: '防衛', text: '予算協議をお願いします。', urgency: 'important', choices: [{ label: '了承', text: '了解しました。' }, { label: '保留', text: '検討します。' }] },
    { actorId: 'ministry:usa', subject: '通商', text: '通商協議の準備があります。', urgency: 'important', choices: [{ label: '了承', text: '了解しました。' }, { label: '保留', text: '検討します。' }] },
    { actorId: 'client:manchukuo', subject: '自治', text: '開発援助の条件を協議したい。', urgency: 'important', choices: [{ label: '了承', text: '了解しました。' }, { label: '保留', text: '検討します。' }] },
  ],
};
const reply = () => ({ reply: '条件を確認しました。月末の裁定を待ちます。', stance: 'consider', memory: '協議を継続。', choices: [{ label: '了承', text: '了解しました。' }, { label: '保留', text: '検討します。' }] });
const evaluation = () => ({
  headline: '月が進む', article: '国内の調整が続いた。', delta: { mil: 0, eco: 0, stb: 0, treasury: 0, prestige: 0, tension: 0 },
  reasoning: [{ text: 'M6撮影用のモック裁定。', sourceActionIds: [] }],
  developments: [{ headline: '欧州', body: '予算協議。' }, { headline: '南米', body: '資源市場の変化。' }],
  groups: [], relations: [], otherNations: [], actorUpdates: [], treaties: [], commitments: [], territoryChanges: [], clientChanges: [], leadershipChanges: [], memory: '継続', npcEvents: [], conflictChanges: [], actionResults: [],
});

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const errors = [];
await context.route('**/*', async route => {
  const request = route.request();
  if (request.method() !== 'POST' || !request.url().includes('127.0.0.1')) return route.continue();
  let body = {};
  try { body = request.postDataJSON() || {}; } catch { body = {}; }
  const texts = (body.messages || []).filter(item => item.role === 'user').map(item => item.content);
  const payload = texts.map(value => { try { return JSON.parse(value); } catch { return null; } }).find(value => value?.operation);
  const data = payload?.operation === 'BRIEFING' ? opening : payload?.operation === 'ACTOR' ? reply() : payload?.operation === 'RESOLUTION' ? evaluation() : { ok: true };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) }, finish_reason: 'stop' }] }) });
});

const page = await context.newPage();
page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));

try {
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof Orbis !== 'undefined' && window.ORBIS_STATES_DB?.length);
  await page.evaluate(() => {
    localStorage.removeItem('orbis_campaign_v6');
    localStorage.removeItem('orbis_campaign_v5');
    window.confirm = () => true;
    Orbis.configure({ provider: 'custom', endpoint: 'http://127.0.0.1/mock', model: 'mock', apiKey: 'TEST_ONLY_NOT_A_REAL_KEY', remember: false });
  });
  await page.evaluate(() => Orbis.start({ nationId: 'japan', difficulty: 'standard', mandate: 'recovery', maxTurns: 24, replace: true }));
  await page.waitForFunction(() => Orbis.snapshot()?.phase === 'playing', { timeout: 120000 });
  await page.waitForSelector('#modal-onboarding[open]', { timeout: 30000 });
  await page.screenshot({ path: `${artifactDir}/onboarding.png` });

  for (let step = 0; step < 3; step++) {
    const label = await page.locator('#onboarding-body [data-onboarding-next]').textContent();
    await page.locator('#onboarding-body [data-onboarding-next]').click();
    if (label?.includes('完了')) break;
  }
  await page.waitForSelector('#modal-onboarding', { state: 'hidden', timeout: 30000 });
  await page.evaluate(() => Orbis.submitAction('沿岸防備の点検と予備役の招集準備を進める。'));
  await page.click('#btn-advance-month');
  await page.waitForSelector('#turn-review[open]');
  await page.click('#btn-confirm-end-turn');
  await page.waitForFunction(() => (Orbis.snapshot()?.completedTurns ?? 0) >= 1, { timeout: 120000 });
  await page.waitForFunction(() => Orbis.snapshot()?.phase === 'playing', { timeout: 120000 });
  await page.waitForSelector('#btn-undo-turn:not([hidden])', { timeout: 30000 });
  await page.click('#btn-undo-turn');
  await page.waitForFunction(() => (Orbis.snapshot()?.completedTurns ?? 0) === 0, { timeout: 30000 });
  await page.screenshot({ path: `${artifactDir}/undo.png` });

  const supply = await page.evaluate(async () => {
    const snapshot = Orbis.snapshot();
    const field = snapshot.formations.find(item => item.nationId === 'japan' && item.type === 'field');
    const region = window.ORBIS_STATES_DB.find(item => item.id === 'usa_pacific');
    const distance = (a, b) => {
      let dLon = Math.abs((Number(a.lon) || 0) - (Number(b.lon) || 0)) % 360;
      if (dLon > 180) dLon = 360 - dLon;
      return Math.hypot(dLon, (Number(a.lat) || 0) - (Number(b.lat) || 0));
    };
    const zone = window.ORBIS_STATES_DB.filter(item => item.isSea || item.isSeaZone)
      .sort((a, b) => distance(region, a) - distance(region, b))[0];
    field.regionId = 'usa_pacific';
    snapshot.territories.usa_pacific = 'japan';
    snapshot.occupations.usa_pacific = 'usa';
    snapshot.maritime = { navy: { japan: 100 }, air: { japan: 40 }, seaControl: { [zone.id]: null }, turn: snapshot.completedTurns };
    await Orbis.restore(snapshot);
    const info = Orbis.formationSupply(field.id);
    return { id: field.id, name: Orbis.regionLabel(region), zoneId: zone.id, relation: info.relation, status: info.status, label: info.label, level: info.level };
  });
  if (!supply || supply.status === 'isolated' || !['full', 'stretched'].includes(supply.status)) {
    throw new Error(`平和時の海路補給が不正です: ${JSON.stringify(supply)}`);
  }
  await page.evaluate(() => Orbis.openEconomyPanel());
  await page.waitForSelector('#modal-economy[open]');
  const row = page.locator('#modal-economy .formation-row').filter({ hasText: supply.name }).first();
  await row.waitFor({ state: 'visible', timeout: 30000 });
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${artifactDir}/sea-supply-peacetime.png` });
  console.log(`sea supply: ${supply.name} / ${supply.relation} / ${supply.status} (${supply.label}) level=${supply.level}`);
  console.log(`screenshots: onboarding.png, undo.png, sea-supply-peacetime.png`);
  if (errors.length) throw new Error(`コンソールエラー: ${errors.join(' | ')}`);
} finally {
  await browser.close();
}
