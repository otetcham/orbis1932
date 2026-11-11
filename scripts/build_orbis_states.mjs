#!/usr/bin/env node
/**
 * Rebuild ORBIS_STATES_DB from Natural Earth admin-1 + aourednik world_1930 sovereignty.
 * Data stays in repo as generated orbis_states.js (+ orbis_map_meta.js).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import polylabel from 'polylabel';
import turfArea from '@turf/area';
import turfCentroid from '@turf/centroid';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import distance from '@turf/distance';
import { point, multiPolygon, polygon } from '@turf/helpers';

const MIN_AREA_M2 = 6e7;
const SMALL_ADM0 = new Set(['LUX', 'IRL', 'SGP', 'BRN', 'QAT', 'BHR', 'KWT', 'LIE', 'AND', 'MCO', 'SMR', 'MLT', 'CYM', 'JEY', 'GGY']);

const PROJ_X = lon => (lon + 180) * (2000 / 360);
const PROJ_Y = lat => (90 - lat) * 9.32 + 60;

const ISO_TO_ORBIS = {
  AFG: 'afghanistan', ALB: 'albania', ARG: 'argentina', AUS: 'australia', AUT: 'austria', BEL: 'belgium',
  BOL: 'bolivia', BRA: 'brazil', BGR: 'bulgaria', CAN: 'canada', CHL: 'chile', CHN: 'china', COL: 'colombia',
  CRI: 'costa_rica', CUB: 'cuba', CZE: 'czechoslovakia', DEU: 'germany', DNK: 'denmark', DOM: 'dominican',
  ECU: 'ecuador', EGY: 'egypt', SLV: 'el_salvador', EST: 'estonia', ETH: 'ethiopia', FIN: 'finland', FRA: 'france',
  GRC: 'greece', GTM: 'guatemala', HTI: 'haiti', HND: 'honduras', HUN: 'hungary', IRN: 'iran', ITA: 'italy',
  LVA: 'latvia', LTU: 'lithuania', LUX: 'luxembourg', MEX: 'mexico', MNG: 'mongolia', NLD: 'netherlands',
  NZL: 'new_zealand', NIC: 'nicaragua', NOR: 'norway', PAN: 'panama', PRY: 'paraguay', PER: 'peru', POL: 'poland',
  PRT: 'portugal', ROU: 'romania', RUS: 'russia', SAU: 'saudi_arabia', SVK: 'czechoslovakia', ZAF: 'south_africa',
  ESP: 'spain', SWE: 'sweden', CHE: 'switzerland', THA: 'siam', TUR: 'turkey', GBR: 'uk', USA: 'usa', URY: 'uruguay',
  VEN: 'venezuela', YUG: 'yugoslavia', IDN: 'dutch_indies', IND: 'india', JPN: 'japan', KOR: 'japan', TWN: 'japan',
  IRL: 'ireland', EGY: 'egypt',
};

const LEGACY_ID_HINTS = [
  ['jp_kanto', 'japan', /Tokyo|Kanagawa|Chiba|Saitama|Ibaraki|Tochigi|Gunma/],
  ['cn_beijing', 'china', /Beijing|Tianjin|Hebei/],
  ['cn_dongbei', 'manchukuo', /Liaoning|Jilin|Heilongjiang/],
  ['de_rhineland', 'germany', /Rhineland|Nordrhein|Rheinland/],
];

function slugify(text) {
  return String(text || 'region').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48);
}

function decimateRing(ring, maxPts = 96) {
  if (ring.length <= maxPts) return ring.map(([lon, lat]) => [Math.round(lon * 100) / 100, Math.round(lat * 100) / 100]);
  const step = Math.ceil(ring.length / maxPts);
  const out = [];
  for (let i = 0; i < ring.length; i += step) out.push([Math.round(ring[i][0] * 100) / 100, Math.round(ring[i][1] * 100) / 100]);
  if (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1]) out.push(out[0]);
  return out;
}

function ringsToSvg(rings) {
  const parts = [];
  for (const ring of rings) {
    if (ring.length < 3) continue;
    parts.push('M ' + ring.map(([lon, lat]) => `${PROJ_X(lon).toFixed(1)} ${PROJ_Y(lat).toFixed(1)}`).join(' L ') + ' Z');
  }
  return parts.join(' ');
}

function featureToRings(geom) {
  if (geom.type === 'Polygon') return geom.coordinates.map(ring => decimateRing(ring));
  if (geom.type === 'MultiPolygon') {
    const out = [];
    for (const poly of geom.coordinates) for (const ring of poly) out.push(decimateRing(ring));
    return out;
  }
  return [];
}

function ringsCentroid(rings) {
  let lon = 0; let lat = 0; let n = 0;
  for (const ring of rings) for (const [x, y] of ring) { lon += x; lat += y; n++; }
  return n ? [lon / n, lat / n] : [0, 0];
}

function polylabelLonLat(rings) {
  try {
    const polyRings = rings.map(ring => ring.map(([lon, lat]) => [lon, lat]));
    const p = polylabel(polyRings, 0.0001);
    return [p[0], p[1]];
  } catch {
    return ringsCentroid(rings);
  }
}

function inferTerrain(name, areaM2) {
  const n = String(name).toLowerCase();
  if (/tokyo|beijing|moscow|london|paris|berlin|delhi|shanghai|osaka|manhattan|district|capital|city/i.test(n)) return 'urban';
  if (areaM2 < 4e9) return 'coastal';
  if (/desert|sahara|gobi|arid/i.test(n)) return 'arid';
  if (/siberia|tundra|alaska|northwest territories|yukon/i.test(n)) return 'tundra';
  return 'plains';
}

function assignHistCountry(centroid, histFeatures, histMap) {
  const pt = point(centroid);
  for (const f of histFeatures) {
    try {
      if (booleanPointInPolygon(pt, f)) {
        const name = f.properties?.NAME;
        if (name && histMap[name]) return histMap[name];
        if (name && histMap[name.trim()]) return histMap[name.trim()];
      }
    } catch { /* skip invalid */ }
  }
  return null;
}

function legacyIdFor(country, nameEn) {
  for (const [id, c, re] of LEGACY_ID_HINTS) if (country === c && re.test(nameEn)) return id;
  return null;
}

function bucketMergeKey(country, adm0, props, nameEn, agg, lon, lat) {
  const region = props.region || '';
  let label = nameEn;
  const rename = agg.anachronismRename?.[country];
  if (rename && rename[nameEn]) label = rename[nameEn];
  if (country === 'canada') return slugify(label);
  if (country === 'ireland' && adm0 === 'IRL') {
    if (lon < -7.2 && lat > 53.8) return 'ulster';
    if (lon < -8.8) return 'connacht';
    if (lat < 52.35) return 'munster';
    return 'leinster';
  }
  if (country === 'uk' && adm0 === 'GBR') {
    const home = agg.ukHomeFromRegion?.[region] || agg.ukHomeFromRegion?.default || 'England';
    return slugify(home);
  }
  if (country === 'france' && adm0 === 'FRA') {
    const mapped = agg.franceMetroRegionRemap?.[region] || region || label;
    return slugify(mapped);
  }
  if ((agg.mergeByNeRegionAdm0 || []).includes(adm0) && region) return slugify(`${adm0}_${region}`);
  if ((agg.prefectureAdm0 || []).includes(adm0)) return slugify(props.iso_3166_2 || label);
  if (country === 'japan' && adm0 !== 'JPN') {
    return slugify(`empire_${adm0 || 'pacific'}_${Math.floor(lon / 12)}_${Math.floor(lat / 8)}`);
  }
  const isColonial = adm0 && ISO_TO_ORBIS[adm0] && ISO_TO_ORBIS[adm0] !== country;
  if (isColonial || (adm0 !== countryToAdm0(country) && country !== ISO_TO_ORBIS[adm0])) {
    const gw = agg.colonialGridDegrees?.lon || 18;
    const gh = agg.colonialGridDegrees?.lat || 12;
    return slugify(`col_${Math.floor(lon / gw)}_${Math.floor(lat / gh)}`);
  }
  return slugify(props.iso_3166_2 || props.postal || label);
}

function countryToAdm0(country) {
  const flip = Object.entries(ISO_TO_ORBIS).find(([, v]) => v === country);
  return flip?.[0] || null;
}

function bucketsToRegions(buckets, usedIds, agg, legacyIdFor) {
  const regions = [];
  const legacyUsed = new Set();
  for (const bucket of buckets.values()) {
    const { country, mergeKey, parts } = bucket;
    const rings = [];
    let areaM2 = 0;
    for (const part of parts) {
      rings.push(...part.rings);
      areaM2 += part.areaM2;
    }
    const primaryName = bucket.label || mergeKey;
    const display = primaryName.replace(/_/g, ' ');
    let id = legacyIdFor(country, parts.map(p => p.nameEn).join(' '));
    if (id && (legacyUsed.has(id) || usedIds.has(id))) id = null;
    if (id) legacyUsed.add(id);
    if (!id) {
      const base = `${country}_${mergeKey}`;
      id = base;
      let n = 2;
      while (usedIds.has(id)) id = `${base}_${n++}`;
    }
    usedIds.add(id);
    const [lon, lat] = polylabelLonLat(rings);
    const terrain = inferTerrain(display, areaM2);
    const vp = terrain === 'urban' ? 42 : terrain === 'coastal' ? 28 : 18;
    regions.push({
      id,
      name: display,
      nameJa: display,
      country,
      terrain,
      vp,
      infra: 4,
      mic: terrain === 'urban' ? 14 : 8,
      cic: terrain === 'urban' ? 18 : 10,
      nic: 8,
      air: terrain === 'urban' ? 3 : 1,
      fort: terrain === 'urban' ? 4 : 2,
      garrison: [],
      frontline: null,
      isSea: false,
      svgPath: ringsToSvg(rings),
      rings,
      lon: Math.round(lon * 100) / 100,
      lat: Math.round(lat * 100) / 100,
      cx: Math.round(PROJ_X(lon) * 10) / 10,
      cy: Math.round(PROJ_Y(lat) * 10) / 10,
    });
  }
  return regions;
}

function enforceCountryCaps(regions, caps, usedIds) {
  const byCountry = new Map();
  for (const r of regions) {
    if (!byCountry.has(r.country)) byCountry.set(r.country, []);
    byCountry.get(r.country).push(r);
  }
  const out = [];
  for (const [country, list] of byCountry) {
    const cap = caps[country];
    if (!cap || list.length <= cap) {
      out.push(...list);
      continue;
    }
    const sorted = [...list].sort((a, b) => turfArea(ringsToGeo(b)) - turfArea(ringsToGeo(a)));
    const keep = sorted.slice(0, cap);
    const drop = sorted.slice(cap);
    for (const piece of drop) {
      const target = keep.reduce((best, k) => {
        const d = (k.lon - piece.lon) ** 2 + (k.lat - piece.lat) ** 2;
        return d < best.d ? { k, d } : best;
      }, { k: keep[0], d: 1e18 }).k;
      target.rings.push(...piece.rings);
      target.svgPath = ringsToSvg(target.rings);
      const [lon, lat] = polylabelLonLat(target.rings);
      target.lon = Math.round(lon * 100) / 100;
      target.lat = Math.round(lat * 100) / 100;
      target.cx = Math.round(PROJ_X(lon) * 10) / 10;
      target.cy = Math.round(PROJ_Y(lat) * 10) / 10;
    }
    out.push(...keep);
  }
  return out;
}

async function main() {
  const histMap = JSON.parse(await readFile(new URL('../data/orbis_hist_name_map.json', import.meta.url), 'utf8'));
  const agg = JSON.parse(await readFile(new URL('../data/orbis_aggregation.json', import.meta.url), 'utf8'));
  const admin = JSON.parse(await readFile(new URL('../data/raw/ne_admin1_build.geojson', import.meta.url), 'utf8'));
  const hist = JSON.parse(await readFile(new URL('../data/raw/hist_world_1930.geojson', import.meta.url), 'utf8'));
  const oldSource = await readFile(new URL('../orbis_states.js', import.meta.url), 'utf8');
  const oldDb = JSON.parse(oldSource.replace(/^window\.ORBIS_STATES_DB\s*=\s*/, '').replace(/;\s*$/, ''));
  const seaZones = oldDb.filter(s => s.isSea || s.isSeaZone || s.type === 'sea');

  const histFeatures = hist.features.filter(f => f.geometry);
  const buckets = new Map();
  const usedIds = new Set();
  const orphans = [];

  for (const f of admin.features) {
    const props = f.properties || {};
    if (props.featurecla === 'Admin-0 country' || props.type === 'Dependency') continue;
    const adm0 = props.adm0_a3;
    const nameEn = props.name || props.name_en || props.nameascii || 'Region';
    const nameJa = props.name_local || props.name || nameEn;
    const rings = featureToRings(f.geometry);
    if (!rings.length) continue;
    let areaM2 = 0;
    try { areaM2 = turfArea(f); } catch { continue; }
    const smallAdm0 = SMALL_ADM0.has(adm0);
    if (areaM2 < MIN_AREA_M2 && !smallAdm0) continue;
    const [centLon, centLat] = ringsCentroid(rings);
    let country = null;
    if (adm0 === 'IRL') country = 'ireland';
    else if (adm0 === 'MNG') country = 'mongolia';
    else country = assignHistCountry([centLon, centLat], histFeatures, histMap);
    if (!country) country = ISO_TO_ORBIS[adm0] || null;
    if (!country) {
      orphans.push({ nameEn, adm0, centLon, centLat });
      continue;
    }
    const mergeKey = bucketMergeKey(country, adm0, props, nameEn, agg, centLon, centLat);
    const bucketId = `${country}|${mergeKey}`;
    if (!buckets.has(bucketId)) buckets.set(bucketId, { country, mergeKey, label: mergeKey, parts: [], areaM2: 0, names: [] });
    const bucket = buckets.get(bucketId);
    bucket.parts.push({ rings, areaM2, nameEn, nameJa, props });
    bucket.areaM2 += areaM2;
    bucket.names.push(nameEn);
  }

  let regions = bucketsToRegions(buckets, usedIds, agg, legacyIdFor);
  regions = enforceCountryCaps(regions, agg.countryCaps || {}, usedIds);

  const out = [...regions, ...seaZones];
  const countryAreas = new Map();
  for (const r of regions) countryAreas.set(r.country, (countryAreas.get(r.country) || 0) + turfArea(ringsToGeo(r)));
  const capitals = JSON.parse(await readFile(new URL('../data/orbis_capitals.json', import.meta.url), 'utf8'));
  const homeRules = JSON.parse(await readFile(new URL('../data/orbis_home_territory.json', import.meta.url), 'utf8'));
  const countryAnchors = computeCountryAnchors(regions, capitals, homeRules);

  const migration = buildMigration(oldDb, regions);

  const json = JSON.stringify(out);
  await writeFile(new URL('../orbis_states.js', import.meta.url), `window.ORBIS_STATES_DB = ${json};\n`);
  const regionBuckets = await computeRegionBuckets(regions);
  const meta = {
    generatedAt: new Date().toISOString(),
    landRegions: regions.length,
    totalRegions: out.length,
    seaZones: seaZones.length,
    orphansSample: orphans.slice(0, 20),
    countryAnchors,
    countryCounts: Object.fromEntries([...groupCount(regions, 'country')].sort((a, b) => b[1] - a[1])),
    regionBuckets,
    capitals,
    homeTerritoryRules: homeRules,
    migration,
    sources: {
      admin1: 'Natural Earth 10m Admin-1 (Public Domain)',
      sovereignty: 'aourednik/historical-basemaps world_1930 (GPL-3.0 — see CREDITS)',
    },
  };
  await writeFile(new URL('../orbis_map_meta.js', import.meta.url), `window.ORBIS_MAP_META = ${JSON.stringify(meta, null, 0)};\n`);
  await writeFile(new URL('../data/state_id_migration.json', import.meta.url), JSON.stringify(migration, null, 2));

  const nationRegions = JSON.parse(await readFile(new URL('../data/orbis_nation_regions.json', import.meta.url), 'utf8'));
  const missingNations = Object.keys(nationRegions).filter(id => !meta.countryCounts[id]);
  if (missingNations.length) console.error('Missing playable nations:', missingNations);
  const low = Object.entries(meta.countryCounts).filter(([, n]) => n < 2).map(([id]) => id);
  if (low.length) console.warn('Nations with <2 provinces:', low);

  console.log('Built', regions.length, 'land regions +', seaZones.length, 'sea zones');
  console.log('Output size bytes', json.length);
  console.log('Orphans', orphans.length);
  if (orphans.length) console.log(orphans.slice(0, 8));
}

function ringsToGeo(r) {
  return { type: 'Feature', properties: {}, geometry: r.rings.length === 1 ? { type: 'Polygon', coordinates: [r.rings[0].map(([lon, lat]) => [lon, lat])] } : { type: 'MultiPolygon', coordinates: r.rings.map(ring => [ring.map(([lon, lat]) => [lon, lat])]) } };
}

function groupCount(rows, key) {
  const m = new Map();
  for (const r of rows) m.set(r[key], (m.get(r[key]) || 0) + 1);
  return m;
}

function inHomeBBox(rule, lon, lat) {
  return lon >= rule.minLon && lon <= rule.maxLon && lat >= rule.minLat && lat <= rule.maxLat;
}

function computeCountryAnchors(regions, capitals, homeRules) {
  const anchors = {};
  const byCountry = groupCount(regions, 'country');
  for (const country of byCountry.keys()) {
    const cap = capitals[country];
  const owned = regions.filter(r => r.country === country);
    if (!owned.length) continue;
    const homeRule = homeRules[country];
    let pool = owned;
    if (homeRule) pool = owned.filter(r => inHomeBBox(homeRule, r.lon, r.lat));
    if (!pool.length) pool = owned;

    let anchorRegion = null;
    if (cap) {
      const capPt = point(cap);
      const containing = pool.filter(r => {
        try { return booleanPointInPolygon(capPt, ringsToGeo(r)); } catch { return false; }
      });
      if (containing.length) {
        anchorRegion = containing.sort((a, b) => turfArea(ringsToGeo(b)) - turfArea(ringsToGeo(a)))[0];
      } else {
        anchorRegion = [...pool].sort((a, b) => distance(capPt, point([a.lon, a.lat]), { units: 'kilometers' }) - distance(capPt, point([b.lon, b.lat]), { units: 'kilometers' }))[0];
      }
    }
    if (!anchorRegion) {
      anchorRegion = [...pool].sort((a, b) => turfArea(ringsToGeo(b)) - turfArea(ringsToGeo(a)))[0];
    }
    const poi = cap ? cap : [anchorRegion.lon, anchorRegion.lat];
    let lon = poi[0];
    let lat = poi[1];
    try {
      if (!booleanPointInPolygon(point(poi), ringsToGeo(anchorRegion))) {
        [lon, lat] = polylabelLonLat(anchorRegion.rings);
      }
    } catch {
      [lon, lat] = polylabelLonLat(anchorRegion.rings);
    }
    anchors[country] = {
      lon: Math.round(lon * 100) / 100,
      lat: Math.round(lat * 100) / 100,
      cx: Math.round(PROJ_X(lon) * 10) / 10,
      cy: Math.round(PROJ_Y(lat) * 10) / 10,
      homeRegionId: anchorRegion.id,
      anchorKind: cap ? 'capital' : 'pole',
    };
  }
  return anchors;
}

async function computeRegionBuckets(regions) {
  const nationRegions = JSON.parse(await readFile(new URL('../data/orbis_nation_regions.json', import.meta.url), 'utf8'));
  const buckets = {};
  for (const r of regions) {
    const key = nationRegions[r.country] || 'その他';
    buckets[key] = (buckets[key] || 0) + 1;
  }
  return buckets;
}

function buildMigration(oldDb, newRegions) {
  const landOld = oldDb.filter(s => !s.isSea && !s.isSeaZone && s.type !== 'sea');
  const map = {};
  for (const old of landOld) {
    let best = null;
    let bestD = 1e18;
    for (const neu of newRegions) {
      if (neu.country !== old.country) continue;
      const d = (neu.lon - old.lon) ** 2 + (neu.lat - old.lat) ** 2;
      if (d < bestD) { bestD = d; best = neu.id; }
    }
    if (!best) {
      for (const neu of newRegions) {
        const d = (neu.lon - old.lon) ** 2 + (neu.lat - old.lat) ** 2;
        if (d < bestD) { bestD = d; best = neu.id; }
      }
    }
    map[old.id] = best;
  }
  return map;
}

main().catch(err => { console.error(err); process.exit(1); });
