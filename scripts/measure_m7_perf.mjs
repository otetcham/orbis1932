#!/usr/bin/env node
/**
 * M7 性能測定。構築済みオフライン配布物をローカルHTTPで配信し、
 * 初回読み込みと、モックHTTPでの1ターン（半月）処理を測る。
 * 有料APIは呼ばない。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { buildDist } from './build_dist.mjs';
import { startStaticServer } from './static_server.mjs';

const artifactDir = '/workspace/pm/orbis1932/m7';
const endpoint = 'http://127.0.0.1/mock';
await mkdir(artifactDir, { recursive: true });

const choices = [
  { label: '了承', text: '了解しました。条件を確認します。' },
  { label: '保留', text: '検討します。' }
];
const opening = {
  headline: '軍縮と復興のあいだ',
  briefing: 'M7性能測定用のモック概況です。',
  telegrams: [
    { actorId: 'domestic:ig_military', subject: '防衛費', text: '防衛予算の協議を求めます。', urgency: 'important', choices },
    { actorId: 'ministry:usa', subject: '通商', text: '通商条件を協議したい。', urgency: 'important', choices },
    { actorId: 'client:manchukuo', subject: '開発', text: '開発援助の条件を確認したい。', urgency: 'routine', choices }
  ]
};
const evaluation = () => ({
  headline: '月が進む',
  article: '国内の調整と外交が進み、限られた財源の中で政策が実行された。',
  delta: { mil: 0, eco: 0, stb: 0, treasury: 0, prestige: 0, tension: 0 },
  reasoning: [{ text: '性能測定用のモック裁定。', sourceActionIds: [] }],
  developments: [{ headline: '欧州', body: '予算協議が続く。' }, { headline: 'アジア', body: '通商の調整が進む。' }],
  groups: [], relations: [], otherNations: [], actorUpdates: [], treaties: [], commitments: [],
  territoryChanges: [], clientChanges: [], leadershipChanges: [], memory: '性能測定用の継続記憶。',
  npcEvents: [], conflictChanges: [], actionResults: []
});

function sse(content) {
  const pieces = content.match(/.{1,48}/gs) || [content];
  return `${pieces.map(piece => `data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`).join('')}data: [DONE]\n\n`;
}

const dist = await buildDist();
const server = await startStaticServer(dist.outDir);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--no-sandbox']
});
const externalRequests = [];

async function routeMock(context) {
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
    const operation = payload?.operation;
    const data = operation === 'BRIEFING' ? opening : operation === 'CONNECTION_TEST' ? { ok: true } : evaluation();
    const content = JSON.stringify(data);
    if (body.stream) {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(content) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] })
    });
  });
}

const round = value => Math.round(value * 10) / 10;
const stats = values => ({
  iterations: values.length,
  averageMs: round(values.reduce((sum, value) => sum + value, 0) / values.length),
  minMs: round(Math.min(...values)),
  maxMs: round(Math.max(...values))
});

// 初回読み込み（毎回新しいコンテキスト＝空のlocalStorage）
const loadSamples = [];
for (let i = 0; i < 3; i++) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await routeMock(context);
  const page = await context.newPage();
  const startedAt = Date.now();
  await page.goto(server.url, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof Orbis !== 'undefined' && window.ORBIS_STATES_DB?.length && document.getElementById('orbis-build-version')?.textContent, { timeout: 120000 });
  const readyMs = Date.now() - startedAt;
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return nav ? { navigationMs: nav.duration, domContentLoadedMs: nav.domContentLoadedEventEnd, loadEventEndMs: nav.loadEventEnd } : {};
  });
  loadSamples.push({ readyMs, ...timing });
  await context.close();
}

// 1ターン（半月）処理。ウォームアップ1回のあと5回を記録。
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await routeMock(context);
const page = await context.newPage();
await page.goto(server.url, { waitUntil: 'load' });
await page.waitForFunction(() => typeof Orbis !== 'undefined' && window.ORBIS_STATES_DB?.length, { timeout: 120000 });
await page.evaluate(async endpoint => {
  Orbis.configure({ provider: 'custom', endpoint, model: 'fixture-model', apiKey: 'TEST_ONLY_NOT_A_REAL_KEY', remember: false });
  await Orbis.start({ nationId: 'japan', difficulty: 'standard', mandate: 'recovery', maxTurns: 48, replace: true });
  Orbis.completeOnboarding();
}, endpoint);
await page.waitForFunction(() => Orbis.snapshot()?.phase === 'playing', { timeout: 120000 });

async function runTurn() {
  const result = await page.evaluate(async () => {
    const startedAt = performance.now();
    const ok = await Orbis.finishTurn();
    return { ok, ms: performance.now() - startedAt, completedTurns: Orbis.snapshot()?.completedTurns ?? 0 };
  });
  await page.evaluate(() => {
    window.ORBIS_PLAYBACK?.stop?.();
    document.getElementById('turn-playback-card')?.remove();
    document.getElementById('turn-playback-controls')?.setAttribute('hidden', '');
    document.getElementById('turn-playback-overlay')?.setAttribute('hidden', '');
  });
  return result;
}

const warmup = await runTurn();
const turnSamples = [];
for (let i = 0; i < 5; i++) {
  const result = await runTurn();
  if (!result.ok) throw new Error(`ターン処理が失敗しました（${i + 1}回目）`);
  turnSamples.push(result);
}
const userAgent = await page.evaluate(() => navigator.userAgent);
await context.close();
await browser.close();
await server.close();

const report = {
  milestone: 'M7 製品化の下地',
  version: dist.version,
  measuredAt: new Date().toISOString(),
  mock: {
    httpOnly: true,
    paidApiCalls: 0,
    note: 'PlaywrightのルートでOpenAI互換のモック応答を返した。実キー・有料APIは使っていない。'
  },
  target: {
    mode: 'offline-dist-local-server',
    distDir: dist.outDir,
    zipPath: dist.zipPath,
    entry: 'index.html',
    externalRequests
  },
  initialLoad: {
    definition: 'ナビゲーション開始から、Orbis起動・州データ読込・バージョン表示まで',
    ...stats(loadSamples.map(sample => sample.readyMs)),
    samples: loadSamples.map(sample => ({
      readyMs: sample.readyMs,
      navigationMs: round(sample.navigationMs || 0),
      domContentLoadedMs: round(sample.domContentLoadedMs || 0),
      loadEventEndMs: round(sample.loadEventEndMs || 0)
    }))
  },
  turn: {
    definition: 'Orbis.finishTurn() の開始から、月次裁定・地図更新・翌月の電報受信まで（モックHTTP）',
    ...stats(turnSamples.map(sample => sample.ms)),
    warmupMs: round(warmup.ms),
    samplesMs: turnSamples.map(sample => round(sample.ms)),
    completedTurns: turnSamples.at(-1)?.completedTurns
  },
  environment: {
    node: process.version,
    platform: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    cpu: os.cpus()?.[0]?.model || 'unknown',
    viewport: '1440x900',
    browser: userAgent
  }
};
await writeFile(path.join(artifactDir, 'perf.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`初回読み込み: 平均 ${report.initialLoad.averageMs}ms（${report.initialLoad.iterations}回）`);
console.log(`1ターン: 平均 ${report.turn.averageMs}ms（${report.turn.iterations}回、ウォームアップ ${report.turn.warmupMs}ms）`);
console.log(`保存: ${path.join(artifactDir, 'perf.json')}`);
