import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { auditData } from './orbis_data_audit.mjs';

const htmlSource = await readFile(new URL('./orbis_simulator.html', import.meta.url), 'utf8');
const statesSource = await readFile(new URL('./orbis_states.js', import.meta.url), 'utf8');
const mapMetaSource = await readFile(new URL('./orbis_map_meta.js', import.meta.url), 'utf8');
const coreSource = await readFile(new URL('./orbis_campaign_core.js', import.meta.url), 'utf8');
const timelineSource = await readFile(new URL('./orbis_timeline_engine.js', import.meta.url), 'utf8');
const playbackSource = await readFile(new URL('./orbis_turn_playback.js', import.meta.url), 'utf8');
const gameSource = await readFile(new URL('./orbis_game.js', import.meta.url), 'utf8');
const regionLabelsSource = await readFile(new URL('./orbis_region_labels.js', import.meta.url), 'utf8');
const eventsSource = await readFile(new URL('./orbis_events.js', import.meta.url), 'utf8');
const textSource = await readFile(new URL('./orbis_text.js', import.meta.url), 'utf8');
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
    const oaiFinish = custom?.finishReason || 'stop';
    if (body.stream) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (gemini) {
        for (const piece of content.match(/.{1,24}/gs) || [content]) {
          response.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: piece }] } }] })}\n\n`);
        }
      } else if (anthropic) {
        for (const piece of content.match(/.{1,24}/gs) || [content]) {
          response.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { text: piece } })}\n\n`);
        }
      } else {
        for (const piece of content.match(/.{1,24}/gs) || [content]) {
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
        }
      }
      response.write('data: [DONE]\n\n');
      response.end();
      return;
    }
    const envelope = gemini ? { candidates: [{ content: { parts: [{ text: content }] }, finishReason: custom?.finishReason === 'length' ? 'MAX_TOKENS' : 'STOP' }] } : anthropic ? { content: [{ type: 'text', text: content }], stop_reason: custom?.finishReason === 'length' ? 'max_tokens' : 'end_turn' } : { choices: [{ message: { content }, finish_reason: oaiFinish }] };
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
  vm.runInContext(statesSource, context, { timeout: 4000 });
  vm.runInContext(mapMetaSource, context, { timeout: 4000 });
  vm.runInContext(regionLabelsSource, context, { timeout: 4000 });
  for (const script of inlineScripts) if (script.trim()) vm.runInContext(script, context, { timeout: 4000 });
  vm.runInContext(eventsSource, context, { timeout: 4000 });
  vm.runInContext(textSource, context, { timeout: 4000 });
  vm.runInContext(coreSource, context, { timeout: 4000 });
  vm.runInContext(timelineSource, context, { timeout: 4000 });
  vm.runInContext(playbackSource, context, { timeout: 4000 });
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
const begin = api => api.start({ nationId: 'japan', difficulty: 'standard', mandate: 'recovery', maxTurns: 24, replace: true });
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
    assert.equal(next.nations.japan.groups.ig_industrialists, 66);
    assert.equal(next.nations.japan.groups.ig_labor, 47);
    assert.equal(next.relations.japan.usa, -17);
    assert.equal(next.relations.usa.japan, -17);
    assert.equal(next.treaties.length, 1);
    assert.equal(next.treaties[0].secret, true);
    assert.equal(requests.at(-1).context.date, '1932年3月（後半）');
    assert.equal(requests.at(-1).context.worldMemory, next.worldMemory);
    const resolution = next.articles.find(article => article.kind === 'resolution');
    assert.ok(resolution);
    assert.ok((resolution.changes?.eco ?? 0) >= 1);
    const serialized = storage.get('orbis_campaign_v6') || storage.get('orbis_campaign_v5') || storage.get('orbis_campaign_v4');
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
    const repairCalls = requests.slice(callsBefore).filter(item => item.operation === 'ACTOR');
    assert.ok(repairCalls.length >= 2 && repairCalls.length <= 4, '形式修正は追加呼び出しのみ');
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
    let blockBriefing = true;
    respond = item => (item.operation === 'BRIEFING' && item.context.turn === 2 && blockBriefing ? { status: 503 } : null);
    assert.equal(await api.finishTurn(), true);
    assert.equal(api.snapshot().completedTurns, 1);
    assert.equal(api.snapshot().phase, 'playing');
    assert.ok(api.snapshot().briefing?.telegrams?.length >= 3, 'BRIEFING失敗時は定型電報で継続');
    const balance = api.snapshot().treasury;
    const resolutionsAfterFirst = requests.filter(item => item.operation === 'RESOLUTION').length;
    blockBriefing = false;
    respond = () => null;
    assert.equal(await api.finishTurn(), true);
    assert.equal(api.snapshot().completedTurns, 2);
    assert.ok(requests.filter(item => item.operation === 'RESOLUTION').length > resolutionsAfterFirst);
    assert.ok(Math.abs(api.snapshot().treasury - balance) < 25);
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
      const request = requests.filter(item => item.operation === 'BRIEFING').at(-1);
      const streamed = requests.filter(item => item.operation === 'BRIEFING' && item.body?.stream);
      assert.ok(!request.url.includes('TEST_ONLY_NOT_A_REAL_KEY'));
      if (provider === 'gemini') {
        assert.equal(request.headers['x-goog-api-key'], 'TEST_ONLY_NOT_A_REAL_KEY');
        assert.ok(requests.some(item => item.operation === 'BRIEFING' && item.url.includes('streamGenerateContent')));
        assert.equal(request.body.generationConfig.responseMimeType, 'application/json');
        assert.ok(request.body.systemInstruction.parts[0].text.includes('OPERATION: BRIEFING'));
      } else if (provider === 'anthropic') {
        assert.equal(request.headers['x-api-key'], 'TEST_ONLY_NOT_A_REAL_KEY');
        assert.equal(request.headers['anthropic-dangerous-direct-browser-access'], 'true');
        assert.ok(request.body.system.includes('OPERATION: BRIEFING'));
        assert.ok(request.body.messages.every(item => item.role !== 'system'));
        assert.ok(streamed.length >= 1);
      } else {
        assert.equal(request.headers.authorization, 'Bearer TEST_ONLY_NOT_A_REAL_KEY');
        assert.ok(request.body.messages.some(item => item.role === 'system'));
        assert.equal(provider === 'openai' ? request.body.max_completion_tokens : request.body.max_tokens, 5000);
        assert.ok(streamed.length >= 1);
      }
    }
  });

  await check('SSEストリームを解析し、失敗時は非ストリームへフォールバックする', async () => {
    const { api } = harness('openai');
    await begin(api);
    let sawStream = false;
    respond = item => {
      if (item.operation !== 'ACTOR') return null;
      if (item.body.stream) sawStream = true;
      if (item.body.stream) return null;
      return { data: reply() };
    };
    const ok = await api.send('ストリーム経由の交渉テストです。', 'ministry:usa');
    assert.equal(ok, true);
    assert.equal(sawStream, true);
    const failOnce = { value: true };
    respond = item => {
      if (item.operation !== 'ACTOR') return null;
      if (item.body.stream && failOnce.value) {
        failOnce.value = false;
        return { status: 500, error: 'stream failed' };
      }
      return { data: reply() };
    };
    assert.equal(await api.send('フォールバック確認の交渉です。', 'ministry:usa'), true);
    assert.equal(requests.filter(item => item.operation === 'ACTOR' && item.body.stream).length >= 2, true);
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

  await check('軍事・経済は復元時に0〜100へ正規化する', async () => {
    const { api } = harness();
    await begin(api);
    const save = json(api.snapshot());
    save.nations.japan.mil = 128;
    save.nations.japan.eco = 145;
    assert.equal(await api.restore(save), true);
    const after = api.snapshot();
    assert.equal(after.nations.japan.mil, 100);
    assert.equal(after.nations.japan.eco, 100);
    assert.ok(after.nations.japan.stb >= 0 && after.nations.japan.stb <= 100);
  });

  await check('高緊張・世界大戦状態でもプレイヤー敗北にはならない', async () => {
    const { api } = harness();
    await begin(api);
    const snap = json(api.snapshot());
    snap.tension = 98;
    snap.worldWarActive = true;
    snap.globalWarHalves = 12;
    snap.stress.war = 6;
    snap.nations.japan.stb = 45;
    snap.nations.japan.eco = 48;
    snap.nations.japan.mil = 78;
    await api.restore(snap);
    respond = item => (item.operation === 'RESOLUTION' ? { data: evaluation() } : null);
    assert.equal(await api.finishTurn(), true);
    const after = api.snapshot();
    assert.ok(['playing', 'briefing'].includes(after.phase));
    assert.equal(after.ending, null);
    assert.equal(after.stress.war, 0);
    assert.ok(after.nations.japan.mil <= 100);
    assert.ok(api.listConflicts().wars.some(w => w.global));
  });

  await check('占領表示用に地域スラッグを行政名へ変換する', async () => {
    const { api, context } = harness();
    await begin(api);
    const region = vm.runInContext("ORBIS_STATES_DB.find(s => /^japan_jp_03$/i.test(s.id))", context);
    assert.ok(region);
    assert.equal(api.regionLabel(region), '岩手県');
    const empire = vm.runInContext("ORBIS_STATES_DB.find(s => /japan_empire_prk/i.test(s.id))", context);
    if (empire) assert.ok(!/^japan empire prk/i.test(api.regionLabel(empire)));
  });

  await check('裁定JSONは部分応答を正規化して受理する', async () => {
    const { api } = harness();
    await begin(api);
    const game = api.snapshot();
    const partial = evaluation();
    partial.conflictChanges = [{ stateId: 'invalid_region', status: 'start', attacker: 'japan', reason: '不正' }];
    partial.treaties = [{ nationId: 'usa', type: 'war', title: 'x', terms: 'y', duration: 4, sourceActionId: 'none' }];
    const normalized = api.applyResolutionValidation(partial, game);
    assert.ok(normalized.headline);
    assert.ok(!normalized.conflictChanges?.length);
    assert.ok(!normalized.treaties?.length);
    assert.ok((game.lastResolutionIssues || []).length >= 1);
  });

  await check('finish_reason=lengthの切れ端JSONを修復して反映する', async () => {
    const { api } = harness();
    await begin(api);
    const base = evaluation();
    let resolutionCalls = 0;
    respond = item => {
      if (item.operation !== 'RESOLUTION') return null;
      resolutionCalls += 1;
      const raw = JSON.stringify(base).slice(0, Math.floor(JSON.stringify(base).length * 0.82));
      return { raw, finishReason: 'length' };
    };
    assert.equal(await api.finishTurn(), true);
    assert.equal(resolutionCalls, 1);
    const after = api.snapshot();
    assert.ok(after.completedTurns >= 1);
    assert.ok(after.articles.some(a => a.kind === 'resolution'));
  });

  await check('無期限キャンペーンの結末ダイアログ見出しは任期終了にしない', async () => {
    const { api } = harness();
    await api.start({ nationId: 'japan', difficulty: 'standard', mandate: 'recovery', maxTurns: 0, replace: true });
    assert.equal(api.endingTitleFor({ ending: { result: 'survived' }, maxTurns: 0 }), '時代の振り返り');
    assert.equal(api.endingTitleFor({ ending: { result: 'defeat' }, maxTurns: 0 }), '歴史の転換点');
    assert.notEqual(api.endingTitleFor({ ending: { result: 'survived' }, maxTurns: 24 }), '任期終了');
  });

  await check('約束の期限切れと、履行記録の一度だけの適用', async () => {
    const { api } = harness();
    await begin(api);
    assert.equal(await api.send('翌月末までに予算案を提示します。', 'domestic:ig_military'), true);
    respond = item => {
      if (item.operation !== 'RESOLUTION') return null;
      const data = evaluation();
      if (item.context.conversations?.length) {
        data.commitments = [{ id: '', actorId: 'domestic:ig_military', status: 'active', title: '予算案の提示', detail: '翌月末までに予算案を出す。', dueIn: 1, sourceActionId: item.context.conversations[0].id }];
      }
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
    // 自治度29の目標忠誠は44。交渉で63になった後、月次ドリフトで62へ。
    assert.equal(saved.clients.manchukuo.loyalty, 62);
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
      assert.equal(await api.start({ nationId, difficulty: 'standard', mandate: 'recovery', maxTurns: 24, replace: true }), true, nationId);
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
    for (let turn = 0; turn < 24; turn++) {
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

  await check('12か月（24半月）完走と、終了後のAPI呼び出し停止', async () => {
    const { api } = harness();
    await begin(api);
    for (let turn = 0; turn < 24; turn++) assert.equal(await api.finishTurn(), true);
    const final = api.snapshot();
    assert.equal(final.completedTurns, 24);
    assert.equal(final.phase, 'ended');
    assert.equal(final.ending.result, 'survived');
    const briefings = requests.filter(item => item.operation === 'BRIEFING');
    assert.ok(briefings.length >= 24 && briefings.length <= 72, `BRIEFING呼び出し ${briefings.length}`);
    const callCount = requests.length;
    assert.equal(await api.finishTurn(), false);
    assert.equal(await api.send('任期終了後の交渉', 'ministry:usa'), false);
    assert.equal(requests.length, callCount);
    const restored = harness().api;
    assert.equal(await restored.restore(final), true);
    assert.equal(restored.snapshot().phase, 'ended');
  });

  await check('財政危機の猶予・回復・6半月連続時の敗北', async () => {
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
    for (let i = 1; i <= 5; i++) {
      await api.finishTurn();
      assert.equal(api.snapshot().stress.bankruptcy, i);
      assert.equal(api.snapshot().ending, null);
    }
    const grace = api.snapshot();
    await api.finishTurn();
    assert.equal(api.snapshot().ending.result, 'defeat');
    assert.equal(api.snapshot().completedTurns, 6);
    respond = () => null;
    grace.treasury = 28;
    await api.restore(grace);
    await api.finishTurn();
    assert.ok(api.snapshot().treasury > 2);
    assert.ok(api.snapshot().stress.bankruptcy < grace.stress.bankruptcy);
    assert.equal(api.snapshot().ending, null);
  });

  await check('極端な裁定JSONでも単月の財政・緊張スパイクを抑制', async () => {
    const { api } = harness();
    await begin(api);
    const start = api.snapshot();
    assert.equal(await api.submitAction('財政と外交の極端な圧力テスト。'), true);
    respond = item => {
      if (item.operation !== 'RESOLUTION') return null;
      const data = evaluation();
      const id = item.context.nationalAction.id;
      data.delta = { mil: 0, eco: 0, stb: 0, treasury: -40, prestige: 0, tension: 40 };
      data.actionResults = [{ actionId: id, outcome: 'partial', text: '過大な圧力。', effects: { mil: 0, eco: 0, stb: 0, treasury: -30, prestige: 0, tension: 35 }, evidence: [id], relations: [] }];
      return { data };
    };
    assert.equal(await api.finishTurn(), true);
    const after = api.snapshot();
    assert.ok(after.treasury >= start.treasury - 13, `treasury ${start.treasury} -> ${after.treasury}`);
    assert.ok(after.tension <= start.tension + 8, `tension ${start.tension} -> ${after.tension}`);
    assert.equal(after.ending, null);
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
  await check('3月開始の半月暦は12月→翌年1月、12か月後→翌年3月を維持', async () => {
    const { api, context } = harness();
    await begin(api);
    assert.equal(requests[0].context.date, '1932年3月（前半）');
    const december = api.snapshot();
    december.completedTurns = 19;
    await api.restore(december);
    assert.match(vm.runInContext('state.date', context), /1932年12月/);
    await api.finishTurn();
    assert.match(vm.runInContext('state.date', context), /1933年1月/);
    assert.equal(vm.runInContext('state.year', context), 1933);
    for (let i = 0; i < 4; i++) await api.finishTurn();
    assert.match(vm.runInContext('state.date', context), /1933年3月/);
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

  await check('行動裁定の根拠を偽造しても提出行動IDを補正して月を進める', async () => {
    const { api } = harness();
    await begin(api);
    api.submitAction('予算2で救済を実施する。');
    const before = api.snapshot();
    respond = item => {
      if (item.operation !== 'RESOLUTION') return null;
      const data = evaluation();
      data.actionResults = [{ actionId: 'forged-id', outcome: 'success', text: '無償で成功。', effects: { mil: 0, eco: 0, stb: 0, treasury: 0, prestige: 0, tension: 0 }, evidence: ['forged-id'] }];
      return { data };
    };
    assert.equal(await api.finishTurn(), true);
    assert.equal(api.snapshot().completedTurns, 1);
    assert.equal(api.snapshot().actionHistory[0].actionId, before.nationalAction.id);
    assert.equal(api.snapshot().nationalAction, null);
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
    assert.deepEqual(json(after.territories), json(before.territories));
    assert.equal(after.territories.jp_kanto, undefined);
    assert.equal(after.npcAgreements.length, 2);
    assert.ok(after.articles.some(article => article.headline === '米英の通商協議'));
    await api.restore(after);
    assert.equal(api.snapshot().npcAgreements.length, 2);
  });

  await check('紛争消耗・緊張下限・停戦・6か月継続の敗北と復元', async () => {
    const { api } = harness();
    await begin(api);
    respond = item => {
      if (item.operation !== 'RESOLUTION') return null;
      const data = evaluation();
      if (item.context.turn === 1) data.conflictChanges = [{ stateId: 'jp_kanto', status: 'start', attacker: 'usa', reason: '関東で局地戦が発生。' }];
      return { data };
    };
    await api.finishTurn();
    const ongoing = api.snapshot();
    assert.equal(ongoing.conflicts.jp_kanto.months, 1);
    assert.ok(ongoing.tension >= 55);
    assert.equal(ongoing.nations.japan.eco, 68);
    await api.restore(ongoing);
    for (let month = 2; month <= 12; month++) assert.equal(await api.finishTurn(), true);
    assert.equal(api.snapshot().ending.title, '領土の喪失');
    assert.equal(api.snapshot().completedTurns, 12);
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
    assert.ok(api.snapshot().tension <= 55);
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
      data.actionResults = [{ actionId: item.context.nationalAction.id, outcome: 'partial', text: '攻撃を試みた。', effects: { mil: 0, eco: 0, stb: 0, treasury: -10, prestige: 0, tension: 5 }, evidence: [item.context.nationalAction.id], relations: [] }];
      data.territoryChanges = [{ stateId: region.id, to: 'japan', basis: 'military', reason: '戦力を比較して占領を判定。', sourceActionId: item.context.nationalAction.id }];
      return { data };
    };
    api.submitAction('予算8で北平へ進軍する。');
    await api.finishTurn();
    assert.equal(api.snapshot().territories[region.id], undefined);
    const stronger = api.snapshot();
    stronger.nations.japan.mil = stronger.nations.china.mil + 12 + defense + 20;
    stronger.treasury = 90;
    await api.restore(stronger);
    const occupied = api.snapshot();
    occupied.territories[region.id] = 'japan';
    occupied.occupations[region.id] = 'china';
    await api.restore(occupied);
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

  await check('開始時から満洲国(client:manchukuo)宛の電報が送れる', async () => {
    const { api } = harness();
    await begin(api);
    assert.equal(await api.send('自治と開発援助の条件を協議したい。', 'client:manchukuo'), true);
    assert.equal(api.snapshot().usedActions, 1);
    assert.equal(api.snapshot().turnActions[0].actorId, 'client:manchukuo');
  });

  await check('1932年3月開始で1937年12月終了は140半月', async () => {
    const { api, context } = harness();
    assert.equal(api.eraFullTurns, 140);
    assert.equal(api.milestoneHalfTurns, 980);
    assert.equal(await api.start({ nationId: 'siam', difficulty: 'standard', mandate: 'recovery', endYear: 1937, endMonth: 12, replace: true }), true);
    const nearEnd = api.snapshot();
    nearEnd.completedTurns = 139;
    await api.restore(nearEnd);
    assert.match(vm.runInContext('state.date', context), /1937年12月/);
    assert.equal(await api.start({ nationId: 'japan', endYear: 1937, endMonth: 12, replace: true }), true);
    assert.equal(api.snapshot().maxTurns, 140);
  });

  await check('v5月次セーブはv6半月へ移行（maxTurns×2）', async () => {
    const { api, storage } = harness();
    await api.start({ nationId: 'japan', maxTurns: 140, replace: true });
    const snap = api.snapshot();
    snap.completedTurns = 6;
    snap.saveFormat = 5;
    snap.halfMonth = false;
    snap.maxTurns = 70;
    await api.restore(snap);
    const migrated = api.snapshot();
    assert.equal(migrated.completedTurns, 12);
    assert.equal(migrated.maxTurns, 140);
    assert.equal(migrated.halfMonth, true);
    const serialized = storage.get('orbis_campaign_v6');
    assert.ok(serialized?.includes('"saveFormat":6'));
    const reloaded = harness();
    assert.equal(await reloaded.api.restore(JSON.parse(serialized)), true);
    assert.equal(reloaded.api.snapshot().halfMonth, true);
  });

  await check('タイムライン・宣戦・記事整合フィルタ', async () => {
    const { api } = harness();
    await api.start({ nationId: 'japan', maxTurns: 24, replace: true });
    assert.equal(api.declareWar('china', '満州情勢'), true);
    assert.ok(Object.keys(api.snapshot().wars).length);
    const snap = api.snapshot();
    snap.establishedFacts = ['日本は満洲国を公式承認した'];
    snap.completedTurns = 0;
    snap.conflicts = {};
    await api.restore(snap);
    respond = item => {
      if (item.operation !== 'RESOLUTION') return null;
      const data = evaluation();
      data.developments = [
        { headline: '満洲承認見送り', body: '政府は満洲国承認を当面見送った。' },
        { headline: '海運', body: '船腹不足。' },
      ];
      return { data };
    };
    await api.finishTurn();
    const articles = api.snapshot().articles.filter(a => a.kind === 'world');
    assert.ok(articles.some(a => a.headline === '海運'));
    assert.ok(!articles.some(a => a.headline.includes('見送り')));
  });

  await check('途切れた裁定JSONでも月末を完走（フォールバック）', async () => {
    const { api } = harness();
    await begin(api);
    assert.equal(await api.submitAction('フォールバック裁定のテスト。'), true);
    respond = item => item.operation === 'RESOLUTION' ? { raw: '{"headline":"途切れ","article":"月次"' } : null;
    assert.equal(await api.finishTurn(), true);
    const snap = api.snapshot();
    assert.equal(snap.completedTurns, 1);
    assert.equal(snap.phase, 'playing');
    assert.ok(snap.articles.some(a => a.kind === 'resolution'));
  });

  await check('不正な提出行動IDは補正して裁定を適用', async () => {
    const { api } = harness();
    await begin(api);
    assert.equal(await api.submitAction('ID補正テストの国家方針。'), true);
    const realId = api.snapshot().nationalAction.id;
    respond = item => {
      if (item.operation !== 'RESOLUTION') return null;
      const data = evaluation();
      data.actionResults = [{ actionId: 'wrong-order-id', outcome: 'partial', text: '補正対象。', effects: { mil: 0, eco: 0, stb: 0, treasury: -2, prestige: 0, tension: 0 }, evidence: ['wrong-order-id'], relations: [] }];
      return { data };
    };
    assert.equal(await api.finishTurn(), true);
    assert.equal(api.snapshot().completedTurns, 1);
    assert.ok(api.snapshot().actionHistory.some(item => item.actionId === realId));
  });

  await check('不正な電報宛先は除外・補完して開始', async () => {
    const { api } = harness();
    respond = item => {
      if (item.operation !== 'BRIEFING') return null;
      const roster = item.context.roster;
      const domestic = roster.find(a => a.kind === 'domestic');
      return { data: { headline: '破損', briefing: '不正ID混在のブリーフィング。', telegrams: [
        { actorId: 'ministry:atlantis', subject: '誤', text: '存在しない相手。', urgency: 'routine', choices },
        { actorId: domestic.id, subject: '国内', text: '正しい国内電報。', urgency: 'important', choices },
        { actorId: domestic.id, subject: '重複', text: '重複ID。', urgency: 'routine', choices },
      ] } };
    };
    assert.equal(await begin(api), true);
    assert.equal(api.snapshot().briefing.telegrams.length, 3);
    assert.ok(api.snapshot().briefing.telegrams.every(t => t.actorId !== 'ministry:atlantis'));
  });

  await check('史実データ監査 (78カ国・Admin-1州・危機・歴史イベントの整合)', async () => {
    const { context } = harness();
    const audit = auditData(context);
    assert.equal(audit.nations, 78);
    assert.ok(audit.land >= 900 && audit.land <= 2000, `陸上州数 ${audit.land}`);
    assert.ok(audit.land <= 1300, `ヨーロッパ集約後の州数上限目安 (${audit.land})`);
    assert.equal(audit.events, 9);
    assert.equal(audit.history, 272);
    assert.ok(audit.regions >= audit.land);
  });

  await check('国名ラベル錨が首都本土付近に置かれる（海外領土に引っ張られない）', async () => {
    const { context } = harness();
    const capitals = vm.runInContext('ORBIS_MAP_META.capitals', context);
    const anchors = vm.runInContext('ORBIS_MAP_META.countryAnchors', context);
    const homeRules = vm.runInContext('ORBIS_MAP_META.homeTerritoryRules', context);
    for (const [country, cap] of Object.entries(capitals)) {
      const anchor = anchors[country];
      assert.ok(anchor, `${country} のラベル錨なし`);
      const dLon = anchor.lon - cap[0];
      const dLat = anchor.lat - cap[1];
      const approxKm = Math.hypot(dLon * 85, dLat * 111);
      assert.ok(approxKm < 650, `${country} ラベルが首都から遠すぎる (${approxKm.toFixed(0)}km)`);
      if (homeRules[country]) {
        const rule = homeRules[country];
        assert.ok(anchor.lon >= rule.minLon && anchor.lon <= rule.maxLon && anchor.lat >= rule.minLat && anchor.lat <= rule.maxLat,
          `${country} ラベルが本土bbox外 (${anchor.lon},${anchor.lat})`);
      }
    }
    const uk = anchors.uk;
    assert.ok(uk.lon > -8 && uk.lon < 3 && uk.lat > 49 && uk.lat < 60, '英国ラベルが本土外');
    const fr = anchors.france;
    assert.ok(fr.lon > -5 && fr.lon < 8 && fr.lat > 42 && fr.lat < 51, 'フランスラベルが本土外');
  });

  await check('既定キャンペーンは無制限（HUDに / 上限なし）', async () => {
    const { api } = harness();
    await api.start({ nationId: 'japan', replace: true });
    const snap = api.snapshot();
    assert.equal(snap.maxTurns, 0);
    assert.match(api.hudTurnLabel(snap), /^第 \d+ 半月$/);
    assert.doesNotMatch(api.hudTurnLabel(snap), /\//);
  });

  await check('占領は侵略者支配領に隣接して進む', async () => {
    const { api, context } = harness();
    await api.start({ nationId: 'japan', maxTurns: 48, replace: true });
    assert.equal(api.declareWar('china', '満州国境'), true);
    assert.equal(Object.keys(api.snapshot().occupations).length, 0, '宣戦だけでは占領しない');
    const land = id => context.window.ORBIS_STATES_DB.find(r => r.id === id);
    const isLand = region => region && !region.isSea && !region.isSeaZone && region.type !== 'sea';
    const snapshot = api.snapshot();
    const adjacency = api.landAdjacency();
    const frontier = regionId => [...(adjacency.get(regionId) || [])].find(id => {
      const r = land(id);
      return isLand(r) && (snapshot.territories[id] || r.country) === 'china';
    });
    const field = api.listFormations().find(item => item.nationId === 'japan' && item.type === 'field' && frontier(item.regionId));
    assert.ok(field, '中国領に隣接する野戦部隊');
    const targetId = frontier(field.regionId);
    assert.equal(api.setFormationOrder(field.id, { kind: 'offensive', targetRegionId: targetId, targetNationId: 'china' }), true, api.formationOrderError());
    assert.equal(await api.finishTurn(), true);
    const after = api.snapshot();
    assert.ok(Object.keys(after.occupations).length > 0, '攻勢で占領が進む');
    assert.ok(api.verifyOccupationsAdjacent(after, 'japan'));
    for (const id of Object.keys(after.occupations)) {
      const r = land(id);
      assert.ok(r, id);
      assert.ok((r.lon || 0) > 95, `${id} が西方で占領されている (${r.lon})`);
    }
  });

  await check('宣戦直後は自動占領せず、内陸の中国領も変化しない', async () => {
    const { api, context } = harness();
    await begin(api);
    const db = id => context.window.ORBIS_STATES_DB.find(region => region.id === id);
    const watched = ['china_cn_js', 'china_cn_hb', 'cn_beijing'];
    const before = api.snapshot();
    const ownersBefore = Object.fromEntries(watched.map(id => [id, before.territories[id] || db(id).country]));
    assert.equal(api.declareWar('china', '満州国境の戦線'), true);
    const after = api.snapshot();
    assert.equal(Object.keys(after.occupations).length, 0, '宣戦だけでは占領が発生しない');
    assert.ok(Object.values(after.wars).filter(war => war.status === 'active').length >= 1, '戦争は成立する');
    for (const id of watched) {
      const region = db(id);
      assert.ok(region, id);
      assert.equal(after.occupations[id], undefined, `${region.nameJa}は宣戦時に占領されない`);
      assert.equal(after.territories[id] || region.country, ownersBefore[id], `${region.nameJa}の領有は宣戦時に変わらない`);
    }
  });

  await check('戦争・和平APIと紛争一覧', async () => {
    const { api } = harness();
    await api.start({ nationId: 'japan', maxTurns: 48, replace: true });
    assert.equal(api.declareWar('china', '満州情勢'), true);
    const conflicts = api.listConflicts();
    assert.ok(conflicts.wars.length >= 1);
    assert.equal(Object.keys(api.snapshot().occupations).length, 0, '宣戦だけでは占領しない');
    const warId = conflicts.wars[0].id;
    const warm = api.snapshot();
    warm.relations.japan.china = 30;
    warm.relations.china.japan = 30;
    await api.restore(warm);
    assert.equal(api.proposePeace(warId, { returnStateIds: [] }), true);
    assert.equal(api.listConflicts().wars.filter(w => w.status === 'active').length, 0);
  });

  await check('統治危機が4半月続くと内戦が発生し紛争一覧に載る', async () => {
    const { api } = harness();
    await begin(api);
    const snap = api.snapshot();
    snap.nations.japan.stb = 12;
    snap.nations.japan.eco = 22;
    snap.stress.civil = 4;
    snap.phase = 'playing';
    snap.ending = null;
    await api.restore(snap);
    respond = item => (item.operation === 'RESOLUTION' ? { data: evaluation() } : null);
    assert.equal(await api.finishTurn(), true);
    const after = api.snapshot();
    const civil = after.civilWars?.[after.playerNationId];
    assert.ok(civil?.status === 'active', '内戦開始');
    assert.ok(api.listConflicts().civil.length >= 1);
    assert.ok(api.negotiateCivilWar(after.playerNationId, 'amnesty'));
  });

  await check('WORLD_EVENT_DB: 満州国建国が正しい半月に発火', async () => {
    const { api, context } = harness();
    await api.start({ nationId: 'japan', maxTurns: 24, replace: true });
    respond = item => (item.operation === 'RESOLUTION' ? { data: evaluation() } : null);
    await api.finishTurn();
    const fired = api.snapshot().timelineFired || {};
    assert.ok(fired['1932-manchukuo_founding'] != null, '1932-manchukuo_founding');
    const dbCount = vm.runInContext('ORBIS_TIMELINE.dbEvents().length', context);
    assert.ok(dbCount >= 40, `scripted DB events ${dbCount}`);
  });

  await check('史実DB連携: 電報文脈に当月・年内の史実ノートが入る', async () => {
    const { api, context } = harness();
    await begin(api);
    vm.runInContext(`WORLD_EVENT_DB.push({ id: 'test-year-note', year: 1932, date: '1932', title: '年内テスト事件', summary: 'YYYY精度の注入確認。', importance: 3, causal_kind: 'structural' })`, context);
    await api.send('満洲国の承認動向を報告してください。', 'client:manchukuo', 'private');
    const calendar = requests.filter(item => item.operation === 'ACTOR').at(-1).context.calendar;
    assert.ok(calendar.includes('満洲国'), 'timelineノート');
    assert.ok(calendar.includes('満州国建国'), '当月の史実DBノート');
    assert.ok(calendar.includes('1932-03-01'), '当月ノートの日付');
    assert.ok(calendar.includes('年内の注目事件'), '年内注目節');
    assert.ok(calendar.includes('年内テスト事件'), 'YYYY精度の年内注目');
    assert.ok(calendar.includes('自動発生させない'), '分岐指示文');
  });

  await check('Wikipediaリンクは実在辞書だけを対象にし、新規タブで開く', async () => {
    const { context } = harness();
    const decorate = vm.runInContext('OrbisText.decorate', context);
    const linked = decorate('ルーズベルトは満州事変の東京で演説し、蒋介石と会談した。');
    assert.match(linked, /https:\/\/ja\.wikipedia\.org\/wiki\//);
    assert.match(linked, /target="_blank"/);
    assert.match(linked, /rel="noopener noreferrer"/);
    assert.ok(linked.includes('>ルーズベルト</a>'));
    assert.ok(linked.includes('>満州事変</a>'));
    assert.ok(linked.includes('>東京</a>'));
    assert.ok(linked.includes('>蒋介石</a>'));
    const fictional = decorate('佐伯 修一は架空事件ゼータを起こした。');
    assert.ok(!fictional.includes('wikipedia.org'));
    assert.ok(fictional.includes('佐伯 修一'));
    assert.ok(fictional.includes('架空事件ゼータ'));
  });

  await check('文章装飾はHTMLを先にエスケープし、スクリプトを挿入しない', async () => {
    const { context } = harness();
    const decorate = vm.runInContext('OrbisText.decorate', context);
    const decorated = decorate('<script>alert(1)</script><img src=x onerror=alert(2)> ルーズベルト');
    assert.ok(!decorated.includes('<script'));
    assert.ok(!decorated.includes('<img'));
    assert.ok(decorated.includes('&lt;script&gt;'));
    assert.ok(decorated.includes('&lt;img'));
    assert.ok(decorated.includes('&lt;/script&gt;'));
    assert.match(decorated, /target="_blank"/);
  });

  await check('国名は国旗画像＋1932年正式名に正規化し、絵文字を使わない', async () => {
    const { context } = harness();
    const decorate = vm.runInContext('OrbisText.decorate', context);
    const decorated = decorate('アメリカ合衆国と米国、ソ連、日本、満洲国、アトランティス。');
    assert.ok(decorated.includes('./flags/USA.webp'));
    assert.ok(decorated.includes('./flags/SOV.webp'));
    assert.ok(decorated.includes('./flags/JAP.webp'));
    assert.ok(decorated.includes('./flags/MAN.webp'));
    assert.ok(decorated.includes('アメリカ合衆国'));
    assert.ok(decorated.includes('ソビエト連邦'));
    assert.ok(decorated.includes('大日本帝国'));
    assert.ok(decorated.includes('満洲国'));
    assert.ok(!/[\u{1F1E6}-\u{1F1FF}]/u.test(decorated));
    assert.ok(!decorated.includes('🇺'));
    const flagless = vm.runInContext("OrbisText.countryMention('atlantis', 'アトランティス')", context);
    assert.equal(flagless, 'アトランティス');
    assert.ok(!flagless.includes('<span'));
  });

  await check('国名はゲーム内の国家情報ポップアップを開き、Wikipediaへは飛ばさない', async () => {
    const { api, context } = harness();
    await begin(api);
    const decorate = vm.runInContext('OrbisText.decorate', context);
    const decorated = decorate('日本とアメリカ合衆国が会談した。');
    assert.ok(decorated.includes('data-orbis-country="japan"'));
    assert.ok(decorated.includes('data-orbis-country="usa"'));
    assert.ok(decorated.includes('orbis-country-link'));
    assert.ok(!decorated.includes('wikipedia.org'));
    const card = api.countryCardData('japan');
    assert.equal(card.name, '大日本帝国');
    assert.equal(card.isPlayer, true);
    assert.equal(card.stats.find(stat => stat.key === 'mil').value, 84);
    assert.equal(card.groups.length, 4);
    assert.ok(card.summary.length > 20);
    assert.ok(card.agenda.length > 10);
    const other = api.countryCardData('usa');
    assert.equal(other.isPlayer, false);
    assert.ok(other.relation.label.length > 0);
    assert.ok(other.wikiTitle.length > 0);
    assert.ok(other.stats.every(stat => Number.isInteger(stat.value)));
    const manchukuo = api.countryCardData('manchukuo');
    assert.equal(manchukuo.client.sponsorId, 'japan');
    assert.equal(api.countryCardData('atlantis'), null);
  });

  await check('プロビンス情報は自国・他国・海洋で行動を出し分ける', async () => {
    const { api, context } = harness();
    await begin(api);
    const own = api.provincePanelData('jp_kanto');
    assert.ok(own);
    assert.equal(own.isSea, false);
    assert.equal(own.ownerId, 'japan');
    assert.equal(own.ownerFormalName, '大日本帝国');
    assert.ok(own.ownerLeader && own.ownerRegime);
    assert.ok(own.canPolicy && own.canDefense);
    assert.equal(own.canDiplomacy, false);
    assert.ok(own.actions.some(action => action.id === 'policy'));

    const foreign = api.provincePanelData('cn_beijing');
    assert.ok(foreign);
    assert.equal(foreign.ownerId, 'china');
    assert.equal(foreign.ownerFormalName, '中華民国');
    assert.ok(foreign.canDiplomacy);
    assert.equal(foreign.canPolicy, false);
    assert.equal(foreign.canDefense, false);
    assert.ok(Number.isFinite(foreign.relationScore));
    assert.ok(foreign.actions.some(action => action.id === 'diplomacy'));

    const seaId = vm.runInContext("ORBIS_STATES_DB.find(region => region.isSea || region.type === 'sea' || region.isSeaZone)?.id", context);
    assert.ok(seaId);
    const sea = api.provincePanelData(seaId);
    assert.ok(sea.isSea);
    assert.equal(sea.canOwn, false);
    assert.equal(sea.actions.length, 0);
    assert.equal(sea.canPolicy, false);
    assert.equal(sea.canDefense, false);
    assert.ok(sea.description.includes('領有でき'));
    assert.ok(sea.statusNote.includes('領有できません'));
  });

  await check('占領中プロビンスは元の領有国と戦争・和平の導線を返す', async () => {
    const { api } = harness();
    await begin(api);
    const occupied = api.snapshot();
    occupied.territories.cn_beijing = 'japan';
    occupied.occupations.cn_beijing = 'china';
    await api.restore(occupied);
    let panel = api.provincePanelData('cn_beijing');
    assert.equal(panel.occupied, true);
    assert.equal(panel.originalOwnerId, 'china');
    assert.equal(panel.originalOwnerName, '中華民国');
    assert.ok(panel.statusNote.includes('占領中'));
    assert.equal(api.declareWar('china', '満州情勢'), true);
    panel = api.provincePanelData('cn_beijing');
    assert.equal(panel.warActive, true);
    assert.ok(panel.actions.some(action => action.id === 'war'));
    assert.ok(panel.canWar);
  });

  await check('ロビーの球体ヒットテストは可視面の国だけを返し、海を選ばない', async () => {
    const { api, context } = harness();
    await begin(api);
    assert.equal(vm.runInContext("OrbisMapHit.lobbyNationForProvince('jp_kanto')", context), 'japan');
    const tokyo = vm.runInContext('OrbisMapHit.lobbyNationAtLonLat(139.7, 35.7, state.states)', context);
    assert.ok(tokyo);
    assert.equal(tokyo.country, 'japan');
    assert.equal(tokyo.stateId, 'jp_kanto');
    assert.equal(vm.runInContext('OrbisMapHit.lobbyNationAtLonLat(-140, 0, state.states)', context), null);
    assert.equal(vm.runInContext('OrbisMapHit.lobbyNationAtLonLat(0, 0, state.states)', context), null);
    assert.equal(vm.runInContext('OrbisMapHit.isLonLatVisibleOnGlobe(0, 0, { lon: 0, lat: 0 })', context), true);
    assert.equal(vm.runInContext('OrbisMapHit.isLonLatVisibleOnGlobe(180, 0, { lon: 0, lat: 0 })', context), false);
    vm.runInContext("selectLobbyNation(OrbisMapHit.lobbyNationForProvince('jp_kanto'))", context);
    assert.equal(vm.runInContext('state.lobbyNationId', context), 'japan');
  });

  await check('旧植民地政庁は開始時に植民地型従属国へ移行する', async () => {
    const { api } = harness();
    await begin(api);
    const korea = api.dependencyInfo('col_japan_korea');
    assert.equal(korea.type, 'colony');
    assert.equal(korea.overlordId, 'japan');
    assert.equal(api.provincePanelData('japan_empire_kor').ownerId, 'col_japan_korea');
    assert.equal(api.colorNation('col_japan_korea'), 'japan');
    assert.equal(api.nationMeta('col_japan_korea').name, '朝鮮総督府');
    assert.equal(api.snapshot().localGovernments, undefined, '自治政府レイヤーは廃止');
    assert.equal(api.dependencyInfo('col_france_fwa').overlordId, 'france');
    assert.equal(api.provincePanelData('japan_jp_03').ownerId, 'japan');
  });

  await check('中国軍閥はすべて自治軍閥として中華民国に近い薄青で表示される', async () => {
    const { api, context } = harness();
    await begin(api);
    const warlords = ['shanxi', 'sichuan', 'hunan', 'guangxi', 'yunnan', 'shandong', 'ma_clique', 'guangdong', 'xinjiang', 'guizhou'];
    for (const id of warlords) {
      const dependency = api.dependencyInfo(id);
      assert.equal(dependency.type, 'warlord', id);
      assert.equal(dependency.overlordId, 'china', id);
      assert.equal(dependency.warlordStatusLabel, '自治軍閥', id);
      assert.equal(api.colorNation(id), 'warlord_autonomous', id);
    }
    const sharedColor = api.colonialColorGroups().map(entry => entry.id);
    for (const id of warlords) assert.ok(!sharedColor.includes(id), id);
    assert.ok(sharedColor.includes('india') || sharedColor.includes('dutch_indies'), '植民地の同色国境は維持');
    assert.equal(api.provincePanelData('china_cn_sx').ownerId, 'shanxi');
    assert.equal(api.provincePanelData('china_cn_cq').ownerId, 'sichuan');
    assert.equal(api.provincePanelData('china_cn_sx').vassalOf.overlordName, '中国');
    assert.equal(api.colorNation('china'), 'china');
    assert.ok(!vm.runInContext("ORBIS_STATES_DB.some(region => region.id === 'china_xikang')", context));
    assert.equal(api.provincePanelData('china_cn_sc').ownerId, 'sichuan');
    assert.ok(api.provincePanelData('china_cn_sc').name.includes('四川'));

    const snapshot = api.snapshot();
    snapshot.clients.guangxi.warlordStatus = 'neutral';
    snapshot.clients.guangdong.warlordStatus = 'independent';
    assert.equal(await api.restore(snapshot), true);
    assert.equal(api.colorNation('guangxi'), 'warlord_neutral');
    assert.equal(api.colorNation('guangdong'), 'warlord_independent');
    const after = api.colonialColorGroups().map(entry => entry.id);
    assert.ok(!after.includes('guangxi'));
    assert.ok(!after.includes('guangdong'));
  });

  await check('チベットは中国の保護国として独立した操作可能国', async () => {
    const { api, context } = harness();
    await begin(api);
    assert.equal(vm.runInContext("SCENARIOS.era_1932.nations.tibet.dependency.overlordId", context), 'china');
    assert.equal(api.provincePanelData('china_cn_xz').ownerId, 'tibet');
    const dependency = api.dependencyInfo('tibet');
    assert.equal(dependency.kind, 'protectorate');
    assert.equal(dependency.overlordId, 'china');
    assert.ok(dependency.autonomy >= 80);
  });

  await check('フィリピン・コモンウェルスは米国の保護国', async () => {
    const { api, context } = harness();
    await begin(api);
    assert.equal(vm.runInContext("SCENARIOS.era_1932.nations.philippines.name", context), 'フィリピン・コモンウェルス');
    const dependency = api.dependencyInfo('philippines');
    assert.equal(dependency.kind, 'protectorate');
    assert.equal(dependency.overlordId, 'usa');
    assert.equal(api.provincePanelData('usa_phl_n').ownerId, 'philippines');
    assert.equal(api.colorNation('philippines'), 'philippines');
    assert.equal(await api.start({ nationId: 'philippines', difficulty: 'standard', mandate: 'recovery', maxTurns: 24, replace: true }), true);
    assert.equal(api.snapshot().playerNationId, 'philippines');
  });

  await check('中国・日本の州名は1932年3月の呼称', async () => {
    const { api } = harness();
    await begin(api);
    assert.equal(api.provincePanelData('cn_beijing').name, '北平市');
    assert.equal(api.provincePanelData('jp_kanto').name, '東京府');
    assert.ok(api.provincePanelData('china_cn_gx').name.includes('広西省'));
    assert.ok(api.provincePanelData('china_cn_xj').name.includes('新疆省'));
    assert.ok(api.provincePanelData('china_cn_xz').name.includes('西蔵'));
    assert.equal(api.provincePanelData('japan_empire_rus_11_6').name, '南樺太（樺太庁）・千島');
  });

  await check('従属国プレイ: 宗主国への宣戦不可・自治拡大・独立宣言', async () => {
    const { api } = harness();
    assert.equal(await api.start({ nationId: 'tibet', difficulty: 'standard', mandate: 'recovery', maxTurns: 24, replace: true }), true);
    assert.equal(api.dependencyInfo('tibet').overlordId, 'china');
    assert.equal(api.declareWar('china', '宗主国への反乱'), false);
    const before = api.snapshot().prestige;
    assert.equal(api.increaseAutonomy().ok, true);
    assert.ok(api.snapshot().prestige < before);
    const independence = api.declareIndependence();
    assert.equal(independence.ok, true);
    const snapshot = api.snapshot();
    assert.equal(snapshot.clients.tibet.independent, true);
    assert.ok(Object.values(snapshot.wars).some(war => war.attacker === 'china' && war.defender === 'tibet'));
  });

  await check('宗主国は低自治の従属国を威信を払って併合できる', async () => {
    const { api, context } = harness();
    await begin(api);
    const manRegion = vm.runInContext("ORBIS_STATES_DB.find(region => region.country === 'manchukuo' && !region.isSea).id", context);
    const prestige = api.snapshot().prestige;
    const annex = api.annexDependency('manchukuo');
    assert.equal(annex.ok, true);
    assert.ok(api.snapshot().prestige < prestige);
    assert.equal(api.snapshot().clients.manchukuo.annexed, true);
    assert.equal(api.provincePanelData(manRegion).ownerId, 'japan');
  });

  await check('領土移管で旧所有者の請求権が記録される', async () => {
    const { api } = harness();
    await begin(api);
    assert.equal(api.declareWar('china', '国境紛争'), true);
    const warId = Object.keys(api.snapshot().wars)[0];
    assert.equal(api.signPeace(warId, ['cn_beijing'], []), true);
    const panel = api.provincePanelData('cn_beijing');
    assert.equal(panel.ownerId, 'japan');
    assert.ok(panel.claims.some(claim => claim.nationId === 'china'), '中国の請求権');
  });

  await check('従属政権の登録・移管・統合と地図色の解決', async () => {
    const { api } = harness();
    await begin(api);
    assert.equal(api.colorNation('manchukuo'), 'manchukuo', '保護国は独自色');
    assert.equal(api.colorNation('col_japan_korea'), 'japan', '植民地は宗主国色');
    assert.equal(api.colorNation('china'), 'china');
    const registered = api.createDependentCommand('siam', 'protectorate', 'シャム保護国');
    assert.equal(registered.ok, true);
    assert.equal(api.dependencyInfo('siam').type, 'protectorate');
    assert.equal(api.colorNation('siam'), 'siam', '保護国は宗主国色にしない');
    const transferred = api.transferDependentCommand('siam', 'uk');
    assert.equal(transferred.ok, true);
    assert.equal(api.dependencyInfo('siam').overlordId, 'uk');
    assert.equal(api.colorNation('siam'), 'siam');
    const second = api.createDependentCommand('iran', 'colony', 'イラン植民地');
    assert.equal(second.ok, true);
    const integrated = api.integrateDependentCommand('iran');
    assert.equal(integrated.ok, true);
    assert.equal(api.dependencyInfo('iran').dissolved, true);
  });

  await check('地域から動的従属政権を創設し、保存・再開・統合できる', async () => {
    const { api, context } = harness();
    await begin(api);
    const created = api.createDependentRegionCommand('japan_jp_03', 'dv_test_state', 'テスト政庁', 'colony');
    assert.equal(created.ok, true);
    assert.equal(api.colorNation('dv_test_state'), 'japan');
    assert.equal(api.provincePanelData('japan_jp_03').ownerId, 'dv_test_state');
    assert.equal(api.nationMeta('dv_test_state').name, 'テスト政庁');
    assert.equal(api.dependencyInfo('dv_test_state').type, 'colony');
    assert.equal(api.countryCardData('dv_test_state').dependency.type, 'colony');
    assert.ok(api.actorRoster().includes('ministry:dv_test_state'), '従属政権の外務省actor');
    assert.equal(vm.runInContext("state.states.find(region => region.id === 'japan_jp_03').country", context), 'dv_test_state');
    assert.equal(await api.restore(api.snapshot()), true);
    assert.equal(api.provincePanelData('japan_jp_03').ownerId, 'dv_test_state');
    assert.equal(api.nationMeta('dv_test_state').name, 'テスト政庁');
    assert.equal(api.integrateDependentCommand('dv_test_state').ok, true);
    assert.equal(api.provincePanelData('japan_jp_03').ownerId, 'japan');
    assert.ok(!api.actorRoster().includes('ministry:dv_test_state'), '統合後はactorを除去');
  });

  await check('軍閥型は低忠誠で独立する', async () => {
    const { api } = harness();
    respond = () => null;
    await begin(api);
    const snapshot = api.snapshot();
    snapshot.clients.shanxi.loyalty = 10;
    snapshot.nations.shanxi.stb = 50;
    assert.equal(await api.restore(snapshot), true);
    assert.equal(await api.finishTurn(), true);
    assert.equal(await api.finishTurn(), true);
    const after = api.snapshot();
    assert.equal(after.clients.shanxi.independent, true);
    assert.ok(Object.values(after.wars).some(war => war.attacker === 'shanxi' && war.defender === 'china'));
  });

  await check('AI裁定で従属政権を創設・統合できる', async () => {
    const { api } = harness();
    respond = () => null;
    await begin(api);
    assert.equal(await api.send('岩手県に現地政庁を設け、間接統治に切り替えます。', 'adviser'), true);
    const actionId = api.snapshot().turnActions[0].id;
    respond = item => {
      if (item.operation !== 'RESOLUTION') return null;
      const data = evaluation();
      data.dependentChanges = [{ action: 'create', regionId: 'japan_jp_03', vassalId: 'dv_ai_state', name: 'AI岩手政庁', type: 'colony', reason: '間接統治への移行。', sourceActionId: actionId }];
      return { data };
    };
    assert.equal(await api.finishTurn(), true);
    assert.equal(api.provincePanelData('japan_jp_03').ownerId, 'dv_ai_state');
    assert.equal(api.colorNation('dv_ai_state'), 'japan');
    assert.equal(await api.send('AI岩手政庁を中央政府へ統合します。', 'adviser'), true);
    const integrateAction = api.snapshot().turnActions[0].id;
    respond = item => {
      if (item.operation !== 'RESOLUTION') return null;
      const data = evaluation();
      data.dependentChanges = [{ action: 'integrate', vassalId: 'dv_ai_state', reason: '統合の決断。', sourceActionId: integrateAction }];
      return { data };
    };
    assert.equal(await api.finishTurn(), true);
    assert.equal(api.provincePanelData('japan_jp_03').ownerId, 'japan');
  });

  await check('旧セーブの従属国データを既定タイプへ移行する', async () => {
    const { api } = harness();
    await begin(api);
    const save = api.snapshot();
    for (const client of Object.values(save.clients)) {
      delete client.type;
      delete client.kind;
      delete client.legitimacy;
      delete client.dissolved;
    }
    delete save.dynamicNations;
    assert.equal(await api.restore(save), true);
    assert.equal(api.dependencyInfo('manchukuo').type, 'protectorate');
    assert.equal(typeof api.dependencyInfo('manchukuo').legitimacy, 'number');
  });

  await check('中華民国の軍閥会議: 招集・翌ターンの参加表明・会議チャット', async () => {
    const { api } = harness();
    respond = () => null;
    assert.equal(await api.start({ nationId: 'china', difficulty: 'standard', mandate: 'recovery', maxTurns: 24, replace: true }), true);
    const summoned = api.summonWarlords(['shanxi', 'guangxi', 'guangdong']);
    assert.equal(summoned.ok, true);
    assert.equal(api.conferenceInfo().status, 'pending');
    assert.equal(await api.finishTurn(), true);
    const conference = api.conferenceInfo();
    assert.equal(conference.status, 'ready');
    assert.equal(conference.invited.length, 3);
    assert.equal(conference.attended.length + conference.declined.length, 3);
    assert.equal(api.sendConferenceMessage('自治条件と省境の扱いを協議したい。').ok, true);
    const chat = api.conferenceInfo();
    assert.ok(chat.messages.some(message => message.role === 'player'));
    assert.ok(chat.messages.some(message => message.role === 'warlord'));
    assert.equal(await api.restore(api.snapshot()), true);
    assert.equal(api.conferenceInfo().invited.length, 3);
  });

  await check('会話レベルがAIプロンプトとセーブに反映される', async () => {
    const { api } = harness();
    assert.equal(await api.start({ nationId: 'japan', difficulty: 'standard', mandate: 'recovery', maxTurns: 24, knowledgeLevel: 'student', replace: true }), true);
    assert.equal(api.snapshot().knowledgeLevel, 'student');
    const briefing = requests.filter(item => item.operation === 'BRIEFING').at(-1);
    assert.ok(briefing, 'briefing request');
    assert.match(briefing.body.messages[0].content, /会話レベル（学生）/);
    assert.equal(api.setKnowledgeLevel('doctor'), true);
    assert.equal(api.snapshot().knowledgeLevel, 'doctor');
    const save = api.snapshot();
    delete save.knowledgeLevel;
    assert.equal(await api.restore(save), true);
    assert.equal(api.snapshot().knowledgeLevel, 'general');
  });

  await check('開始時に日本軍の部隊が陸州へ自動配置される', async () => {
    const { api, context } = harness();
    await begin(api);
    const formations = api.listFormations();
    const japan = formations.filter(item => item.nationId === 'japan');
    assert.ok(japan.length >= 2);
    assert.ok(japan.some(item => item.type === 'field'), '野戦部隊');
    assert.ok(japan.some(item => item.type === 'garrison'), '守備隊');
    const landIds = new Set(vm.runInContext("ORBIS_STATES_DB.filter(region => !region.isSea && !region.isSeaZone && region.type !== 'sea').map(region => region.id)", context));
    assert.ok(japan.every(item => landIds.has(item.regionId)));
    assert.ok(japan.every(item => Number.isInteger(item.strength) && item.strength >= 1 && item.strength <= 100));
    const garrison = japan.find(item => item.type === 'garrison');
    assert.ok(api.provincePanelData(garrison.regionId).formations.some(item => item.id === garrison.id));
  });

  await check('戦争中の攻勢を許可し、平和時は拒否、非隣接目標は方向目標として保持する', async () => {
    const { api, context } = harness();
    await begin(api);
    const isLand = region => region && !region.isSea && !region.isSeaZone && region.type !== 'sea';
    const db = id => context.window.ORBIS_STATES_DB.find(region => region.id === id);
    const before = api.snapshot();
    const japanSphere = new Set(['japan']);
    for (const [id, client] of Object.entries(before.clients || {})) if (client.sponsorId === 'japan' && !client.dissolved) japanSphere.add(id);
    const frontierTargets = [];
    for (const region of context.window.ORBIS_STATES_DB) {
      if (!isLand(region) || !japanSphere.has(before.territories[region.id] || region.country)) continue;
      for (const neighborId of api.landAdjacency().get(region.id) || []) {
        const neighbor = db(neighborId);
        if (isLand(neighbor) && (before.territories[neighborId] || neighbor.country) === 'china') frontierTargets.push(neighborId);
      }
    }
    assert.ok(frontierTargets.length, '日本陣営に隣接する中国領');
    const formation = api.listFormations().find(item => item.nationId === 'japan' && item.type === 'field');
    assert.ok(formation);
    const pair = { formation, targetId: frontierTargets[0] };
    assert.equal(api.setFormationOrder(pair.formation.id, { kind: 'offensive', targetRegionId: pair.targetId }), false);
    assert.match(api.formationOrderError(), /平和|戦争/);
    assert.equal(api.declareWar('china', '満州国境の戦線'), true);
    const war = api.snapshot();
    assert.equal(api.setFormationOrder(pair.formation.id, { kind: 'offensive', targetRegionId: pair.targetId, targetNationId: 'china' }), true, api.formationOrderError());
    const ordered = api.snapshot().formations.find(item => item.id === pair.formation.id);
    assert.equal(ordered.order.kind, 'offensive');
    assert.equal(ordered.order.targetNationId, 'china');
    const targetIds = new Set(api.formationTargets(pair.formation.id).map(item => item.regionId));
    const far = context.window.ORBIS_STATES_DB.find(region => isLand(region) && (war.territories[region.id] || region.country) === 'china' && region.id !== pair.targetId && !targetIds.has(region.id));
    assert.ok(far, '非隣接の中国領');
    assert.equal(api.setFormationOrder(pair.formation.id, { kind: 'offensive', targetRegionId: far.id, targetNationId: 'china' }), true, api.formationOrderError());
    const direction = api.snapshot().formations.find(item => item.id === pair.formation.id);
    assert.equal(direction.order.kind, 'offensive');
    assert.equal(direction.order.targetRegionId, far.id);
    assert.equal(direction.order.targetNationId, 'china');
    assert.equal(api.setFormationOrder(pair.formation.id, { kind: 'defend' }), true);
    assert.equal(api.snapshot().formations.find(item => item.id === pair.formation.id).order.kind, 'defend');
  });

  await check('攻勢命令のある戦線だけ占領が進み、無命令では広がらない', async () => {
    const ordered = harness();
    await begin(ordered.api);
    assert.equal(ordered.api.declareWar('china', '満州国境の戦線'), true);
    const isLand = region => region && !region.isSea && !region.isSeaZone && region.type !== 'sea';
    const db = id => ordered.context.window.ORBIS_STATES_DB.find(region => region.id === id);
    const snapshot = ordered.api.snapshot();
    const field = ordered.api.listFormations().find(item => item.nationId === 'japan' && item.type === 'field'
      && (ordered.api.landAdjacency().get(item.regionId) || new Set()).has('china_cn_he'));
    assert.ok(field, '満洲側で中国領に隣接する野戦部隊');
    const target = snapshot.territories['china_cn_he'] || db('china_cn_he').country;
    assert.equal(target, 'china');
    assert.equal(ordered.api.setFormationOrder(field.id, { kind: 'offensive', targetRegionId: 'china_cn_he' }), true, ordered.api.formationOrderError());
    const before = Object.keys(snapshot.occupations).length;
    assert.equal(await ordered.api.finishTurn(), true);
    const after = ordered.api.snapshot();
    const gain = Object.keys(after.occupations).length - before;
    assert.equal(gain, 1, `攻勢で占領が1州だけ増える (${gain})`);
    const moved = after.formations.find(item => item.id === field.id);
    assert.notEqual(moved.regionId, field.regionId, '野戦部隊が前進する');
    assert.ok(moved.strength > 0 && moved.strength <= 100, '戦力は0にならない');
    assert.equal(moved.regionId, 'china_cn_he', '前進先は隣接する1州');
    assert.ok(Object.hasOwn(after.occupations, moved.regionId), '前進先は占領地');

    const idle = harness();
    await begin(idle.api);
    assert.equal(idle.api.declareWar('china', '満州国境の戦線'), true);
    const idleBefore = Object.keys(idle.api.snapshot().occupations).length;
    assert.equal(await idle.api.finishTurn(), true);
    const idleGain = Object.keys(idle.api.snapshot().occupations).length - idleBefore;
    assert.equal(idleGain, 0, '命令のない戦線は広がらない');
    assert.ok(gain > idleGain, '攻勢命令との差');
  });

  await check('満洲から江蘇省への攻勢は1ターンで飛ばず、隣接1州までに留まる', async () => {
    const { api, context } = harness();
    await begin(api);
    assert.equal(api.declareWar('china', '満州国境の戦線'), true);
    const isLand = region => region && !region.isSea && !region.isSeaZone && region.type !== 'sea';
    const db = id => context.window.ORBIS_STATES_DB.find(region => region.id === id);
    const jiangsu = db('china_cn_js');
    assert.equal(jiangsu?.nameJa, '江蘇省');
    const adjacency = api.landAdjacency();
    const field = api.listFormations().find(item => item.nationId === 'japan' && item.type === 'field'
      && isLand(db(item.regionId)) && (adjacency.get(item.regionId) || new Set()).has('china_cn_he'));
    assert.ok(field, '満洲国領から中国領へ隣接する日本軍野戦部隊');
    const startRegionId = field.regionId;
    assert.notEqual(startRegionId, 'china_cn_js');
    assert.equal((adjacency.get(startRegionId) || new Set()).has('china_cn_js'), false, '江蘇省は非隣接');
    const before = api.snapshot();
    const beforeOccupations = new Set(Object.keys(before.occupations));
    assert.equal((before.territories['china_cn_js'] || jiangsu.country), 'china');
    assert.equal(api.setFormationOrder(field.id, { kind: 'offensive', targetRegionId: 'china_cn_js', targetNationId: 'china' }), true, api.formationOrderError());
    const ordered = api.snapshot().formations.find(item => item.id === field.id);
    assert.equal(ordered.order.kind, 'offensive');
    assert.equal(ordered.order.targetRegionId, 'china_cn_js');

    assert.equal(await api.finishTurn(), true);
    const after = api.snapshot();
    const moved = after.formations.find(item => item.id === field.id);
    assert.ok(moved);
    assert.notEqual(moved.regionId, 'china_cn_js', '江蘇省へ飛ばない');
    assert.equal((after.territories['china_cn_js'] || jiangsu.country), 'china');
    assert.ok(!Object.hasOwn(after.occupations, 'china_cn_js'), '江蘇省は占領されない');
    const neighborIds = adjacency.get(startRegionId) || new Set();
    if (moved.regionId !== startRegionId) {
      assert.ok(neighborIds.has(moved.regionId), '移動先は命令前の州に陸続きで隣接する1州');
      assert.ok(isLand(db(moved.regionId)), '移動先は陸州');
    }
    const newlyOccupied = Object.keys(after.occupations).filter(id => !beforeOccupations.has(id));
    assert.ok(newlyOccupied.length <= 1, `1部隊が1ターンに占領する州は0または1 (${newlyOccupied.length})`);
    if (moved.regionId !== startRegionId) {
      assert.equal(newlyOccupied.length, 1);
      assert.equal(newlyOccupied[0], moved.regionId);
    }
  });

  await check('ズームアウト時は近接する部隊マーカーを集約し、拡大時は個別表示する', async () => {
    const { context } = harness();
    const result = vm.runInContext(`(() => {
      const entries = [
        { id: 'a', x: 100, y: 100 },
        { id: 'b', x: 112, y: 106 },
        { id: 'c', x: 300, y: 200 }
      ];
      const grouped = clusterFormationPoints(entries, 28, true);
      const separate = clusterFormationPoints(entries, 28, false);
      return {
        grouped: grouped.map(cluster => cluster.members.map(member => member.id)),
        separate: separate.map(cluster => cluster.members.map(member => member.id)),
        globeOut: formationClusteringEnabled(1.05, 'globe'),
        globeIn: formationClusteringEnabled(2.2, 'globe'),
        flatOut: formationClusteringEnabled(1.0, 'flat'),
        flatIn: formationClusteringEnabled(2.0, 'flat')
      };
    })()`, context);
    assert.deepEqual(json(result.grouped), [['a', 'b'], ['c']]);
    assert.deepEqual(json(result.separate), [['a'], ['b'], ['c']]);
    assert.equal(result.globeOut, true, '球体・ズームアウトで集約');
    assert.equal(result.globeIn, false, '球体・ズームインで個別');
    assert.equal(result.flatOut, true, '平面・ズームアウトで集約');
    assert.equal(result.flatIn, false, '平面・ズームインで個別');
  });

  await check('部隊と命令はスナップショット復元で残り、旧セーブは自動配置する', async () => {
    const { api } = harness();
    await begin(api);
    assert.equal(api.declareWar('china', '満州国境の戦線'), true);
    const field = api.listFormations().find(item => item.nationId === 'japan' && item.type === 'field');
    const targets = api.formationTargets(field.id);
    assert.ok(targets.length);
    assert.equal(api.setFormationOrder(field.id, { kind: 'offensive', targetRegionId: targets[0].regionId }), true, api.formationOrderError());
    const saved = json(api.snapshot());
    const restored = harness().api;
    assert.equal(await restored.restore(saved), true);
    const restoredField = restored.snapshot().formations.find(item => item.id === field.id);
    assert.ok(restoredField);
    assert.equal(restoredField.regionId, field.regionId);
    assert.equal(restoredField.order.kind, 'offensive');
    assert.equal(restoredField.order.targetRegionId, targets[0].regionId);

    const old = json(saved);
    delete old.formations;
    const oldApi = harness().api;
    assert.equal(await oldApi.restore(old), true);
    const seeded = oldApi.snapshot().formations;
    assert.ok(Array.isArray(seeded) && seeded.length > 0);
    assert.ok(seeded.some(item => item.nationId === 'japan'));
    assert.ok(seeded.every(item => item.strength >= 1 && item.strength <= 100));

    const broken = json(saved);
    broken.formations = {};
    await assert.rejects(oldApi.restore(broken), /部隊|配列/);
  });

  console.log(`\n${passed} checks passed. Live provider credentials were not used.`);
} finally {
  await new Promise(resolve => server.close(resolve));
}
