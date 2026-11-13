'use strict';
/** Human-readable labels for admin-1 regions when nameJa is a slug. (1932-03-01 historical nomenclature) */
window.ORBIS_REGION_LABELS = (() => {
  const JP = {
    '01': '北海道', '02': '青森県', '03': '岩手県', '04': '宮城県', '05': '秋田県', '06': '山形県', '07': '福島県',
    '08': '茨城県', '09': '栃木県', '10': '群馬県', '11': '埼玉県', '12': '千葉県', '13': '東京府', '14': '神奈川県',
    '15': '新潟県', '16': '富山県', '17': '石川県', '18': '福井県', '19': '山梨県', '20': '長野県', '21': '岐阜県',
    '22': '静岡県', '23': '愛知県', '24': '三重県', '25': '滋賀県', '26': '京都府', '27': '大阪府', '28': '兵庫県',
    '29': '奈良県', '30': '和歌山県', '31': '鳥取県', '32': '島根県', '33': '岡山県', '34': '広島県', '35': '山口県',
    '36': '徳島県', '37': '香川県', '38': '愛媛県', '39': '高知県', '40': '福岡県', '41': '佐賀県', '42': '長崎県',
    '43': '熊本県', '44': '大分県', '45': '宮崎県', '46': '鹿児島県', '47': '沖縄県',
  };
  const CN = {
    bj: '北平市',
    sh: '上海市',
    tj: '天津市',
    cq: '四川省東部（重慶・劉湘）',
    sc: '四川省西部（成都・劉文輝）',
    ln: '奉天省（遼寧）',
    jl: '吉林省',
    hl: '黒竜江省',
    jx: '江西省北部（南昌）',
    gd: '広東省（西南派・陳済棠）',
    gx: '広西省（新広西派・李宗仁/白崇禧）',
    sx: '山西省（晋系・閻錫山）',
    sd: '山東省（韓復榘）',
    xj: '新疆省（金樹仁）',
    qh: '青海省（馬家軍・馬歩芳）',
    nx: '寧夏省（馬家軍・馬鴻逵）',
    yn: '雲南省（龍雲）',
    xz: '西蔵（チベット・ガンデンポタン）',
    he: '河北省',
    js: '江蘇省',
    zj: '浙江省',
    ah: '安徽省',
    fj: '福建省',
    ha: '河南省',
    hb: '湖北省',
    hn: '湖南省',
    gz: '貴州省',
    sn: '陝西省',
    gs: '甘粛省',
    hi: '広東省（海南島）',
  };
  const DE = {
    by: 'バイエルン自由州',
    pr: 'プロイセン自由州',
    bb: 'ブランデンブルク（プロイセン州）',
    bw: 'ヴュルテンベルク・バーデン',
    nw: 'ラインラント・ヴェストファーレン',
    ni: 'ハノーファー（プロイセン州）・オルデンブルク',
    sn: 'ザクセン自由州',
    th: 'テューリンゲン州',
    he: 'ヘッセン人民州',
    mv: 'メクレンブルク自由州',
    st: 'ザクセン州（プロイセン）',
    rp: 'ラインヘッセン・ファルツ',
    sh: 'シュレースヴィヒ＝ホルシュタイン',
    sl: 'ザール地方（国際連盟管理）',
    be: 'ベルリン特別市',
    hh: '自由ハンザ都市ハンブルク',
    hb: '自由ハンザ都市ブレーメン'
  };

  const SPECIAL_IDS = {
    'japan_empire_kwantung': '関東州（大連・旅順）',
    'japan_empire_kor': '朝鮮',
    'japan_empire_rus_11_6': '南樺太（樺太庁）・千島',
    'japan_empire_pacific': '南洋群島（委任統治領）',
    'cn_dongbei': '吉林省（新京）',
    'manchukuo_xingan': '興安省（ホロンバイル）',
    'manchukuo_jehol': '熱河省',
    'china_jehol': '熱河省（東北軍・湯玉麟）',
    'china_chahar': '察哈爾省（宋哲元・第29軍）',
    'china_suiyuan': '綏遠省（傅作義）',
    'china_ruijin_soviet': '中央蘇区（瑞金・中華ソビエト共和国）',
    'china_xikang': '西康省（康定・川辺係争地）',
    'china_cn_cq': '四川省東部（重慶・劉湘）',
    'china_cn_sc': '四川省（成都・劉文輝）',
    'china_cn_jx': '江西省（南昌）',
    'france_guangzhouwan': '広州湾（フランス租借地）',
    'france_hatay': 'アレクサンドレッタ（ハタイ）',
    'germany_saar': 'ザール地方（国際連盟管理）',
    'de_rhineland': 'ラインラント・ヴェストファーレン',
    'finland_karelia': 'カレリア（ヴィープリ）',
    'finland_petsamo': 'ペツァモ',
    'poland_wilno_nowogrodek': 'ヴィルノ・ノヴォグルデク',
    'romania_bessarabia_south': '南ベッサラビア（ブジャク）',
    'spain_sp_morocco': 'スペイン領モロッコ',
    'uk_newfoundland': 'ニューファンドランド',
    'uk_aden': 'アデン保護領',
    'bolivia_chaco_boreal': 'チャコ・ボレアール',
  };

  const slugLike = text => typeof text === 'string' && /^[a-z0-9 _.-]+$/i.test(text.trim());
  function fromId(id) {
    if (!id || typeof id !== 'string') return '';
    if (SPECIAL_IDS[id]) return SPECIAL_IDS[id];
    let m = id.match(/^japan_jp_(\d{1,2})$/i);
    if (m) return JP[m[1].padStart(2, '0')] || `日本・地域${m[1]}`;
    if (/^japan_empire_(kor|prk)/i.test(id)) return '朝鮮';
    if (/^japan_empire_twn/i.test(id)) return '台湾';
    if (/^japan_empire_rus/i.test(id)) return '南樺太（樺太庁）・千島';
    if (/^japan_empire_pacific/i.test(id)) return '南洋群島（委任統治領）';
    if (/kwantung|guandong|dalian|ryojun|port_arthur/i.test(id)) return '関東州（大連・旅順）';
    m = id.match(/^china_cn_([a-z]{2})$/i);
    if (m) return CN[m[1].toLowerCase()] || `中国・${m[1].toUpperCase()}`;
    if (/jehol|rehe/i.test(id)) return '熱河省（東北軍・湯玉麟）';
    if (/chahar/i.test(id)) return '察哈爾省（宋哲元・第29軍）';
    if (/suiyuan/i.test(id)) return '綏遠省（傅作義）';
    if (/ruijin/i.test(id)) return '中央蘇区（瑞金・中華ソビエト共和国）';
    if (/xikang/i.test(id)) return '西康省（康定・川辺係争地）';
    if (/xingan/i.test(id)) return '興安省（ホロンバイル）';
    if (id.startsWith('manchukuo') || id === 'cn_dongbei') return '満洲国';
    m = id.match(/^germany_de_([a-z]{2})$/i);
    if (m && DE[m[1].toLowerCase()]) return DE[m[1].toLowerCase()];
    if (id === 'de_rhineland') return 'ラインラント・ヴェストファーレン';
    if (id === 'germany_east_prussia') return '東プロイセン自由州';
    if (id === 'germany_pomerania') return 'ポンメルン（プロイセン）';
    if (id === 'germany_silesia') return 'シレジア（プロイセン）';
    if (id.startsWith('germany_de_')) return `ドイツ・${id.split('_').pop().toUpperCase()}`;
    if (id.startsWith('usa_us_')) return `米国・${id.split('_').pop().toUpperCase()}`;
    return '';
  }
  function displayName(region) {
    if (!region) return '';
    const fromMeta = fromId(region.id);
    if (fromMeta) return fromMeta;
    const ja = region.nameJa || '';
    if (ja && !slugLike(ja)) return ja;
    const en = region.name || region.id || '';
    if (en && !slugLike(en)) return en;
    return region.id?.replace(/_/g, ' ') || '';
  }
  return Object.freeze({ displayName, fromId });
})();
