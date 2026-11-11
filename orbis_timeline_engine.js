'use strict';
/** Scripted historical events 1932–1972 with simple prevent/branch conditions. */
window.ORBIS_TIMELINE = (() => {
  const events = [
    { id: 'tl_manchukuo_recognition', year: 1932, month: 9, half: 'second', nations: ['japan'], title: '日本、満洲国を承認', body: '政府は満洲国承認と日満議定書調印を発表した。', fact: '日本は満洲国を公式承認した', unless: game => game.nations.japan?.relations?.usa < -80 && false },
    { id: 'tl_league_withdrawal', year: 1933, month: 3, half: 'second', nations: ['japan'], title: '日本、国際連盟脱退', body: '国際連盟脱退が通告された。', fact: '日本は国際連盟を脱退した', preventIf: game => (game.establishedFacts || []).some(f => /連盟.*維持|留守.*外交/.test(f)) },
    { id: 'tl_hitler_chancellor', year: 1933, month: 1, half: 'second', nations: ['germany'], title: 'ヒトラー首相就任', body: 'ドイツでナチス政権が成立した。', fact: 'ヒトラーがドイツ首相となった' },
    { id: 'tl_marco_polo', year: 1937, month: 7, half: 'first', nations: ['japan', 'china'], title: '盧溝橋事件', body: '北支で武力衝突が拡大し、日中戦争の火ぶたが外れた。', fact: '盧溝橋事件から日中戦争が始まった', preventIf: game => game.relations?.japan?.china > 20 },
    { id: 'tl_ww2_europe', year: 1939, month: 9, half: 'first', nations: ['germany', 'uk', 'france'], title: 'ポーランド侵攻と対独宣戦', body: '欧州で大規模戦争が始まった。', fact: '第二次世界大戦が欧州で始まった' },
    { id: 'tl_pearl_harbor', year: 1941, month: 12, half: 'first', nations: ['japan', 'usa'], title: '太平洋戦争開戦', body: '日米戦争が始まった。', fact: '日本と米国が戦争状態に入った' },
    { id: 'tl_1945_end', year: 1945, month: 8, half: 'second', nations: ['japan'], title: '終戦', body: '大戦が終結し、占領と改革の時代へ向かった。', fact: '日本は第二次世界大戦で敗北した' },
    { id: 'tl_1960s_detente', year: 1968, month: 8, half: 'first', nations: ['usa', 'russia'], title: 'クレムリン外の緊張緩和', body: '東西の仲裁交渉が続いた。', fact: '冷戦下で部分的新張緩和が進んだ' },
  ];

  function currentHalf(game) {
    const core = globalThis.ORBIS_CAMPAIGN;
    if (!core) return null;
    return core.calendarFromHalfTurn(game.completedTurns);
  }

  function matchesTurn(game, ev) {
    const cur = currentHalf(game);
    if (!cur) return false;
    return cur.year === ev.year && cur.month === ev.month && cur.half === ev.half;
  }

  function shouldFire(game, ev) {
    if (game.timelineFired?.[ev.id]) return false;
    if (typeof ev.preventIf === 'function' && ev.preventIf(game)) return false;
    if (typeof ev.unless === 'function' && ev.unless(game)) return false;
    return matchesTurn(game, ev);
  }

  function applyForTurn(game) {
    if (!game.timelineFired) game.timelineFired = {};
    const fired = [];
    for (const ev of events) {
      if (!shouldFire(game, ev)) continue;
      game.timelineFired[ev.id] = game.completedTurns;
      if (ev.fact) game.establishedFacts = [...(game.establishedFacts || []), ev.fact].slice(-400);
      fired.push({
        kind: 'timeline', id: ev.id, headline: ev.title, body: ev.body, date: globalThis.ORBIS_CAMPAIGN?.dateLabelFromHalf?.(game.completedTurns) || '',
        lon: 139, lat: 35, nations: ev.nations || [],
      });
      if (ev.id === 'tl_marco_polo') game.tension = Math.min(100, (game.tension || 40) + 8);
    }
    return fired;
  }

  return Object.freeze({ events, applyForTurn, currentHalf });
})();
