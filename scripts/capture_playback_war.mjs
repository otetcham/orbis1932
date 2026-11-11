#!/usr/bin/env node
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';

const artifactDir = '/opt/cursor/artifacts';
await mkdir(artifactDir, { recursive: true });
const pageUrl = pathToFileURL(new URL('../orbis_simulator.html', import.meta.url).pathname).href;
const evalData = () => ({
  headline: '国境で衝突', article: '前線に動きがあった。東北方面で占领が拡大した。', delta: { mil: 0, eco: 0, stb: 0, treasury: 0, prestige: 0, tension: 2 },
  reasoning: [{ text: 'mock', sourceActionIds: [] }],
  developments: [{ headline: '東アジア', body: '紧张。' }, { headline: '欧州', body: '外交。' }],
  groups: [], relations: [], otherNations: [], actorUpdates: [], treaties: [], commitments: [],
  territoryChanges: [], clientChanges: [], leadershipChanges: [], npcEvents: [], conflictChanges: [],
  memory: 'm',
});

await chromium.launch({ headless: true }).then(async browser => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route('**/*', async route => {
    const req = route.request();
    if (req.method() !== 'POST' || !req.url().includes('127.0.0.1')) return route.continue();
    let op = 'RESOLUTION';
    try {
      const body = req.postDataJSON() || {};
      const texts = (body.messages || []).filter(m => m.role === 'user').map(m => m.content);
      const payload = texts.map(t => { try { return JSON.parse(t); } catch { return null; } }).find(v => v?.operation);
      op = payload?.operation || 'RESOLUTION';
    } catch { /* */ }
    const data = op === 'BRIEFING' ? { headline: 'h', briefing: 'b', telegrams: [{ actorId: 'adviser', subject: 's', text: 't', urgency: 'important', choices: [{ label: 'a', text: 'b' }, { label: 'c', text: 'd' }] }] } : op === 'ACTOR' ? { reply: 'ok', stance: 'consider', memory: 'm', choices: [{ label: 'a', text: 'b' }, { label: 'c', text: 'd' }] } : evalData();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) } }] }) });
  });
  const page = await context.newPage();
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof Orbis !== 'undefined' && window.ORBIS_CAMPAIGN);
  await page.evaluate(() => {
    Orbis.configure({ provider: 'custom', endpoint: 'http://127.0.0.1/mock', model: 'mock', apiKey: 'TEST_ONLY', remember: false });
  });
  await page.evaluate(() => Orbis.start({ nationId: 'japan', maxTurns: 'unlimited', replace: true }));
  await page.waitForFunction(() => Orbis.snapshot()?.phase === 'playing', { timeout: 120000 });
  const turnLabel = await page.textContent('#hud-turn');
  if (turnLabel?.includes('/')) throw new Error(`HUD still capped: ${turnLabel}`);
  await page.evaluate(() => Orbis.declareWar('china', '満州国境の衝突'));
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${artifactDir}/war-occupied-flat.png`, fullPage: false });
  await page.click('#btn-proj-globe');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${artifactDir}/war-occupied-globe.png`, fullPage: false });
  await page.click('#btn-advance-month');
  await page.waitForSelector('#turn-review[open]');
  await page.click('#btn-confirm-end-turn');
  for (let i = 1; i <= 3; i++) {
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${artifactDir}/playback-seq-${i}.png`, fullPage: false });
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${artifactDir}/playback-flat.png`, fullPage: false });
  await page.click('#btn-proj-globe');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${artifactDir}/playback-globe.png`, fullPage: false });
  await browser.close();
  console.log('Saved war + playback screenshots to', artifactDir);
});
