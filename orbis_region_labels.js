'use strict';
/** Human-readable labels for admin-1 regions when nameJa is a slug. */
window.ORBIS_REGION_LABELS = (() => {
  const JP = {
    '01': '北海道', '02': '青森県', '03': '岩手県', '04': '宮城県', '05': '秋田県', '06': '山形県', '07': '福島県',
    '08': '茨城県', '09': '栃木県', '10': '群馬県', '11': '埼玉県', '12': '千葉県', '13': '東京都', '14': '神奈川県',
    '15': '新潟県', '16': '富山県', '17': '石川県', '18': '福井県', '19': '山梨県', '20': '長野県', '21': '岐阜県',
    '22': '静岡県', '23': '愛知県', '24': '三重県', '25': '滋賀県', '26': '京都府', '27': '大阪府', '28': '兵庫県',
    '29': '奈良県', '30': '和歌山県', '31': '鳥取県', '32': '島根県', '33': '岡山県', '34': '広島県', '35': '山口県',
    '36': '徳島県', '37': '香川県', '38': '愛媛県', '39': '高知県', '40': '福岡県', '41': '佐賀県', '42': '長崎県',
    '43': '熊本県', '44': '大分県', '45': '宮崎県', '46': '鹿児島県', '47': '沖縄県',
  };
  const CN = {
    bj: '北京市', sh: '上海市', tj: '天津市', cq: '重慶市', he: '河北省', sx: '山西省', nm: '内モンゴル', ln: '遼寧省',
    jl: '吉林省', hl: '黒竜江省', js: '江蘇省', zj: '浙江省', ah: '安徽省', fj: '福建省', jx: '江西省', sd: '山東省',
    ha: '河南省', hb: '湖北省', hn: '湖南省', gd: '広東省', gx: '広西', hi: '海南省', sc: '四川省', gz: '貴州省',
    yn: '雲南省', sn: '陝西省', gs: '甘粛省', qh: '青海省', nx: '寧夏', xj: '新疆', xz: 'チベット',
  };
  const slugLike = text => typeof text === 'string' && /^[a-z0-9 _.-]+$/i.test(text.trim());
  function fromId(id) {
    if (!id || typeof id !== 'string') return '';
    let m = id.match(/^japan_jp_(\d{1,2})$/i);
    if (m) return JP[m[1].padStart(2, '0')] || `日本・地域${m[1]}`;
    if (/^japan_empire_kor/i.test(id)) return '朝鮮（南部）';
    if (/^japan_empire_prk/i.test(id)) return '朝鮮（北部）';
    if (/^japan_empire_twn/i.test(id)) return '台湾';
    if (/^japan_empire_rus/i.test(id)) return '樺太・千島';
    if (/^japan_empire_pacific/i.test(id)) return '南洋群島';
    m = id.match(/^china_cn_([a-z]{2})$/i);
    if (m) return CN[m[1].toLowerCase()] || `中国・${m[1].toUpperCase()}`;
    if (id.startsWith('manchukuo') || id === 'cn_dongbei') return '満洲国';
    if (id.startsWith('germany_de_')) return `ドイツ・${id.split('_').pop().toUpperCase()}`;
    if (id.startsWith('usa_us_')) return `米国・${id.split('_').pop().toUpperCase()}`;
    return '';
  }
  function displayName(region) {
    if (!region) return '';
    const ja = region.nameJa || '';
    if (ja && !slugLike(ja)) return ja;
    const fromMeta = fromId(region.id);
    if (fromMeta) return fromMeta;
    const en = region.name || region.id || '';
    if (en && !slugLike(en)) return en;
    return region.id?.replace(/_/g, ' ') || '';
  }
  return Object.freeze({ displayName, fromId });
})();
