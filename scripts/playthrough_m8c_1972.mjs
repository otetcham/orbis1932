#!/usr/bin/env node
/**
 * M8c 脚本化通しプレイ: 1932-03 .. 1972-12（980半月）。
 * モックHTTPのみ。実APIは呼ばない。
 * 日本・ドイツ・米国・英国・ソ連・中国をプレイヤーとして、国策・研究・生産・
 * 戦時の攻勢・戦時得点に応じた講和を実行する。
 * 公式レポートはリポジトリ外の /workspace/pm/orbis1932/m8c/playthrough-report.json。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  loadGame, startMockServer, dateLabel, ownerCounts, topOwners, ownerMap,
  changedTerritoryCount, worldArcReport, independenceReport, postwarReport,
  warStats, checkInvariants, nationLandCount
} from './longrun_m6_1972.mjs';

const NATIONS = ['japan', 'germany', 'usa', 'uk', 'russia', 'china'];
const TOTAL_HALVES = 980;
const SAVE_KEY = 'orbis_campaign_v6';
const DEFAULT_REPORT = '/workspace/pm/orbis1932/m8c/playthrough-report.json';
const EXPANSION_THRESHOLD = 160;

const NATION_ACTION_NAME = {
  japan: '大日本帝国', germany: 'ドイツ国', west_germany: '西ドイツ', usa: 'アメリカ合衆国',
  uk: '大英帝国', russia: 'ソビエト連邦', china: '中華民国'
};

function safeJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function activeWarsFor(snapshot, nationId) {
  return Object.entries(snapshot.wars || {})
    .filter(([, war]) => war.status === 'active' && (war.attacker === nationId || war.defender === nationId))
    .map(([warId, war]) => ({ warId, ...war }));
}

function chooseFocus(api, snapshot, atWar) {
  const summary = api.focusSummary();
  if (!summary) return null;
  if (summary.current) return summary.current;
  const candidates = summary.focuses.filter(focus => focus.status === 'available');
  if (!candidates.length) return null;
  const pathOf = focus => focus.path || 'common';
  const chosen = summary.completed.map(id => summary.focuses.find(focus => focus.id === id)).filter(Boolean);
  const activePath = chosen.length ? pathOf(chosen[chosen.length - 1]) : 'historical';
  let pool = candidates.filter(focus => pathOf(focus) === activePath);
  if (!pool.length) pool = candidates.filter(focus => pathOf(focus) === 'common');
  if (!pool.length) pool = candidates;
  const score = focus => {
    const effects = focus.effects || {};
    if (atWar) {
      return (effects.equipment || 0) * 3 + (effects.manpower || 0)
        + (effects.attackBonus || 0) * 5 + (effects.warGoal ? 30 : 0)
        + (effects.factoryEfficiency || 0) * 0.5 + (effects.stability || 0);
    }
    return (effects.factoryEfficiency || 0) * 3 + (effects.researchSpeed || 0) * 2
      + (effects.stability || 0) * 2 + (effects.treasury || 0) * 3 + (effects.ppGain || 0) * 4;
  };
  return pool.slice().sort((a, b) => score(b) - score(a) || a.tier - b.tier || a.cost - b.cost)[0] || null;
}

function chooseResearch(api, atWar) {
  const summary = api.researchSummary();
  if (!summary || summary.current) return null;
  const priority = atWar ? ['army_doctrine', 'equipment', 'industry', 'electronics'] : ['industry', 'electronics', 'equipment', 'army_doctrine'];
  for (const branchId of priority) {
    const branch = summary.branches.find(item => item.id === branchId);
    const item = branch?.items.find(entry => entry.status === 'available');
    if (item) return item;
  }
  for (const branch of summary.branches) {
    const item = branch.items.find(entry => entry.status === 'available');
    if (item) return item;
  }
  return null;
}

function actionText(snapshot, playerId, warList, focus, research) {
  const date = dateLabel(Math.max(0, snapshot.completedTurns));
  const nation = NATION_ACTION_NAME[playerId] || playerId;
  const warText = warList.length
    ? `進行中の${warList.length}戦線では補給を優先し、隣接する敵陸州への攻勢を継続する。`
    : '戦線は設けず、国境警備と国内復興を優先する。';
  const focusText = focus ? `国策「${focus.name}」` : '国策の再編';
  const researchText = research ? `研究「${research.name}」` : '研究の継続';
  return `${date}、${nation}として${focusText}と${researchText}を進める。${warText}財政余力を確保し、産業動員と民生の均衡を図る。`;
}

function calendarOf(snapshot) {
  const index = Math.max(0, Number(snapshot.completedTurns) || 0);
  const monthIndex = Math.floor(index / 2);
  const m0 = 2 + monthIndex;
  return { year: 1932 + Math.floor(m0 / 12), month: (m0 % 12) + 1 };
}

function activeWarBetweenSnapshot(snapshot, a, b) {
  return Object.values(snapshot.wars || {}).some(war => war.status === 'active'
    && ((war.attacker === a && war.defender === b) || (war.attacker === b && war.defender === a)));
}

// 史実の開戦時期に合わせ、弧が発火していない場合だけプレイヤー側から開戦する。
// 自殺的な拡大はせず、既存の戦争・講和・攻勢ルールだけを使う。
function ensureHistoricalWars(api, snapshot, playerId, declared) {
  const date = calendarOf(snapshot);
  const atOrAfter = (year, month) => date.year > year || (date.year === year && date.month >= month);
  const plans = {
    japan: [{ target: 'china', year: 1937, month: 7, reason: '華北の権益と治安をめぐる紛争' }],
    germany: [
      { target: 'poland', year: 1939, month: 9, reason: 'ポーランド回廊と東方生存圏をめぐる紛争' },
      { target: 'france', year: 1940, month: 5, reason: '西欧の支配をめぐる攻勢' },
      { target: 'belgium', year: 1940, month: 5, reason: 'ベネルクス通過をめぐる侵攻' },
      { target: 'netherlands', year: 1940, month: 5, reason: '低地諸国への侵攻' },
      { target: 'russia', year: 1941, month: 6, reason: '東方生存圏をめぐる独ソ戦' }
    ],
    china: [{ target: 'japan', year: 1937, month: 7, reason: '華北への侵攻に対する抗戦' }],
    uk: [
      { target: 'germany', year: 1939, month: 9, reason: 'ポーランド保障義務の履行' },
      { target: 'italy', year: 1940, month: 6, reason: '地中海・東アフリカの戦線維持' }
    ],
    russia: [{ target: 'germany', year: 1941, month: 6, reason: '独ソ戦への参戦と東方防衛' }],
    usa: [{ target: 'japan', year: 1941, month: 12, reason: '太平洋の秩序回復と真珠湾への対応' }]
  };
  const result = [];
  for (const plan of plans[playerId] || []) {
    const key = `${playerId}:${plan.target}`;
    if (declared.has(key)) continue;
    if (!atOrAfter(plan.year, plan.month)) continue;
    const target = snapshot.nations?.[plan.target];
    if (!target || target.dissolved) continue;
    if (activeWarBetweenSnapshot(snapshot, playerId, plan.target)) {
      declared.add(key);
      continue;
    }
    if (api.declareWar(plan.target, plan.reason)) {
      declared.add(key);
      result.push({ target: plan.target, date: dateLabel(Math.max(0, snapshot.completedTurns)), reason: plan.reason });
    }
  }
  return result;
}

function issueOffensiveOrders(api, snapshot, playerId, landRegions = []) {
  const wars = activeWarsFor(snapshot, playerId);
  const formations = (snapshot.formations || []).filter(formation => formation.nationId === playerId && formation.type === 'field');
  if (!wars.length) {
    for (const formation of formations) {
      if (formation.order?.kind === 'offensive') api.setFormationOrder(formation.id, { kind: 'defend' });
    }
    return 0;
  }
  const enemyIds = [...new Set(wars.map(war => war.attacker === playerId ? war.defender : war.attacker))]
    .filter(enemyId => snapshot.nations?.[enemyId] && !snapshot.nations[enemyId].dissolved);
  let issued = 0;
  for (const formation of formations) {
    const targets = api.formationTargets(formation.id);
    if (!targets.length) {
      // 海を隔てた戦線でも、敵本土への進軍方向を攻勢目標として保持する。
      // 隣接する敵陸州ができるまでは前進しない（既存の隣接1州ルール）。
      const distant = enemyIds.map(enemyId => ({
        enemyId,
        region: landRegions.find(region => (snapshot.territories?.[region.id] || region.country) === enemyId)
      })).find(item => item.region);
      if (distant) {
        if (formation.order?.kind === 'offensive') continue;
        if (api.setFormationOrder(formation.id, {
          kind: 'offensive', targetRegionId: distant.region.id, targetNationId: distant.enemyId
        })) issued++;
      } else if (formation.order?.kind === 'offensive') {
        api.setFormationOrder(formation.id, { kind: 'defend' });
      }
      continue;
    }
    if (formation.order?.kind === 'offensive' && targets.some(target => target.regionId === formation.order.targetRegionId)) continue;
    const target = targets[0];
    if (api.setFormationOrder(formation.id, {
      kind: 'offensive', targetRegionId: target.regionId, targetNationId: target.nationId
    })) issued++;
  }
  return issued;
}

function settleAdvantageousWars(api, snapshot, playerId) {
  const settlements = [];
  for (const war of activeWarsFor(snapshot, playerId)) {
    const summary = api.peaceConferenceSummary(war.warId);
    if (!summary) continue;
    const duration = Math.max(0, snapshot.completedTurns - (Number(war.startedTurn) || 0));
    // 自国領の紛争が長引くと6か月で敗北するため、危機の手前で停戦を選ぶ。
    const defensiveEmergency = Object.values(snapshot.conflicts || {})
      .some(conflict => conflict.defender === playerId && (Number(conflict.months) || 0) >= 8);
    const readyByScore = summary.available >= 18 && duration >= 8;
    const readyByAttrition = duration >= 80;
    if (!readyByScore && !readyByAttrition && !defensiveEmergency) continue;
    const demands = (summary.demands || []).filter(demand => demand.type !== 'vassalize');
    let cost = 0;
    const chosen = [];
    if (readyByScore) {
      for (const demand of demands.filter(item => item.type === 'hold').sort((a, b) => b.cost - a.cost)) {
        if (chosen.length >= 2 || cost + demand.cost > summary.available) continue;
        chosen.push(demand.id);
        cost += demand.cost;
      }
    }
    if (!chosen.length && demands.some(demand => demand.id === 'white')) chosen.push('white');
    if (!chosen.length) continue;
    const result = api.confirmPeaceConference(war.warId, chosen);
    if (result?.ok) {
      settlements.push({
        warId: war.warId,
        enemy: summary.enemyId,
        date: dateLabel(Math.max(0, snapshot.completedTurns)),
        available: summary.available,
        cost: result.cost,
        demands: result.demands
      });
    }
  }
  return settlements;
}

function expansionSnapshot(snapshot, landRegions, baseOwner) {
  const current = ownerCounts(snapshot, landRegions, baseOwner);
  return { current, top: topOwners(current.counts, 5) };
}

async function runNation(api, nationId, options, context) {
  const totalHalves = options.totalHalves;
  const runStarted = Date.now();
  const failures = [];
  const softLocks = [];
  const succession = [];
  const actionSamples = [];
  const peaceSettlements = [];
  const checkpoints = [];
  const anomalies = [];
  const invariantFailures = [];
  const ownerHistory = [];
  let previousOwners = null;
  let previousPlayer = null;
  let issuedOrders = 0;
  let actionCount = 0;
  let focusSelections = 0;
  let researchSelections = 0;
  let mobilizationChanges = 0;
  let productionChanges = 0;
  let completed = 0;
  let peakOwner = { nationId: null, landStates: 0 };
  let lastSaveReadable = false;
  const declaredWars = new Set();
  const warDeclarations = [];

  context.lastOwners = null;
  const started = await api.start({ nationId, difficulty: 'story', mandate: 'recovery', maxTurns: 0, replace: true });
  if (!started) throw new Error(`${nationId}: キャンペーン開始に失敗`);
  const startSnapshot = api.snapshot();
  const startOwners = ownerMap(startSnapshot, context.landRegions);
  const startSuzerain = Object.fromEntries(Object.entries(startSnapshot.nations || {}).map(([id, nation]) => [id, nation.suzerain || null]));
  if (startSnapshot.playerNationId !== nationId) failures.push(`${nationId}: 開始時のプレイヤー国が ${startSnapshot.playerNationId}`);

  for (let index = 0; index < totalHalves; index++) {
    let snapshot = api.snapshot();
    if (!snapshot) {
      softLocks.push({ half: index, reason: 'スナップショットを取得できない' });
      break;
    }
    if (snapshot.phase === 'milestone') {
      if (snapshot.completedTurns >= totalHalves) break;
      const continued = await api.continuePastMilestone();
      if (!continued) {
        softLocks.push({ half: snapshot.completedTurns, reason: '節目ダイアログから継続できない' });
        break;
      }
      snapshot = api.snapshot();
    }
    if (snapshot.phase === 'ended') {
      failures.push(`${nationId}: 1972年以前に終了 (${snapshot.ending?.title || snapshot.ending?.result || '不明'} at ${dateLabel(Math.max(0, snapshot.completedTurns))})`);
      break;
    }
    if (snapshot.phase !== 'playing') {
      softLocks.push({ half: snapshot.completedTurns, reason: `phase=${snapshot.phase} のまま進まない` });
      break;
    }
    const playerId = snapshot.playerNationId;
    if (previousPlayer && previousPlayer !== playerId) {
      succession.push({ turn: snapshot.completedTurns, date: dateLabel(Math.max(0, snapshot.completedTurns)), from: previousPlayer, to: playerId });
    }
    previousPlayer = playerId;
    warDeclarations.push(...ensureHistoricalWars(api, snapshot, playerId, declaredWars));
    const civilWar = snapshot.civilWars?.[playerId];
    if (civilWar?.status === 'active' && (Number(civilWar.halves) || 0) >= 8) {
      // 内戦の長期化で国家が崩壊しないよう、政府側は支配州の返還で収束を選ぶ。
      api.settleCivilWar(playerId, 'return');
    }
    snapshot = api.snapshot();
    const warList = activeWarsFor(snapshot, playerId);
    const atWar = warList.length > 0;

    const focus = chooseFocus(api, snapshot, atWar);
    if (focus && !api.focusSummary()?.current) {
      const result = api.selectFocus(focus.id);
      if (result?.ok) focusSelections++;
    }
    const research = chooseResearch(api, atWar);
    if (research) {
      const result = api.selectResearch(research.id);
      if (result?.ok) researchSelections++;
    }

    const economy = api.economySummary();
    if (economy) {
      const targetMobilization = atWar ? 2 : 1;
      if (economy.mobilization !== targetMobilization) {
        if (api.setMobilization(targetMobilization)) mobilizationChanges++;
      }
      const targetShare = atWar ? 65 : 45;
      if (economy.militaryShare !== targetShare && snapshot.completedTurns % 20 === 0) {
        if (api.setProductionSplit(targetShare)) productionChanges++;
      }
      if (atWar && snapshot.completedTurns % 160 === 0 && economy.formations < 10
        && economy.manpower >= 30 && economy.equipment >= 20) {
        api.recruitFormation();
      }
    }

    const text = actionText(snapshot, playerId, warList, focus, research);
    if (api.submitAction(text)) {
      actionCount++;
      if (actionSamples.length < 6) actionSamples.push({ date: dateLabel(Math.max(0, snapshot.completedTurns)), text });
    }

    issuedOrders += issueOffensiveOrders(api, snapshot, playerId, context.landRegions);
    peaceSettlements.push(...settleAdvantageousWars(api, snapshot, playerId));

    const beforeTurns = snapshot.completedTurns;
    const ok = await api.finishTurn();
    const after = api.snapshot();
    if (!ok || !after) {
      softLocks.push({ half: beforeTurns, reason: 'finishTurn が false を返した' });
      break;
    }
    if (after.completedTurns !== beforeTurns + 1) {
      softLocks.push({ half: beforeTurns, reason: `ターンが進まない (${beforeTurns}→${after.completedTurns})` });
      break;
    }
    completed = after.completedTurns;
    invariantFailures.push(...checkInvariants(after, `${nationId}@${completed}`));

    const saveText = context.storage.get(SAVE_KEY) || '';
    if (completed % 120 === 0 || completed === totalHalves) {
      try {
        const parsed = JSON.parse(saveText);
        lastSaveReadable = parsed?.saveFormat === 6 && parsed?.halfMonth === true && parsed?.completedTurns === completed;
      } catch {
        lastSaveReadable = false;
      }
      if (!lastSaveReadable) failures.push(`${nationId}: ${dateLabel(completed - 1)} のセーブを読み直せない`);
    }

    const expansion = expansionSnapshot(after, context.landRegions, context.baseOwner);
    previousOwners = expansion.current.owners;
    ownerHistory.push(expansion.current.counts);
    for (const item of expansion.top) if (item.landStates > peakOwner.landStates) peakOwner = { ...item };
    if (peakOwner.landStates > context.expansionThreshold) {
      failures.push(`${nationId}: 異常膨張 ${peakOwner.nationId} ${peakOwner.landStates}州 > ${context.expansionThreshold}`);
      break;
    }

    if (previousOwners) {
      const changed = [];
      for (const region of context.landRegions) {
        const previousOwner = context.lastOwners?.get(region.id);
        const owner = previousOwners.get(region.id);
        if (previousOwner && previousOwner !== owner) changed.push({ regionId: region.id, from: previousOwner, to: owner });
      }
      const older = ownerHistory[Math.max(0, ownerHistory.length - 25)];
      if (older) {
        for (const [ownerId, count] of expansion.current.counts) {
          const gain = count - (older.get(ownerId) || 0);
          if (gain >= 180) anomalies.push({ half: completed, type: 'rapid-land-absorption', nationId: ownerId, gain, landStates: count });
        }
      }
    }
    context.lastOwners = previousOwners;

    if (completed % 120 === 0 || completed === totalHalves) {
      checkpoints.push({
        half: completed,
        date: dateLabel(Math.max(0, completed - 1)),
        topOwners: expansion.top,
        activeWars: warStats(after).activeWars,
        totalWars: warStats(after).totalWars,
        territoryChanges: changedTerritoryCount(after, context.landRegions, startOwners),
        saveBytes: Buffer.byteLength(saveText, 'utf8'),
        saveReadable: lastSaveReadable
      });
    }

    if (after.phase === 'milestone' && completed >= totalHalves) break;
    if (after.phase !== 'playing' && after.phase !== 'milestone') {
      failures.push(`${nationId}: ${dateLabel(Math.max(0, completed - 1))} に phase=${after.phase} (${after.ending?.title || ''})`);
      break;
    }
  }

  const finalSnapshot = api.snapshot();
  const finalExpansion = finalSnapshot ? expansionSnapshot(finalSnapshot, context.landRegions, context.baseOwner) : { top: [] };
  const postwar = finalSnapshot ? postwarReport(finalSnapshot, context.landRegions, startOwners, startSuzerain) : null;
  const finalWars = finalSnapshot ? warStats(finalSnapshot) : { activeWars: 0, totalWars: 0, activeWarList: [] };
  const finalArcs = finalSnapshot ? worldArcReport(finalSnapshot) : { fired: [], states: {}, total: 0 };
  const focusCompleted = finalSnapshot?.nationalFocus?.[finalSnapshot.playerNationId]?.completed?.length || 0;
  const researchCompleted = finalSnapshot?.research?.[finalSnapshot.playerNationId]?.completed?.length || 0;
  const run = {
    nationId,
    playerNationId: finalSnapshot?.playerNationId || nationId,
    succession,
    targetHalves: totalHalves,
    completedHalves: completed,
    reachedTarget: completed >= totalHalves,
    startDate: dateLabel(0),
    lastCompletedDate: dateLabel(Math.max(0, completed - 1)),
    finalPhase: finalSnapshot?.phase || null,
    finalEnding: finalSnapshot?.ending || null,
    elapsedMs: Date.now() - runStarted,
    avgTurnMs: Math.round((Date.now() - runStarted) / Math.max(1, completed)),
    finalSaveBytes: Buffer.byteLength(context.storage.get(SAVE_KEY) || '', 'utf8'),
    saveReadable: lastSaveReadable,
    finalTopOwners: finalExpansion.top,
    peakOwner,
    expansionThreshold: context.expansionThreshold,
    activeWars: finalWars.activeWars,
    totalWars: finalWars.totalWars,
    activeWarList: finalWars.activeWarList,
    territoryChanges: finalSnapshot ? changedTerritoryCount(finalSnapshot, context.landRegions, startOwners) : 0,
    worldArcs: finalArcs.fired,
    independence: finalSnapshot ? independenceReport(finalSnapshot) : { count: 0, ids: [] },
    focusCompleted,
    researchCompleted,
    actions: { nationalActions: actionCount, focusSelections, researchSelections, mobilizationChanges, productionChanges, offensiveOrders: issuedOrders, peaceSettlements: peaceSettlements.length },
    actionSamples,
    warDeclarations,
    peaceSettlements,
    checkpoints,
    postwar,
    anomalies,
    invariantFailures,
    softLocks,
    failures
  };
  return run;
}

async function verifyVictoryPath(api) {
  const started = await api.start({ nationId: 'japan', difficulty: 'story', mandate: 'recovery', maxTurns: 24, replace: true });
  if (!started) return { ok: false, reason: '開始できない' };
  let snapshot = safeJson(api.snapshot());
  snapshot.completedTurns = 23;
  snapshot.maxTurns = 24;
  snapshot.phase = 'playing';
  snapshot.nations.japan.eco = 92;
  snapshot.nations.japan.stb = 92;
  snapshot.treasury = 80;
  snapshot.tension = 35;
  snapshot.stress = { collapse: 0, bankruptcy: 0, war: 0 };
  if (!(await api.restore(snapshot))) return { ok: false, reason: '勝利経路の復元に失敗' };
  const finished = await api.finishTurn();
  const after = api.snapshot();
  return {
    ok: Boolean(finished && after?.ending?.result === 'victory'),
    result: after?.ending?.result || null,
    title: after?.ending?.title || '',
    date: dateLabel(Math.max(0, (after?.completedTurns || 1) - 1)),
    conditions: after ? api.snapshot().nations.japan : null
  };
}

async function verifyDefeatPath(api) {
  const started = await api.start({ nationId: 'germany', difficulty: 'story', mandate: 'recovery', maxTurns: 0, replace: true });
  if (!started) return { ok: false, reason: '開始できない' };
  let after = api.snapshot();
  const track = [];
  for (let index = 0; index < 8; index++) {
    const snapshot = safeJson(api.snapshot());
    snapshot.phase = 'playing';
    snapshot.nations.germany.eco = 0;
    snapshot.nations.germany.stb = 0;
    snapshot.stress = snapshot.stress || { collapse: 0, bankruptcy: 0, war: 0 };
    if (!(await api.restore(snapshot))) return { ok: false, reason: '危機状態の復元に失敗' };
    const finished = await api.finishTurn();
    after = api.snapshot();
    track.push({
      half: after?.completedTurns,
      stress: after?.stress?.collapse,
      result: after?.ending?.result || null
    });
    if (!finished) return { ok: false, reason: '危機ターンが進まない', track };
    if (after?.ending?.result === 'defeat') break;
  }
  return {
    ok: after?.ending?.result === 'defeat',
    result: after?.ending?.result || null,
    title: after?.ending?.title || '',
    method: '経済と安定度の危機を6半月連続（短い負け経路）',
    track
  };
}

function checkPostwar(run) {
  const postwar = run.postwar;
  if (!postwar) return { applicable: false, reason: '戦後データなし', ok: false };
  const europeOutcome = postwar.settlement?.europe?.outcome;
  const pacificOutcome = postwar.settlement?.pacific?.outcome;
  const checks = [];
  const add = (id, label, ok, detail) => checks.push({ id, label, ok: Boolean(ok), detail });
  if (pacificOutcome !== 'axis_victory') {
    add('taiwan', '台湾は china', postwar.japan.taiwanHolder === 'china', postwar.japan.taiwanHolder);
    const korea = postwar.japan.koreaSplit;
    add('korea-split', '朝鮮南北が陸州を持つ', korea.southExists && korea.northExists && korea.bothHoldLand,
      `${korea.southHolder}/${korea.northHolder}`);
    add('korea-not-whole-communist', '半島全体が korea_communist でない', !korea.wholePeninsulaCommunist, '');
  } else {
    add('pacific-axis-victory', '太平洋は枢軸勝利のため朝鮮・台湾の敗戦処理は対象外', true, pacificOutcome);
  }
  if (europeOutcome !== 'axis_victory') {
    add('libya', 'リビア独立', postwar.italy.libyaIndependent, postwar.italy.libyaHolder);
    add('somalia', 'ソマリア独立', postwar.italy.somaliaIndependent, postwar.italy.somaliaHolder);
    add('somaliland', 'ソマリアがソマリランドを保有', postwar.italy.somaliaHoldsSomaliland, postwar.italy.somalilandHolder);
    add('eritrea', 'エリトリアはエチオピア保有', postwar.italy.eritreaEthiopian, postwar.italy.eritreaHolder);
    add('germany-split', 'ドイツが東西に分かれる', postwar.germany.west.landStates > 0 && postwar.germany.east.landStates > 0,
      `西${postwar.germany.west.landStates}/東${postwar.germany.east.landStates}`);
  } else {
    add('europe-axis-victory', '欧州は枢軸勝利のため植民地再割当・ドイツ分割は対象外', true, europeOutcome);
  }
  return { applicable: true, ok: checks.every(check => check.ok), checks, europeOutcome, pacificOutcome };
}

export async function runM8cPlaythrough(options = {}) {
  const totalHalves = Math.max(1, Number(options.totalHalves) || TOTAL_HALVES);
  const nations = Array.isArray(options.nations) && options.nations.length ? options.nations : NATIONS;
  const reportPath = options.reportPath || DEFAULT_REPORT;
  const log = options.log || console.log;
  const { server, endpoint } = await startMockServer({
    evaluation: payload => {
      const context = payload?.context || {};
      const national = context.nationalAction;
      const actionResults = national ? [{
        actionId: national.id,
        text: '国策・研究・生産・前線の調整を閣議で確認し、実行段階へ移した。',
        outcome: 'partial',
        effects: { mil: 0, eco: 0, stb: 0, treasury: 0, prestige: 0, tension: 0 },
        evidence: [national.id],
        relations: []
      }] : [];
      return {
        headline: '半月の推移', article: '各国は国策と前線を調整し、世界は静かに動いた。',
        delta: { mil: 0, eco: 0, stb: 0, treasury: 0, prestige: 0, tension: 0 },
        reasoning: [{ text: '提出された国家行動と世界情勢を踏まえたモック裁定。', sourceActionIds: national ? [national.id] : [] }],
        developments: [{ headline: '国際', body: '各国の財政と外交が続く。' }, { headline: '地域', body: '目立った変化はない。' }],
        groups: [], relations: [], otherNations: [], actorUpdates: [], treaties: [], commitments: [],
        territoryChanges: [], clientChanges: [], leadershipChanges: [], npcEvents: [], conflictChanges: [],
        actionResults, memory: '継続'
      };
    }
  });
  const startedAt = Date.now();
  const runs = [];
  const failures = [];
  let context = null;
  try {
    const loaded = await loadGame(endpoint);
    const api = loaded.api;
    const allRegions = vm.runInContext('ORBIS_STATES_DB', loaded.context);
    const landRegions = allRegions.filter(region => !region.isSea && !region.isSeaZone && region.type !== 'sea');
    context = {
      api,
      storage: loaded.storage,
      landRegions,
      baseOwner: new Map(landRegions.map(region => [region.id, region.country])),
      expansionThreshold: EXPANSION_THRESHOLD,
      lastOwners: null
    };
    for (const nationId of nations) {
      try {
        const run = await runNation(api, nationId, { totalHalves }, context);
        runs.push(run);
        failures.push(...run.failures.map(message => `${nationId}: ${message}`));
        if (!run.reachedTarget) failures.push(`${nationId}: ${run.completedHalves}/${totalHalves} 半月で完走していない`);
        if (run.softLocks.length) failures.push(`${nationId}: ソフトロック ${run.softLocks.length}件`);
        if (run.invariantFailures.length) failures.push(`${nationId}: 数値異常 ${run.invariantFailures.length}件`);
        if (run.anomalies.length) failures.push(`${nationId}: 領土異常 ${run.anomalies.length}件`);
        log(`[M8c ${nationId}] ${run.completedHalves}/${totalHalves} ${run.lastCompletedDate} 完了 継承 ${run.succession.map(item => `${item.from}->${item.to}`).join(',') || 'なし'} 最大保有 ${run.peakOwner.nationId || '-'} ${run.peakOwner.landStates}州 国策 ${run.focusCompleted} 研究 ${run.researchCompleted} 講和 ${run.peaceSettlements.length} 平均 ${run.avgTurnMs}ms`);
      } catch (error) {
        failures.push(`${nationId}: ${error?.stack || error?.message || String(error)}`);
      }
    }

    const victoryPath = await verifyVictoryPath(api);
    if (!victoryPath.ok) failures.push(`勝利経路を確認できない: ${JSON.stringify(victoryPath)}`);
    const defeatPath = await verifyDefeatPath(api);
    if (!defeatPath.ok) failures.push(`負け経路を確認できない: ${JSON.stringify(defeatPath)}`);
    const postwarRequired = totalHalves >= 900;
    const postwarChecks = Object.fromEntries(runs.map(run => [run.nationId, postwarRequired
      ? checkPostwar(run)
      : { applicable: false, ok: true, reason: '短縮スモークのため戦後確認は対象外' }]));
    const allPostwarOk = Object.values(postwarChecks).every(check => check.ok);
    if (postwarRequired && !allPostwarOk) failures.push('M8a/M8b の戦後確認に失敗がある');

    const report = {
      generatedAt: new Date().toISOString(),
      mode: 'mock-http',
      scripted: true,
      liveProviderCredentialsUsed: false,
      totalHalves,
      startedNations: nations,
      thresholds: {
        expansionLandStates: EXPANSION_THRESHOLD,
        softLocksAllowed: 0,
        saveReadableEveryHalves: 120
      },
      totals: {
        elapsedMs: Date.now() - startedAt,
        turns: runs.reduce((sum, run) => sum + run.completedHalves, 0),
        avgTurnMs: Math.round((Date.now() - startedAt) / Math.max(1, runs.reduce((sum, run) => sum + run.completedHalves, 0))),
        failures
      },
      victoryPath,
      defeatPath,
      postwarChecks,
      summary: runs.map(run => ({
        nationId: run.nationId,
        playerNationId: run.playerNationId,
        succession: run.succession,
        completedHalves: run.completedHalves,
        reachedTarget: run.reachedTarget,
        lastCompletedDate: run.lastCompletedDate,
        avgTurnMs: run.avgTurnMs,
        finalSaveBytes: run.finalSaveBytes,
        saveReadable: run.saveReadable,
        maxLandStates: run.peakOwner.landStates,
        maxLandOwner: run.peakOwner.nationId,
        totalWars: run.totalWars,
        activeWars: run.activeWars,
        territoryChanges: run.territoryChanges,
        focusCompleted: run.focusCompleted,
        researchCompleted: run.researchCompleted,
        actions: run.actions,
        warDeclarations: run.warDeclarations,
        softLocks: run.softLocks.length,
        anomalies: run.anomalies.length,
        invariantFailures: run.invariantFailures.length,
        postwar: postwarChecks[run.nationId],
        worldArcs: run.worldArcs.map(entry => ({ id: entry.id, date: entry.date, summary: entry.summary }))
      })),
      runs
    };
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    log(`レポート: ${reportPath}`);
    if (failures.length) {
      const message = `M8c playthrough failed: failures=${failures.length}`;
      if (options.throwOnFailure !== false) throw new Error(message);
      return { ...report, ok: false };
    }
    return { ...report, ok: true };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href) {
  try {
    const report = await runM8cPlaythrough();
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  }
}
