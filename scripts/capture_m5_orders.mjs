#!/usr/bin/env node
/**
 * ORBIS//1932 — M5 常設方針・命令キュー・顧問ブリーフィング・命令叙述のスクリーンショット。
 * Playwright (chromium) が必要。PNG はリポジトリ外の m5/ に保存する。
 * モックHTTPのみを使い、実APIは呼ばない。
 */
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const artifactDir = '/workspace/pm/orbis1932/m5';
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
const reply = { reply: '条件を確認しました。月末の裁定を待ちます。', stance: 'consider', memory: '協議を継続。', choices };
const orderNarrative = '財源の範囲で東北の農村救済を準備した。現地協力者の選定を終え、本格給付は翌月へ回す。';

function evaluationFromContext(context = {}) {
  const national = context.nationalAction;
  const actionResults = national ? [{
    actionId: national.id,
    outcome: 'partial',
    text: orderNarrative,
    effects: { mil: 0, eco: 1, stb: 1, treasury: -2, prestige: 0, tension: 0 },
    relations: [],
    evidence: [national.id]
  }] : [];
  return {
    headline: '救済の準備と通商の調整が進む',
    article: '政府は限られた財源のなかで農村救済の準備を進め、各国との通商協議を継続した。',
    delta: { mil: 0, eco: 1, stb: 1, treasury: -2, prestige: 0, tension: 0 },
    reasoning: [{ text: '提出命令と交渉を踏まえ、実施可能な範囲を裁定した。', sourceActionIds: [] }],
    developments: [{ headline: '欧州の予算折衝', body: '金融安定と軍事費をめぐる交渉が続く。' }, { headline: '海運業界が協議', body: '国際海運各社は輸送費と信用供与の条件を見直した。' }],
    groups: [], relations: [], otherNations: [], actorUpdates: [], treaties: [], commitments: [],
    territoryChanges: [], clientChanges: [], leadershipChanges: [], memory: '救済準備と通商協議を記憶した。',
    npcEvents: [], conflictChanges: [], actionResults
  };
}

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
  let payload = {};
  try {
    const body = req.postDataJSON() || {};
    const texts = (body.messages || []).filter(item => item.role === 'user').map(item => item.content);
    payload = texts.map(value => { try { return JSON.parse(value); } catch { return null; } }).find(value => value?.operation) || {};
    operation = payload.operation || operation;
  } catch { /* mock */ }
  const data = operation === 'BRIEFING'
    ? opening
    : operation === 'ACTOR'
      ? reply
      : operation === 'CONNECTION_TEST' ? { ok: true } : evaluationFromContext(payload.context || {});
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

const policy = '対中は穏健に、軍備は漸進する。通商網の維持を優先する。';
const firstOrder = '予算2で東北の農村救済を始め、現地の協力者と実施時期を定める。';
const secondOrder = '予算1で対米通商の連絡路を整え、輸出枠の維持を打診する。';
await page.evaluate(value => Orbis.setStandingPolicy(value), policy);
await page.evaluate(value => Orbis.submitAction(value), firstOrder);
await page.evaluate(() => Orbis.finishTurn());
await page.waitForFunction(() => (Orbis.snapshot()?.completedTurns ?? 0) >= 1 && Orbis.snapshot()?.phase === 'playing', { timeout: 180000 });
await page.evaluate(() => globalThis.ORBIS_PLAYBACK?.skipAll());
await page.waitForFunction(() => !globalThis.ORBIS_PLAYBACK?._state?.running, { timeout: 30000 });
await page.evaluate(value => Orbis.submitAction(value), secondOrder);

// 1. 行動パネル。常設方針・今半月の命令・直近の結果を並べて見せる。
await page.evaluate(() => Orbis.openActions());
await page.waitForSelector('#window-actions:not([hidden])');
await page.evaluate(() => {
  const content = document.querySelector('#window-actions .actions-content');
  if (content) content.scrollTop = 0;
});
await page.waitForTimeout(400);
const queueText = await page.evaluate(() => document.getElementById('national-action-queue')?.textContent || '');
for (const expected of [policy, secondOrder, orderNarrative, '直近の実行結果']) {
  if (!queueText.includes(expected)) throw new Error(`命令キューに「${expected}」が表示されていません。`);
}
await page.screenshot({ path: `${artifactDir}/order-queue.png`, fullPage: false });
console.log('order-queue: 常設方針・提出命令・直近結果を表示');

// 日付チップがダイアログへ重ならないことを確認してから顧問ブリーフィングを撮る。
await page.evaluate(() => {
  document.getElementById('turn-playback-card')?.remove();
  const card = document.createElement('div');
  card.id = 'turn-playback-card';
  card.className = 'turn-playback-card visible';
  card.innerHTML = '<div class="tp-date">1932年3月（後半）</div><strong>ターン再生カード</strong><p>日付チップの重なり確認用。</p>';
  document.body.appendChild(card);
});
await page.evaluate(() => globalThis.openSituationBriefing?.());
await page.waitForSelector('#modal-adviser-briefing[open]');
await page.waitForTimeout(400);
const chipCheck = await page.evaluate(() => {
  const card = document.getElementById('turn-playback-card');
  const dialog = document.getElementById('modal-adviser-briefing');
  const style = getComputedStyle(card);
  const cardRect = card.getBoundingClientRect();
  const headRect = dialog.querySelector('.modal-head').getBoundingClientRect();
  const overlap = !(cardRect.bottom < headRect.top || cardRect.top > headRect.bottom || cardRect.right < headRect.left || cardRect.left > headRect.right);
  return { visibility: style.visibility, opacity: style.opacity, bodyClass: document.body.classList.contains('dialog-open'), overlap };
});
if (!chipCheck.bodyClass) throw new Error('顧問ダイアログの表示状態が不正です。');
if (chipCheck.visibility !== 'hidden' || chipCheck.opacity !== '0') throw new Error('顧問ダイアログ表示中に日付チップが隠れていません。');
if (chipCheck.overlap && chipCheck.visibility !== 'hidden') throw new Error('日付チップが顧問ダイアログへ重なっています。');
const briefingText = await page.evaluate(() => document.getElementById('adviser-briefing-body')?.textContent || '');
for (const expected of ['顧問ブリーフィング', '方針と命令', '軍事', '外交', '内政・経済', policy, secondOrder]) {
  if (!briefingText.includes(expected)) throw new Error(`顧問ブリーフィングに「${expected}」が表示されていません。`);
}
await page.screenshot({ path: `${artifactDir}/adviser-briefing.png`, fullPage: false });
console.log(`adviser-briefing: 分野別メモ、visibility=${chipCheck.visibility}, overlap=${chipCheck.overlap}`);
await page.evaluate(() => document.querySelector('[data-close-dialog="modal-adviser-briefing"]')?.click());
await page.evaluate(() => document.getElementById('turn-playback-card')?.remove());

// 2. 命令結果の叙述を再生カードで見せる。
const orderCard = await page.evaluate(() => Orbis.snapshot()?.turnPlaybackQueue?.find(item => item.kind === 'order') || null);
if (!orderCard) throw new Error('命令結果の再生カードがありません。');
await page.evaluate(card => globalThis.ORBIS_PLAYBACK?.enqueue([card]), orderCard);
await page.waitForFunction(() => document.getElementById('turn-playback-card')?.classList.contains('visible'), { timeout: 5000 });
await page.waitForTimeout(250);
const narrativeText = await page.evaluate(() => document.getElementById('turn-playback-card')?.textContent || '');
for (const expected of ['国家の行動・部分成功', firstOrder, '結果：', orderNarrative]) {
  if (!narrativeText.includes(expected)) throw new Error(`命令叙述カードに「${expected}」が表示されていません。`);
}
await page.screenshot({ path: `${artifactDir}/order-narrative.png`, fullPage: false });
console.log('order-narrative: 命令文と裁定叙述を再生カードに表示');
await page.evaluate(() => globalThis.ORBIS_PLAYBACK?.skipAll());
await page.waitForFunction(() => !globalThis.ORBIS_PLAYBACK?._state?.running, { timeout: 30000 });

if (consoleErrors.length) {
  console.error('Console errors:');
  for (const error of consoleErrors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('No console errors.');
}
console.log(`Screenshots saved to ${artifactDir}`);
await browser.close();
