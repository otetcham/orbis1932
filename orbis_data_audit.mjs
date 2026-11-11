import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

export function auditData(context) {
  const { nations, regions, crises, events, history } = vm.runInContext('({ nations: SCENARIOS.era_1932.nations, regions: ORBIS_STATES_DB, crises: SCENARIO_CRISES.era_1932, events: HISTORICAL_TIMELINE_EVENTS, history: WORLD_EVENT_DB })', context);
  const ids = Object.keys(nations);
  const land = regions.filter(region => !region.isSea && !region.isSeaZone && region.type !== 'sea');
  assert.equal(new Set(ids.map(id => nations[id].code)).size, ids.length, '国コードの重複');
  assert.equal(new Set(regions.map(region => region.id)).size, regions.length, '州IDの重複');
  const composites = ['central_europe', 'nordic', 'benelux', 'andes', 'romania', 'yugoslavia'].slice(0, 4);
  for (const composite of composites) assert.ok(!ids.includes(composite), `複合国家 ${composite} が残存`);
  for (const region of land) {
    assert.ok(nations[region.country], `${region.id}: 未知の統治国 ${region.country}`);
    assert.ok(region.rings?.length, `${region.id}: 輪郭なし`);
    assert.ok(region.svgPath?.length, `${region.id}: svgPathなし`);
  }
  for (const id of ids) {
    assert.equal(nations[id].id, id);
    assert.ok(regions.some(region => region.country === id && !region.isSea), `${id}: 領土なし`);
    assert.equal(nations[id].interestGroups.length, 4, `${id}: 利益集団`);
    assert.ok(nations[id].cabinet?.length, `${id}: 内閣なし`);
    assert.ok(nations[id].leader && nations[id].name && nations[id].bloc, `${id}: 基本欄欠損`);
  }
  for (const crisis of crises) assert.ok(regions.some(region => region.id === crisis.stateId), `${crisis.id}: 危機の州ID不整合`);
  for (const event of events) {
    assert.ok(Number.isInteger(event.year) && event.month >= 1 && event.month <= 12, `${event.id}: 歴史イベントにyear/monthなし`);
    assert.ok(typeof event.title === 'string' && event.title.length >= 4, `${event.id}: タイトル不足`);
    assert.ok(typeof event.desc === 'string' && event.desc.length >= 20, `${event.id}: 説明不足`);
    assert.equal(Object.keys(event).sort().join(','), 'desc,id,month,title,year', `${event.id}: 余分なフィールド`);
  }
  assert.equal(history.length, 272, '史実DBの件数');
  assert.equal(new Set(history.map(event => event.id)).size, history.length, '史実DBのID重複');
  const historyIds = new Set(history.map(event => event.id));
  for (const event of history) for (const dependency of event.depends_on || []) assert.ok(historyIds.has(dependency), `${event.id}: depends_on未解決 ${dependency}`);
  assert.equal(Math.min(...history.map(event => event.year)), 1932, '史実DBの開始年');
  assert.equal(Math.max(...history.map(event => event.year)), 1972, '史実DBの終了年');
  assert.equal(ids.length, 66, '国家数 (1932年・66カ国体制)');
  assert.equal(land.length, 165, '陸上州数');
  return { nations: ids.length, regions: regions.length, events: events.length, history: history.length };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const source = await readFile(new URL('./orbis_simulator.html', import.meta.url), 'utf8');
  const statesSource = await readFile(new URL('./orbis_states.js', import.meta.url), 'utf8');
  const context = vm.createContext({ document: { addEventListener() {} } });
  context.window = context;
  vm.runInContext(statesSource, context);
  for (const [, script] of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) if (script.trim()) vm.runInContext(script, context);
  vm.runInContext(await readFile(new URL('./orbis_events.js', import.meta.url), 'utf8'), context);
  if (process.argv.includes('--inspect')) {
    const regions = vm.runInContext('ORBIS_STATES_DB', context);
    for (const region of regions.filter(region => !region.isSea)) {
      const rings = (region.rings || []).map(ring => {
        const xs = ring.map(point => point[0]);
        const ys = ring.map(point => point[1]);
        return { vertices: ring.length, west: Math.min(...xs), east: Math.max(...xs), south: Math.min(...ys), north: Math.max(...ys) };
      });
      console.log(JSON.stringify({ id: region.id, name: region.nameJa, country: region.country, lon: region.lon, lat: region.lat, cx: region.cx, cy: region.cy, rings }));
    }
  } else console.log('史実データ監査:', auditData(context));
}
