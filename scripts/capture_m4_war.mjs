#!/usr/bin/env node
/**
 * ORBIS//1932 — M4 和平会議・海空軍・国策ダイアログのスクリーンショット。
 * Playwright (chromium) が必要。PNG はリポジトリ外の m4/ に保存する。
 */
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const artifactDir = '/workspace/pm/orbis1932/m4';
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
  headline: '和平と海空軍の均衡が地域秩序を動かす',
  article: '和平会議の要求と制海の帰趨が、次の半月の外交と補給に影響する。',
  delta: { mil: 0, eco: 0, stb: 0, treasury: 0, prestige: 0, tension: 0 },
  reasoning: [{ text: '和平会議と海空軍の簡易集計を既存の裁定へ接続した。', sourceActionIds: [] }],
  developments: [{ headline: '海運の保険料が変動', body: '制海の所在に応じて海上輸送の保険料が動いた。' }],
  groups: [], relations: [], otherNations: [], actorUpdates: [], treaties: [], commitments: [],
  territoryChanges: [], clientChanges: [], leadershipChanges: [], memory: '和平会議と海空軍の状況を記憶した。'
};

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--no-sandbox']
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
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
      ? { reply: '和平会議と海空軍の状況を確認しました。月末の裁定を待ちます。', stance: 'consider', memory: '和平と制海を確認。', choices }
      : operation === 'CONNECTION_TEST' ? { ok: true } : evaluation;
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

// 1. 制海と海空軍。海を隔てた部隊に敵制海の補給悪化を見せる。
const seaSetup = await page.evaluate(() => {
  const snap = Orbis.snapshot();
  const field = snap.formations.find(item => item.nationId === 'japan' && item.type === 'field');
  if (!field) throw new Error('野戦部隊が見つかりません。');
  field.regionId = 'usa_pacific';
  snap.territories.usa_pacific = 'japan';
  snap.occupations.usa_pacific = 'usa';
  const region = window.ORBIS_STATES_DB.find(item => item.id === 'usa_pacific');
  const distance = (a, b) => {
    let dLon = Math.abs((Number(a.lon) || 0) - (Number(b.lon) || 0)) % 360;
    if (dLon > 180) dLon = 360 - dLon;
    return Math.hypot(dLon, (Number(a.lat) || 0) - (Number(b.lat) || 0));
  };
  const zone = window.ORBIS_STATES_DB.filter(item => item.isSea || item.isSeaZone).sort((a, b) => distance(region, a) - distance(region, b))[0];
  snap.wars['war-sea-demo'] = { attacker: 'japan', defender: 'usa', startedTurn: 0, status: 'active', reason: '太平洋の制海をめぐる緊張' };
  snap.maritime = {
    navy: { japan: 420, usa: 610 },
    air: { japan: 210, usa: 190 },
    seaControl: { [zone.id]: 'usa' },
    turn: snap.completedTurns
  };
  return { snap, zoneId: zone.id, fieldId: field.id };
});
await page.evaluate(async snap => { await Orbis.restore(snap); }, seaSetup.snap);
await page.evaluate(() => Orbis.openEconomyPanel());
await page.waitForSelector('#modal-economy[open]');
await page.evaluate(() => {
  const dialog = document.getElementById('modal-economy');
  const body = document.getElementById('economy-panel-body');
  if (body) body.scrollTop = body.scrollHeight;
  if (dialog) dialog.scrollTop = dialog.scrollHeight;
  document.querySelector('.maritime-section')?.scrollIntoView({ block: 'end' });
});
await page.waitForTimeout(400);
const seaText = await page.evaluate(() => document.getElementById('economy-panel-body')?.textContent || '');
if (!seaText.includes('海空軍と制海')) throw new Error('海空軍と制海の節が表示されていません。');
if (!seaText.includes('補給 孤立') && !seaText.includes('補給 不足')) throw new Error('敵制海による補給悪化が表示されていません。');
await page.screenshot({ path: `${artifactDir}/sea-control-supply.png`, fullPage: false });
console.log(`sea-control-supply: ${seaSetup.zoneId} を敵制海、${seaSetup.fieldId} の補給悪化を表示`);
await page.evaluate(() => document.querySelector('[data-close-dialog="modal-economy"]')?.click());

// 2. 和平会議。戦時得点と要求、選択中・得点不足の要求を見せる。
await page.evaluate(() => Orbis.declareWar('china', '満州国境の和平交渉'));
const peaceSetup = await page.evaluate(() => {
  const snap = Orbis.snapshot();
  const warId = Object.keys(snap.wars).find(id => snap.wars[id].defender === 'china' && snap.wars[id].status === 'active');
  if (!warId) throw new Error('対中戦争が見つかりません。');
  snap.territories.cn_beijing = 'japan';
  snap.occupations.cn_beijing = 'china';
  snap.territories.china_cn_hb = 'japan';
  snap.occupations.china_cn_hb = 'china';
  snap.claims.china_cn_sd = [{ nationId: 'japan', reason: '国策の戦争目標', turn: 0 }];
  return { snap, warId };
});
await page.evaluate(async snap => { await Orbis.restore(snap); }, peaceSetup.snap);
await page.evaluate(() => Orbis.openWarPanel());
await page.waitForSelector('#modal-war-panel[open]');
const hasConferenceButton = await page.evaluate(warId => Boolean(document.querySelector(`[data-peace-conference="${warId}"]`)), peaceSetup.warId);
if (!hasConferenceButton) throw new Error('戦争パネルに和平会議ボタンがありません。');
await page.evaluate(() => document.querySelector('[data-close-dialog="modal-war-panel"]')?.click());
await page.evaluate(warId => Orbis.openPeaceConference(warId), peaceSetup.warId);
await page.waitForSelector('#modal-peace[open]');
const selected = await page.evaluate(warId => {
  const summary = Orbis.peaceConferenceSummary(warId);
  if (!summary) throw new Error('和平会議の要約がありません。');
  const demand = summary.demands.find(item => item.type === 'annex' && item.affordable);
  if (!demand) throw new Error('得点内の併合要求がありません。');
  return { id: demand.id, cost: demand.cost, available: summary.available, vassalCost: summary.demands.find(item => item.type === 'vassalize')?.cost || 0 };
}, peaceSetup.warId);
await page.click(`[data-peace-demand="${selected.id}"]`);
await page.waitForFunction(id => document.querySelector(`[data-peace-demand="${id}"]`)?.classList.contains('selected'), selected.id);
await page.waitForTimeout(400);
const peaceText = await page.evaluate(() => document.getElementById('peace-panel-body')?.textContent || '');
if (!peaceText.includes('利用可能な戦時得点')) throw new Error('戦時得点が表示されていません。');
if (!peaceText.includes('占領地の併合')) throw new Error('併合要求が表示されていません。');
if (!peaceText.includes('従属化')) throw new Error('従属化要求が表示されていません。');
const selectedVisible = await page.evaluate(() => Boolean(document.querySelector('#peace-panel-body .peace-demand.selected')));
if (!selectedVisible) throw new Error('選択中の要求が表示されていません。');
await page.screenshot({ path: `${artifactDir}/peace-conference.png`, fullPage: false });
console.log(`peace-conference: 得点 ${selected.available}、選択 ${selected.id}（${selected.cost}点）、従属化 ${selected.vassalCost}点`);
await page.evaluate(() => document.querySelector('[data-close-dialog="modal-peace"]')?.click());

// 3. 国策ダイアログ。再生カードの日付チップを作り、開いたダイアログで隠れることを確認する。
await page.evaluate(() => {
  document.getElementById('turn-playback-card')?.remove();
  const card = document.createElement('div');
  card.id = 'turn-playback-card';
  card.className = 'turn-playback-card visible';
  card.innerHTML = '<div class="tp-date">1932年3月（後半）</div><strong>ターン再生カード</strong><p>日付チップの重なり確認用。</p>';
  document.body.appendChild(card);
});
await page.evaluate(() => Orbis.openFocusPanel());
await page.waitForSelector('#modal-focus[open]');
await page.waitForTimeout(400);
const focusCheck = await page.evaluate(() => {
  const card = document.getElementById('turn-playback-card');
  const dialog = document.getElementById('modal-focus');
  const style = getComputedStyle(card);
  const cardRect = card.getBoundingClientRect();
  const dialogRect = dialog.getBoundingClientRect();
  const overlap = !(cardRect.bottom < dialogRect.top || cardRect.top > dialogRect.bottom || cardRect.right < dialogRect.left || cardRect.left > dialogRect.right);
  const head = dialog.querySelector('.modal-head');
  const headRect = head.getBoundingClientRect();
  const topElement = document.elementFromPoint(headRect.left + headRect.width / 2, headRect.top + headRect.height / 2);
  return {
    visibility: style.visibility,
    opacity: style.opacity,
    hidden: card.hidden,
    dialogOpen: dialog.open,
    bodyClass: document.body.classList.contains('dialog-open'),
    overlap,
    titleCovered: Boolean(topElement && !dialog.contains(topElement))
  };
});
if (!focusCheck.dialogOpen || !focusCheck.bodyClass) throw new Error('国策ダイアログの開閉状態が不正です。');
if (focusCheck.visibility !== 'hidden' || focusCheck.opacity !== '0') throw new Error('国策ダイアログ表示中に日付チップが隠れていません。');
if (focusCheck.titleCovered) throw new Error('日付チップが国策ダイアログのタイトルへ重なっています。');
await page.screenshot({ path: `${artifactDir}/focus-dialog.png`, fullPage: false });
console.log(`focus-dialog: visibility=${focusCheck.visibility}, opacity=${focusCheck.opacity}, overlap=${focusCheck.overlap}, titleCovered=${focusCheck.titleCovered}`);

// 再生終了後にカードと日付チップが残らないことも確認する。
await page.evaluate(() => {
  document.querySelector('[data-close-dialog="modal-focus"]')?.click();
  document.getElementById('turn-playback-card')?.remove();
  globalThis.ORBIS_PLAYBACK?.enqueue([{ headline: '再生終了の確認', body: '日付チップの後始末を確認する。', date: '1932年3月（後半）' }]);
});
await page.waitForFunction(() => document.getElementById('turn-playback-card')?.classList.contains('visible'), { timeout: 5000 });
await page.waitForFunction(() => {
  const card = document.getElementById('turn-playback-card');
  return card && card.hidden && !card.classList.contains('visible') && !card.innerHTML;
}, { timeout: 5000 });
console.log('playback-card-cleanup: 再生終了後にカードと日付チップが残らない');

if (consoleErrors.length) {
  console.error('Console errors:');
  for (const error of consoleErrors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('No console errors.');
}
console.log(`Screenshots saved to ${artifactDir}`);
await browser.close();
