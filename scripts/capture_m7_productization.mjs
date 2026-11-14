#!/usr/bin/env node
/**
 * M7 製品化画面のスクリーンショット。モックHTTPのみ。
 * 出力先はリポジトリ外の /workspace/pm/orbis1932/m7/。
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { buildDist } from './build_dist.mjs';
import { startStaticServer } from './static_server.mjs';

const artifactDir = '/workspace/pm/orbis1932/m7';
const endpoint = 'http://127.0.0.1/mock';
await mkdir(artifactDir, { recursive: true });

const dist = await buildDist();
const server = await startStaticServer(dist.outDir);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--no-sandbox']
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const externalRequests = [];
await context.route('**/*', async route => {
  const request = route.request();
  const url = request.url();
  const parsed = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    externalRequests.push(url);
    await route.abort();
    return;
  }
  if (request.method() !== 'POST' || parsed.pathname !== '/mock') {
    await route.continue();
    return;
  }
  let body = {};
  try { body = request.postDataJSON() || {}; } catch { body = {}; }
  const texts = (body.messages || []).filter(item => item.role === 'user').map(item => item.content);
  const payload = texts.map(value => { try { return JSON.parse(value); } catch { return null; } }).find(value => value?.operation);
  if (payload?.operation === 'CONNECTION_TEST') {
    const authorization = request.headers().authorization || '';
    if (!authorization || authorization === 'Bearer ') {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'APIキーがありません' } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] }) });
    return;
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }) });
});

const page = await context.newPage();
const errors = [];
page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
const checks = [];
const check = (name, condition, detail = '') => {
  checks.push({ name, ok: Boolean(condition), detail });
  if (!condition) errors.push(`check: ${name}${detail ? ` (${detail})` : ''}`);
};

await page.goto(server.url, { waitUntil: 'load' });
await page.waitForFunction(() => typeof Orbis !== 'undefined' && window.ORBIS_STATES_DB?.length && document.getElementById('orbis-build-version')?.textContent, { timeout: 120000 });
await page.evaluate(() => {
  Orbis.configure({ provider: 'custom', endpoint: 'http://127.0.0.1/mock', model: 'fixture-model', apiKey: '', remember: false });
  const card = document.createElement('div');
  card.className = 'turn-playback-card visible';
  card.setAttribute('data-test-date-chip', '');
  card.innerHTML = '<div class="tp-date">1932年3月（後半）</div><strong>日付チップの重なり確認</strong>';
  document.body.appendChild(card);
});

const version = await page.textContent('#orbis-build-version');
check('バージョン表示', version === 'v0.7.0', version);

await page.evaluate(() => Orbis.openAbout());
await page.waitForSelector('#modal-about[open]');
await page.waitForTimeout(250);
const about = await page.evaluate(() => ({
  version: document.getElementById('about-version')?.textContent,
  title: document.getElementById('about-title')?.textContent,
  brand: document.getElementById('about-brand')?.textContent,
  body: document.getElementById('modal-about')?.innerText || ''
}));
check('Aboutのバージョン', about.version === 'v0.7.0', about.version);
check('Aboutのタイトル', about.title === 'このソフトについて', about.title);
check('Aboutの説明', about.body.includes('歴史シミュレーション') && about.body.includes('© 2026'));
const chip = await page.evaluate(() => {
  const card = document.querySelector('[data-test-date-chip]');
  const dialog = document.querySelector('dialog[open]');
  const style = getComputedStyle(card);
  const cardRect = card.getBoundingClientRect();
  const dialogRect = dialog.getBoundingClientRect();
  const overlap = !(cardRect.right < dialogRect.left || cardRect.left > dialogRect.right || cardRect.bottom < dialogRect.top || cardRect.top > dialogRect.bottom);
  return { visibility: style.visibility, opacity: style.opacity, overlap, dialogOpen: Boolean(dialog), bodyClass: document.body.classList.contains('dialog-open') };
});
check('ダイアログ中の日付チップ非表示', chip.visibility === 'hidden' && chip.opacity === '0' && !chip.overlap && chip.bodyClass, JSON.stringify(chip));
await page.screenshot({ path: path.join(artifactDir, 'about.png') });
await page.evaluate(() => document.querySelector('[data-test-date-chip]')?.remove());
await page.keyboard.press('Escape');
await page.waitForSelector('#modal-about', { state: 'hidden' });

await page.evaluate(() => Orbis.openCredits());
await page.waitForSelector('#modal-credits[open]');
await page.waitForTimeout(250);
const credits = await page.evaluate(() => ({
  text: document.getElementById('credits-body')?.innerText || '',
  updated: document.getElementById('credits-updated')?.textContent
}));
for (const expected of ['Natural Earth', 'historical-basemaps', 'GNU GPL v3', 'flags/', 'Wikimedia Commons', 'Turf.js', 'Playwright', '要判断']) {
  check(`クレジット: ${expected}`, credits.text.includes(expected));
}
check('クレジット更新日', credits.updated.includes('2026-11-14'), credits.updated);
await page.screenshot({ path: path.join(artifactDir, 'credits.png') });
await page.keyboard.press('Escape');
await page.waitForSelector('#modal-credits', { state: 'hidden' });

await page.evaluate(() => Orbis.openSettings());
await page.waitForSelector('#modal-ai-settings[open]');
await page.waitForTimeout(250);
const settings = await page.evaluate(() => ({
  title: document.getElementById('ai-settings-title')?.textContent,
  keyType: document.getElementById('input-api-key')?.type,
  keyValue: document.getElementById('input-api-key')?.value,
  keyNote: document.querySelector('.settings-key-note')?.textContent || ''
}));
check('設定画面タイトル', settings.title === '設定', settings.title);
check('APIキー欄はパスワード', settings.keyType === 'password');
check('APIキー欄は初期表示で空', settings.keyValue === '', settings.keyValue);
check('キー保存の説明', settings.keyNote.includes('保存を選んだときだけ') && settings.keyNote.includes('localStorage'));
await page.screenshot({ path: path.join(artifactDir, 'settings.png') });

await page.evaluate(() => {
  const key = document.getElementById('input-api-key');
  if (key) key.value = '';
});
await page.selectOption('#select-ai-provider', 'openai');
await page.click('#btn-test-ai');
await page.waitForFunction(() => document.getElementById('ai-modal-alert-banner')?.classList.contains('error'), { timeout: 120000 });
const errorState = await page.evaluate(() => ({
  text: document.getElementById('ai-modal-alert-banner')?.textContent || '',
  className: document.getElementById('ai-modal-alert-banner')?.className || '',
  pageText: document.body.innerText
}));
check('設定エラーの日本語表示', errorState.text.includes('APIキーを入力してください'), errorState.text);
check('設定エラーがerror表示', errorState.className.includes('error'), errorState.className);
check('キー文字列を画面に出さない', !errorState.pageText.includes('TEST_ONLY_NOT_A_REAL_KEY'));
await page.evaluate(() => {
  const dialog = document.getElementById('modal-ai-settings');
  if (dialog) dialog.scrollTop = 0;
  const body = dialog?.querySelector('.modal-body');
  if (body) body.scrollTop = 0;
});
await page.waitForTimeout(150);
await page.screenshot({ path: path.join(artifactDir, 'settings-error.png') });

check('外部リクエストなし', externalRequests.length === 0, externalRequests.join(', '));
check('コンソールエラーなし', errors.length === 0, errors.join(' / '));

await context.close();
await browser.close();
await server.close();

for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.ok ? '' : `: ${item.detail}`}`);
if (errors.length) {
  console.error('スクリーンショット検証に失敗しました。');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`スクリーンショット: ${artifactDir}/about.png, settings.png, settings-error.png, credits.png`);
console.log(`外部リクエスト: 0 / コンソールエラー: 0 / モックのみ`);
