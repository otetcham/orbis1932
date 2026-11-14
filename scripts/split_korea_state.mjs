#!/usr/bin/env node
/**
 * 既存の単一朝鮮州を北緯38度で南北に分割する一回限りの移行スクリプト。
 * data/raw の Natural Earth を再取得できない環境でも、現在の orbis_states.js の
 * リング形状をそのままクリップして 2 州を作る。生成物はコミット対象。
 */
import { readFile, writeFile } from 'node:fs/promises';
import intersect from '@turf/intersect';
import area from '@turf/area';
import { multiPolygon, polygon } from '@turf/helpers';
import polylabel from 'polylabel';

const PROJ_X = lon => (lon + 180) * (2000 / 360);
const PROJ_Y = lat => (90 - lat) * 9.32 + 60;
const r2 = value => Math.round(value * 100) / 100;
const PARALLEL = 38;

async function main() {
  const statesUrl = new URL('../orbis_states.js', import.meta.url);
  const metaUrl = new URL('../orbis_map_meta.js', import.meta.url);
  const migrationUrl = new URL('../data/state_id_migration.json', import.meta.url);
  const source = await readFile(statesUrl, 'utf8');
  const db = JSON.parse(source.replace(/^window\.ORBIS_STATES_DB\s*=\s*/, '').replace(/;\s*$/, ''));
  const index = db.findIndex(region => region.id === 'japan_empire_kor');
  if (index < 0) throw new Error('japan_empire_kor が見つかりません。');
  if (db.some(region => region.id === 'japan_empire_prk')) {
    console.log('すでに南北分割済みです。');
    return;
  }
  const base = db[index];
  const basePolys = base.rings.map(ring => polygon([ring]));
  const geometry = basePolys.length === 1 ? basePolys[0] : multiPolygon(basePolys.map(item => item.geometry.coordinates));
  const southBox = polygon([[[120, 20], [132, 20], [132, PARALLEL], [120, PARALLEL], [120, 20]]]);
  const northBox = polygon([[[120, PARALLEL], [132, PARALLEL], [132, 46], [120, 46], [120, PARALLEL]]]);
  const southGeometry = intersect({ type: 'FeatureCollection', features: [geometry, southBox] });
  const northGeometry = intersect({ type: 'FeatureCollection', features: [geometry, northBox] });
  if (!southGeometry || !northGeometry) throw new Error('38度線でのクリップに失敗しました。');
  const southRings = cleanGeometry(southGeometry.geometry);
  const northRings = cleanGeometry(northGeometry.geometry);
  if (!southRings.length || !northRings.length) throw new Error('分割後のリングが空です。');

  const south = makeState(base, {
    id: 'japan_empire_kor',
    name: 'Korea (South)',
    nameJa: '朝鮮南部',
    rings: southRings,
    vp: 10
  });
  const north = makeState(base, {
    id: 'japan_empire_prk',
    name: 'Korea (North)',
    nameJa: '朝鮮北部',
    rings: northRings,
    vp: 8
  });
  db.splice(index, 1, south, north);
  await writeFile(statesUrl, `window.ORBIS_STATES_DB = ${JSON.stringify(db)};\n`);

  const metaSource = await readFile(metaUrl, 'utf8');
  const meta = JSON.parse(metaSource.replace(/^window\.ORBIS_MAP_META\s*=\s*/, '').replace(/;\s*$/, ''));
  meta.migration = meta.migration || {};
  meta.migration.japan_empire_kor = 'japan_empire_kor';
  meta.migration.japan_empire_prk = 'japan_empire_prk';
  meta.landRegions = Number(meta.landRegions || 0) + 1;
  meta.totalRegions = Number(meta.totalRegions || 0) + 1;
  meta.countryCounts = meta.countryCounts || {};
  meta.countryCounts.japan = Number(meta.countryCounts.japan || 0) + 1;
  meta.regionBuckets = meta.regionBuckets || {};
  const bucketKey = '東アジア・太平洋';
  meta.regionBuckets[bucketKey] = Number(meta.regionBuckets[bucketKey] || 0) + 1;
  await writeFile(metaUrl, `window.ORBIS_MAP_META = ${JSON.stringify(meta)};\n`);

  const migration = JSON.parse(await readFile(migrationUrl, 'utf8'));
  migration.japan_empire_kor = 'japan_empire_kor';
  migration.japan_empire_prk = 'japan_empire_prk';
  await writeFile(migrationUrl, `${JSON.stringify(migration, null, 2)}\n`);
  console.log(`朝鮮を南北に分割: south ${south.rings.length} rings / north ${north.rings.length} rings`);
}

function cleanGeometry(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const rings = [];
  for (const poly of polygons) {
    for (const ring of poly) {
      const normalized = normalizeRing(ring);
      if (normalized.length < 5) continue;
      const ringArea = Math.abs(area(polygon([normalized])));
      if (ringArea < 1e-4) continue;
      rings.push(normalized);
    }
  }
  return rings;
}

function normalizeRing(ring) {
  const points = [];
  for (const point of ring) {
    const next = [r2(point[0]), r2(point[1])];
    const previous = points[points.length - 1];
    if (!previous || previous[0] !== next[0] || previous[1] !== next[1]) points.push(next);
  }
  if (points.length && (points[0][0] !== points[points.length - 1][0] || points[0][1] !== points[points.length - 1][1])) points.push([...points[0]]);
  return points;
}

function makeState(base, { id, name, nameJa, rings, vp }) {
  const largest = largestRing(rings);
  let [lon, lat] = centerOf(largest);
  lon = r2(lon);
  lat = r2(lat);
  return {
    ...base,
    id,
    name,
    nameJa,
    vp,
    svgPath: ringsToSvg(rings),
    rings,
    lon,
    lat,
    cx: Math.round(PROJ_X(lon) * 10) / 10,
    cy: Math.round(PROJ_Y(lat) * 10) / 10
  };
}

function ringsToSvg(rings) {
  const parts = [];
  for (const ring of rings) {
    if (ring.length < 4) continue;
    parts.push(`M ${ring.map(([lon, lat]) => `${PROJ_X(lon).toFixed(1)} ${PROJ_Y(lat).toFixed(1)}`).join(' L ')} Z`);
  }
  return parts.join(' ');
}

function largestRing(rings) {
  return rings.reduce((best, ring) => {
    if (!best) return ring;
    return Math.abs(area(polygon([ring]))) > Math.abs(area(polygon([best]))) ? ring : best;
  }, null);
}

function centerOf(ring) {
  if (!ring?.length) return [0, 0];
  try {
    const point = polylabel([ring], 0.01);
    return [point[0], point[1]];
  } catch {
    const sum = ring.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0]);
    return [sum[0] / ring.length, sum[1] / ring.length];
  }
}

await main();
