'use strict';
/**
 * ORBIS//1932 — 文章用の史実辞書・Wikipediaリンク・国名旗表示。
 * 入力は必ず先にHTMLエスケープし、許可した <a> と既存の国旗マークアップだけを後から挿入する。
 */
window.OrbisText = (() => {
  const WIKI_BASE = 'https://ja.wikipedia.org/wiki/';

  const COUNTRY_INFO = {
    japan: { name: '大日本帝国', wiki: '大日本帝国', aliases: ['日本国', '日本'] },
    china: { name: '中華民国', wiki: '中華民国', aliases: ['南京国民政府', '国民政府', '中国'] },
    tibet: { name: 'チベット', wiki: 'チベット', aliases: ['チベット国', 'ラサ政府'] },
    manchukuo: { name: '満洲国', wiki: '満洲国', aliases: ['満州国'] },
    mongolia: { name: 'モンゴル人民共和国', wiki: 'モンゴル人民共和国', aliases: ['モンゴル'] },
    usa: { name: 'アメリカ合衆国', wiki: 'アメリカ合衆国', aliases: ['アメリカ', '米国', '合衆国'] },
    uk: { name: '大英帝国', wiki: '大英帝国', aliases: ['イギリス', '英国', '連合王国'] },
    france: { name: 'フランス共和国', wiki: 'フランス第三共和政', aliases: ['フランス'] },
    germany: { name: 'ドイツ国', wiki: 'ドイツ国', aliases: ['ドイツ', '独国', 'ヴァイマル共和政', 'ワイマール共和政'] },
    russia: { name: 'ソビエト連邦', wiki: 'ソビエト連邦', aliases: ['ソビエト社会主義共和国連邦', 'ソ連', 'ソビエト', 'ロシア'] },
    italy: { name: 'イタリア王国', wiki: 'イタリア王国', aliases: ['イタリア'] },
    poland: { name: 'ポーランド共和国', wiki: 'ポーランド第二共和国', aliases: ['ポーランド'] },
    spain: { name: 'スペイン共和国', wiki: 'スペイン第二共和政', aliases: ['スペイン'] },
    portugal: { name: 'ポルトガル共和国', wiki: 'ポルトガル第一共和政', aliases: ['ポルトガル'] },
    turkey: { name: 'トルコ共和国', wiki: 'トルコ', aliases: ['トルコ'] },
    iran: { name: 'ペルシア帝国', wiki: 'パフラヴィー朝', aliases: ['イラン', 'ペルシア'] },
    saudi_arabia: { name: 'サウジアラビア王国', wiki: 'サウジアラビア', aliases: ['サウジアラビア'] },
    egypt: { name: 'エジプト王国', wiki: 'エジプト王国', aliases: ['エジプト'] },
    ethiopia: { name: 'エチオピア帝国', wiki: 'エチオピア帝国', aliases: ['エチオピア'] },
    south_africa: { name: '南アフリカ連邦', wiki: '南アフリカ連邦', aliases: ['南アフリカ'] },
    india: { name: '英領インド帝国', wiki: 'イギリス領インド帝国', aliases: ['英領インド', 'インド'] },
    dutch_indies: { name: '蘭領東インド', wiki: 'オランダ領東インド', aliases: ['オランダ領東インド', '東インド'] },
    australia: { name: 'オーストラリア連邦', wiki: 'オーストラリア', aliases: ['オーストラリア'] },
    new_zealand: { name: 'ニュージーランド自治領', wiki: 'ニュージーランド', aliases: ['ニュージーランド'] },
    canada: { name: 'カナダ自治領', wiki: 'カナダ', aliases: ['カナダ'] },
    mexico: { name: 'メキシコ合衆国', wiki: 'メキシコ', aliases: ['メキシコ'] },
    brazil: { name: 'ブラジル合衆国', wiki: 'ブラジル', aliases: ['ブラジル'] },
    argentina: { name: 'アルゼンチン共和国', wiki: 'アルゼンチン', aliases: ['アルゼンチン'] },
    venezuela: { name: 'ベネズエラ合衆国', wiki: 'ベネズエラ', aliases: ['ベネズエラ'] },
    colombia: { name: 'コロンビア共和国', wiki: 'コロンビア', aliases: ['コロンビア'] },
    ecuador: { name: 'エクアドル共和国', wiki: 'エクアドル', aliases: ['エクアドル'] },
    peru: { name: 'ペルー共和国', wiki: 'ペルー', aliases: ['ペルー'] },
    bolivia: { name: 'ボリビア共和国', wiki: 'ボリビア', aliases: ['ボリビア'] },
    chile: { name: 'チリ共和国', wiki: 'チリ', aliases: ['チリ'] },
    uruguay: { name: 'ウルグアイ東方共和国', wiki: 'ウルグアイ', aliases: ['ウルグアイ'] },
    paraguay: { name: 'パラグアイ共和国', wiki: 'パラグアイ', aliases: ['パラグアイ'] },
    cuba: { name: 'キューバ共和国', wiki: 'キューバ', aliases: ['キューバ'] },
    guatemala: { name: 'グアテマラ共和国', wiki: 'グアテマラ', aliases: ['グアテマラ'] },
    el_salvador: { name: 'エルサルバドル共和国', wiki: 'エルサルバドル', aliases: ['エルサルバドル'] },
    honduras: { name: 'ホンジュラス共和国', wiki: 'ホンジュラス', aliases: ['ホンジュラス'] },
    nicaragua: { name: 'ニカラグア共和国', wiki: 'ニカラグア', aliases: ['ニカラグア'] },
    costa_rica: { name: 'コスタリカ共和国', wiki: 'コスタリカ', aliases: ['コスタリカ'] },
    panama: { name: 'パナマ共和国', wiki: 'パナマ', aliases: ['パナマ'] },
    haiti: { name: 'ハイチ共和国', wiki: 'ハイチ', aliases: ['ハイチ'] },
    dominican: { name: 'ドミニカ共和国', wiki: 'ドミニカ共和国', aliases: ['ドミニカ'] },
    ireland: { name: 'アイルランド自由国', wiki: 'アイルランド自由国', aliases: ['アイルランド'] },
    siam: { name: 'シャム王国', wiki: 'シャム王国', aliases: ['シャム'] },
    afghanistan: { name: 'アフガニスタン王国', wiki: 'アフガニスタン王国', aliases: ['アフガニスタン'] },
    czechoslovakia: { name: 'チェコスロバキア共和国', wiki: 'チェコスロバキア', aliases: ['チェコスロバキア'] },
    austria: { name: 'オーストリア共和国', wiki: 'オーストリア第一共和国', aliases: ['オーストリア'] },
    switzerland: { name: 'スイス連邦', wiki: 'スイス', aliases: ['スイス'] },
    hungary: { name: 'ハンガリー王国', wiki: 'ハンガリー王国 (1920年-1946年)', aliases: ['ハンガリー'] },
    bulgaria: { name: 'ブルガリア王国', wiki: 'ブルガリア王国 (近代)', aliases: ['ブルガリア'] },
    romania: { name: 'ルーマニア王国', wiki: 'ルーマニア王国', aliases: ['ルーマニア'] },
    yugoslavia: { name: 'ユーゴスラビア王国', wiki: 'ユーゴスラビア王国', aliases: ['ユーゴスラビア'] },
    greece: { name: 'ギリシャ王国', wiki: 'ギリシャ王国', aliases: ['ギリシャ'] },
    albania: { name: 'アルバニア王国', wiki: 'アルバニア王国', aliases: ['アルバニア'] },
    estonia: { name: 'エストニア共和国', wiki: 'エストニア', aliases: ['エストニア'] },
    latvia: { name: 'ラトビア共和国', wiki: 'ラトビア', aliases: ['ラトビア', 'ラトヴィア'] },
    lithuania: { name: 'リトアニア共和国', wiki: 'リトアニア', aliases: ['リトアニア'] },
    sweden: { name: 'スウェーデン王国', wiki: 'スウェーデン', aliases: ['スウェーデン'] },
    denmark: { name: 'デンマーク王国', wiki: 'デンマーク', aliases: ['デンマーク'] },
    norway: { name: 'ノルウェー王国', wiki: 'ノルウェー', aliases: ['ノルウェー'] },
    finland: { name: 'フィンランド共和国', wiki: 'フィンランド', aliases: ['フィンランド'] },
    netherlands: { name: 'オランダ王国', wiki: 'オランダ', aliases: ['オランダ'] },
    belgium: { name: 'ベルギー王国', wiki: 'ベルギー', aliases: ['ベルギー'] },
    luxembourg: { name: 'ルクセンブルク大公国', wiki: 'ルクセンブルク', aliases: ['ルクセンブルク'] }
  };

  // 短い略称が日本語の複合語の一部になった場合に、国名置換で文章を壊さないためのガード。
  const GENERAL_GUARD = '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|製品|資本|企業|大使館|領事館|当局|側|国内|国外)';
  const COUNTRY_GUARDS = {
    japan: '(?!人|語|円|国|政府|軍|海|側|当局|国内|国外|列島|民族|文化|史|式|風|間|中|上|下|製|産|資本|企業|社会|文学|映画|料理|庭園|建築|政治|外交|経済|放送|新聞|時間|本土|内地|占領|統治|兵|艦|航空|郵船|郵便|電気|銀行|年|月|大使館|領事館|租界|製品)',
    china: '(?!人|語|共産党|共産|軍|大陸|政府|社会|文化|史|料理|経済|外交|国内|当局|側|国民党|東北|南部|北部|西部|東部|中央|沿岸|海|艦|船|製品|産|製|系|城|式|風|画|文学|建築|庭園|武術|医学|茶|服|街)',
    usa: '(?!人|語|軍|政府|大統領|議会|経済|社会|文化|映画|製品|資本|企業|大使館|領事館|側|当局|大陸|英語|ドル)',
    uk: '(?!人|語|軍|政府|議会|経済|社会|文化|映画|製品|資本|企業|大使館|領事館|側|当局|連邦|王室|国王|女王)',
    france: '(?!人|語|軍|政府|経済|社会|文化|映画|製品|資本|企業|大使館|領事館|側|当局|革命|料理|文学|哲学|音楽|建築|車|製|パン|ワイン)',
    germany: '(?!人|語|軍|政府|経済|社会|文化|映画|製品|資本|企業|大使館|領事館|側|当局|帝国|連邦|民主|共産|社会民主党|労働者|騎士|文学|哲学|音楽|建築|車|製)',
    russia: '(?!人|語|軍|政府|共産党|崩壊|時代|経済|社会|文化|映画|製品|大使館|領事館|側|当局|指導部|政治局|赤軍)',
    italy: '(?!人|語|軍|政府|経済|社会|文化|映画|製品|資本|企業|大使館|領事館|側|当局|料理|文学|哲学|音楽|建築|車|製|ワイン)',
    mongolia: '(?!人|語|軍|政府|高原|帝国|経済|社会|文化|大使館|領事館|側|当局)',
    india: '(?!人|語|洋|国民会議|共産党|軍|政府|経済|社会|文化|映画|料理|哲学|宗教|数学|音楽|舞踊|綿|麻|鉄)',
    iran: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|哲学|宗教|数学|音楽|絨毯|猫|石油|利権|湾|高原|帝国)',
    siam: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|王国|湾|猫)',
    turkey: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|哲学|音楽|建築|絨毯|茶)',
    spain: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|哲学|音楽|建築|車|製|ワイン)',
    portugal: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製|ワイン)',
    netherlands: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|哲学|音楽|建築|車|製)',
    belgium: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製|ワッフル|チョコ)',
    switzerland: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|哲学|音楽|建築|車|製|チーズ)',
    poland: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    czechoslovakia: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    austria: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|哲学|音楽|建築|車|製)',
    hungary: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    bulgaria: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    romania: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    yugoslavia: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    greece: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|哲学|音楽|建築|車|製)',
    albania: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    estonia: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    latvia: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    lithuania: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    sweden: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    denmark: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    norway: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    finland: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    ireland: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    canada: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    australia: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    new_zealand: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    mexico: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    brazil: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    argentina: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    venezuela: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    colombia: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    ecuador: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    peru: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    bolivia: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    chile: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    uruguay: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    paraguay: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    cuba: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    guatemala: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    el_salvador: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    honduras: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    nicaragua: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    costa_rica: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    panama: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    haiti: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    dominican: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    afghanistan: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    saudi_arabia: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    egypt: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    ethiopia: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    south_africa: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    dutch_indies: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)',
    luxembourg: '(?!人|語|軍|政府|経済|社会|文化|映画|料理|文学|音楽|建築|車|製)'
  };

  const WIKI_ENTRIES = [];
  const add = (title, terms) => WIKI_ENTRIES.push({ title, terms });
  const person = (title, ...terms) => add(title, terms);
  const event = (title, ...terms) => add(title, terms);
  const place = (title, ...terms) => add(title, terms);
  const party = (title, ...terms) => add(title, terms);

  // 人物（実在が確認できる固有名のみ。ゲーム内の架空の外交官・補佐官は登録しない）
  person('犬養毅', '犬養毅', '犬養 毅');
  person('高橋是清', '高橋是清', '高橋 是清');
  person('荒木貞夫', '荒木貞夫', '荒木 貞夫');
  person('芳澤謙吉', '芳澤謙吉', '芳澤 謙吉');
  person('蔣介石', '蔣介石', '蒋介石');
  person('汪兆銘', '汪兆銘');
  person('閻錫山', '閻錫山', '閻 錫山');
  person('李宗仁', '李宗仁');
  person('白崇禧', '白崇禧');
  person('陳済棠', '陳済棠', '陈济棠');
  person('劉湘', '劉湘');
  person('劉文輝', '劉文輝');
  person('龍雲', '龍雲');
  person('韓復榘', '韓復榘');
  person('金樹仁', '金樹仁');
  person('盛世才', '盛世才');
  person('馬麟', '馬麟');
  person('馬鴻逵', '馬鴻逵');
  person('馬鴻賓', '馬鴻賓');
  person('何鍵', '何鍵');
  person('王家烈', '王家烈');
  person('傅作義', '傅作義');
  person('宋子文', '宋子文');
  person('愛新覚羅溥儀', '愛新覚羅溥儀', '溥儀');
  person('鄭孝胥', '鄭孝胥');
  person('本庄繁', '本庄繁', '本庄 繁');
  person('武藤信義', '武藤信義');
  person('フランクリン・D・ルーズベルト', 'フランクリン・D・ルーズベルト', 'フランクリン・ルーズベルト', 'ルーズベルト');
  person('ハーバート・フーヴァー', 'ハーバート・フーヴァー', 'フーヴァー');
  person('ヘンリー・スチムソン', 'ヘンリー・スチムソン', 'スチムソン');
  person('アドルフ・ヒトラー', 'アドルフ・ヒトラー', 'ヒトラー');
  person('パウル・フォン・ヒンデンブルク', 'パウル・フォン・ヒンデンブルク', 'ヒンデンブルク');
  person('ベニート・ムッソリーニ', 'ベニート・ムッソリーニ', 'ムッソリーニ');
  person('ヨシフ・スターリン', 'ヨシフ・スターリン', 'スターリン');
  person('ウィンストン・チャーチル', 'ウィンストン・チャーチル', 'チャーチル');
  person('ダグラス・マッカーサー', 'ダグラス・マッカーサー', 'マッカーサー');
  person('シャルル・ド・ゴール', 'シャルル・ド・ゴール', 'ド・ゴール');
  person('ジェトゥリオ・ヴァルガス', 'ジェトゥリオ・ヴァルガス');
  person('プルタルコ・エリアス・カジェス', 'プルタルコ・カジェス', 'プルタルコ・エリアス・カジェス');
  person('フアン・ビセンテ・ゴメス', 'フアン・ビセンテ・ゴメス');
  person('エンリケ・オラヤ・エレーラ', 'エンリケ・オラヤ・エレーラ');
  person('ルイス・ミゲル・サンチェス・セロ', 'ルイス・ミゲル・サンチェス・セロ');
  person('ダニエル・サラマンカ', 'ダニエル・サラマンカ');
  person('アグスティン・ペドロ・フスト', 'アグスティン・ペドロ・フスト');
  person('チャールズ・リンドバーグ', 'チャールズ・リンドバーグ', 'リンドバーグ');
  person('小林多喜二', '小林多喜二');
  person('美濃部達吉', '美濃部達吉');
  person('湯川秀樹', '湯川秀樹');
  person('毛沢東', '毛沢東');
  person('ホー・チ・ミン', 'ホー・チ・ミン');
  person('スカルノ', 'スカルノ');
  person('スハルト', 'スハルト');
  person('ジョン・F・ケネディ', 'ジョン・F・ケネディ');
  person('マーティン・ルーサー・キング・ジュニア', 'マーティン・ルーサー・キング・ジュニア', 'キング牧師');
  person('ユーリ・ガガーリン', 'ユーリ・ガガーリン', 'ガガーリン');
  person('ニール・アームストロング', 'ニール・アームストロング');
  person('リチャード・ニクソン', 'リチャード・ニクソン', 'ニクソン');
  person('田中角栄', '田中角栄');
  person('エリザベス2世', 'エリザベス2世');

  // 事件・戦争・条約（ゲーム内の史実DBと主要な世界史記事）
  event('中原大戦', '中原大戦', '中原大戦争');
  event('蒋桂戦争', '蒋桂戦争');
  event('福建事変', '福建事変');
  event('満州事変', '満州事変', '満洲事変');
  event('関東大震災', '関東大震災');
  event('五・一五事件', '五・一五事件');
  event('二・二六事件', '二・二六事件');
  event('第一次上海事変', '第一次上海事変', '上海事変');
  event('満洲国', '満州国建国', '満洲国建国');
  event('リットン調査団', 'リットン調査団');
  event('リットン報告書', 'リットン報告書');
  event('ジュネーヴ軍縮会議', 'ジュネーヴ軍縮会議');
  event('ローザンヌ会議', 'ローザンヌ会議');
  event('世界恐慌', '世界恐慌');
  event('オタワ会議', 'オタワ会議', 'オタワ帝国経済会議');
  event('チャコ戦争', 'チャコ戦争');
  event('立憲革命 (シャム)', 'シャム立憲革命');
  event('レティシア事件', 'レティシア紛争', 'レティシア事件');
  event('ヒトラー内閣', 'ヒトラー内閣');
  event('ドイツ国会議事堂放火事件', 'ドイツ国会議事堂放火事件', '国会議事堂放火事件');
  event('長征', '長征');
  event('長いナイフの夜', '長いナイフの夜');
  event('ニュルンベルク法', 'ニュルンベルク法');
  event('スペイン内戦', 'スペイン内戦');
  event('日独防共協定', '日独防共協定');
  event('日満議定書', '日満議定書');
  event('塘沽協定', '塘沽協定');
  event('淞滬停戦協定', '淞滬停戦協定', '上海停戦協定');
  event('日本国憲法', '日本国憲法');
  event('大日本帝国憲法', '大日本帝国憲法', '明治憲法');
  event('ベルリンオリンピック', 'ベルリンオリンピック');
  event('盧溝橋事件', '盧溝橋事件');
  event('日中戦争', '日中戦争');
  event('南京事件', '南京事件', '南京大虐殺');
  event('真珠湾攻撃', '真珠湾攻撃');
  event('マレー沖海戦', 'マレー沖海戦');
  event('ミッドウェー海戦', 'ミッドウェー海戦');
  event('ガダルカナル島の戦い', 'ガダルカナル島の戦い');
  event('スターリングラード攻防戦', 'スターリングラード攻防戦');
  event('ノルマンディー上陸作戦', 'ノルマンディー上陸作戦');
  event('ベルリンの戦い', 'ベルリンの戦い');
  event('広島市への原子爆弾投下', '広島への原爆投下', '広島原爆');
  event('長崎市への原子爆弾投下', '長崎への原爆投下', '長崎原爆');
  event('ポツダム宣言', 'ポツダム宣言');
  event('日本の降伏', '日本の降伏');
  event('極東国際軍事裁判', '極東国際軍事裁判', '東京裁判');
  event('朝鮮戦争', '朝鮮戦争');
  event('ベルリン封鎖', 'ベルリン封鎖');
  event('北大西洋条約機構', 'NATO', '北大西洋条約機構');
  event('朝鮮戦争休戦協定', '朝鮮戦争休戦協定');
  event('スエズ危機', 'スエズ危機');
  event('キューバ革命', 'キューバ革命');
  event('ベルリンの壁', 'ベルリンの壁');
  event('キューバ危機', 'キューバ危機');
  event('アポロ11号', 'アポロ11号');
  event('1964年東京オリンピック', '東京オリンピック');
  event('東海道新幹線', '東海道新幹線');
  event('文化大革命', '文化大革命');
  event('ニクソン・ショック', 'ニクソン・ショック');
  event('日中国交正常化', '日中国交正常化');
  event('沖縄返還', '沖縄返還');
  event('ウォーターゲート事件', 'ウォーターゲート事件');

  // 地名（史実の都市・地域・海域）
  place('東京', '東京');
  place('東京都', '東京都');
  place('大阪', '大阪');
  place('京都', '京都');
  place('北海道', '北海道');
  place('沖縄県', '沖縄');
  place('広島市', '広島');
  place('長崎市', '長崎');
  place('北京', '北京');
  place('上海', '上海');
  place('南京', '南京');
  place('天津', '天津');
  place('漢口', '漢口');
  place('武漢', '武漢');
  place('重慶', '重慶');
  place('長春', '長春');
  place('新京', '新京');
  place('奉天', '奉天');
  place('ハルビン', 'ハルビン', '哈爾浜');
  place('満洲', '満洲', '満州');
  place('関東地方', '関東地方');
  place('関東州', '関東州');
  place('東北地方', '東北地方');
  place('内モンゴル自治区', '内モンゴル');
  place('京城', '京城');
  place('釜山', '釜山');
  place('平壌', '平壌');
  place('台北', '台北');
  place('高雄', '高雄');
  place('ウランバートル', 'ウランバートル');
  place('モスクワ', 'モスクワ');
  place('レニングラード', 'レニングラード');
  place('キエフ', 'キエフ');
  place('シベリア', 'シベリア');
  place('ウクライナ', 'ウクライナ');
  place('カザフスタン', 'カザフスタン');
  place('ベルリン', 'ベルリン');
  place('ミュンヘン', 'ミュンヘン');
  place('ハンブルク', 'ハンブルク');
  place('ラインラント', 'ラインラント');
  place('パリ', 'パリ');
  place('ロンドン', 'ロンドン');
  place('ワシントンD.C.', 'ワシントンD.C.', 'ワシントン');
  place('ニューヨーク', 'ニューヨーク');
  place('シカゴ', 'シカゴ');
  place('ハワイ', 'ハワイ');
  place('フィリピン', 'フィリピン');
  place('サンフランシスコ', 'サンフランシスコ');
  place('ローマ', 'ローマ');
  place('ミラノ', 'ミラノ');
  place('マドリード', 'マドリード');
  place('バルセロナ', 'バルセロナ');
  place('リスボン', 'リスボン');
  place('ウィーン', 'ウィーン');
  place('プラハ', 'プラハ');
  place('ワルシャワ', 'ワルシャワ');
  place('ブダペスト', 'ブダペスト');
  place('ベオグラード', 'ベオグラード');
  place('ブカレスト', 'ブカレスト');
  place('ソフィア', 'ソフィア');
  place('アテネ', 'アテネ');
  place('イスタンブール', 'イスタンブール');
  place('アンカラ', 'アンカラ');
  place('カイロ', 'カイロ');
  place('テヘラン', 'テヘラン');
  place('リヤド', 'リヤド');
  place('エルサレム', 'エルサレム');
  place('バグダッド', 'バグダッド');
  place('ジュネーヴ', 'ジュネーヴ');
  place('ローザンヌ', 'ローザンヌ');
  place('オタワ', 'オタワ');
  place('ブエノスアイレス', 'ブエノスアイレス');
  place('リオデジャネイロ', 'リオデジャネイロ');
  place('サンパウロ', 'サンパウロ');
  place('メキシコシティ', 'メキシコシティ');
  place('ハバナ', 'ハバナ');
  place('リマ', 'リマ');
  place('ボゴタ', 'ボゴタ');
  place('サンティアゴ・デ・チレ', 'サンティアゴ');
  place('アスンシオン', 'アスンシオン');
  place('モンテビデオ', 'モンテビデオ');
  place('真珠湾', '真珠湾');
  place('ハルハ河', 'ハルハ河');
  place('ノモンハン', 'ノモンハン');
  place('満州里', '満州里');
  place('張鼓峰', '張鼓峰');
  place('硫黄島', '硫黄島');
  place('サイパン', 'サイパン');
  place('ガダルカナル島', 'ガダルカナル');
  place('太平洋', '太平洋');
  place('大西洋', '大西洋');
  place('インド洋', 'インド洋');
  place('地中海', '地中海');
  place('日本海', '日本海');
  place('極東', '極東');
  place('中東', '中東');
  place('東南アジア', '東南アジア');
  place('南アジア', '南アジア');
  place('中央アジア', '中央アジア');
  place('北アフリカ', '北アフリカ');

  // 政党・組織
  party('立憲政友会', '立憲政友会', '政友会');
  party('立憲民政党', '立憲民政党', '民政党');
  party('日本共産党', '日本共産党');
  party('中国国民党', '中国国民党', '国民党');
  party('中国共産党', '中国共産党');
  party('国家社会主義ドイツ労働者党', '国家社会主義ドイツ労働者党', 'ナチス');
  party('ファシスト党', 'ファシスト党', 'イタリア・ファシスト党');
  party('ソビエト連邦共産党', 'ソビエト連邦共産党', 'ソ連共産党');
  party('労働党 (イギリス)', 'イギリス労働党');
  party('フランス社会党', 'フランス社会党');
  party('インド国民会議', 'インド国民会議');
  party('コミンテルン', 'コミンテルン');
  party('国際連盟', '国際連盟');
  party('国際連合', '国際連合', '国連');
  party('南満洲鉄道', '南満洲鉄道', '満鉄');
  party('関東軍', '関東軍');
  party('東北軍', '東北軍');

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function wikipediaUrl(title) {
    return WIKI_BASE + encodeURIComponent(String(title || '').replace(/ /g, '_'));
  }

  function wikiLink(escapedText, title) {
    return `<a class="orbis-wiki-link" href="${wikipediaUrl(title)}" target="_blank" rel="noopener noreferrer">${escapedText}</a>`;
  }

  function flagMarkup(countryId) {
    try {
      if (typeof globalThis.getCountryFlagSvg !== 'function') return '';
      return globalThis.getCountryFlagSvg(countryId) || '';
    } catch {
      return '';
    }
  }

  function countryName(countryId, fallbackName = '') {
    return COUNTRY_INFO[countryId]?.name || fallbackName || countryId || '';
  }

  // 国名はWikipediaへ飛ばさず、ゲーム内の国家情報ポップアップを開く。
  function countryMention(countryId, fallbackName = '') {
    const info = COUNTRY_INFO[countryId];
    if (!info) return escapeHtml(fallbackName || countryId || '');
    const flag = flagMarkup(countryId);
    const name = escapeHtml(info.name);
    const linked = `<a class="orbis-wiki-link orbis-country-link" href="#" role="button" aria-haspopup="dialog" data-orbis-country="${escapeHtml(countryId)}" title="${escapeHtml(info.name)}の国家情報">${name}</a>`;
    return flag ? `<span class="orbis-country-mention">${flag}${linked}</span>` : `<span class="orbis-country-mention">${linked}</span>`;
  }

  const TERM_MAP = new Map();
  for (const entry of WIKI_ENTRIES) {
    for (const term of entry.terms) {
      if (!term || TERM_MAP.has(term)) continue;
      TERM_MAP.set(term, { type: 'wiki', title: entry.title });
    }
  }
  for (const [countryId, info] of Object.entries(COUNTRY_INFO)) {
    const terms = [info.name, ...(info.aliases || [])];
    for (const term of terms) {
      if (!term || TERM_MAP.has(term)) continue;
      TERM_MAP.set(term, { type: 'country', countryId, guard: COUNTRY_GUARDS[countryId] || GENERAL_GUARD });
    }
  }

  const TERM_PATTERN = new RegExp(
    [...TERM_MAP.keys()]
      .sort((a, b) => b.length - a.length || a.localeCompare(b, 'ja'))
      .map(term => {
        const entry = TERM_MAP.get(term);
        return `${escapeRegExp(term)}${entry.type === 'country' ? entry.guard : ''}`;
      })
      .join('|'),
    'g'
  );

  function decorate(value) {
    const escaped = escapeHtml(value);
    if (!escaped) return '';
    TERM_PATTERN.lastIndex = 0;
    return escaped.replace(TERM_PATTERN, matched => {
      const entry = TERM_MAP.get(matched);
      if (!entry) return matched;
      if (entry.type === 'wiki') return wikiLink(matched, entry.title);
      return countryMention(entry.countryId);
    });
  }

  return Object.freeze({
    decorate,
    linkify: decorate,
    escapeHtml,
    wikipediaUrl,
    countryMention,
    countryName,
    countries: COUNTRY_INFO,
    entries: WIKI_ENTRIES
  });
})();
