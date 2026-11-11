import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

export function auditData(context) {
  const { nations, regions } = vm.runInContext('({ nations: SCENARIOS.era_1932.nations, regions: ORBIS_STATES_DB })', context);
  const ids = Object.keys(nations);
  assert.equal(new Set(ids.map(id => nations[id].code)).size, ids.length, '国コードの重複');
  assert.equal(new Set(regions.map(region => region.id)).size, regions.length, '州IDの重複');
  for (const region of regions.filter(region => !region.isSea && !region.isSeaZone && region.type !== 'sea')) {
    assert.ok(nations[region.country], `${region.id}: 未知の統治国 ${region.country}`);
    assert.ok(region.rings?.length, `${region.id}: 輪郭なし`);
  }
  for (const id of ids) {
    assert.equal(nations[id].id, id);
    assert.ok(regions.some(region => region.country === id && !region.isSea), `${id}: 領土なし`);
    assert.equal(nations[id].interestGroups.length, 4, `${id}: 利益集団`);
  }
  return { nations: ids.length, regions: regions.length };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const source = await readFile(new URL('./orbis_simulator.html', import.meta.url), 'utf8');
  const context = vm.createContext({ document: { addEventListener() {} } });
  context.window = context;
  for (const [, script] of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) if (script.trim()) vm.runInContext(script, context);
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
