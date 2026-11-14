#!/usr/bin/env node
/**
 * Mock playtest: 1932-03 .. 1972-12 (980 half-turns) in Node VM (no browser).
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';

const TOTAL = 980;
const evaluation = () => ({
  headline: '半月の推移', article: '世界は静かに動いた。',
  delta: { mil: 0, eco: 1, stb: 1, treasury: 1, prestige: 0, tension: -1 },
  reasoning: [{ text: '中立裁定。', sourceActionIds: [] }],
  developments: [{ headline: '国際', body: '情勢。' }, { headline: '地域', body: '変化。' }],
  groups: [], relations: [], otherNations: [], actorUpdates: [], treaties: [], commitments: [],
  territoryChanges: [], clientChanges: [], leadershipChanges: [], npcEvents: [], conflictChanges: [],
  actionResults: [], memory: '継続',
});
const opening = () => ({
  headline: '概況', briefing: 'mock',
  telegrams: [{ actorId: 'adviser', subject: 's', text: 't', urgency: 'routine', choices: [{ label: 'a', text: 'b' }, { label: 'c', text: 'd' }] }],
});

let respond = item => (item.operation === 'ACTOR' ? { data: { reply: '了承する。', stance: 'agree', memory: 'm', choices: [{ label: 'a', text: 'b' }, { label: 'c', text: 'd' }] } } : null);
const server = createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  const body = JSON.parse(raw);
  const texts = (body.messages || []).filter(m => m.role === 'user').map(m => m.content);
  const payload = texts.map(t => { try { return JSON.parse(t); } catch { return null; } }).find(v => v?.operation);
  const item = { operation: payload?.operation };
  const custom = await respond(item);
  const data = custom?.data || (item.operation === 'BRIEFING' ? opening() : item.operation === 'RESOLUTION' ? evaluation() : { ok: true });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) } }] }));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const endpoint = `http://127.0.0.1:${server.address().port}`;

const html = await readFile(new URL('../orbis_simulator.html', import.meta.url), 'utf8');
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
const files = ['orbis_states.js', 'orbis_map_meta.js', 'orbis_events.js', 'orbis_campaign_core.js', 'orbis_timeline_engine.js', 'orbis_turn_playback.js', 'orbis_focus.js', 'orbis_game.js'];
const ctx = vm.createContext({
  console, fetch, URL, Blob, AbortController, crypto: webcrypto,
  setTimeout, clearTimeout, setInterval, clearInterval,
  document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ classList: { add() {}, remove() {} }, innerHTML: '', style: {} }) },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  addEventListener() {},
});
ctx.window = ctx;
for (const f of ['orbis_states.js', 'orbis_map_meta.js']) vm.runInContext(await readFile(new URL(`../${f}`, import.meta.url), 'utf8'), ctx);
for (const s of inlineScripts) if (s.trim()) vm.runInContext(s, ctx);
for (const f of files.slice(2)) vm.runInContext(await readFile(new URL(`../${f}`, import.meta.url), 'utf8'), ctx);
const api = vm.runInContext('Orbis', ctx);
api.configure({ provider: 'custom', endpoint, model: 'mock', apiKey: 'TEST_ONLY', remember: false });
const nationId = 'japan';
await api.start({ nationId, difficulty: 'story', maxTurns: 0, replace: true });
const stable = api.snapshot();
stable.treasury = 85;
stable.tension = 35;
stable.nations[nationId].stb = 72;
stable.nations[nationId].eco = 72;
stable.stress = { collapse: 0, bankruptcy: 0, war: 0 };
await api.restore(stable);

const log = [];
const t0 = Date.now();
for (let i = 0; i < TOTAL; i++) {
  api.playtestStabilize();
  let snap = api.snapshot();
  if (snap.phase === 'milestone') await api.continuePastMilestone();
  snap = api.snapshot();
  if (snap.phase !== 'playing') {
    console.error('ending', snap.ending, 'stress', snap.stress);
    throw new Error(`Stalled at half ${i} phase=${snap.phase}`);
  }
  if (api.snapshot().ending?.result === 'defeat') throw new Error(`Collapse at half ${i}: ${api.snapshot().ending.title}`);
  const cur = api.snapshot();
  for (const tg of cur.briefing?.telegrams || []) {
    if (!cur.turnActions.some(a => a.actorId === tg.actorId) && cur.usedActions < 6) {
      await api.send('方針を維持し、国内の安定を優先する。', tg.actorId, 'private');
    }
  }
  const ok = await api.finishTurn();
  if (!ok) throw new Error(`finishTurn failed at ${i}`);
  const s = api.snapshot();
  if (s.completedTurns !== i + 1) throw new Error(`Turn count mismatch ${s.completedTurns} vs ${i + 1}`);
  if (i % 120 === 0 || i === TOTAL - 1) log.push({ half: s.completedTurns, date: vm.runInContext('state.date', ctx), tension: s.tension, treasury: s.treasury });
}
const final = api.snapshot();
const artifactDir = '/opt/cursor/artifacts';
await mkdir(artifactDir, { recursive: true });
await writeFile(`${artifactDir}/playtest_1972_log.json`, JSON.stringify({ totalHalves: TOTAL, elapsedMs: Date.now() - t0, final: { completedTurns: final.completedTurns, phase: final.phase, ending: final.ending, date: vm.runInContext('state.date', ctx) }, samples: log }, null, 2));
server.close();
console.log(`OK ${TOTAL} half-turns in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${artifactDir}/playtest_1972_log.json`);
