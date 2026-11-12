#!/usr/bin/env node
/**
 * ORBIS//1932 — 本文中の Wikipedia リンク・通常テキスト・国旗＋国名の
 * ベースライン／行ボックスを Playwright で計測する。
 *
 * 合格条件: リンク文字と隣接テキストの top/bottom/height 差分が 0.5px 未満で、
 * ベースラインマーカー差分も 0.5px 未満。国旗＋国名を含む行の高さが
 * 通常行とほぼ同じ（0.5px 未満）であること。
 *
 * スクリーンショットはリポジトリ外の feat_panel/ に保存する。
 */
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const artifactDir = '/workspace/pm/orbis1932/feat_panel';
const screenshotPath = `${artifactDir}/link-baseline-fixed.png`;
await mkdir(artifactDir, { recursive: true });
const pageUrl = pathToFileURL(new URL('../orbis_simulator.html', import.meta.url).pathname).href;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    console.error('Playwright が見つからないため、計測をスキップしました。');
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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
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
const consoleErrors = [];
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`));
await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof Orbis !== 'undefined' && window.ORBIS_STATES_DB?.length, { timeout: 120000 });
await page.evaluate(() => Orbis.configure({ provider: 'custom', endpoint: 'http://127.0.0.1/mock', model: 'mock', apiKey: '', remember: false }));
await page.locator('[data-nation-id="japan"]').click();
await page.click('#btn-start-campaign');
await page.waitForFunction(() => document.getElementById('lobby-overlay')?.classList.contains('hidden'), { timeout: 120000 });
await page.waitForFunction(() => Orbis.snapshot()?.phase === 'playing', { timeout: 120000 });

// 1行に「リンク＋通常テキスト＋国旗＋国名＋通常テキスト」が並ぶ記事を用意する。
await page.evaluate(() => {
  const snapshot = Orbis.snapshot();
  snapshot.briefing.headline = '満州事変と東京、アメリカ合衆国の選択';
  snapshot.briefing.briefing = '満州事変の直後、アメリカ合衆国と東京が協議した。';
  snapshot.articles.unshift({
    id: 'article-link-baseline-measure',
    kind: 'world',
    turn: 1,
    date: '1932年3月（前半）',
    headline: '満州事変の直後、東京とアメリカ合衆国が協議',
    body: '満州事変の直後、アメリカ合衆国と東京が協議した。\n各国の利害は対立し、交渉は難航した。'
  });
  Orbis.restore(snapshot);
  Orbis.render();
});
await page.click('#dock-history');
await page.waitForSelector('#window-history:not([hidden])');
await page.evaluate(() => {
  const article = document.querySelector('[data-article-id="article-link-baseline-measure"]');
  if (article) article.open = true;
  document.querySelector('.dispatch-content p')?.scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(300);
await page.evaluate(() => document.fonts?.ready);

const metrics = await page.evaluate(() => {
  const article = document.querySelector('[data-article-id="article-link-baseline-measure"]');
  const paragraph = article?.querySelector('.dispatch-content p');
  if (!paragraph) throw new Error('計測対象の記事段落が見つかりません');

  const round = value => Math.round(value * 1000) / 1000;
  const rectObject = rect => ({ top: round(rect.top), bottom: round(rect.bottom), height: round(rect.height), left: round(rect.left), right: round(rect.right) });
  const rangeRect = range => rectObject(range.getBoundingClientRect());
  const diff = (a, b) => round(Math.abs(a - b));

  const link = paragraph.querySelector('a.orbis-wiki-link');
  if (!link) throw new Error('計測対象の Wikipedia リンクが見つかりません');
  let adjacent = link.nextSibling;
  while (adjacent && adjacent.nodeType !== Node.TEXT_NODE) adjacent = adjacent.nextSibling;
  if (!adjacent || !adjacent.textContent.trim()) throw new Error('リンクに隣接する通常テキストが見つかりません');

  const adjacentLength = Math.max(1, Math.min(6, adjacent.textContent.split('\n')[0].length));
  const linkRange = document.createRange();
  linkRange.selectNodeContents(link);
  const adjacentRange = document.createRange();
  adjacentRange.setStart(adjacent, 0);
  adjacentRange.setEnd(adjacent, adjacentLength);

  // 0 高さの inline-block の底辺 = 行のベースライン。リンク前後に一時挿入して実測する。
  const markerStyle = 'display:inline-block;width:0;height:0;vertical-align:baseline;overflow:hidden;';
  const beforeMarker = document.createElement('span');
  beforeMarker.setAttribute('data-baseline-marker', 'before');
  beforeMarker.style.cssText = markerStyle;
  link.before(beforeMarker);
  const tail = adjacent.splitText(adjacentLength);
  const afterMarker = document.createElement('span');
  afterMarker.setAttribute('data-baseline-marker', 'after');
  afterMarker.style.cssText = markerStyle;
  tail.before(afterMarker);

  const linkRect = rangeRect(linkRange);
  const adjacentRect = rangeRect(adjacentRange);
  const beforeBaseline = rectObject(beforeMarker.getBoundingClientRect());
  const afterBaseline = rectObject(afterMarker.getBoundingClientRect());

  beforeMarker.remove();
  afterMarker.remove();
  paragraph.normalize();

  const mention = paragraph.querySelector('.orbis-country-mention');
  if (!mention) throw new Error('国旗＋国名スパンが見つかりません');
  const flag = mention.querySelector('.flag-badge');
  if (!flag) throw new Error('国旗バッジが見つかりません');
  const mentionRect = rectObject(mention.getBoundingClientRect());
  const flagRect = rectObject(flag.getBoundingClientRect());

  // 国旗＋国名の中のリンク文字と、その外側の通常テキストも同じ方法で比較する。
  const mentionLink = mention.querySelector('a.orbis-wiki-link');
  let mentionAdjacent = mention.nextSibling;
  while (mentionAdjacent && mentionAdjacent.nodeType !== Node.TEXT_NODE) mentionAdjacent = mentionAdjacent.nextSibling;
  if (!mentionLink || !mentionAdjacent?.textContent.trim()) throw new Error('国旗＋国名に隣接する通常テキストが見つかりません');
  const mentionAdjacentLength = Math.max(1, Math.min(4, mentionAdjacent.textContent.split('\n')[0].length));
  const mentionLinkRange = document.createRange();
  mentionLinkRange.selectNodeContents(mentionLink);
  const mentionAdjacentRange = document.createRange();
  mentionAdjacentRange.setStart(mentionAdjacent, 0);
  mentionAdjacentRange.setEnd(mentionAdjacent, mentionAdjacentLength);
  const mentionBeforeMarker = document.createElement('span');
  mentionBeforeMarker.style.cssText = markerStyle;
  mention.before(mentionBeforeMarker);
  const mentionTail = mentionAdjacent.splitText(mentionAdjacentLength);
  const mentionAfterMarker = document.createElement('span');
  mentionAfterMarker.style.cssText = markerStyle;
  mentionTail.before(mentionAfterMarker);
  const mentionLinkRect = rangeRect(mentionLinkRange);
  const mentionAdjacentRect = rangeRect(mentionAdjacentRange);
  const mentionBeforeBaseline = rectObject(mentionBeforeMarker.getBoundingClientRect());
  const mentionAfterBaseline = rectObject(mentionAfterMarker.getBoundingClientRect());
  mentionBeforeMarker.remove();
  mentionAfterMarker.remove();
  paragraph.normalize();

  const paragraphRange = document.createRange();
  paragraphRange.selectNodeContents(paragraph);
  const lineRects = [...paragraphRange.getClientRects()].map(rectObject).filter(rect => rect.height > 0);
  const overlap = (a, b) => Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const mentionLineIndex = lineRects.reduce((best, rect, index) => overlap(rect, mentionRect) > overlap(lineRects[best], mentionRect) ? index : best, 0);
  const mentionLine = lineRects[mentionLineIndex];
  const plainLine = lineRects.find((rect, index) => index !== mentionLineIndex && rect.height > 0);
  if (!plainLine) throw new Error('比較用の通常行が見つかりません');

  return {
    text: link.textContent,
    adjacentText: adjacentRange.toString(),
    link: linkRect,
    adjacent: adjacentRect,
    differences: {
      top: diff(linkRect.top, adjacentRect.top),
      bottom: diff(linkRect.bottom, adjacentRect.bottom),
      height: diff(linkRect.height, adjacentRect.height)
    },
    baseline: {
      before: beforeBaseline,
      after: afterBaseline,
      difference: diff(beforeBaseline.bottom, afterBaseline.bottom)
    },
    countryLink: {
      text: mentionLink.textContent,
      adjacentText: mentionAdjacentRange.toString(),
      link: mentionLinkRect,
      adjacent: mentionAdjacentRect,
      differences: {
        top: diff(mentionLinkRect.top, mentionAdjacentRect.top),
        bottom: diff(mentionLinkRect.bottom, mentionAdjacentRect.bottom),
        height: diff(mentionLinkRect.height, mentionAdjacentRect.height)
      },
      baseline: {
        before: mentionBeforeBaseline,
        after: mentionAfterBaseline,
        difference: diff(mentionBeforeBaseline.bottom, mentionAfterBaseline.bottom)
      }
    },
    countryMention: {
      text: mention.textContent,
      lineHeights: lineRects.map(rect => rect.height),
      mentionLineHeight: mentionLine.height,
      plainLineHeight: plainLine.height,
      difference: diff(mentionLine.height, plainLine.height),
      mention: mentionRect,
      flag: flagRect
    }
  };
});

const { link, adjacent, differences, baseline, countryLink, countryMention } = metrics;
console.log('リンクと隣接テキストの行ボックス計測（getBoundingClientRect / Range）');
console.log(`  リンク「${metrics.text}」: top=${link.top}px bottom=${link.bottom}px height=${link.height}px`);
console.log(`  隣接テキスト「${metrics.adjacentText}…」: top=${adjacent.top}px bottom=${adjacent.bottom}px height=${adjacent.height}px`);
console.log(`  差分: top=${differences.top}px bottom=${differences.bottom}px height=${differences.height}px`);
console.log(`  ベースライン（0高マーカー）: リンク前=${baseline.before.bottom}px リンク後=${baseline.after.bottom}px 差分=${baseline.difference}px`);
console.log('国旗＋国名内のリンクと外側テキストの計測');
console.log(`  リンク「${countryLink.text}」: top=${countryLink.link.top}px bottom=${countryLink.link.bottom}px height=${countryLink.link.height}px`);
console.log(`  隣接テキスト「${countryLink.adjacentText}…」: top=${countryLink.adjacent.top}px bottom=${countryLink.adjacent.bottom}px height=${countryLink.adjacent.height}px`);
console.log(`  差分: top=${countryLink.differences.top}px bottom=${countryLink.differences.bottom}px height=${countryLink.differences.height}px`);
console.log(`  ベースライン（0高マーカー）: リンク前=${countryLink.baseline.before.bottom}px リンク後=${countryLink.baseline.after.bottom}px 差分=${countryLink.baseline.difference}px`);
console.log('国旗＋国名と行ボックス計測');
console.log(`  「${countryMention.text}」の行高=${countryMention.mentionLineHeight}px 通常行高=${countryMention.plainLineHeight}px 差分=${countryMention.difference}px`);
console.log(`  国旗バッジ: top=${countryMention.flag.top}px bottom=${countryMention.flag.bottom}px height=${countryMention.flag.height}px`);
console.log(`  段落の各行高: ${countryMention.lineHeights.map(value => `${value}px`).join(', ')}`);

// 対象段落をズーム（deviceScaleFactor: 2）でリポジトリ外へ保存する。
const clip = await page.evaluate(() => {
  const article = document.querySelector('[data-article-id="article-link-baseline-measure"]');
  const paragraph = article.querySelector('.dispatch-content p');
  const rect = paragraph.getBoundingClientRect();
  return { x: Math.max(0, rect.left - 16), y: Math.max(0, rect.top - 16), width: Math.min(rect.width + 32, window.innerWidth), height: rect.height + 32 };
});
await page.screenshot({ path: screenshotPath, clip });
await browser.close();

const tolerance = 0.5;
const failures = [];
if (differences.top >= tolerance) failures.push(`リンクと隣接テキストの top 差分 ${differences.top}px`);
if (differences.bottom >= tolerance) failures.push(`リンクと隣接テキストの bottom 差分 ${differences.bottom}px`);
if (differences.height >= tolerance) failures.push(`リンクと隣接テキストの height 差分 ${differences.height}px`);
if (baseline.difference >= tolerance) failures.push(`ベースライン差分 ${baseline.difference}px`);
if (countryLink.differences.top >= tolerance) failures.push(`国旗＋国名内リンクの top 差分 ${countryLink.differences.top}px`);
if (countryLink.differences.bottom >= tolerance) failures.push(`国旗＋国名内リンクの bottom 差分 ${countryLink.differences.bottom}px`);
if (countryLink.differences.height >= tolerance) failures.push(`国旗＋国名内リンクの height 差分 ${countryLink.differences.height}px`);
if (countryLink.baseline.difference >= tolerance) failures.push(`国旗＋国名内リンクのベースライン差分 ${countryLink.baseline.difference}px`);
if (countryMention.difference >= tolerance) failures.push(`国旗＋国名行と通常行の高さ差分 ${countryMention.difference}px`);

console.log(`スクリーンショット: ${screenshotPath}`);
console.log(`コンソールエラー: ${consoleErrors.length ? consoleErrors.join(' / ') : 'なし'}`);
if (consoleErrors.length) failures.push(`コンソールエラー ${consoleErrors.length}件`);
if (failures.length) {
  console.error(`FAIL: ${failures.join(' / ')}`);
  process.exit(1);
}
console.log('PASS: ベースライン／行ボックス差分はすべて 0.5px 未満です。');
