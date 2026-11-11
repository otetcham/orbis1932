'use strict';
/** Shared campaign calendar, caps, and save migration (1932-03 .. 1972-12, half-month turns). */
window.ORBIS_CAMPAIGN = (() => {
  const CALENDAR = { startYear: 1932, startMonth: 3, defaultEndYear: 1972, defaultEndMonth: 12 };
  const halfLabel = half => (half === 'first' ? '前半' : '後半');

  function calendarFromHalfTurn(halfTurnIndex) {
    const monthIndex = Math.floor(halfTurnIndex / 2);
    const half = halfTurnIndex % 2 === 0 ? 'first' : 'second';
    const m0 = CALENDAR.startMonth - 1 + monthIndex;
    return { year: CALENDAR.startYear + Math.floor(m0 / 12), month: (m0 % 12) + 1, half, halfTurnIndex };
  }

  function halfTurnsThrough(endYear, endMonth, endHalf = 'second') {
    const months = (endYear - CALENDAR.startYear) * 12 + (endMonth - CALENDAR.startMonth) + 1;
    if (!Number.isInteger(months) || months < 1) throw new Error('キャンペーン終了年月が範囲外です。');
    let halves = months * 2;
    if (endHalf === 'first') halves -= 1;
    return halves;
  }

  const MILESTONE_HALVES = halfTurnsThrough(CALENDAR.defaultEndYear, CALENDAR.defaultEndMonth);
  const UNLIMITED_MAX_TURNS = 0;
  const SAVE_TURN_CEILING = 2500;

  /** Per half-month ruling caps (~½ of former monthly limits). */
  const HALF_TURN_RULING_CAPS = {
    delta: { mil: 2, eco: 2, stb: 2, treasury: 5, prestige: 2, tension: 3 },
    actionEffect: { mil: 2, eco: 2, stb: 2, treasury: 5, prestige: 2, tension: 3 },
    combined: { mil: 3, eco: 3, stb: 3, treasury: 6, prestige: 2, tension: 4 },
    groupDeltaPerHalf: 2,
    halfTensionRiseCap: 4,
    halfTreasuryFallCap: 6,
    halfStbFallCap: 3,
    halfEcoFallCap: 3,
    stressHalvesRequired: 6,
  };

  function dateLabelFromHalf(halfTurnIndex) {
    const { year, month, half } = calendarFromHalfTurn(halfTurnIndex);
    return `${year}年${month}月（${halfLabel(half)}）`;
  }

  function migrateSavePayload(raw) {
    if (!raw || typeof raw !== 'object') return raw;
    const next = { ...raw };
    if (next.saveFormat === 6 && next.halfMonth === true) return next;
    next.saveFormat = 6;
    next.halfMonth = true;
    next.completedTurns = Math.min(SAVE_TURN_CEILING, (Number(next.completedTurns) || 0) * 2);
    if (Number(next.maxTurns) > 0) next.maxTurns = Math.min(SAVE_TURN_CEILING, next.maxTurns * 2);
    if (next.milestoneHalfTurns == null) next.milestoneHalfTurns = MILESTONE_HALVES;
    if (next.continuePastMilestone == null) next.continuePastMilestone = false;
    next.version = Math.max(5, Number(next.version) || 4);
    return next;
  }

  return Object.freeze({
    CALENDAR, MILESTONE_HALVES, UNLIMITED_MAX_TURNS, SAVE_TURN_CEILING, HALF_TURN_RULING_CAPS,
    calendarFromHalfTurn, halfTurnsThrough, dateLabelFromHalf, migrateSavePayload, halfLabel,
  });
})();
