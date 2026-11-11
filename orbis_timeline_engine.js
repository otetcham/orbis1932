'use strict';
/** Scripted events from WORLD_EVENT_DB (1932–1972), half-month schedule + depends_on / prevent rules. */
window.ORBIS_TIMELINE = (() => {
  const anchors = () => (globalThis.ORBIS_MAP_META?.countryAnchors || {});

  function parseSchedule(event) {
    const d = String(event.date || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const [y, m, day] = d.split('-').map(Number);
      return { year: y, month: m, half: day <= 15 ? 'first' : 'second' };
    }
    if (/^\d{4}-\d{2}$/.test(d)) {
      const [y, m] = d.split('-').map(Number);
      return { year: y, month: m, half: 'first' };
    }
    if (/^\d{4}$/.test(d) && event.year) {
      return { year: event.year, month: 6, half: 'first' };
    }
    if (event.year) return { year: event.year, month: 6, half: 'first' };
    return null;
  }

  function resolveLonLat(event) {
    const region = String(event.region || '');
    const nation = region.split('/')[0]?.trim();
    const nationMap = {
      日本: 'japan', 中国: 'china', 米国: 'usa', アメリカ: 'usa', ドイツ: 'germany', ソ連: 'russia',
      イギリス: 'uk', 英国: 'uk', フランス: 'france', イタリア: 'italy',
    };
    const id = Object.entries(nationMap).find(([jp]) => region.includes(jp))?.[1];
    const a = id && anchors()[id];
    if (a) return { lon: a.lon, lat: a.lat };
    return { lon: 0, lat: 20 };
  }

  function currentHalf(game) {
    const core = globalThis.ORBIS_CAMPAIGN;
    if (!core) return null;
    return core.calendarFromHalfTurn(game.completedTurns);
  }

  function matchesTurn(game, sched) {
    const cur = currentHalf(game);
    if (!cur || !sched) return false;
    return cur.year === sched.year && cur.month === sched.month && cur.half === sched.half;
  }

  function dependenciesMet(game, event) {
    const deps = event.depends_on;
    if (!Array.isArray(deps) || !deps.length) return true;
    const fired = game.timelineFired || {};
    return deps.every(id => fired[id]);
  }

  function playerBlocked(game, event) {
    const facts = game.establishedFacts || [];
    const blob = facts.join(' ');
    if (event.id === '1933-japan_league_withdrawal' && /国際連盟.*(維持|留保)/.test(blob)) return true;
    if (event.id === '1937-marco_polo_bridge') {
      const rel = game.relations?.japan?.china ?? game.relations?.china?.japan;
      if (typeof rel === 'number' && rel > 15) return true;
    }
    if (event.causal_kind === 'contingent') {
      const deny = `${event.title}.*(見送|阻止|不发|不发生)`;
      if (facts.some(f => new RegExp(deny).test(f))) return true;
    }
    return false;
  }

  function dbEvents() {
    return (globalThis.WORLD_EVENT_DB || []).filter(ev => ev.importance >= 2 && parseSchedule(ev));
  }

  function shouldFire(game, event, sched) {
    if (game.timelineFired?.[event.id]) return false;
    if (!dependenciesMet(game, event)) return false;
    if (playerBlocked(game, event)) return false;
    return matchesTurn(game, sched);
  }

  function applyForTurn(game) {
    if (!game.timelineFired) game.timelineFired = {};
    const fired = [];
    const core = globalThis.ORBIS_CAMPAIGN;
    const dateLabel = core?.dateLabelFromHalf?.(game.completedTurns) || '';
    for (const ev of dbEvents()) {
      const sched = parseSchedule(ev);
      if (!shouldFire(game, ev, sched)) continue;
      game.timelineFired[ev.id] = game.completedTurns;
      const fact = `${ev.title}（${ev.date || ev.year}）`;
      game.establishedFacts = [...(game.establishedFacts || []), fact].slice(-400);
      const { lon, lat } = resolveLonLat(ev);
      fired.push({
        kind: 'timeline', id: ev.id, headline: ev.title, body: ev.summary.slice(0, 220),
        date: dateLabel, location: ev.region || '', lon, lat, importance: ev.importance,
      });
      if (ev.id === '1937-marco_polo_bridge') game.tension = Math.min(100, (game.tension || 40) + 6);
      if (ev.id === '1939-poland_invasion') game.tension = Math.min(100, (game.tension || 40) + 10);
    }
    return fired;
  }

  return Object.freeze({ applyForTurn, currentHalf, parseSchedule, dbEvents });
})();
