#!/usr/bin/env node
/**
 * Rebuild ORBIS_STATES_DB from Natural Earth admin-1 (data/raw/ne_admin1_build.geojson).
 *
 * Pipeline (topology preserving, 1932-03-01 historical borders):
 *   1. Every admin-1 feature is assigned a 1932 sovereign (ADM0 tables + polygon-level rules).
 *   2. All units go through TopoJSON so neighbouring borders share identical arcs
 *      (no gaps / overlaps), then are simplified once, globally.
 *   3. Provinces are merged down to per-country caps ONLY with topologically adjacent
 *      provinces, while PROTECTED_KEYS (historical flashpoints, colonies, and enclaves)
 *      are locked so they are never swallowed into mainland provinces.
 *   4. Merged provinces are dissolved with topojson.merge (no internal borders).
 */
import { readFile, writeFile } from 'node:fs/promises';
import polylabel from 'polylabel';
import turfArea from '@turf/area';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import distance from '@turf/distance';
import turfDiff from '@turf/difference';
import turfIntersect from '@turf/intersect';
import { point, featureCollection, polygon } from '@turf/helpers';
import { topology } from 'topojson-server';
import { merge, neighbors } from 'topojson-client';
import { presimplify, simplify } from 'topojson-simplify';

const SIMPLIFY_DEG2 = Number(process.env.SIMPLIFY || 0.02);
const QUANT = 1e5;

const IM_PREFS = JSON.parse(await readFile(new URL('../data/inner_mongolia_prefectures.json', import.meta.url), 'utf8'));

const PROJ_X = lon => (lon + 180) * (2000 / 360);
const PROJ_Y = lat => (90 - lat) * 9.32 + 60;
const r2 = v => Math.round(v * 100) / 100;

/* ------------------------------------------------------------------ sovereignty 1932 */
// Per-unit: each admin-1 unit becomes its own province candidate (caps merge them later).
const UNIT_ADM0 = {
  argentina: 'ARG', uruguay: 'URY', dutch_indies: 'IDN', chile: 'CHL', bolivia: 'BOL', peru: 'PER',
  india: 'IND PAK BGD MMR KAS KAB', china: 'CHN', ethiopia: 'ETH', france: 'FRA', brazil: 'BRA',
  mongolia: 'MNG', russia: 'RUS UKR BLR KAZ', czechoslovakia: 'CZE SVK', germany: 'DEU', estonia: 'EST',
  latvia: 'LVA', lithuania: 'LTU', norway: 'NOR', sweden: 'SWE', finland: 'FIN ALD', luxembourg: 'LUX',
  belgium: 'BEL', albania: 'ALB', turkey: 'TUR', spain: 'ESP', denmark: 'DNK', romania: 'ROU MDA',
  hungary: 'HUN', poland: 'POL', ireland: 'IRL', uk: 'GBR', greece: 'GRC', austria: 'AUT', italy: 'ITA',
  switzerland: 'CHE LIE', iran: 'IRN', netherlands: 'NLD', bulgaria: 'BGR', siam: 'THA', haiti: 'HTI',
  dominican: 'DOM', el_salvador: 'SLV', guatemala: 'GTM', honduras: 'HND', ecuador: 'ECU',
  colombia: 'COL', paraguay: 'PRY', portugal: 'PRT', cuba: 'CUB', afghanistan: 'AFG', usa: 'USA',
  canada: 'CAN', mexico: 'MEX', panama: 'PAN', venezuela: 'VEN', egypt: 'EGY', new_zealand: 'NZL',
  australia: 'AUS', japan: 'JPN', south_africa: 'ZAF', saudi_arabia: 'SAU', costa_rica: 'CRI',
  nicaragua: 'NIC',
};
// Blocs: whole ADM0 groups become one province each.
// Note: KOR + PRK are unified under empire_kor so the post-1945 38th parallel / DMZ is dissolved.
const BLOCS = {
  uk: {
    gulf: 'KWT QAT BHR ARE OMN', iraq: 'IRQ', palestine_jordan: 'ISR PSX JOR WSB', mediterranean: 'CYP MLT GIB ESB CYN',
    sudan: 'SDN SDS', east_africa: 'KEN UGA TZA', rhodesia: 'ZMB MWI ZWE', southern_africa: 'BWA LSO SWZ',
    west_africa: 'NGA GHA SLE GMB', malaya: 'MYS SGP BRN', ceylon: 'LKA', hongkong: 'HKG',
    pacific: 'FJI SLB VUT TON KIR TUV PCN',
    caribbean: 'JAM BHS TTO BLZ TCA CYM BMU BRB LCA DMA GRD VCT ATG KNA MSR AIA VGB GUY FLK SHN SGS IOT SYC MUS MDV',
    england: 'JEY GGY IMN', somaliland: 'SOL',
  },
  france: {
    fwa: 'SEN MLI MRT NER BFA CIV BEN GIN', fea: 'TCD CAF GAB COG', cameroons: 'CMR TGO', algeria: 'DZA',
    tunisia: 'TUN', morocco: 'MAR', levant: 'SYR LBN', vietnam: 'VNM', laos_cambodia: 'LAO KHM',
    djibouti: 'DJI', madagascar: 'MDG COM', pacific: 'NCL PYF WLF', misc: 'AND MCO ATF', atlantic: 'SPM BLM MAF',
  },
  belgium: { congo: 'COD', ruanda_urundi: 'RWA BDI' },
  portugal: { angola: 'AGO', mozambique: 'MOZ', guinea: 'GNB', timor: 'TLS', macau: 'MAC', islands: 'CPV STP' },
  italy: { libya: 'LBY', eritrea: 'ERI', somalia: 'SOM', misc: 'SMR VAT' },
  spain: { sahara: 'SAH', guinea: 'GNQ' },
  netherlands: { suriname: 'SUR', antilles: 'CUW ABW SXM' },
  denmark: { greenland: 'GRL', iceland: 'ISL', faroe: 'FRO' },
  usa: { caribbean: 'PRI VIR USG', pacific: 'GUM ASM UMI', liberia: 'LBR' },
  japan: { empire_kor: 'KOR PRK', empire_twn: 'TWN', empire_pacific: 'FSM MHL MNP PLW' },
  australia: { png: 'PNG', pacific: 'NRU NFK HMD IOA CCK CXR' },
  new_zealand: { pacific: 'WSM COK NIU' },
  south_africa: { swa: 'NAM' },
  india: { nepal: 'NPL', bhutan: 'BTN' },
  russia: { uzbekistan: 'UZB', turkmenistan: 'TKM', tajikistan: 'TJK', kyrgyzstan: 'KGZ', georgia: 'GEO', armenia: 'ARM', azerbaijan: 'AZE' },
  yugoslavia: { serbia: 'SRB KOS', croatia: 'HRV', bosnia: 'BIH', slovenia: 'SVN', macedonia: 'MKD', montenegro: 'MNE' },
};
const ADM0_UNIT = new Map();
const ADM0_BLOC = new Map();
for (const [c, list] of Object.entries(UNIT_ADM0)) for (const a of list.split(' ')) ADM0_UNIT.set(a, c);
for (const [c, blocs] of Object.entries(BLOCS)) for (const [k, list] of Object.entries(blocs)) for (const a of list.split(' ')) ADM0_BLOC.set(a, [c, k]);

// Units whose 1932 sovereign differs from today's: iso_3166_2 -> [country, key|null(unit key)]
// Note: BY-HM (Gomel) is removed so it remains Soviet (Byelorussian SSR).
const ISO_OVERRIDE = {
  'PL-DS': ['germany', 'silesia'], 'PL-OP': ['germany', 'silesia'], 'PL-LB': ['germany', 'pomerania'],
  'PL-ZP': ['germany', 'pomerania'], 'PL-WN': ['germany', 'east_prussia'], 'RU-KGD': ['germany', 'east_prussia'],
  'LT-VL': ['poland', null], 'BY-BR': ['poland', null], 'BY-HR': ['poland', null],
  'UA-07': ['poland', null], 'UA-56': ['poland', null], 'UA-46': ['poland', null], 'UA-61': ['poland', null],
  'UA-26': ['poland', null], 'UA-21': ['czechoslovakia', 'ruthenia'], 'UA-77': ['romania', 'bukovina'],
  'BG-08': ['romania', 'dobruja'], 'BG-19': ['romania', 'dobruja'], 'HR-18': ['italy', 'istria'],
  'TR-31': ['france', 'hatay'], 'DE-SL': ['germany', 'saar'], 'CA-NL': ['uk', 'newfoundland'],
  'PY-19': ['bolivia', 'chaco_boreal'],
  'CN-JL': ['manchukuo', null], 'CN-HL': ['manchukuo', null],
  'CN-HI': ['china', 'cn_gd'],
};
const SOMALILAND = /Awdal|Woqooyi|Togdheer|Sanaag|Sool/i;
const SPANISH_MOROCCO = /Tanger|T[ée]touan|Oriental|Taza|Hoceima|Nador/i;
const SOV_FALLBACK = { // dependencies whose adm0 is not listed explicitly
  ATA: null,
};

const KEY_NAMES = {
  gulf: ['湾岸諸国', 'Gulf States'], iraq: ['イラク', 'Iraq'], palestine_jordan: ['パレスチナ・トランスヨルダン', 'Palestine & Transjordan'],
  mediterranean: ['キプロス・マルタ', 'Cyprus & Malta'], sudan: ['英埃スーダン', 'Anglo-Egyptian Sudan'],
  east_africa: ['英領東アフリカ', 'British East Africa'], rhodesia: ['ローデシア・ニヤサランド', 'Rhodesia & Nyasaland'],
  southern_africa: ['ベチュアナランド・バストランド・スワジランド', 'High Commission Territories'],
  west_africa: ['英領西アフリカ', 'British West Africa'], malaya: ['英領マレー・ボルネオ', 'British Malaya & Borneo'],
  ceylon: ['セイロン', 'Ceylon'], hongkong: ['香港', 'Hong Kong'], pacific: ['太平洋諸島', 'Pacific Islands'],
  caribbean: ['カリブ海諸島', 'Caribbean Islands'], guyana: ['英領ギアナ', 'British Guiana'], atlantic: ['南大西洋諸島', 'Atlantic Islands'],
  fwa: ['仏領西アフリカ', 'French West Africa'], fea: ['仏領赤道アフリカ', 'French Equatorial Africa'],
  cameroons: ['仏領カメルーン・トーゴ', 'French Cameroons & Togo'], algeria: ['アルジェリア', 'Algeria'], tunisia: ['チュニジア', 'Tunisia'],
  morocco: ['仏領モロッコ', 'French Morocco'], levant: ['シリア・レバノン委任統治領', 'Syria & Lebanon'], vietnam: ['ベトナム（仏印）', 'Vietnam (Indochina)'],
  laos_cambodia: ['ラオス・カンボジア（仏印）', 'Laos & Cambodia'], djibouti: ['仏領ソマリランド', 'French Somaliland'],
  madagascar: ['マダガスカル', 'Madagascar'], congo: ['ベルギー領コンゴ', 'Belgian Congo'], ruanda_urundi: ['ルアンダ＝ウルンディ', 'Ruanda-Urundi'],
  angola: ['アンゴラ', 'Angola'], mozambique: ['モザンビーク', 'Mozambique'], guinea: ['ポルトガル領ギニア', 'Guinea'],
  timor: ['ポルトガル領ティモール', 'Portuguese Timor'], macau: ['マカオ', 'Macau'], islands: ['大西洋諸島', 'Atlantic Islands'],
  libya: ['リビア', 'Libya'], eritrea: ['エリトリア', 'Eritrea'], somalia: ['イタリア領ソマリランド', 'Italian Somaliland'],
  sahara: ['スペイン領サハラ', 'Spanish Sahara'], suriname: ['スリナム', 'Suriname'], antilles: ['蘭領アンティル', 'Dutch Antilles'],
  greenland: ['グリーンランド', 'Greenland'], iceland: ['アイスランド', 'Iceland'], faroe: ['フェロー諸島', 'Faroe Islands'],
  liberia: ['リベリア', 'Liberia'], empire_kor: ['朝鮮', 'Korea'], empire_prk: ['朝鮮（北部）', 'Korea (North)'],
  empire_twn: ['台湾', 'Taiwan'], empire_pacific: ['南洋群島', 'South Seas Mandate'], png: ['パプア・ニューギニア', 'Papua & New Guinea'],
  swa: ['南西アフリカ', 'South West Africa'], yemen: ['イエメン', 'Yemen'], uzbekistan: ['ウズベク', 'Uzbekistan'],
  turkmenistan: ['トルクメン', 'Turkmenistan'], tajikistan: ['タジク', 'Tajikistan'], kyrgyzstan: ['キルギス', 'Kyrgyzstan'],
  georgia: ['グルジア', 'Georgia'], armenia: ['アルメニア', 'Armenia'], azerbaijan: ['アゼルバイジャン', 'Azerbaijan'],
  serbia: ['セルビア', 'Serbia'], croatia: ['クロアチア', 'Croatia'], bosnia: ['ボスニア', 'Bosnia'], slovenia: ['スロベニア', 'Slovenia'],
  macedonia: ['マケドニア', 'Macedonia'], montenegro: ['モンテネグロ', 'Montenegro'], silesia: ['シレジア', 'Silesia'],
  pomerania: ['ポンメルン', 'Pomerania'], east_prussia: ['東プロイセン', 'East Prussia'], ruthenia: ['カルパティア・ルテニア', 'Carpathian Ruthenia'],
  bukovina: ['北ブコビナ', 'Northern Bukovina'], dobruja: ['南ドブロジャ', 'Southern Dobruja'], istria: ['イストリア', 'Istria'],
  dodecanese: ['ドデカネス諸島', 'Dodecanese'], somaliland: ['英領ソマリランド', 'British Somaliland'],
  karafuto: ['樺太・千島', 'Karafuto & Kurils'], misc: ['小領土', 'Minor Territories'],
  scotland: ['スコットランド', 'Scotland'], wales: ['ウェールズ', 'Wales'], england: ['イングランド', 'England'], northern_ireland: ['北アイルランド', 'Northern Ireland'],
  caribbean_usa: ['米領カリブ', 'US Caribbean'], phl_n: ['ルソン', 'Luzon'], phl_c: ['ビサヤ', 'Visayas'], phl_s: ['ミンダナオ', 'Mindanao'],
  ca_nt: ['ノースウェスト準州', 'Northwest Territories'], ulster: ['アルスター', 'Ulster'], connacht: ['コナハト', 'Connacht'], munster: ['マンスター', 'Munster'], leinster: ['レンスター', 'Leinster'],
  // 1932 historical additions
  suiyuan: ['綏遠省', 'Suiyuan'],
  chahar: ['察哈爾省', 'Chahar'],
  jehol: ['熱河省', 'Jehol'],
  xingan: ['興安省', 'Hsingan'],
  ruijin_soviet: ['中央ソビエト区（瑞金）', 'Ruijin Soviet'],
  xikang: ['西康省', 'Xikang'],
  empire_kwantung: ['関東州', 'Kwantung Leased Territory'],
  guangzhouwan: ['広州湾', 'Guangzhouwan'],
  karelia: ['カレリア（ヴィープリ）', 'Karelia (Viipuri)'],
  petsamo: ['ペツァモ', 'Petsamo'],
  wilno_nowogrodek: ['ヴィルノ・ノヴォグルデク', 'Wilno & Nowogródek'],
  bessarabia_south: ['南ベッサラビア（ブジャク）', 'Southern Bessarabia (Budjak)'],
  saar: ['ザール地方', 'Saar Territory'],
  hatay: ['アレクサンドレッタ（ハタイ）', 'Sanjak of Alexandretta'],
  sp_morocco: ['スペイン領モロッコ', 'Spanish Morocco'],
  newfoundland: ['ニューファンドランド', 'Newfoundland'],
  aden: ['アデン保護領', 'Aden Protectorate'],
  chaco_boreal: ['チャコ・ボレアール', 'Chaco Boreal'],
  cn_cq: ['四川省東部（重慶）', 'Chongqing (Eastern Sichuan)'],
  cn_sc: ['四川省西部（成都）', 'Western Sichuan (Chengdu)'],
  cn_jx: ['江西省北部（南昌）', 'Northern Jiangxi (Nanchang)'],
  cn_gd: ['広東省', 'Guangdong'],
};

const LEGACY_ID_HINTS = [
  ['jp_kanto', 'japan', 'JP-13'],
  ['cn_beijing', 'china', 'CN-BJ'],
  ['cn_dongbei', 'manchukuo', 'CN-JL'],
  ['de_rhineland', 'germany', 'DE-NW'],
];

const slugify = text => String(text || 'region').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48);
const isoOf = p => (/^[A-Z]{2}-[A-Z0-9]+$/.test(p.iso_3166_2 || '') ? p.iso_3166_2 : '');
const unitKeyOf = p => slugify(isoOf(p) || p.adm1_code || p.name);

/* ------------------------------------------------------------------ geometry helpers */
function toPolys(geom) {
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}
function ringAreaSigned(ring) {
  let a = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
}
function polyCentroidLonLat(poly) {
  const ring = poly[0];
  let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}
// Sutherland-Hodgman clip of a closed ring against lat >= cut (keepNorth) or lat <= cut.
function clipRingLat(ring, cut, keepNorth) {
  const inside = p => (keepNorth ? p[1] >= cut : p[1] <= cut);
  const out = [];
  const pts = ring.slice(0, -1);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]; const b = pts[(i + 1) % pts.length];
    const ia = inside(a); const ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (cut - a[1]) / (b[1] - a[1]);
      out.push([a[0] + t * (b[0] - a[0]), cut]);
    }
  }
  if (out.length < 3) return null;
  out.push(out[0]);
  return out;
}
function clipPolyLat(poly, cut, keepNorth) {
  const outer = clipRingLat(poly[0], cut, keepNorth);
  if (!outer) return null;
  const holes = poly.slice(1).map(h => clipRingLat(h, cut, keepNorth)).filter(Boolean);
  return [outer, ...holes];
}
// Sutherland-Hodgman clip of a closed ring against lon >= cut (keepEast) or lon <= cut.
function clipRingLon(ring, cut, keepEast) {
  const inside = p => (keepEast ? p[0] >= cut : p[0] <= cut);
  const out = [];
  const pts = ring.slice(0, -1);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]; const b = pts[(i + 1) % pts.length];
    const ia = inside(a); const ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (cut - a[0]) / (b[0] - a[0]);
      out.push([cut, a[1] + t * (b[1] - a[1])]);
    }
  }
  if (out.length < 3) return null;
  out.push(out[0]);
  return out;
}
function clipPolyLon(poly, cut, keepEast) {
  const outer = clipRingLon(poly[0], cut, keepEast);
  if (!outer) return null;
  const holes = poly.slice(1).map(h => clipRingLon(h, cut, keepEast)).filter(Boolean);
  return [outer, ...holes];
}
function splitPolysLon(polys, cut) {
  const west = [];
  const east = [];
  for (const poly of polys) {
    const xs = poly[0].map(c => c[0]);
    const lo = Math.min(...xs); const hi = Math.max(...xs);
    if (hi <= cut) west.push(poly);
    else if (lo >= cut) east.push(poly);
    else {
      const w = clipPolyLon(poly, cut, false);
      const e = clipPolyLon(poly, cut, true);
      if (w) west.push(w);
      if (e) east.push(e);
    }
  }
  return { west, east };
}
function splitPolysLat(polys, cut) {
  const south = [];
  const north = [];
  for (const poly of polys) {
    const ys = poly[0].map(c => c[1]);
    const lo = Math.min(...ys); const hi = Math.max(...ys);
    if (hi <= cut) south.push(poly);
    else if (lo >= cut) north.push(poly);
    else {
      const s = clipPolyLat(poly, cut, false);
      const n = clipPolyLat(poly, cut, true);
      if (s) south.push(s);
      if (n) north.push(n);
    }
  }
  return { south, north };
}

/* ------------------------------------------------------------------ classification */
function classifyFeature(f, stats) {
  const p = f.properties || {};
  const adm0 = p.adm0_a3;
  const iso = isoOf(p);
  const name = p.name || '';
  const polys = toPolys(f.geometry);
  if (!polys.length || adm0 === 'ATA') return [];
  const centroid = polys.length === 1 ? polyCentroidLonLat(polys[0]) : polyCentroidLonLat([polys.flatMap(pp => pp[0])]);
  const ukey = unitKeyOf(p);
  const hit = (tag) => { stats[tag] = (stats[tag] || 0) + 1; };

  // Sakhalin / Kurils: south of 50N is Japanese Karafuto, Kurils are Japanese.
  if (iso === 'RU-SAK') {
    const north = []; const south = [];
    for (const poly of polys) {
      const ys = poly[0].map(c => c[1]);
      const lo = Math.min(...ys); const hi = Math.max(...ys);
      if (hi <= 50) south.push(poly);
      else if (lo >= 50) north.push(poly);
      else {
        const n = clipPolyLat(poly, 50, true); const s = clipPolyLat(poly, 50, false);
        if (n) north.push(n);
        if (s) south.push(s);
      }
    }
    hit('RU-SAK');
    const out = [];
    if (north.length) out.push({ country: 'russia', key: ukey, polys: north });
    if (south.length) out.push({ country: 'japan', key: 'empire_rus_11_6', polys: south });
    return out;
  }

  // Finland: Petsamo from Murmansk (RU-MUR, west of 31.65E)
  if (iso === 'RU-MUR') {
    const { west: petsamo, east: murmansk } = splitPolysLon(polys, 31.65);
    const out = [];
    if (petsamo.length) out.push({ country: 'finland', key: 'petsamo', polys: petsamo });
    if (murmansk.length) out.push({ country: 'russia', key: ukey, polys: murmansk });
    hit('RU-MUR-split');
    return out;
  }

  // Finland: Viipuri & Karelian Isthmus from Leningrad (RU-LEN, west of 30.75E & north of 60.42N)
  if (iso === 'RU-LEN') {
    const { west: lenW, east: lenE } = splitPolysLon(polys, 30.75);
    const { south: lenWSouth, north: viipuri } = splitPolysLat(lenW, 60.42);
    const out = [];
    if (viipuri.length) out.push({ country: 'finland', key: 'karelia', polys: viipuri });
    const rus = [...lenE, ...lenWSouth];
    if (rus.length) out.push({ country: 'russia', key: ukey, polys: rus });
    hit('RU-LEN-split');
    return out;
  }

  // Finland: Ladoga Karelia from Republic of Karelia (RU-KR, west of 32.35E & south of 62.25N)
  if (iso === 'RU-KR') {
    const { west: krW, east: krE } = splitPolysLon(polys, 32.35);
    const { south: ladoga, north: krWNorth } = splitPolysLat(krW, 62.25);
    const out = [];
    if (ladoga.length) out.push({ country: 'finland', key: 'karelia', polys: ladoga });
    const rus = [...krE, ...krWNorth];
    if (rus.length) out.push({ country: 'russia', key: ukey, polys: rus });
    hit('RU-KR-split');
    return out;
  }

  // Poland: Riga border (BY-MI and BY-VI west of 27.35E -> Wilno & Nowogródek)
  if (iso === 'BY-MI' || iso === 'BY-VI') {
    const { west: polandPart, east: ussrPart } = splitPolysLon(polys, 27.35);
    const out = [];
    if (polandPart.length) out.push({ country: 'poland', key: 'wilno_nowogrodek', polys: polandPart });
    if (ussrPart.length) out.push({ country: 'russia', key: ukey, polys: ussrPart });
    hit(`${iso}-split`);
    return out;
  }

  // Romania: Southern Bessarabia / Budjak (UA-51 west of 30.42E & south of 46.52N)
  if (iso === 'UA-51') {
    const { west: uaW, east: uaE } = splitPolysLon(polys, 30.42);
    const { south: budjak, north: uaWNorth } = splitPolysLat(uaW, 46.52);
    const out = [];
    if (budjak.length) out.push({ country: 'romania', key: 'bessarabia_south', polys: budjak });
    const rus = [...uaE, ...uaWNorth];
    if (rus.length) out.push({ country: 'russia', key: ukey, polys: rus });
    hit('UA-51-split');
    return out;
  }

  // China / Manchukuo: Inner Mongolia (CN-NM) 1932 split by historical prefecture boundaries:
  // - 興安省 (Hsingan) -> Manchukuo: 呼伦贝尔市, 兴安盟, 通辽市
  // - 熱河省 (Jehol) -> Manchukuo: 赤峰市
  // - 察哈爾省 (Chahar) -> China: 锡林郭勒盟
  // - 綏遠省 (Suiyuan) -> China: 乌兰察布市, 呼和浩特市, 包头市, 鄂尔多斯市, 巴彦淖尔市, 乌海市, 阿拉善盟
  if (iso === 'CN-NM') {
    const out = [];
    for (const pref of IM_PREFS.features) {
      const name = pref.properties.name;
      let country = 'china';
      let key = 'suiyuan';
      if (name === '呼伦贝尔市' || name === '兴安盟' || name === '通辽市') {
        country = 'manchukuo';
        key = 'xingan';
      } else if (name === '赤峰市') {
        country = 'manchukuo';
        key = 'jehol';
      } else if (name === '锡林郭勒盟') {
        country = 'china';
        key = 'chahar';
      } else {
        country = 'china';
        key = 'suiyuan';
      }
      out.push({ country, key, polys: toPolys(pref.geometry) });
    }
    hit('CN-NM-prefectures');
    return out;
  }

  // China: Jiangxi (CN-JX) split at 27.2N (North Nanchang vs South Ruijin Soviet)
  if (iso === 'CN-JX') {
    const { south: ruijin, north: nanchang } = splitPolysLat(polys, 27.2);
    const out = [];
    if (nanchang.length) out.push({ country: 'china', key: 'cn_jx', polys: nanchang });
    if (ruijin.length) out.push({ country: 'china', key: 'ruijin_soviet', polys: ruijin });
    hit('CN-JX-split');
    return out;
  }

  // China: Sichuan (CN-SC) split at 102.0E (West Xikang vs East Chengdu)
  if (iso === 'CN-SC') {
    const { west: xikangPart, east: chengduPart } = splitPolysLon(polys, 102.0);
    const out = [];
    if (chengduPart.length) out.push({ country: 'china', key: 'cn_sc', polys: chengduPart });
    if (xikangPart.length) out.push({ country: 'china', key: 'xikang', polys: xikangPart });
    hit('CN-SC-split');
    return out;
  }

  // China: Tibet (CN-XZ) split at 96.5E (West Tibet vs East Xikang / Chamdo)
  if (iso === 'CN-XZ') {
    const { west: tibetPart, east: xikangPart } = splitPolysLon(polys, 96.5);
    const out = [];
    if (tibetPart.length) out.push({ country: 'china', key: 'cn_xz', polys: tibetPart });
    if (xikangPart.length) out.push({ country: 'china', key: 'xikang', polys: xikangPart });
    hit('CN-XZ-split');
    return out;
  }

  // Japan / Manchukuo: Liaoning (CN-LN) Kwantung Leased Territory split at 39.45N
  if (iso === 'CN-LN') {
    const { south: kwantung, north: manchuriaLn } = splitPolysLat(polys, 39.45);
    const out = [];
    if (manchuriaLn.length) out.push({ country: 'manchukuo', key: ukey, polys: manchuriaLn });
    if (kwantung.length) out.push({ country: 'japan', key: 'empire_kwantung', polys: kwantung });
    hit('CN-LN-kwantung');
    return out;
  }

  // France / China: Guangzhouwan leased territory carved out from Guangdong (CN-GD)
  if (iso === 'CN-GD') {
    const gzBBox = polygon([[[110.0, 20.9], [110.65, 20.9], [110.65, 21.45], [110.0, 21.45], [110.0, 20.9]]]);
    try {
      const diff = turfDiff(featureCollection([f, gzBBox]));
      const inter = turfIntersect(featureCollection([f, gzBBox]));
      const out = [];
      if (diff?.geometry) out.push({ country: 'china', key: 'cn_gd', polys: toPolys(diff.geometry) });
      if (inter?.geometry) out.push({ country: 'france', key: 'guangzhouwan', polys: toPolys(inter.geometry) });
      if (out.length) {
        hit('CN-GD-guangzhouwan');
        return out;
      }
    } catch {
      // fallback to regular assignment if difference throws
    }
  }

  // Yemen: South Yemen (Aden protectorate -> UK) vs North Yemen (Kingdom of Yemen -> Saudi Arabia)
  if (adm0 === 'YEM') {
    const isSouth = /Hadramawt|Mahrah|Adan|Lahij|Abyan|Shabwah|Socotra|Dali/i.test(`${name} ${p.name_en || ''}`) ||
      centroid[1] < 13.8 || centroid[0] > 45.3;
    if (isSouth) {
      hit('yemen-south');
      return [{ country: 'uk', key: 'aden', polys }];
    } else {
      hit('yemen-north');
      return [{ country: 'saudi_arabia', key: 'yemen', polys }];
    }
  }

  // Dodecanese (Italian) vs Cyclades (Greek) inside the South Aegean region.
  if (adm0 === 'GRC' && /Notio Aigaio|South Aegean|Dodeka/i.test(`${name} ${p.name_en || ''}`)) {
    const dode = []; const rest = [];
    for (const poly of polys) (polyCentroidLonLat(poly)[0] > 26.3 ? dode : rest).push(poly);
    const out = [];
    if (rest.length) out.push({ country: 'greece', key: ukey, polys: rest });
    if (dode.length) out.push({ country: 'italy', key: 'dodecanese', polys: dode });
    hit('GR-dodecanese');
    return out;
  }
  if (ISO_OVERRIDE[iso]) {
    const [c, k] = ISO_OVERRIDE[iso];
    hit(`ovr:${iso}`);
    return [{ country: c, key: k || ukey, polys }];
  }
  if (adm0 === 'SOM' && SOMALILAND.test(name)) { hit('somaliland'); return [{ country: 'uk', key: 'somaliland', polys }]; }
  if (adm0 === 'MAR' && SPANISH_MOROCCO.test(name)) { hit('spanish-morocco'); return [{ country: 'spain', key: 'sp_morocco', polys }]; }
  if (adm0 === 'PHL') {
    const lat = centroid[1];
    return [{ country: 'usa', key: lat > 12.3 ? 'phl_n' : lat > 9.3 ? 'phl_c' : 'phl_s', polys }];
  }
  if (adm0 === 'GBR') {
    const g = String(p.geonunit || '').toLowerCase();
    const key = g.includes('scotland') ? 'scotland' : g.includes('wales') ? 'wales' : g.includes('northern ireland') ? 'northern_ireland' : 'england';
    return [{ country: 'uk', key, polys }];
  }
  if (adm0 === 'IRL') {
    const [lon, lat] = centroid;
    const key = lon < -7.2 && lat > 53.8 ? 'ulster' : lon < -8.8 ? 'connacht' : lat < 52.35 ? 'munster' : 'leinster';
    return [{ country: 'ireland', key, polys }];
  }
  if (adm0 === 'CAN') {
    return [{ country: 'canada', key: iso === 'CA-NU' ? 'ca_nt' : ukey, polys }]; // Nunavut did not exist in 1932
  }
  if (ADM0_BLOC.has(adm0)) { const [c, k] = ADM0_BLOC.get(adm0); return [{ country: c, key: k, polys }]; }
  if (ADM0_UNIT.has(adm0)) return [{ country: ADM0_UNIT.get(adm0), key: ukey, polys }];
  const sov = p.sov_a3;
  if (sov && sov !== adm0) {
    if (ADM0_BLOC.has(sov)) { const [c, k] = ADM0_BLOC.get(sov); return [{ country: c, key: k, polys }]; }
    if (ADM0_UNIT.has(sov)) return [{ country: ADM0_UNIT.get(sov), key: ukey, polys }];
  }
  hit(`DROPPED:${adm0}`);
  return [];
}

/* ------------------------------------------------------------------ misc derived data */
function ringsToSvg(rings) {
  const parts = [];
  for (const ring of rings) {
    if (ring.length < 4) continue;
    parts.push('M ' + ring.map(([lon, lat]) => `${PROJ_X(lon).toFixed(1)} ${PROJ_Y(lat).toFixed(1)}`).join(' L ') + ' Z');
  }
  return parts.join(' ');
}
function polysToGeo(polys) {
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: polys } };
}
const geoOf = r => polysToGeo(r._polys);

function polylabelLonLat(polys) {
  let best = null; let bestA = -1;
  for (const poly of polys) {
    const a = Math.abs(ringAreaSigned(poly[0]));
    if (a > bestA) { bestA = a; best = poly; }
  }
  if (!best) return [0, 0];
  try { const pt = polylabel(best, 0.0005); return [pt[0], pt[1]]; } catch { return polyCentroidLonLat(best); }
}

function inferTerrain(name, areaM2) {
  const n = String(name).toLowerCase();
  if (/tokyo|beijing|moscow|london|paris|berlin|delhi|shanghai|osaka|manhattan|district|capital|city/i.test(n)) return 'urban';
  if (areaM2 < 4e9) return 'coastal';
  if (/desert|sahara|gobi|arid/i.test(n)) return 'arid';
  if (/siberia|tundra|alaska|northwest territories|yukon/i.test(n)) return 'tundra';
  return 'plains';
}

const groupCount = (rows, key) => { const m = new Map(); for (const r of rows) m.set(r[key], (m.get(r[key]) || 0) + 1); return m; };
const inHomeBBox = (rule, lon, lat) => lon >= rule.minLon && lon <= rule.maxLon && lat >= rule.minLat && lat <= rule.maxLat;

function computeCountryAnchors(regions, capitals, homeRules) {
  const anchors = {};
  for (const country of groupCount(regions, 'country').keys()) {
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
      const containing = pool.filter(r => { try { return booleanPointInPolygon(capPt, geoOf(r)); } catch { return false; } });
      if (containing.length) anchorRegion = containing.sort((a, b) => turfArea(geoOf(b)) - turfArea(geoOf(a)))[0];
      else anchorRegion = [...pool].sort((a, b) => distance(capPt, point([a.lon, a.lat]), { units: 'kilometers' }) - distance(capPt, point([b.lon, b.lat]), { units: 'kilometers' }))[0];
    }
    if (!anchorRegion) anchorRegion = [...pool].sort((a, b) => turfArea(geoOf(b)) - turfArea(geoOf(a)))[0];
    const poi = cap || [anchorRegion.lon, anchorRegion.lat];
    let [lon, lat] = poi;
    try { if (!booleanPointInPolygon(point(poi), geoOf(anchorRegion))) [lon, lat] = polylabelLonLat(anchorRegion._polys); } catch { [lon, lat] = polylabelLonLat(anchorRegion._polys); }
    anchors[country] = { lon: r2(lon), lat: r2(lat), cx: Math.round(PROJ_X(lon) * 10) / 10, cy: Math.round(PROJ_Y(lat) * 10) / 10, homeRegionId: anchorRegion.id, anchorKind: cap ? 'capital' : 'pole' };
  }
  return anchors;
}

async function computeRegionBuckets(regions) {
  const nationRegions = JSON.parse(await readFile(new URL('../data/orbis_nation_regions.json', import.meta.url), 'utf8'));
  const buckets = {};
  for (const r of regions) { const key = nationRegions[r.country] || 'その他'; buckets[key] = (buckets[key] || 0) + 1; }
  return buckets;
}

function buildMigration(oldDb, newRegions) {
  const landOld = oldDb.filter(s => !s.isSea && !s.isSeaZone && s.type !== 'sea');
  const map = {};
  for (const old of landOld) {
    let best = null; let bestD = 1e18;
    for (const pass of [true, false]) {
      for (const neu of newRegions) {
        if (pass && neu.country !== old.country) continue;
        const d = (neu.lon - old.lon) ** 2 + (neu.lat - old.lat) ** 2;
        if (d < bestD) { bestD = d; best = neu.id; }
      }
      if (best) break;
    }
    map[old.id] = best;
  }
  return map;
}

function seaRingsFromSvg(svgPath) {
  const rings = [];
  for (const part of String(svgPath || '').split('M').map(s => s.trim()).filter(Boolean)) {
    const nums = part.replace(/[LZ]/g, ' ').trim().split(/\s+/).map(Number);
    const ring = [];
    for (let i = 0; i + 1 < nums.length; i += 2) ring.push([r2(nums[i] * 0.18 - 180), r2(90 - (nums[i + 1] - 60) / 9.32)]);
    if (ring.length >= 3) { ring.push(ring[0]); rings.push(ring); }
  }
  return rings;
}

/* ------------------------------------------------------------------ main */
async function main() {
  const agg = JSON.parse(await readFile(new URL('../data/orbis_aggregation.json', import.meta.url), 'utf8'));
  const admin = JSON.parse(await readFile(new URL('../data/raw/ne_admin1_build.geojson', import.meta.url), 'utf8'));
  const oldSource = await readFile(new URL('../orbis_states.js', import.meta.url), 'utf8');
  const oldDb = JSON.parse(oldSource.replace(/^window\.ORBIS_STATES_DB\s*=\s*/, '').replace(/;\s*$/, ''));
  const seaZones = oldDb.filter(s => s.isSea || s.isSeaZone || s.type === 'sea').map(s => ({
    ...s, rings: s.rings?.length ? s.rings : seaRingsFromSvg(s.svgPath),
  }));

  // 1. classify -> units
  const stats = {};
  const units = [];
  for (const f of admin.features) {
    const p = f.properties || {};
    if (p.featurecla === 'Admin-0 country') continue;
    for (const piece of classifyFeature(f, stats)) {
      const geomPolys = piece.polys;
      let areaM2 = 0;
      try { areaM2 = turfArea(polysToGeo(geomPolys)); } catch { areaM2 = 1; }
      units.push({
        country: piece.country, key: piece.key, polys: geomPolys, areaM2: Math.max(areaM2, 1),
        iso: isoOf(p), nameEn: p.name || p.name_en || 'Region', nameJa: p.name_ja || '', cent: polylabelLonLat(geomPolys),
      });
    }
  }
  const dropped = Object.entries(stats).filter(([k]) => k.startsWith('DROPPED:'));
  const overrideMisses = Object.keys(ISO_OVERRIDE).filter(k => !stats[`ovr:${k}`]);

  // 2. topology + simplification
  const topo0 = topology({ u: { type: 'FeatureCollection', features: units.map((u, i) => ({ type: 'Feature', id: i, properties: {}, geometry: { type: 'MultiPolygon', coordinates: u.polys } })) } }, QUANT);
  const topo = simplify(presimplify(topo0), SIMPLIFY_DEG2);
  const geoms = topo.objects.u.geometries;
  const nbr = neighbors(geoms);

  // 3. provinces + topological cap merging
  const provs = new Map();
  const keyOfUnit = units.map((u, i) => { const k = `${u.country}|${u.key}`; return k; });
  units.forEach((u, i) => {
    const k = keyOfUnit[i];
    if (!provs.has(k)) provs.set(k, { id: k, country: u.country, key: u.key, units: [], area: 0, cx: 0, cy: 0 });
    const pr = provs.get(k);
    pr.units.push(i); pr.area += u.areaM2; pr.cx += u.cent[0] * u.areaM2; pr.cy += u.cent[1] * u.areaM2;
  });
  const adj = new Map([...provs.keys()].map(k => [k, new Set()]));
  nbr.forEach((list, i) => { for (const j of list) { const a = keyOfUnit[i]; const b = keyOfUnit[j]; if (a !== b) { adj.get(a).add(b); adj.get(b).add(a); } } });
  const cen = pr => [pr.cx / pr.area, pr.cy / pr.area];
  const largestUnit = pr => pr.units.reduce((best, i) => (units[i].areaM2 > units[best].areaM2 ? i : best), pr.units[0]);

  const caps = agg.countryCaps || {};
  const defaultCap = agg.defaultCap || 30;
  const PROTECTED_KEYS = new Set([
    'hongkong', 'macau', 'timor', 'djibouti', 'dodecanese', 'somaliland', 'karafuto',
    'empire_twn', 'empire_kor', 'empire_pacific', 'empire_kwantung', 'ruthenia', 'bukovina', 'dobruja', 'istria',
    'levant', 'kwantung', 'jehol', 'chahar', 'suiyuan', 'xingan', 'nepal', 'bhutan', 'gibraltar', 'malta',
    'co_ama', 'pe_lor', 'py_15', 'py_16', 'pl_pm', 'cn_cq', 'cn_sc', 'cn_jx', 'ruijin_soviet', 'xikang',
    'guangzhouwan', 'karelia', 'petsamo', 'wilno_nowogrodek', 'bessarabia_south', 'saar', 'hatay',
    'sp_morocco', 'newfoundland', 'aden', 'chaco_boreal', 'cn_gd', 'cn_hi'
  ]);
  const byCountry = new Map();
  for (const pr of provs.values()) { if (!byCountry.has(pr.country)) byCountry.set(pr.country, new Set()); byCountry.get(pr.country).add(pr.id); }
  for (const [country, ids] of byCountry) {
    const cap = caps[country] || defaultCap;
    while (ids.size > cap) {
      let src = null;
      for (const id of ids) {
        if (PROTECTED_KEYS.has(provs.get(id).key)) continue;
        if (!src || provs.get(id).area < provs.get(src).area) src = id;
      }
      if (!src) break;
      const s = provs.get(src);
      let cands = [...adj.get(src)].filter(id => ids.has(id));
      if (!cands.length) {
        const [sx, sy] = cen(s);
        cands = [...ids].filter(id => id !== src).sort((a, b) => {
          const pa = PROTECTED_KEYS.has(provs.get(a).key) ? 1 : 0;
          const pb = PROTECTED_KEYS.has(provs.get(b).key) ? 1 : 0;
          if (pa !== pb) return pa - pb;
          const da = (cen(provs.get(a))[0] - sx) ** 2 + (cen(provs.get(a))[1] - sy) ** 2;
          const db = (cen(provs.get(b))[0] - sx) ** 2 + (cen(provs.get(b))[1] - sy) ** 2;
          return da - db;
        }).slice(0, 1);
      } else {
        cands.sort((a, b) => {
          const pa = PROTECTED_KEYS.has(provs.get(a).key) ? 1 : 0;
          const pb = PROTECTED_KEYS.has(provs.get(b).key) ? 1 : 0;
          if (pa !== pb) return pa - pb;
          return provs.get(a).area - provs.get(b).area;
        });
      }
      const dst = provs.get(cands[0]);
      dst.units.push(...s.units); dst.area += s.area; dst.cx += s.cx; dst.cy += s.cy;
      for (const n of adj.get(src)) { adj.get(n).delete(src); if (n !== dst.id) { adj.get(n).add(dst.id); adj.get(dst.id).add(n); } }
      adj.delete(src); provs.delete(src); ids.delete(src);
    }
  }

  // 4. dissolve + build regions
  const usedIds = new Set();
  const regions = [];
  const sortedProvs = [...provs.values()].sort((a, b) => b.area - a.area);
  for (const pr of sortedProvs) {
    const merged = merge(topo, pr.units.map(i => geoms[i]));
    let polys = merged.coordinates || [];
    const cleaned = [];
    for (const poly of polys) {
      const rings = [];
      poly.forEach((ring, idx) => {
        const pts = [];
        for (const [x, y] of ring) { const q = [r2(x), r2(y)]; const last = pts[pts.length - 1]; if (!last || last[0] !== q[0] || last[1] !== q[1]) pts.push(q); }
        if (pts.length >= 3 && (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1])) pts.push(pts[0]);
        if (pts.length < 4) return;
        const area = Math.abs(ringAreaSigned(pts));
        if (idx > 0 && area < 0.05) return;
        // outer rings counter-clockwise (positive), holes clockwise so nonzero fill keeps holes open
        const want = idx === 0 ? 1 : -1;
        rings.push({ pts: Math.sign(ringAreaSigned(pts)) === want ? pts : [...pts].reverse(), area });
      });
      if (rings.length) cleaned.push(rings);
    }
    cleaned.sort((a, b) => b[0].area - a[0].area);
    const kept = cleaned.filter((rs, i) => i === 0 || (rs[0].area >= 0.025 && !(rs[0].pts.length <= 4 && rs[0].area < 0.08))).slice(0, 12);
    if (!kept.length) continue;
    const keptPolys = kept.map(rs => rs.map(r => r.pts));
    const rings = keptPolys.flat();

    const main = units[largestUnit(pr)];
    const names = KEY_NAMES[pr.key];
    const nameEn = names ? names[1] : main.nameEn;
    const nameJa = names ? names[0] : (main.nameJa || main.nameEn);
    let id = null;
    for (const [lid, c, iso] of LEGACY_ID_HINTS) {
      if (c === pr.country && !usedIds.has(lid) && pr.units.some(i => units[i].iso === iso)) { id = lid; break; }
    }
    if (!id) { const base = `${pr.country}_${pr.key}`; id = base; let n = 2; while (usedIds.has(id)) id = `${base}_${n++}`; }
    usedIds.add(id);
    const [lon, lat] = polylabelLonLat(keptPolys);
    const terrain = inferTerrain(nameEn, pr.area);
    regions.push({
      id, name: nameEn, nameJa, country: pr.country, terrain,
      vp: terrain === 'urban' ? 42 : terrain === 'coastal' ? 28 : 18, infra: 4,
      mic: terrain === 'urban' ? 14 : 8, cic: terrain === 'urban' ? 18 : 10, nic: 8,
      air: terrain === 'urban' ? 3 : 1, fort: terrain === 'urban' ? 4 : 2,
      garrison: [], frontline: null, isSea: false,
      svgPath: ringsToSvg(rings), rings,
      lon: r2(lon), lat: r2(lat), cx: Math.round(PROJ_X(lon) * 10) / 10, cy: Math.round(PROJ_Y(lat) * 10) / 10,
      _polys: keptPolys,
    });
  }

  const capitals = JSON.parse(await readFile(new URL('../data/orbis_capitals.json', import.meta.url), 'utf8'));
  const homeRules = JSON.parse(await readFile(new URL('../data/orbis_home_territory.json', import.meta.url), 'utf8'));
  const countryAnchors = computeCountryAnchors(regions, capitals, homeRules);
  const migration = buildMigration(oldDb, regions);

  const outRegions = regions.map(({ _polys, ...rest }) => rest);
  const out = [...outRegions, ...seaZones];
  const json = JSON.stringify(out);
  await writeFile(new URL('../orbis_states.js', import.meta.url), `window.ORBIS_STATES_DB = ${json};\n`);
  const meta = {
    generatedAt: new Date().toISOString(),
    landRegions: regions.length,
    totalRegions: out.length,
    seaZones: seaZones.length,
    orphansSample: dropped.slice(0, 20),
    countryAnchors,
    countryCounts: Object.fromEntries([...groupCount(regions, 'country')].sort((a, b) => b[1] - a[1])),
    regionBuckets: await computeRegionBuckets(regions),
    capitals,
    homeTerritoryRules: homeRules,
    migration,
    sources: {
      admin1: 'Natural Earth 10m Admin-1 (Public Domain)',
      sovereignty: '1932 sovereignty tables in scripts/build_orbis_states.mjs (curated from historical atlases)',
    },
  };
  await writeFile(new URL('../orbis_map_meta.js', import.meta.url), `window.ORBIS_MAP_META = ${JSON.stringify(meta, null, 0)};\n`);
  await writeFile(new URL('../data/state_id_migration.json', import.meta.url), JSON.stringify(migration, null, 2));

  const nationRegions = JSON.parse(await readFile(new URL('../data/orbis_nation_regions.json', import.meta.url), 'utf8'));
  const missingNations = Object.keys(nationRegions).filter(id => !meta.countryCounts[id]);
  if (missingNations.length) console.error('Missing playable nations:', missingNations);
  const low = Object.entries(meta.countryCounts).filter(([, n]) => n < 2).map(([id]) => id);
  if (low.length) console.warn('Nations with <2 provinces:', low);
  if (overrideMisses.length) console.warn('ISO overrides with no match:', overrideMisses);
  console.log('Built', regions.length, 'land regions +', seaZones.length, 'sea zones;', units.length, 'units');
  console.log('Output size bytes', json.length);
  console.log('Dropped ADM0:', dropped.map(([k, v]) => `${k.slice(8)}(${v})`).join(' ') || 'none');
}

main().catch(err => { console.error(err); process.exit(1); });
