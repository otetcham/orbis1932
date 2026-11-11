#!/usr/bin/env node
/** Mock historical Japan policy, no playtestStabilize — trajectory to 1945-12. */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';

const evaluation = () => ({
  headline: '半月の推移', article: '政策と国際情勢が緩やかに動いた。',
  delta: { mil: 0, eco: 1, stb: 1, treasury: -1, prestige: 0, tension: 0 },
  reasoning: [{ text: '史実方針に沿った中立裁定。', sourceActionIds: [] }],
  developments: [{ headline: '国際', body: '情勢。' }, { headline: '地域', body: '変化。' }],
  groups: [], relations: [], otherNations: [], actorUpdates: [], treaties: [], commitments: [],
  territoryChanges: [], clientChanges: [], leadershipChanges: [], npcEvents: [], conflictChanges: [],
  actionResults: [], memory: '継続',
});
const opening = () => ({
  headline: '概況', briefing: 'mock',
  telegrams: [{ actorId: 'adviser', subject: 's', text: 't', urgency: 'routine', choices: [{ label: 'a', text: 'b' }, { label: 'c', text: 'd' }] }],
});

function historicalAction(turn) {
  if (turn < 24) return '満洲国の鉄道・産業投資と関東軍との調整を継続し、国内恐慌対策に資源を配分する。';
  if (turn < 60) return '満洲経営と対華経済関係の安定化を優先し、軍備拡張は段階的に抑える。';
  if (turn < 120) return '対華関係の管理と南洋貿易の確保に努め、過度な国際緊張の上昇を避ける。';
  if (turn < 200) return '戦時経済への移行を段階的に行い、物資統制と産業動員を国内の支持基盤と両立させる。';
  return '本土防衛と講和の可能性を模索しつつ、軍事・経済のバランスを維持する。';
}

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
  const content = custom?.raw ?? JSON.stringify(data);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: custom?.finishReason || 'stop' }] }));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const endpoint = `http://127.0.0.1:${server.address().port}`;

const inlineScripts = [...(await readFile(new URL('../orbis_simulator.html', import.meta.url), 'utf8')).matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
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
for (const f of ['orbis_region_labels.js', 'orbis_events.js', 'orbis_campaign_core.js', 'orbis_timeline_engine.js', 'orbis_turn_playback.js', 'orbis_game.js']) {
  vm.runInContext(await readFile(new URL(`../${f}`, import.meta.url), 'utf8'), ctx);
}
const api = vm.runInContext('Orbis', ctx);
const targetHalves = vm.runInContext('ORBIS_CAMPAIGN.halfTurnsThrough(1945, 12)', ctx);

api.configure({ provider: 'custom', endpoint, model: 'mock', apiKey: 'TEST_ONLY', remember: false });
await api.start({ nationId: 'japan', difficulty: 'story', mandate: 'security', replace: true, maxTurns: 0 });

const report = { policy: 'historical_japan', targetHalves, reached: false, collapse: null, samples: [], milestones: [] };
const t0 = Date.now();

for (let i = 0; i < targetHalves; i++) {
  let snap = api.snapshot();
  if (snap.phase === 'milestone') {
    report.milestones.push({ half: snap.completedTurns, date: vm.runInContext('state.date', ctx) });
    await api.continuePastMilestone();
    snap = api.snapshot();
  }
  if (snap.phase !== 'playing') {
    report.collapse = { half: snap.completedTurns, phase: snap.phase, ending: snap.ending, stress: snap.stress, date: vm.runInContext('state.date', ctx) };
    break;
  }
  api.submitAction(historicalAction(snap.completedTurns));
  const ok = await api.finishTurn();
  if (!ok) {
    report.collapse = { half: i, reason: 'finishTurn failed' };
    break;
  }
  const s = api.snapshot();
  if (s.ending?.result === 'defeat') {
    report.collapse = {
      half: s.completedTurns, ending: s.ending, stress: s.stress,
      stb: s.nations.japan.stb, eco: s.nations.japan.eco, mil: s.nations.japan.mil,
      treasury: s.treasury, tension: s.tension, worldWarActive: s.worldWarActive,
      date: vm.runInContext('state.date', ctx),
    };
    break;
  }
  if (i % 60 === 0 || i === targetHalves - 1) {
    report.samples.push({
      half: s.completedTurns, date: vm.runInContext('state.date', ctx),
      stb: s.nations.japan.stb, eco: s.nations.japan.eco, mil: s.nations.japan.mil,
      treasury: s.treasury, tension: s.tension,
      stress: { ...s.stress }, worldWarActive: s.worldWarActive,
    });
  }
}

const final = api.snapshot();
if (!report.collapse && final.completedTurns >= targetHalves) report.reached = true;

const artifactDir = '/opt/cursor/artifacts';
await mkdir(artifactDir, { recursive: true });
const out = { ...report, elapsedMs: Date.now() - t0, final: { completedTurns: final.completedTurns, phase: final.phase, date: vm.runInContext('state.date', ctx), stats: final.nations.japan } };
await writeFile(`${artifactDir}/playtest_historical_japan_1945.json`, JSON.stringify(out, null, 2));
server.close();

console.log(JSON.stringify({ reached: report.reached, collapse: report.collapse, samples: report.samples, elapsedMs: out.elapsedMs }, null, 2));
if (report.collapse && !report.reached) process.exit(1);
