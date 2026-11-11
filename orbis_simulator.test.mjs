import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { auditData } from './orbis_data_audit.mjs';

const htmlSource = await readFile(new URL('./orbis_simulator.html', import.meta.url), 'utf8');
const gameSource = await readFile(new URL('./orbis_game.js', import.meta.url), 'utf8');
const inlineScripts = [...htmlSource.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
const choices = [{ label: '条件を詰める', text: '予算の上限を明確にした上で、実施条件を協議しましょう。' }, { label: '見送る', text: '今月の実施は見送ります。代替案を示してください。' }];
const opening = () => ({ headline: '軍縮と復興のあいだ', briefing: '大恐慌が続くなか、外務省と国内勢力が相反する条件を提示した。財政の範囲で決断が求められる。', telegrams: [{ actorId: 'domestic:ig_military', subject: '防衛費の折衝', text: '防衛を維持するための予算を協議したい。軍縮を進める場合も、指揮権の保障を求める。', urgency: 'urgent', choices }, { actorId: 'ministry:usa', subject: '通商の予備協議', text: '資源通商と極東の安定について協議する用意があります。条件をご提示ください。', urgency: 'important', choices }, { actorId: 'client:manchukuo', subject: '自治と開発', text: '開発資金の援助と、現地政府の裁量を確保したい。', urgency: 'important', choices }] });
const reply = () => ({ reply: 'その条件で本国の了承を得ました。予算の上限と実施期限を明文化し、月末の正式裁定を待ちます。', stance: 'agree', memory: '予算と期限を守る条件で協議が進んだ。履行状況を注視する。', choices });
const evaluation = () => ({ headline: '交渉が月の針路を変える', article: '各国と国内勢力の交渉を受け、限られた財源を配分する方針が定まった。外交と内政にはなお課題が残る。', delta: { mil: 0, eco: 0, stb: 0, treasury: 0, prestige: 0, tension: 0 }, reasoning: [{ text: '交渉または無回答を踏まえ、今月の政策と国際情勢を評価した。', sourceActionIds: [] }], developments: [{ headline: '欧州の予算折衝', body: '金融安定と軍事費をめぐる交渉が続く。' }, { headline: '海運業界が協議', body: '国際海運各社は輸送費と信用供与の条件を見直した。' }], groups: [], relations: [], otherNations: [], actorUpdates: [], treaties: [], commitments: [], territoryChanges: [], clientChanges: [], leadershipChanges: [], memory: '今月の対話と世界の変化を記憶し、次月へ引き継ぐ。' });

let requests = [];
let respond = () => null;
const server = createServer(async (request, response) => {
  try {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    const gemini = request.url.includes('/gemini/');
    const anthropic = request.url.startsWith('/anthropic');
    const texts = gemini ? body.contents.map(item => item.parts.map(part => part.text).join('')) : body.messages.filter(item => item.role === 'user').map(item => item.content);
    const payload = texts.map(value => { try { return JSON.parse(value); } catch { return null; } }).find(value => value?.operation);
    const item = { url: request.url, headers: request.headers, body, operation: payload?.operation, context: payload?.context };
    requests.push(item);
    const custom = await respond(item);
    if (custom?.status) {
      response.writeHead(custom.status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: custom.error || 'Fixture API failure' } }));
      return;
    }
    const fallback = evaluation();
    if (item.context?.nationalAction) fallback.actionResults = [{ actionId: item.context.nationalAction.id, outcome: 'partial', text: '財源の範囲で準備段階を実施した。', effects: { mil: 0, eco: 1, stb: 0, treasury: -2, prestige: 0, tension: 0 }, relations: [], evidence: [item.context.nationalAction.id] }];
    const data = custom?.data || (item.operation === 'BRIEFING' ? opening() : item.operation === 'ACTOR' ? reply() : item.operation === 'CONNECTION_TEST' ? { ok: true } : fallback);
    const content = custom?.raw ?? JSON.stringify(data);
    const envelope = gemini ? { candidates: [{ content: { parts: [{ text: content }] }, finishReason: 'STOP' }] } : anthropic ? { content: [{ type: 'text', text: content }], stop_reason: 'end_turn' } : { choices: [{ message: { content }, finish_reason: 'stop' }] };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(envelope));
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: error.message } }));
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}`;

function harness(provider = 'custom') {
  const storage = new Map();
  const document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, activeElement: null };
  const context = vm.createContext({ console, document, fetch, URL, Blob, AbortController, AbortSignal, setTimeout, clearTimeout, crypto: webcrypto, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, addEventListener() {}, confirm: () => true });
  context.window = context;
  for (const script of inlineScripts) if (script.trim()) vm.runInContext(script, context, { timeout: 4000 });
  vm.runInContext(gameSource, context, { timeout: 4000 });
  const api = vm.runInContext('Orbis', context);
  const apiEndpoint = provider === 'gemini' ? `${endpoint}/gemini/v1beta` : `${endpoint}/${provider}`;
  api.configure({ provider, endpoint: apiEndpoint, model: provider === 'gemini' ? 'gemini-2.5-flash' : 'fixture-model', apiKey: 'TEST_ONLY_NOT_A_REAL_KEY', remember: false });
  return { api, storage, context };
}

let passed = 0;
async function check(name, run) {
  requests = [];
  respond = () => null;
  await run();
  passed++;
  console.log(`PASS ${name}`);
}
const begin = api => api.start({ nationId: 'japan', difficulty: 'standard', mandate: 'recovery', maxTurns: 12, replace: true });
const json = value => JSON.parse(JSON.stringify(value));

try {
  await check('開始 → 対話 → 条約・支持率の月次裁定 → 翌月の電報', async () => {
    const { api, storage, context } = harness();
    assert.equal(await begin(api), true);
    const initial = api.snapshot();
    assert.equal(initial.phase, 'playing');
    assert.equal(initial.briefing.telegrams.length, 3);
    assert.equal(initial.relations.japan.usa, -25);
    assert.equal(initial.relations.japan.france, -25);
    assert.equal(await api.send('輸送条件と予算上限を明記し、互恵通商協定の締結を提案します。', 'ministry:usa', 'private'), true);
    const afterChat = api.snapshot();
    assert.equal(afterChat.completedTurns, 0);
    assert.equal(afterChat.usedActions, 1);
    assert.deepEqual(json(afterChat.nations), json(initial.nations));
    assert.equal(afterChat.treasury, initial.treasury);
    respond = item => {
      if (item.operation !== 'RESOLUTION') return null;
      const data = evaluation();
      const action = item.context.conversations[0];
      data.delta = { mil: 0, eco: 3, stb: 3, treasury: -8, prestige: 3, tension: -2 };
      data.groups = [{ groupId: 'ig_industrialists', delta: 5, reason: '通商条件が明確になったため。', sourceActionIds: [action.id] }, { groupId: 'ig_labor', delta: 4, reason: '輸出回復で雇用が改善する見通し。', sourceActionIds: [action.id] }];
      data.relations = [{ a: 'japan', b: 'usa', delta: 8, reason: '具体的な合意。' }];
      data.treaties = [{ nationId: 'usa', type: 'trade', title: '日米互恵通商協定', terms: '輸送費と輸出枠の相互保証。', duration: 4, sourceActionId: action.id }];
      return { data };
    };
    assert.equal(await api.finishTurn(), true);
    const next = api.snapshot();
    assert.equal(next.completedTurns, 1);
    assert.equal(next.phase, 'playing');
    assert.equal(next.usedActions, 0);
    assert.equal(next.nations.japan.groups.ig_industrialists, 69);
    assert.equal(next.nations.japan.groups.ig_labor, 49);
    assert.equal(next.relations.japan.usa, -17);
    assert.equal(next.relations.usa.japan, -17);
    assert.equal(next.treaties.length, 1);
    assert.equal(next.treaties[0].secret, true);
    assert.equal(requests.at(-1).context.date, '1932年4月');
    assert.equal(requests.at(-1).context.worldMemory, next.worldMemory);
    assert.ok(next.articles.some(article => article.kind === 'resolution' && article.changes.eco === 2));
    const serialized = storage.get('orbis_campaign_v4');
    assert.ok(serialized);
    assert.ok(!serialized.includes('TEST_ONLY_NOT_A_REAL_KEY'));
    const { api: restored } = harness();
    assert.equal(await restored.restore(JSON.parse(serialized)), true);
    assert.equal(restored.snapshot().completedTurns, 1);
    assert.equal(restored.snapshot().treaties[0].title, '日米互恵通商協定');
    console.log(`  Data: ${vm.runInContext('Object.keys(SCENARIOS.era_1932.nations).length', context)} nations, ${vm.runInContext('ORBIS_STATES_DB.length', context)} regions`);
  });

  await check('秘密電報の視点分離と、公式声明の共有', async () => {
    const { api } = harness();
    await begin(api);
    await api.send('PRIVATE_SECRET_731：融資の裏条件を協議します。', 'ministry:usa', 'private');
    await api.send('我が軍の今月の配備案を示してください。', 'domestic:ig_military', 'private');
    const military = requests.filter(item => item.operation === 'ACTOR').at(-1);
    assert.ok(!JSON.stringify(military.context).includes('PRIVATE_SECRET_731'));
    await api.send('PUBLIC_STATEMENT_905：軍縮協議の継続を公表します。', 'adviser', 'official');
    await api.send('共同声明について意見を伺います。', 'client:manchukuo', 'private');
    const foreign = requests.filter(item => item.operation === 'ACTOR').at(-1);
    assert.ok(JSON.stringify(foreign.context.publicStatements).includes('PUBLIC_STATEMENT_905'));
    assert.ok(!JSON.stringify(foreign.context).includes('PRIVATE_SECRET_731'));
  });

  await check('通信失敗・不正JSONで、時間や交渉枠を失わない', async () => {
    const { api } = harness();
    await begin(api);
    const before = api.snapshot();
    respond = item => item.operation === 'ACTOR' ? { status: 500 } : null;
    assert.equal(await api.send('失敗する交渉', 'ministry:usa'), false);
    let after = api.snapshot();
    assert.equal(after.usedActions, 0);
    assert.equal(after.completedTurns, 0);
    assert.equal(after.threads['ministry:usa'].messages.length, before.threads['ministry:usa'].messages.length);
    assert.equal(after.threads['ministry:usa'].draft, '失敗する交渉');
    respond = item => item.operation === 'ACTOR' ? { raw: '{"reply": "途中で切れた回答"' } : null;
    const callsBefore = requests.length;
    assert.equal(await api.send('不正JSONの交渉', 'ministry:usa'), false);
    assert.equal(requests.length - callsBefore, 2, '形式修正は一度だけ');
    after = api.snapshot();
    assert.equal(after.usedActions, 0);
    assert.deepEqual(json(after.nations), json(before.nations));
    let repair = false;
    respond = item => {
      if (item.operation === 'ACTOR' && !repair) { repair = true; return { raw: 'JSONでない回答' }; }
      return null;
    };
    assert.equal(await api.send('形式を修正して受け付ける交渉', 'ministry:usa'), true);
    assert.equal(api.snapshot().usedActions, 1);
  });

  await check('月次裁定後の受信失敗を再開しても、裁定を二重適用しない', async () => {
    const { api } = harness();
    await begin(api);
    let failOpening = true;
    respond = item => {
      if (item.operation === 'BRIEFING' && item.context.turn === 2 && failOpening) { failOpening = false; return { status: 503 }; }
      return null;
    };
    assert.equal(await api.finishTurn(), false);
    assert.equal(api.snapshot().completedTurns, 1);
    assert.equal(api.snapshot().phase, 'briefing');
    const balance = api.snapshot().treasury;
    assert.equal(await api.retryBriefing(), true);
    assert.equal(api.snapshot().completedTurns, 1);
    assert.equal(api.snapshot().treasury, balance);
    assert.equal(requests.filter(item => item.operation === 'RESOLUTION').length, 1);
  });

  await check('二重送信防止と、交渉枠の上限', async () => {
    const { api } = harness();
    await begin(api);
    const results = await Promise.all([api.send('最初の交渉', 'ministry:usa'), api.send('二重送信', 'ministry:usa')]);
    assert.deepEqual(results, [true, false]);
    for (let i = 1; i < 6; i++) assert.equal(await api.send(`条件を詰める ${i}`, 'ministry:usa'), true);
    const callCount = requests.length;
    assert.equal(await api.send('上限を超える交渉', 'ministry:usa'), false);
    assert.equal(api.snapshot().usedActions, 6);
    assert.equal(requests.length, callCount);
    assert.equal(api.snapshot().completedTurns, 0);
  });

  await check('Gemini / OpenAI / Claude / OpenRouter の実HTTPリクエスト形式', async () => {
    for (const provider of ['gemini', 'openai', 'anthropic', 'openrouter']) {
      const { api } = harness(provider);
      assert.equal(await begin(api), true, provider);
      const request = requests.at(-1);
      assert.ok(!request.url.includes('TEST_ONLY_NOT_A_REAL_KEY'));
      if (provider === 'gemini') {
        assert.equal(request.headers['x-goog-api-key'], 'TEST_ONLY_NOT_A_REAL_KEY');
        assert.ok(request.url.endsWith('/models/gemini-2.5-flash:generateContent'));
        assert.equal(request.body.generationConfig.responseMimeType, 'application/json');
        assert.ok(request.body.systemInstruction.parts[0].text.includes('OPERATION: BRIEFING'));
      } else if (provider === 'anthropic') {
        assert.equal(request.headers['x-api-key'], 'TEST_ONLY_NOT_A_REAL_KEY');
        assert.equal(request.headers['anthropic-dangerous-direct-browser-access'], 'true');
        assert.ok(request.body.system.includes('OPERATION: BRIEFING'));
        assert.ok(request.body.messages.every(item => item.role !== 'system'));
      } else {
        assert.equal(request.headers.authorization, 'Bearer TEST_ONLY_NOT_A_REAL_KEY');
        assert.ok(request.body.messages.some(item => item.role === 'system'));
        assert.equal(provider === 'openai' ? request.body.max_completion_tokens : request.body.max_tokens, 5000);
      }
    }
  });

  await check('異常な増分・重複更新・資金不足をゲーム側で制限', async () => {
    const { api } = harness();
    await begin(api);
    await api.send('実行可能な範囲で投資する。', 'ministry:usa');
    const before = api.snapshot();
    respond = item => {
      if (item.operation !== 'RESOLUTION') return null;
      const data = evaluation();
      data.delta = { mil: 999, eco: 999, stb: 999, treasury: 999, prestige: 999, tension: -999 };
      data.groups = Array.from({ length: 4 }, () => ({ groupId: 'ig_industrialists', delta: 999, reason: '重複した増分。', sourceActionIds: [item.context.conversations[0].id] }));
      data.relations = Array.from({ length: 2 }, () => ({ a: 'japan', b: 'usa', delta: 999, reason: '重複した関係変化。' }));
      data.otherNations = Array.from({ length: 2 }, () => ({ nationId: 'usa', mil: 999, eco: 999, stb: 999 }));
      return { data };
    };
    assert.equal(await api.finishTurn(), true);
    const after = api.snapshot();
    assert.ok(after.treasury < before.treasury, '増強には財源を使う');
    assert.ok(after.nations.japan.mil - before.nations.japan.mil <= 4);
    assert.ok(after.nations.japan.groups.ig_industrialists - before.nations.japan.groups.ig_industrialists <= 8);
    assert.equal(after.relations.japan.usa - before.relations.japan.usa, 12);
    assert.equal(after.nations.usa.mil - before.nations.usa.mil, 3);
    assert.ok(Object.values(after.nations).every(nation => ['mil', 'eco', 'stb'].every(key => Number.isFinite(nation[key]) && nation[key] >= 0 && (key === 'stb' ? nation[key] <= 100 : true))));
  });

  await check('軍事・経済は上限なし（100超のセーブを受理）', async () => {
    const { api } = harness();
    await begin(api);
    const save = json(api.snapshot());
    save.nations.japan.mil = 128;
    save.nations.japan.eco = 145;
    assert.equal(await api.restore(save), true);
    const after = api.snapshot();
    assert.equal(after.nations.japan.mil, 128);
    assert.equal(after.nations.japan.eco, 145);
    assert.ok(after.nations.japan.stb >= 0 && after.nations.japan.stb <= 100);
  });

  await check('約束の期限切れと、履行記録の一度だけの適用', async () => {
    const { api } = harness();
    await begin(api);
    await api.send('翌月末までに予算案を提示します。', 'domestic:ig_military');
    let made = false;
    respond = item => {
      if (item.operation !== 'RESOLUTION' || made) return null;
      made = true;
      const data = evaluation();
      data.commitments = [{ id: '', actorId: 'domestic:ig_military', status: 'active', title: '予算案の提示', detail: '翌月末までに予算案を出す。', dueIn: 1, sourceActionId: item.context.conversations[0].id }];
      return { data };
    };
    assert.equal(await api.finishTurn(), true);
    assert.equal(api.snapshot().commitments[0].status, 'active');
    const pledged = api.snapshot();
    assert.equal(await api.finishTurn(), true);
    assert.equal(api.snapshot().commitments[0].status, 'broken');
    assert.equal(api.snapshot().cumulative.broken, 1);
    assert.equal(await api.finishTurn(), true);
    assert.equal(api.snapshot().cumulative.broken, 1);
    await api.restore(pledged);
    await api.send('約束した予算案を提出します。今月の財源の範囲で実行してください。', 'domestic:ig_military');
    respond = item => {
      if (item.operation !== 'RESOLUTION') return null;
      const data = evaluation();
      data.commitments = [{ ...item.context.commitments[0], status: 'fulfilled', detail: '予算案の提示を完了。', dueIn: 1, sourceActionId: item.context.conversations[0].id }];
      return { data };
    };
    assert.equal(await api.finishTurn(), true);
    assert.equal(api.snapshot().commitments[0].status, 'fulfilled');
    assert.equal(api.snapshot().cumulative.fulfilled, 1);
    assert.equal(api.snapshot().cumulative.broken, 0);
    respond = () => null;
    await api.finishTurn();
    assert.equal(api.snapshot().cumulative.fulfilled, 1);
  });

  await check('領土の合意移管・従属国の自治・権限のない条約の拒否', async () => {
    const { api, context } = harness();
    await begin(api);
    await api.send('境界線について限定的な移管合意を協議します。', 'ministry:china');
    await api.send('現地の自治権を拡大する代わりに、開発事業の監督を共有します。', 'client:manchukuo');
    await api.send('対米軍事作戦の実現可能性を検討してください。', 'adviser');
    await api.send('貴団体との提携を国同士の同盟として扱ってください。', 'foreign_group:usa');
    const chineseRegion = vm.runInContext("ORBIS_STATES_DB.find(item => item.country === 'china' && !item.isSea).id", context);
    const usRegion = vm.runInContext("ORBIS_STATES_DB.find(item => item.country === 'usa' && !item.isSea).id", context);
    respond = item => {
      if (item.operation !== 'RESOLUTION') return null;
      const data = evaluation();
      const actions = item.context.conversations;
      data.delta.treasury = -8;
      data.delta.tension = 3;
      data.territoryChanges = [{ stateId: chineseRegion, to: 'japan', basis: 'negotiated', reason: '双方政府が限定的な境界移管に合意。', sourceActionId: actions[0].id }, { stateId: usRegion, to: 'japan', basis: 'military', reason: '実力が足りない軍事移管案。', sourceActionId: actions[2].id }];
      data.clientChanges = [{ nationId: 'manchukuo', autonomyDelta: 4, loyaltyDelta: -2, reason: '自治権の条件を再交渉。', sourceActionId: actions[1].id }];
      data.treaties = [{ nationId: 'usa', type: 'defense', title: '産業団体による国家同盟案', terms: '権限のない相手との同盟。', duration: 4, sourceActionId: actions[3].id }];
      return { data };
    };
    assert.equal(await api.finishTurn(), true);
    const saved = api.snapshot();
    assert.equal(saved.territories[chineseRegion], 'japan');
    assert.ok(!Object.hasOwn(saved.territories, usRegion));
    assert.equal(saved.clients.manchukuo.autonomy, 29);
    assert.equal(saved.clients.manchukuo.loyalty, 63);
    assert.equal(saved.treaties.length, 0);
    assert.equal(vm.runInContext(`state.states.find(item => item.id === '${chineseRegion}').country`, context), 'japan');
    assert.equal(await api.restore(saved), true);
    assert.equal(api.snapshot().territories[chineseRegion], 'japan');
  });

  await check('全国家で開始・各自の回線・翌月への進行が成立', async () => {
    const { api, context } = harness();
    respond = item => {
      if (item.operation !== 'BRIEFING') return null;
      const roster = item.context.roster;
      const domestic = roster.find(actor => actor.kind === 'domestic');
      const foreign = roster.find(actor => actor.kind === 'ministry');
      const third = roster.find(actor => actor.kind === 'client' && actor.id !== foreign.id) || roster.find(actor => actor.kind === 'ministry' && actor.id !== foreign.id);
      return { data: { headline: '国ごとに異なる交渉の出発点', briefing: '国内勢力と外国政府が条件を示し、新たな交渉が始まる。', telegrams: [domestic, foreign, third].map(actor => ({ actorId: actor.id, subject: '新政権への協議要請', text: '自国と組織の利益を守るため、具体的な条件を協議したい。', urgency: 'important', choices })) } };
    };
    const nationIds = vm.runInContext('Object.keys(SCENARIOS.era_1932.nations)', context);
    for (const nationId of nationIds) {
      assert.equal(await api.start({ nationId, difficulty: 'standard', mandate: 'recovery', maxTurns: 12, replace: true }), true, nationId);
      const target = api.snapshot().briefing.telegrams[1].actorId;
      assert.notEqual(target, `ministry:${nationId}`);
      assert.equal(await api.send('外交と財政に見合う協議条件を提示してください。', target), true, nationId);
      assert.equal(await api.finishTurn(), true, nationId);
      assert.equal(api.snapshot().completedTurns, 1, nationId);
      assert.equal(api.snapshot().phase, 'playing', nationId);
      assert.equal(await api.restore(api.snapshot()), true, `${nationId}: 保存から再開`);
    }
  });

  await check('支出を抑えた復興戦略で、標準難易度の国家目標を達成可能', async () => {
    const { api } = harness();
    await begin(api);
    respond = item => {
      if (item.operation !== 'RESOLUTION') return null;
      const data = evaluation();
      data.delta = { mil: 0, eco: 2, stb: 1, treasury: -4, prestige: 0, tension: 0 };
      data.reasoning = [{ text: '財政4以内の公共事業を続け、軍部には現状の防衛予算を説明した。', sourceActionIds: item.context.conversations.map(action => action.id) }];
      return { data };
    };
    for (let turn = 0; turn < 12; turn++) {
      assert.equal(await api.send('現状の国防予算を維持し、公共事業との両立を協議します。', 'domestic:ig_military'), true);
      assert.equal(await api.send('今月は財政4を上限に、段階的な復興事業と生活安定策を実施してください。', 'adviser'), true);
      assert.equal(await api.finishTurn(), true);
    }
    const final = api.snapshot();
    assert.equal(final.ending.result, 'victory');
    assert.ok(final.treasury >= 20);
    assert.ok(final.nations.japan.eco >= 78);
    assert.ok(final.nations.japan.stb >= 60);
    assert.ok(final.tension <= 70);
  });

  await check('12か月完走と、終了後のAPI呼び出し停止', async () => {
    const { api } = harness();
    await begin(api);
    for (let turn = 0; turn < 12; turn++) assert.equal(await api.finishTurn(), true);
    const final = api.snapshot();
    assert.equal(final.completedTurns, 12);
    assert.equal(final.phase, 'ended');
    assert.equal(final.ending.result, 'survived');
    assert.equal(requests.filter(item => item.operation === 'BRIEFING').length, 12);
    const callCount = requests.length;
    assert.equal(await api.finishTurn(), false);
    assert.equal(await api.send('任期終了後の交渉', 'ministry:usa'), false);
    assert.equal(requests.length, callCount);
    const restored = harness().api;
    assert.equal(await restored.restore(final), true);
    assert.equal(restored.snapshot().phase, 'ended');
  });

  await check('財政危機の猶予・回復・2か月連続時の敗北', async () => {
    const { api } = harness();
    await begin(api);
    const poor = api.snapshot();
    poor.treasury = 0;
    await api.restore(poor);
    respond = item => {
      if (item.operation !== 'RESOLUTION') return null;
      const data = evaluation();
      data.delta.treasury = -18;
      return { data };
    };
    await api.finishTurn();
    assert.equal(api.snapshot().stress.bankruptcy, 1);
    assert.equal(api.snapshot().ending, null);
    const grace = api.snapshot();
    await api.finishTurn();
    assert.equal(api.snapshot().ending.result, 'defeat');
    assert.equal(api.snapshot().completedTurns, 2);
    respond = () => null;
    await api.restore(grace);
    await api.finishTurn();
    assert.ok(api.snapshot().treasury > 0);
    assert.equal(api.snapshot().stress.bankruptcy, 0);
    assert.equal(api.snapshot().ending, null);
  });

  await check('破損セーブ・APIキーの混入・プロトタイプ汚染を拒否', async () => {
    const { api } = harness();
    await begin(api);
    const good = api.snapshot();
    const broken = json(good);
    broken.nations.japan.eco = 'not a number';
    await assert.rejects(api.restore(broken), /セーブ/);
    assert.equal(api.snapshot().nations.japan.eco, good.nations.japan.eco);
    const extra = json(good);
    extra.apiKey = 'SECRET_FROM_IMPORTED_FILE';
    await api.restore(extra);
    assert.ok(!JSON.stringify(api.snapshot()).includes('SECRET_FROM_IMPORTED_FILE'));
    assert.ok(!gameSource.includes('sk-or-v1-'));
    assert.ok(!htmlSource.includes('TEST_ONLY_NOT_A_REAL_KEY'));
    respond = item => item.operation === 'ACTOR' ? { raw: '{"__proto__":{"polluted":true},"reply":"不正なデータ"}' } : null;
    assert.equal(await api.send('JSON境界の検証', 'ministry:usa'), false);
    assert.equal({}.polluted, undefined);
    assert.equal(api.snapshot().usedActions, 0);
  });
  await check('3月開始の暦は12月→翌年1月、12か月後→翌年3月を維持', async () => {
    const { api, context } = harness();
    await begin(api);
    assert.equal(requests[0].context.date, '1932年3月');
    const december = api.snapshot();
    december.completedTurns = 9;
    await api.restore(december);
    assert.equal(vm.runInContext('state.date', context), '1932年12月');
    await api.finishTurn();
    assert.equal(vm.runInContext('state.date', context), '1933年1月');
    assert.equal(vm.runInContext('state.year', context), 1933);
    await api.finishTurn();
    await api.finishTurn();
    assert.equal(vm.runInContext('state.date', context), '1933年3月');
  });

  await check('国家の行動は月1件、更新・保存・秘密の分離・裁定が成立', async () => {
    const { api } = harness();
    await begin(api);
    const before = api.snapshot();
    const calls = requests.length;
    assert.equal(api.submitAction('予算2で東北の農村救済の準備を始める。'), true);
    const id = api.snapshot().nationalAction.id;
    assert.equal(api.submitAction('SECRET_ORDER_321：予算2で農村救済を開始する。'), true);
    assert.equal(api.snapshot().nationalAction.id, id);
    assert.equal(requests.length, calls, '提出時はAPIを使わない');
    assert.equal(api.snapshot().usedActions, 0);
    assert.deepEqual(json(api.snapshot().nations), json(before.nations));
    assert.equal(api.submitAction('x'.repeat(2401)), false);
    await api.restore(api.snapshot());
    await api.send('国際情勢を伺います。', 'ministry:usa');
    assert.ok(!JSON.stringify(requests.at(-1).context).includes('SECRET_ORDER_321'));
    assert.equal(await api.finishTurn(), true);
    const after = api.snapshot();
    assert.equal(after.actionHistory.length, 1);
    assert.equal(after.actionHistory[0].outcome, 'partial');
    assert.equal(after.nationalAction, null);
    assert.equal(after.actionDraft, '');
    assert.ok(after.articles.some(article => article.notes?.some(note => note.includes('国家の行動・部分成功'))));
    await api.restore(after);
    assert.equal(api.snapshot().actionHistory[0].actionId, id);
    await api.finishTurn();
    assert.equal(api.snapshot().actionHistory.length, 1);
    assert.equal(api.submitAction('翌月の準備を行う。'), true);
    assert.equal(api.withdrawAction(), true);
    assert.equal(api.snapshot().nationalAction, null);
  });

  await check('行動裁定の根拠を偽造しても未反映・行動は保持される', async () => {
    const { api } = harness();
    await begin(api);
    api.submitAction('予算2で救済を実施する。');
    const before = api.snapshot();
    respond = item => {
      if (item.operation !== 'RESOLUTION') return null;
      const data = evaluation();
      data.actionResults = [{ actionId: 'forged-id', outcome: 'success', text: '無償で成功。', effects: data.delta, evidence: ['forged-id'] }];
      return { data };
    };
    assert.equal(await api.finishTurn(), false);
    assert.equal(api.snapshot().completedTurns, 0);
    assert.equal(api.snapshot().nationalAction.id, before.nationalAction.id);
    assert.deepEqual(json(api.snapshot().nations), json(before.nations));
  });

  await check('NPC外交は対称に最大±8、非敵対的合意を記録し領土を渡さない', async () => {
    const { api } = harness();
    await begin(api);
    const before = api.snapshot();
    respond = item => {
      if (item.operation !== 'RESOLUTION') return null;
      const data = evaluation();
      data.npcEvents = [0, 1].map(() => ({ a: 'usa', b: 'uk', kind: 'agreement', delta: 999, headline: '米英の通商協議', body: '相互の輸送条件に合意した。', territoryChanges: [{ stateId: 'jp_kanto', to: 'usa' }] }));
      return { data };
    };
    assert.equal(await api.finishTurn(), true);
    const after = api.snapshot();
    assert.equal(after.relations.usa.uk - before.relations.usa.uk, 8);
    assert.equal(after.relations.usa.uk, after.relations.uk.usa);
    assert.deepEqual(json(after.territories), {});
    assert.equal(after.npcAgreements.length, 2);
    assert.ok(after.articles.some(article => article.headline === '米英の通商協議'));
    await api.restore(after);
    assert.equal(api.snapshot().npcAgreements.length, 2);
  });

  await check('紛争消耗・緊張下限・停戦・6か月継続の敗北と復元', async () => {
    const { api } = harness();
    await begin(api);
    let first = true;
    respond = item => {
      if (item.operation !== 'RESOLUTION') return null;
      const data = evaluation();
      if (first) { first = false; data.conflictChanges = [{ stateId: 'jp_kanto', status: 'start', attacker: 'usa', reason: '関東で局地戦が発生。' }]; }
      return { data };
    };
    await api.finishTurn();
    const ongoing = api.snapshot();
    assert.equal(ongoing.conflicts.jp_kanto.months, 1);
    assert.ok(ongoing.tension >= 55);
    assert.equal(ongoing.nations.japan.eco, 68);
    await api.restore(ongoing);
    for (let month = 2; month <= 6; month++) assert.equal(await api.finishTurn(), true);
    assert.equal(api.snapshot().ending.title, '領土の喪失');
    assert.equal(api.snapshot().completedTurns, 6);
    await api.restore(api.snapshot());
    assert.equal(api.snapshot().phase, 'ended');
    await api.restore(ongoing);
    respond = item => {
      if (item.operation !== 'RESOLUTION') return null;
      const data = evaluation();
      data.conflictChanges = [{ stateId: 'jp_kanto', status: 'end', reason: '停戦協定が成立。' }];
      data.delta.tension = -8;
      return { data };
    };
    await api.finishTurn();
    assert.deepEqual(json(api.snapshot().conflicts), {});
    assert.ok(api.snapshot().tension < 55);
  });

  await check('守備隊・要塞は軍事移管を防ぎ、成立した占領は保存される', async () => {
    const { api, context } = harness();
    await begin(api);
    const region = vm.runInContext("ORBIS_STATES_DB.find(region => region.id === 'cn_beijing')", context);
    const defense = Math.min(10, region.garrison.length * 2) + Math.min(10, region.fort) * 2;
    const prepared = api.snapshot();
    prepared.nations.japan.mil = prepared.nations.china.mil + 12 + defense - 1;
    await api.restore(prepared);
    respond = item => {
      if (item.operation !== 'RESOLUTION') return null;
      const data = evaluation();
      data.actionResults = [{ actionId: item.context.nationalAction.id, outcome: 'partial', text: '攻撃を試みた。', effects: { ...data.delta, treasury: -8, tension: 3 }, evidence: [item.context.nationalAction.id], relations: [] }];
      data.territoryChanges = [{ stateId: region.id, to: 'japan', basis: 'military', reason: '戦力を比較して占領を判定。', sourceActionId: item.context.nationalAction.id }];
      return { data };
    };
    api.submitAction('予算8で北平へ進軍する。');
    await api.finishTurn();
    assert.equal(api.snapshot().territories[region.id], undefined);
    const stronger = api.snapshot();
    stronger.nations.japan.mil = stronger.nations.china.mil + 12 + defense;
    await api.restore(stronger);
    api.submitAction('予算8で北平へ進軍する。');
    await api.finishTurn();
    assert.equal(api.snapshot().territories[region.id], 'japan');
    assert.equal(api.snapshot().occupations[region.id], 'china');
    await api.restore(api.snapshot());
    assert.equal(vm.runInContext("state.states.find(region => region.id === 'cn_beijing').originalOwner", context), 'china');
  });

  await check('旧版・偽の紛争・未来月の行動をセーブから持ち込めない', async () => {
    const { api } = harness();
    await begin(api);
    const old = api.snapshot();
    old.version = 3;
    await assert.rejects(api.restore(old), /この版以前/);
    const conflict = api.snapshot();
    conflict.conflicts.jp_kanto = { attacker: '__proto__', defender: 'japan', months: 1, reason: '偽の国家' };
    await assert.rejects(api.restore(conflict), /セーブの紛争/);
    const future = api.snapshot();
    future.nationalAction = { id: 'fake', text: '未来からの行動', turn: 9 };
    await assert.rejects(api.restore(future), /提出行動の月/);
  });

  await check('史実データ監査 (66カ国・165陸上州・危機・歴史イベントの整合)', async () => {
    const { context } = harness();
    assert.deepEqual(auditData(context), { nations: 66, regions: 176, events: 9 });
  });

  console.log(`\n${passed} checks passed. Live provider credentials were not used.`);
} finally {
  await new Promise(resolve => server.close(resolve));
}
