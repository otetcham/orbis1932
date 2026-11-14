#!/usr/bin/env node
/**
 * ORBIS//1932 — M3 国策ツリー・研究・動員カードのスクリーンショット。
 * Playwright (chromium) が必要。PNG はリポジトリ外の m3/ に保存する。
 */
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const artifactDir = '/workspace/pm/orbis1932/m3';
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
  headline: '国策と研究が国家の針路を定める',
  article: '政治力を国策へ振り向け、研究と生産の基礎を整えた。分岐の選択が今後の外交と軍備に影響する。',
  delta: { mil: 0, eco: 0, stb: 0, treasury: 0, prestige: 0, tension: 0 },
  reasoning: [{ text: '国策・研究・生産の骨格を既存の半月裁定に接続した。', sourceActionIds: [] }],
  developments: [{ headline: '軍需工場の稼働', body: '生産効率の改善が装備の増産につながった。' }],
  groups: [], relations: [], otherNations: [], actorUpdates: [], treaties: [], commitments: [],
  territoryChanges: [], clientChanges: [], leadershipChanges: [], memory: '国策と研究の進捗を記憶した。'
};

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--no-sandbox']
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 1 });
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
      ? { reply: '国策と研究の進捗を確認しました。月末の裁定を待ちます。', stance: 'consider', memory: '国策と研究を確認。', choices }
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

// 研究と国策を選び、数ターン進める。国策は史実寄りを完了し、分岐の片側を進行中にする。
const selected = await page.evaluate(() => ({
  research: Orbis.selectResearch('industry_standardization').ok,
  focus: Orbis.selectFocus('jp_manchukuo').ok
}));
if (!selected.research || !selected.focus) throw new Error('研究または国策を選択できませんでした。');
for (let turn = 0; turn < 3; turn++) {
  await page.evaluate(() => Orbis.finishTurn());
  await page.evaluate(() => globalThis.ORBIS_PLAYBACK?.skipAll?.());
  await page.waitForFunction(count => Orbis.snapshot()?.completedTurns >= count && Orbis.snapshot()?.phase === 'playing', turn + 1, { timeout: 120000 });
}
const branchSelected = await page.evaluate(() => Orbis.selectFocus('jp_league_withdrawal').ok);
if (!branchSelected) throw new Error('史実寄り分岐を選択できませんでした。');
await page.evaluate(() => Orbis.finishTurn());
await page.evaluate(() => globalThis.ORBIS_PLAYBACK?.skipAll?.());
await page.waitForFunction(() => Orbis.snapshot()?.completedTurns >= 4 && Orbis.snapshot()?.phase === 'playing', { timeout: 120000 });

// 1. 国策ツリー。完了・進行中・分岐ロックが同時に見える。
const focusState = await page.evaluate(() => Orbis.focusSummary());
if (!focusState.completed.includes('jp_manchukuo')) throw new Error('史実寄り国策が完了していません。');
if (focusState.current?.id !== 'jp_league_withdrawal' || focusState.current.progress <= 0) throw new Error('分岐国策が進行中ではありません。');
await page.evaluate(() => document.querySelector('[data-open-focus]')?.click());
await page.waitForFunction(() => document.getElementById('modal-focus')?.open);
const lockVisible = await page.evaluate(() => {
  const card = document.querySelector('#focus-panel-body .focus-card.is-locked');
  return Boolean(card && card.textContent.includes('分岐') && card.textContent.includes('アジア協調路線'));
});
if (!lockVisible) throw new Error('代替史分岐のロックが表示されていません。');
await page.waitForTimeout(500);
await page.screenshot({ path: `${artifactDir}/focus-tree.png`, fullPage: false });
console.log(`focus-tree: ${focusState.treeLabel}, 完了 ${focusState.completed.length}, 進行中 ${focusState.current.name} ${focusState.current.progress}/${focusState.current.cost}, 政治力 ${focusState.politicalPower}`);

// 2. 研究パネル。4系統と進行が見える。
const researchState = await page.evaluate(() => Orbis.researchSummary());
if (researchState.branches.length < 4) throw new Error('研究系統が4つ未満です。');
if (researchState.current?.id !== 'industry_standardization' || researchState.current.progress <= 0) throw new Error('研究が進行中ではありません。');
await page.evaluate(() => {
  document.querySelector('[data-close-dialog="modal-focus"]')?.click();
  document.querySelector('[data-open-research]')?.click();
});
await page.waitForFunction(() => document.getElementById('modal-research')?.open);
await page.waitForTimeout(500);
await page.screenshot({ path: `${artifactDir}/research-panel.png`, fullPage: false });
console.log(`research-panel: ${researchState.branches.map(branch => branch.label).join(' / ')}, 進行中 ${researchState.current.name} ${researchState.current.progress}/${researchState.current.cost}`);

// 3. 動員・生産の上部4カード。明るいアクティブなカードであることをスタイルでも確認する。
await page.evaluate(() => {
  document.querySelector('[data-close-dialog="modal-research"]')?.click();
  document.querySelector('[data-open-economy]')?.click();
});
await page.waitForFunction(() => document.getElementById('modal-economy')?.open);
await page.waitForTimeout(500);
const cardStyles = await page.evaluate(() => [...document.querySelectorAll('#economy-panel-body .economy-card')].map(card => {
  const style = getComputedStyle(card);
  const label = getComputedStyle(card.querySelector('span'));
  const title = getComputedStyle(card.querySelector('strong'));
  return { background: style.backgroundColor, border: style.borderColor, label: label.color, title: title.color, text: card.textContent.replace(/\s+/g, ' ').trim() };
}));
if (cardStyles.length !== 4) throw new Error(`動員・生産カードが4枚ではありません (${cardStyles.length})`);
if (cardStyles.some(card => /rgba\(15,\s*23,\s*42/.test(card.background))) throw new Error('動員・生産カードが暗い無効色のままです。');
await page.screenshot({ path: `${artifactDir}/economy-cards.png`, fullPage: false });
console.log(`economy-cards: ${cardStyles.map(card => card.text.split(' ').slice(0, 2).join(' ')).join(' / ')}`);
console.log(`economy-card-style: ${cardStyles.map(card => `${card.background} / ${card.title}`).join(' | ')}`);

if (consoleErrors.length) {
  console.error('Console errors:');
  for (const error of consoleErrors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('No console errors.');
}
console.log(`Screenshots saved to ${artifactDir}`);
await browser.close();
