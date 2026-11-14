#!/usr/bin/env node
/**
 * M6 long-run: 1932-03 .. 1972-12 (980 half-turns) with mock HTTP only.
 * No playtestStabilize. Milestones are continued with continuePastMilestone.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const DEFAULT_TOTAL = 980;
const DEFAULT_NATIONS = ['japan', 'usa', 'uk'];
const DEFAULT_REPORT = '/workspace/pm/orbis1932/m6/long-run-report.json';
const SAVE_KEY = 'orbis_campaign_v6';

const evaluation = () => ({
  headline: '半月の推移', article: '世界は静かに動いた。',
  delta: { mil: 0, eco: 0, stb: 0, treasury: 0, prestige: 0, tension: 0 },
  reasoning: [{ text: 'モック裁定。提出された方針と世界情勢を踏まえた。', sourceActionIds: [] }],
  developments: [{ headline: '国際', body: '各国の財政と外交が続く。' }, { headline: '地域', body: '目立った変化はない。' }],
  groups: [], relations: [], otherNations: [], actorUpdates: [], treaties: [], commitments: [],
  territoryChanges: [], clientChanges: [], leadershipChanges: [], npcEvents: [], conflictChanges: [],
  actionResults: [], memory: '継続',
});
const opening = () => ({
  headline: '概況', briefing: 'モックの長期安定ラン用概況。',
  telegrams: [{ actorId: 'adviser', subject: '情勢', text: '今半月の方針を確認します。', urgency: 'routine', choices: [{ label: '了承', text: '了解した。' }, { label: '保留', text: '検討する。' }] }],
});

function dateLabel(halfIndex) {
  const index = Math.max(0, Math.floor(Number(halfIndex) || 0));
  const monthIndex = Math.floor(index / 2);
  const m0 = 2 + monthIndex;
  const year = 1932 + Math.floor(m0 / 12);
  const month = (m0 % 12) + 1;
  const half = index % 2 === 0 ? '前半' : '後半';
  return `${year}年${month}月（${half}）`;
}

async function startMockServer() {
  const server = createServer(async (request, response) => {
    try {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw || '{}');
      const texts = (body.messages || []).filter(item => item.role === 'user').map(item => item.content);
      const payload = texts.map(value => { try { return JSON.parse(value); } catch { return null; } }).find(value => value?.operation);
      const operation = payload?.operation;
      const data = operation === 'BRIEFING' ? opening() : operation === 'RESOLUTION' ? evaluation() : { ok: true };
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) }, finish_reason: 'stop' }] }));
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, endpoint: `http://127.0.0.1:${server.address().port}` };
}

function createContext(endpoint) {
  const storage = new Map();
  const document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => ({ classList: { add() {}, remove() {} }, innerHTML: '', style: {} })
  };
  const context = vm.createContext({
    console, fetch, URL, Blob, AbortController, AbortSignal, crypto: webcrypto,
    setTimeout, clearTimeout, setInterval, clearInterval,
    document,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    },
    addEventListener() {},
  });
  context.window = context;
  return { context, storage, endpoint };
}

async function loadGame(endpoint) {
  const html = await readFile(new URL('../orbis_simulator.html', import.meta.url), 'utf8');
  const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  const preload = ['orbis_states.js', 'orbis_map_meta.js', 'orbis_region_labels.js'];
  const afterInline = ['orbis_events.js', 'orbis_text.js', 'orbis_campaign_core.js', 'orbis_timeline_engine.js', 'orbis_turn_playback.js', 'orbis_game.js'];
  const { context, storage } = createContext(endpoint);
  for (const file of preload) vm.runInContext(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), context, { timeout: 8000 });
  for (const script of inlineScripts) if (script.trim()) vm.runInContext(script, context, { timeout: 8000 });
  for (const file of afterInline) vm.runInContext(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), context, { timeout: 8000 });
  const api = vm.runInContext('Orbis', context);
  api.configure({ provider: 'custom', endpoint, model: 'mock', apiKey: 'TEST_ONLY_NOT_A_REAL_KEY', remember: false });
  return { api, context, storage };
}

function ownerCounts(snapshot, landRegions, baseOwner) {
  const owners = new Map();
  const counts = new Map();
  for (const region of landRegions) {
    const owner = snapshot.territories[region.id] || baseOwner.get(region.id) || region.country;
    owners.set(region.id, owner);
    counts.set(owner, (counts.get(owner) || 0) + 1);
  }
  return { owners, counts };
}

function topOwners(counts, limit = 3) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([nationId, landStates]) => ({ nationId, landStates }));
}

function ownerMap(snapshot, landRegions) {
  return new Map(landRegions.map(region => [region.id, snapshot.territories[region.id] || region.country]));
}

function changedTerritoryCount(snapshot, landRegions, startOwners) {
  if (!startOwners) return 0;
  let changed = 0;
  for (const region of landRegions) {
    const before = startOwners.get(region.id);
    const after = snapshot.territories[region.id] || region.country;
    if (before !== after) changed++;
  }
  return changed;
}

function worldArcReport(snapshot) {
  const log = Array.isArray(snapshot.worldArcs?.log) ? snapshot.worldArcs.log : [];
  const fired = log.filter(entry => entry.status === 'fired').map(entry => ({
    id: entry.id,
    label: entry.label,
    date: entry.date,
    half: entry.half,
    summary: entry.summary,
    warId: entry.warId || null
  }));
  const states = {};
  for (const [id, state] of Object.entries(snapshot.worldArcs?.states || {})) {
    states[id] = {
      status: state.status,
      firedHalf: state.firedHalf ?? null,
      dueHalf: state.dueHalf ?? null,
      blockReason: state.blockReason || '',
      result: state.result?.summary || ''
    };
  }
  return { fired, states, total: fired.length };
}

function warStats(snapshot) {
  const wars = Object.values(snapshot.wars || {});
  return {
    activeWars: wars.filter(war => war.status === 'active').length,
    totalWars: wars.length,
    activeWarList: wars.filter(war => war.status === 'active').map(war => ({ attacker: war.attacker, defender: war.defender, reason: war.reason, goals: war.goals?.attacker?.length || 0 })),
    resolvedWars: wars.filter(war => war.status !== 'active').length
  };
}

function checkInvariants(snapshot, label) {
  const failures = [];
  const finiteNonNegative = (value, name) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) failures.push(`${label}: ${name}=${String(value)}`);
  };
  for (const [nationId, item] of Object.entries(snapshot.nations || {})) {
    for (const key of ['mil', 'eco', 'stb', 'tech']) finiteNonNegative(item[key], `${nationId}.${key}`);
    for (const [groupId, value] of Object.entries(item.groups || {})) finiteNonNegative(value, `${nationId}.${groupId}`);
  }
  for (const key of ['treasury', 'prestige', 'tension']) finiteNonNegative(snapshot[key], key);
  for (const [nationId, item] of Object.entries(snapshot.economy || {})) {
    finiteNonNegative(item.manpower, `${nationId}.manpower`);
    finiteNonNegative(item.equipment, `${nationId}.equipment`);
    finiteNonNegative(item.militaryShare, `${nationId}.militaryShare`);
  }
  for (const formation of snapshot.formations || []) {
    const strength = Number(formation.strength);
    if (!Number.isFinite(strength) || strength <= 0) failures.push(`${label}: ${formation.id}.strength=${String(formation.strength)}`);
  }
  for (const key of ['navy', 'air']) {
    for (const [nationId, value] of Object.entries(snapshot.maritime?.[key] || {})) finiteNonNegative(value, `maritime.${key}.${nationId}`);
  }
  return failures;
}

export async function runLongRun(options = {}) {
  const totalHalves = Math.max(1, Number(options.totalHalves) || DEFAULT_TOTAL);
  const nations = Array.isArray(options.nations) && options.nations.length ? options.nations : DEFAULT_NATIONS;
  const reportPath = options.reportPath || DEFAULT_REPORT;
  const requireArcs = options.requireArcs ?? totalHalves >= 120;
  const log = options.log || console.log;
  const { server, endpoint } = await startMockServer();
  const startedAt = Date.now();
  const runs = [];
  const failures = [];
  try {
    const { api, context, storage } = await loadGame(endpoint);
    const allRegions = vm.runInContext('ORBIS_STATES_DB', context);
    const landRegions = allRegions.filter(region => !region.isSea && !region.isSeaZone && region.type !== 'sea');
    const baseOwner = new Map(landRegions.map(region => [region.id, region.country]));
    const adjacency = api.landAdjacency();

    for (const nationId of nations) {
      const runStarted = Date.now();
      const intervals = [];
      const anomalies = [];
      const invariantFailures = [];
      let completed = 0;
      let previous = null;
      let intervalPeak = { nationId: null, landStates: 0 };
      let peakOwner = { nationId: null, landStates: 0 };
      let startOwners = null;
      let lastArcReport = { fired: [], states: {}, total: 0 };
      const ownerHistory = [];
      try {
        const started = await api.start({ nationId, difficulty: 'story', mandate: 'recovery', maxTurns: 0, replace: true });
        if (!started) throw new Error('start failed');
        startOwners = ownerMap(api.snapshot(), landRegions);
        for (let index = 0; index < totalHalves; index++) {
          let snapshot = api.snapshot();
          if (snapshot.phase === 'milestone') {
            const continued = await api.continuePastMilestone();
            if (!continued) throw new Error(`milestone continue failed at ${snapshot.completedTurns}`);
            snapshot = api.snapshot();
          }
          if (snapshot.phase !== 'playing') {
            failures.push(`${nationId}: phase ${snapshot.phase} at half ${snapshot.completedTurns} (${dateLabel(snapshot.completedTurns)})`);
            break;
          }
          const ok = await api.finishTurn();
          if (!ok) {
            failures.push(`${nationId}: finishTurn failed at half ${snapshot.completedTurns}`);
            break;
          }
          snapshot = api.snapshot();
          completed = snapshot.completedTurns;
          invariantFailures.push(...checkInvariants(snapshot, `${nationId}@${completed}`));

          const current = ownerCounts(snapshot, landRegions, baseOwner);
          const currentTop = topOwners(current.counts, 3);
          for (const item of currentTop) if (item.landStates > peakOwner.landStates) peakOwner = { ...item };
          if (currentTop[0] && currentTop[0].landStates > intervalPeak.landStates) intervalPeak = { ...currentTop[0] };
          ownerHistory.push(current.counts);

          if (previous) {
            const changed = [];
            const jumps = [];
            for (const region of landRegions) {
              const beforeOwner = previous.owners.get(region.id);
              const afterOwner = current.owners.get(region.id);
              if (beforeOwner === afterOwner) continue;
              changed.push({ regionId: region.id, from: beforeOwner, to: afterOwner });
              let adjacent = false;
              for (const neighbor of adjacency.get(region.id) || []) {
                if (current.owners.get(neighbor) === afterOwner) { adjacent = true; break; }
              }
              if (!adjacent) jumps.push({ regionId: region.id, from: beforeOwner, to: afterOwner });
            }
            if (changed.length >= 100) {
              anomalies.push({ half: completed, date: dateLabel(completed - 1), type: 'single-half-mass-transfer', changed: changed.length });
            }
            if (changed.length >= 12 && jumps.length >= 12 && jumps.length / changed.length >= 0.5) {
              anomalies.push({ half: completed, date: dateLabel(completed - 1), type: 'non-adjacent-mass-jump', changed: changed.length, jumps: jumps.length, sample: jumps.slice(0, 3) });
            }
            const gainWindow = current.counts;
            const older = ownerHistory[Math.max(0, ownerHistory.length - 25)];
            if (older && ownerHistory.length >= 25) {
              for (const [ownerId, count] of gainWindow) {
                const gain = count - (older.get(ownerId) || 0);
                if (gain >= 180) anomalies.push({ half: completed, date: dateLabel(completed - 1), type: 'rapid-land-absorption', nationId: ownerId, gain, landStates: count });
              }
            }
          }
          previous = current;

          if (completed % 120 === 0 || index === totalHalves - 1) {
            const saveBytes = Buffer.byteLength(storage.get(SAVE_KEY) || '', 'utf8');
            const arcReport = worldArcReport(snapshot);
            lastArcReport = arcReport;
            const wars = warStats(snapshot);
            intervals.push({
              half: completed,
              date: dateLabel(Math.max(0, completed - 1)),
              topOwners: currentTop,
              intervalPeak: { ...intervalPeak },
              activeWars: wars.activeWars,
              totalWars: wars.totalWars,
              activeWarList: wars.activeWarList,
              territoryChanges: changedTerritoryCount(snapshot, landRegions, startOwners),
              worldArcs: arcReport.fired,
              worldArcStates: arcReport.states,
              saveBytes,
              elapsedMs: Date.now() - runStarted,
              avgTurnMs: Math.round((Date.now() - runStarted) / Math.max(1, completed))
            });
            intervalPeak = { nationId: null, landStates: 0 };
          }
        }
      } catch (error) {
        failures.push(`${nationId}: ${error?.stack || error?.message || String(error)}`);
      }
      const finalSnapshot = api.snapshot();
      const finalOwners = finalSnapshot ? ownerCounts(finalSnapshot, landRegions, baseOwner) : { counts: new Map() };
      const finalArcs = finalSnapshot ? worldArcReport(finalSnapshot) : lastArcReport;
      const finalWars = finalSnapshot ? warStats(finalSnapshot) : { activeWars: 0, totalWars: 0, activeWarList: [] };
      if (finalSnapshot) lastArcReport = finalArcs;
      const finalTerritoryChanges = finalSnapshot ? changedTerritoryCount(finalSnapshot, landRegions, startOwners) : 0;
      const run = {
        nationId,
        targetHalves: totalHalves,
        completedHalves: completed,
        reachedTarget: completed >= totalHalves,
        startDate: dateLabel(0),
        lastCompletedDate: dateLabel(Math.max(0, completed - 1)),
        finalPhase: finalSnapshot?.phase || null,
        finalEnding: finalSnapshot?.ending || null,
        elapsedMs: Date.now() - runStarted,
        avgTurnMs: Math.round((Date.now() - runStarted) / Math.max(1, completed)),
        finalSaveBytes: Buffer.byteLength(storage.get(SAVE_KEY) || '', 'utf8'),
        finalTopOwners: topOwners(finalOwners.counts, 5),
        activeWars: finalWars.activeWars,
        totalWars: finalWars.totalWars,
        activeWarList: finalWars.activeWarList,
        territoryChanges: finalTerritoryChanges,
        worldArcs: finalArcs.fired,
        worldArcStates: finalArcs.states,
        peakOwner,
        intervals,
        anomalies,
        invariantFailures
      };
      runs.push(run);
      if (requireArcs && (finalArcs.total < 2 || finalTerritoryChanges === 0)) {
        failures.push(`${nationId}: 史実の弧 ${finalArcs.total}件、領土変更 ${finalTerritoryChanges}州。受動プレイで世界が動いていない。`);
      }
      log(`[${nationId}] ${completed}/${totalHalves} 半月 ${run.lastCompletedDate} 完了 平均 ${run.avgTurnMs}ms 最終セーブ ${run.finalSaveBytes} bytes 最大保有 ${run.peakOwner.nationId || '-'} ${run.peakOwner.landStates}州 戦争 ${run.totalWars}件 領土変更 ${run.territoryChanges}州 主要弧 ${run.worldArcs.length}件`);
      for (const interval of intervals) {
        const top = interval.topOwners.map(item => `${item.nationId} ${item.landStates}州`).join(' / ');
        const arcIds = interval.worldArcs.map(entry => entry.id).join(',') || '-';
        log(`  ${interval.half}半月 ${interval.date} 上位: ${top} 戦争 進行${interval.activeWars}/累計${interval.totalWars} 領土変更 ${interval.territoryChanges}州 弧 ${arcIds} セーブ ${interval.saveBytes} bytes 平均 ${interval.avgTurnMs}ms`);
        for (const entry of interval.worldArcs) log(`    弧 ${entry.id} ${entry.date}: ${entry.summary}`);
      }
      if (run.anomalies.length) for (const anomaly of run.anomalies) log(`  異常: ${JSON.stringify(anomaly)}`);
      if (run.invariantFailures.length) for (const failure of run.invariantFailures.slice(0, 8)) log(`  在庫異常: ${failure}`);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  const totalElapsed = Date.now() - startedAt;
  const totalTurns = runs.reduce((sum, run) => sum + run.completedHalves, 0);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'mock-http',
    totalHalves,
    startedNations: nations,
    totals: {
      elapsedMs: totalElapsed,
      turns: totalTurns,
      avgTurnMs: Math.round(totalElapsed / Math.max(1, totalTurns)),
      finalSaveBytes: runs.at(-1)?.finalSaveBytes || 0,
      failures
    },
    runs,
    summary: runs.map(run => ({
      nationId: run.nationId,
      completedHalves: run.completedHalves,
      reachedTarget: run.reachedTarget,
      lastCompletedDate: run.lastCompletedDate,
      avgTurnMs: run.avgTurnMs,
      finalSaveBytes: run.finalSaveBytes,
      maxLandStates: run.peakOwner.landStates,
      maxLandOwner: run.peakOwner.nationId,
      totalWars: run.totalWars,
      activeWars: run.activeWars,
      territoryChanges: run.territoryChanges,
      worldArcs: run.worldArcs.map(entry => ({ id: entry.id, date: entry.date, summary: entry.summary })),
      intervalMaxLandStates: run.intervals.map(interval => ({ half: interval.half, nationId: interval.intervalPeak.nationId, landStates: interval.intervalPeak.landStates, territoryChanges: interval.territoryChanges }))
    }))
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  log(`合計 ${(totalElapsed / 1000).toFixed(1)}秒 / ${totalTurns} 半月 / 平均 ${report.totals.avgTurnMs}ms / 最終セーブ ${report.totals.finalSaveBytes} bytes`);
  log(`レポート: ${reportPath}`);
  const anomalyCount = runs.reduce((sum, run) => sum + run.anomalies.length, 0);
  const invariantCount = runs.reduce((sum, run) => sum + run.invariantFailures.length, 0);
  if (failures.length || anomalyCount || invariantCount || runs.some(run => !run.reachedTarget)) {
    const message = `M6 long-run failed: failures=${failures.length}, anomalies=${anomalyCount}, inventory=${invariantCount}`;
    if (options.throwOnFailure !== false) throw new Error(message);
    return { ...report, ok: false };
  }
  return { ...report, ok: true };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href) {
  try {
    const report = await runLongRun();
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  }
}
