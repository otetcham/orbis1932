#!/usr/bin/env node
/** Passive mock campaign without playtestStabilize — report collapse or reach 1945-12. */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';

const evaluation = () => ({
  headline: '半月の推移', article: '世界は静かに動いた。',
  delta: { mil: 0, eco: 0, stb: 0, treasury: 0, prestige: 0, tension: 0 },
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

let respond = () => null;
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
const targetHalves = vm.runInContext('ORBIS_CAMPAIGN.halfTurnsThrough(1945, 12)', ctx);

api.configure({ provider: 'custom', endpoint, model: 'mock', apiKey: 'TEST_ONLY', remember: false });
await api.start({ nationId: 'japan', difficulty: 'story', mandate: 'recovery', replace: true });
assertOk(api.snapshot().maxTurns === 0, 'default unlimited maxTurns');

const report = { targetHalves, reached: false, collapse: null, samples: [] };
const t0 = Date.now();

for (let i = 0; i < targetHalves; i++) {
  let snap = api.snapshot();
  if (snap.phase === 'milestone') await api.continuePastMilestone();
  snap = api.snapshot();
  if (snap.phase !== 'playing') {
    report.collapse = { half: snap.completedTurns, phase: snap.phase, ending: snap.ending, stress: snap.stress, date: vm.runInContext('state.date', ctx) };
    break;
  }
  const ok = await api.finishTurn();
  if (!ok) {
    report.collapse = { half: i, reason: 'finishTurn failed' };
    break;
  }
  const s = api.snapshot();
  if (s.ending?.result === 'defeat') {
    report.collapse = { half: s.completedTurns, ending: s.ending, stress: s.stress, stb: s.nations.japan.stb, eco: s.nations.japan.eco, treasury: s.treasury, date: vm.runInContext('state.date', ctx) };
    break;
  }
  if (i % 80 === 0 || i === targetHalves - 1) {
    report.samples.push({ half: s.completedTurns, date: vm.runInContext('state.date', ctx), stb: s.nations.japan.stb, eco: s.nations.japan.eco, treasury: s.treasury, tension: s.tension, stress: { ...s.stress } });
  }
}

const final = api.snapshot();
if (!report.collapse && final.completedTurns >= targetHalves) report.reached = true;

const artifactDir = '/opt/cursor/artifacts';
await mkdir(artifactDir, { recursive: true });
const out = { ...report, elapsedMs: Date.now() - t0, final: { completedTurns: final.completedTurns, phase: final.phase, date: vm.runInContext('state.date', ctx) } };
await writeFile(`${artifactDir}/playtest_no_stabilize.json`, JSON.stringify(out, null, 2));
server.close();

if (report.collapse) {
  console.log('COLLAPSE', JSON.stringify(report.collapse));
  process.exit(1);
}
console.log(`OK passive play reached ${targetHalves} halves (${out.final.date}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

function assertOk(cond, msg) {
  if (!cond) throw new Error(msg);
}
