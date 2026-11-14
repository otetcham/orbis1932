import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { auditData } from './orbis_data_audit.mjs';
import { buildDist } from './scripts/build_dist.mjs';
import { runM7aLongRun } from './scripts/longrun_m7a_1972.mjs';
import { runM7bLongRun } from './scripts/longrun_m7b_1972.mjs';

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
const versionSource = await readFile(new URL('./orbis_version.js', import.meta.url), 'utf8');
const creditsSource = await readFile(new URL('./orbis_credits.js', import.meta.url), 'utf8');
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

function harness(provider = 'custom', sharedStorage = null) {
  const storage = sharedStorage || new Map();
  const document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, activeElement: null };
  const context = vm.createContext({ console, document, fetch, URL, Blob, AbortController, AbortSignal, setTimeout, clearTimeout, crypto: webcrypto, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, addEventListener() {}, confirm: () => true });
  context.window = context;
  vm.runInContext(statesSource, context, { timeout: 4000 });
  vm.runInContext(mapMetaSource, context, { timeout: 4000 });
  vm.runInContext(regionLabelsSource, context, { timeout: 4000 });
  for (const script of inlineScripts) if (script.trim()) vm.runInContext(script, context, { timeout: 4000 });
  vm.runInContext(versionSource, context, { timeout: 4000 });
  vm.runInContext(creditsSource, context, { timeout: 4000 });
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

  await check('導入案内を最初の数ターンで進め、閉じても再表示でき、完了後は自動表示しない', async () => {
    const { api } = harness();
    await begin(api);
    const initial = api.onboardingInfo();
    assert.equal(initial.done, false);
    assert.equal(initial.step, 0);
    assert.equal(initial.total, 3);
    assert.equal(initial.lastShownTurn, 0, '開始直後に案内を表示');
    assert.equal(initial.autoEligible, true);
    assert.equal(api.dismissOnboarding(), true, '閉じられる');
    assert.equal(await api.finishTurn(), true);
    const afterTurn = api.onboardingInfo();
    assert.equal(afterTurn.done, false);
    assert.equal(afterTurn.lastShownTurn, 1, '未完了なら次の半月にも案内');
    assert.equal(afterTurn.autoAvailable, false, '同じ半月では再表示しない');
    assert.equal(api.advanceOnboarding(), true);
    assert.equal(api.onboardingInfo().step, 1);
    assert.equal(api.advanceOnboarding(), true);
    assert.equal(api.onboardingInfo().step, 2);
    assert.equal(api.completeOnboarding(), true);
    const done = api.onboardingInfo();
    assert.equal(done.done, true);
    assert.equal(done.autoEligible, false);
    assert.equal(api.maybeShowOnboarding(), false, '完了後は自動表示しない');
    assert.equal(api.advanceOnboarding(), false, '完了後は進めない');
    assert.equal(api.openOnboarding(), true, 'メニューから後で見直せる');
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

  await check('直前ターンのUndoで地図・戦争・命令・指標・日付が戻り、対象が無ければ拒否される', async () => {
    const { api, context } = harness();
    await begin(api);
    assert.equal(api.undoInfo().available, false, '開始直後は取り消す対象が無い');
    assert.equal(api.undoLastTurn(), false, '対象が無いUndoは拒否');
    const actionText = '沿岸防備の点検と予備役の招集準備を進める。';
    assert.equal(await api.submitAction(actionText), true);
    const before = api.snapshot();
    const beforeDate = vm.runInContext('state.date', context);
    assert.equal(await api.finishTurn(), true);
    const after = api.snapshot();
    assert.equal(after.completedTurns, 1);
    assert.ok(after.undo?.state, '直前状態を1件保持');
    assert.equal(after.undo.state.completedTurns, 0);
    assert.equal(after.undo.state.nationalAction.text, actionText, '命令も保持');
    assert.ok(after.articles.some(article => article.kind === 'resolution'), '取り消す前は裁定記事がある');
    assert.ok(Object.values(after.threads).some(channel => channel.messages.some(message => message.turn === 2)), '取り消す前は翌月の電報がある');
    assert.notEqual(vm.runInContext('state.date', context), beforeDate);
    const undo = api.undoInfo();
    assert.equal(undo.available, true);
    assert.equal(undo.turn, 0);
    assert.equal(api.undoLastTurn(), true);
    const restored = api.snapshot();
    assert.equal(restored.completedTurns, 0, '日付が戻る');
    assert.equal(vm.runInContext('state.date', context), beforeDate);
    assert.deepEqual(json(restored.territories), json(before.territories), '地図が戻る');
    assert.deepEqual(json(restored.wars), json(before.wars), '戦争が戻る');
    assert.deepEqual(json(restored.formations), json(before.formations), '部隊が戻る');
    assert.deepEqual(json(restored.nations), json(before.nations), '指標が戻る');
    assert.equal(restored.nationalAction.text, actionText, '命令が戻る');
    assert.equal(restored.actionHistory.length, before.actionHistory.length);
    assert.ok(!restored.articles.some(article => article.kind === 'resolution'), '取り消した裁定記事も戻る');
    assert.equal(restored.articles[0].kind, 'opening');
    assert.ok(Object.values(restored.threads).every(channel => channel.messages.every(message => message.turn <= 1)), '翌月の電報も戻る');
    assert.equal(restored.undo, null, 'Undoは1回だけ');
    assert.equal(api.undoInfo().available, false);
    assert.equal(api.undoLastTurn(), false, '取り消し後は再度拒否');

    const reloaded = harness().api;
    assert.equal(await reloaded.restore(json(after)), true, '直前状態を含むセーブを読み込める');
    assert.equal(reloaded.undoInfo().available, true, '再開後もUndoできる');
    assert.equal(reloaded.undoLastTurn(), true);
    const reloadedState = reloaded.snapshot();
    assert.equal(reloadedState.completedTurns, 0);
    assert.equal(reloadedState.nationalAction.text, actionText);
    assert.ok(!reloadedState.articles.some(article => article.kind === 'resolution'));
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

  await check('自由文命令の裁定叙述が記事とターン再生キューに残る', async () => {
    const { api, storage } = harness();
    await begin(api);
    const order = '予算2で東北の農村救済を始め、現地の協力者と実施時期を定める。';
    const result = '財源の範囲で東北の救済準備を実施した。本格的な給付は翌月へ回す。';
    assert.equal(api.submitAction(order), true);
    respond = item => {
      if (item.operation !== 'RESOLUTION') return null;
      const data = evaluation();
      const id = item.context.nationalAction.id;
      data.actionResults = [{ actionId: id, outcome: 'partial', text: result, effects: { mil: 0, eco: 1, stb: 1, treasury: -2, prestige: 0, tension: 0 }, relations: [], evidence: [id] }];
      return { data };
    };
    assert.equal(await api.finishTurn(), true);
    const after = api.snapshot();
    assert.ok(after.articles.some(article => article.notes?.some(note => note.includes('国家の行動・部分成功') && note.includes(result))), '記事ノートに裁定叙述');
    const card = after.turnPlaybackQueue.find(item => item.kind === 'order');
    assert.ok(card, '再生キューの命令カード');
    assert.match(card.headline, /国家の行動・部分成功/);
    assert.equal(card.order, order);
    assert.ok(card.body.includes(`命令：${order}`));
    assert.ok(card.body.includes(`結果：${result}`));
    assert.equal(card.outcome, 'partial');
    const saved = JSON.parse(storage.get('orbis_campaign_v6'));
    const { api: restored } = harness();
    assert.equal(await restored.restore(saved), true);
    const restoredCard = restored.snapshot().turnPlaybackQueue.find(item => item.kind === 'order');
    assert.ok(restoredCard, '再生キューは保存・再開後も残る');
    assert.equal(restoredCard.order, order);
    assert.ok(restoredCard.body.includes(result));
  });

  await check('常設方針は保存・再開・AI文脈に残り、設定と提出でAPIを増やさない', async () => {
    const { api, storage } = harness();
    await begin(api);
    const policy = '対中は穏健に、軍備は漸進する。通商網を優先する。';
    const calls = requests.length;
    assert.equal(api.setStandingPolicy(policy), true);
    assert.equal(api.setStandingPolicy(`${policy} 海軍は守勢。`), true);
    assert.equal(api.submitAction('予算2で東北の農村救済を始める。'), true);
    assert.equal(requests.length, calls, '設定・提出時はAPIを使わない');
    const snapshot = api.snapshot();
    assert.equal(snapshot.standingPolicy, `${policy} 海軍は守勢。`);
    const serialized = storage.get('orbis_campaign_v6');
    assert.ok(serialized?.includes('海軍は守勢'));
    const { api: restored } = harness();
    assert.equal(await restored.restore(JSON.parse(serialized)), true);
    assert.equal(restored.snapshot().standingPolicy, `${policy} 海軍は守勢。`);
    assert.equal(await restored.finishTurn(), true);
    const evaluationRequest = requests.filter(item => item.operation === 'RESOLUTION').at(-1);
    assert.ok(evaluationRequest.context.standingPolicy.includes('海軍は守勢'), 'EVALUATION文脈に常設方針');
    const briefingRequest = requests.filter(item => item.operation === 'BRIEFING').at(-1);
    assert.ok(briefingRequest.context.standingPolicy.includes('海軍は守勢'), 'BRIEFING文脈に常設方針');
    assert.equal(restored.clearStandingPolicy(), true);
    assert.equal(restored.snapshot().standingPolicy, '');
    const old = json(restored.snapshot());
    delete old.standingPolicy;
    delete old.adviserBriefings;
    delete old.turnPlaybackQueue;
    const { api: oldApi } = harness();
    assert.equal(await oldApi.restore(old), true);
    assert.equal(oldApi.snapshot().standingPolicy, '');
    assert.deepEqual(json(oldApi.snapshot().adviserBriefings), []);
    assert.deepEqual(json(oldApi.snapshot().turnPlaybackQueue), []);
  });

  await check('顧問ブリーフィングが分野別に取れ、裁定後の要約が記事とセーブに残る', async () => {
    const { api, storage } = harness();
    await begin(api);
    const policy = '対中は穏健に、軍備は漸進する。';
    assert.equal(api.setStandingPolicy(policy), true);
    assert.equal(api.submitAction('予算2で東北の農村救済を始める。'), true);
    const briefingBefore = api.situationBriefing();
    const titles = briefingBefore.sections.map(section => section.title);
    assert.ok(titles.includes('軍事') && titles.includes('外交') && titles.includes('内政・経済'), '分野別の顧問メモ');
    assert.ok(briefingBefore.sections.find(section => section.id === 'directives').lines.some(line => line.includes(policy)), '常設方針が読める');
    assert.ok(briefingBefore.sections.find(section => section.id === 'directives').lines.some(line => line.includes('農村救済')), '進行中の命令が読める');
    assert.equal(await api.finishTurn(), true);
    const after = api.snapshot();
    const resolution = after.articles.find(article => article.kind === 'resolution');
    assert.ok(resolution.notes.some(note => note.includes('顧問ブリーフィング')), '記事ノートに顧問要約');
    assert.equal(after.adviserBriefings.length, 1);
    assert.ok(after.adviserBriefings[0].summary.includes(policy));
    assert.ok(after.adviserBriefings[0].sections.some(section => section.id === 'military' && section.lines.length));
    const saved = JSON.parse(storage.get('orbis_campaign_v6'));
    const { api: restored } = harness();
    assert.equal(await restored.restore(saved), true);
    const reopened = restored.snapshot();
    assert.equal(reopened.adviserBriefings.length, 1);
    assert.ok(reopened.articles.find(article => article.kind === 'resolution').notes.some(note => note.includes('顧問ブリーフィング')));
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

  await check('戦時得点の範囲内で和平要求が通り、不足要求は拒否され、確定後に領土へ反映される', async () => {
    const { api, context } = harness();
    await begin(api);
    assert.equal(api.declareWar('china', '和平会議テスト'), true);
    const warm = api.snapshot();
    const warId = Object.keys(warm.wars).find(id => warm.wars[id].status === 'active');
    assert.ok(warId);
    for (const stateId of ['cn_beijing', 'china_cn_hb']) warm.territories[stateId] = 'japan', warm.occupations[stateId] = 'china';
    await api.restore(warm);
    const summary = api.peaceConferenceSummary(warId);
    assert.ok(summary, '和平会議の要約');
    assert.ok(summary.available > 0, `戦時得点 ${summary.available}`);
    const annex = summary.demands.find(demand => demand.type === 'annex' && demand.affordable);
    assert.ok(annex, '得点内の併合要求');
    const vassalize = summary.demands.find(demand => demand.type === 'vassalize');
    assert.ok(vassalize, '従属化要求');
    assert.ok(vassalize.cost > summary.available, `従属化 ${vassalize.cost} > 得点 ${summary.available}`);
    assert.equal(api.togglePeaceDemand(warId, vassalize.id).ok, false, '得点不足の要求は選べない');
    const rejected = api.confirmPeaceConference(warId, [vassalize.id]);
    assert.equal(rejected.ok, false, '得点不足の要求は確定できない');
    assert.equal(api.snapshot().wars[warId].status, 'active', '拒否時は戦争継続');
    assert.equal(api.togglePeaceDemand(warId, annex.id).ok, true);
    const confirmed = api.confirmPeaceConference(warId);
    assert.equal(confirmed.ok, true, confirmed.error);
    const after = api.snapshot();
    assert.equal(after.wars[warId].status, 'peace');
    assert.equal(after.territories[annex.stateId], 'japan');
    assert.equal(after.occupations[annex.stateId], undefined, '併合で占領状態を解除');
    assert.ok((after.claims[annex.stateId] || []).some(claim => claim.nationId === 'china'), '旧所有者の請求権');
    assert.ok(api.warScoreSummary(warId));
    assert.ok(context.window.ORBIS_STATES_DB.some(region => region.id === annex.stateId));
  });

  await check('敵の制海下では海を隔てた部隊の補給が悪化する', async () => {
    const { api, context } = harness();
    await begin(api);
    const warm = api.snapshot();
    const field = warm.formations.find(item => item.nationId === 'japan' && item.type === 'field');
    assert.ok(field, '野戦部隊');
    field.regionId = 'usa_pacific';
    warm.territories.usa_pacific = 'japan';
    warm.occupations.usa_pacific = 'usa';
    const region = context.window.ORBIS_STATES_DB.find(item => item.id === 'usa_pacific');
    assert.ok(region);
    const zoneDistance = (a, b) => {
      let dLon = Math.abs((Number(a.lon) || 0) - (Number(b.lon) || 0)) % 360;
      if (dLon > 180) dLon = 360 - dLon;
      return Math.hypot(dLon, (Number(a.lat) || 0) - (Number(b.lat) || 0));
    };
    const zone = context.window.ORBIS_STATES_DB
      .filter(item => item.isSea || item.isSeaZone)
      .sort((a, b) => zoneDistance(region, a) - zoneDistance(region, b))[0];
    assert.ok(zone, '最寄りの海域');
    warm.wars['war-sea-test'] = { attacker: 'japan', defender: 'usa', startedTurn: 0, status: 'active', reason: '制海テスト' };
    warm.maritime = { navy: { japan: 100, usa: 50 }, air: { japan: 50, usa: 20 }, seaControl: { [zone.id]: 'japan' }, turn: 0 };
    await api.restore(warm);
    const friendly = api.formationSupply(field.id);
    assert.ok(friendly.level > 10, `自国制海の海路補給 ${friendly.level}`);
    assert.equal(friendly.seaControl, 'japan');
    const hostileSnap = api.snapshot();
    hostileSnap.maritime.seaControl[zone.id] = 'usa';
    await api.restore(hostileSnap);
    const hostile = api.formationSupply(field.id);
    assert.ok(hostile.level < friendly.level, `敵制海 ${hostile.level} < 自国制海 ${friendly.level}`);
    assert.equal(hostile.status, 'isolated');
    assert.equal(hostile.seaControl, 'usa');
  });

  await check('平和時、自国または中立の海路を持つ海外部隊は孤立しない', async () => {
    const { api, context } = harness();
    await begin(api);
    const warm = api.snapshot();
    const field = warm.formations.find(item => item.nationId === 'japan' && item.type === 'field');
    assert.ok(field, '野戦部隊');
    field.regionId = 'usa_pacific';
    warm.territories.usa_pacific = 'japan';
    warm.occupations.usa_pacific = 'usa';
    const region = context.window.ORBIS_STATES_DB.find(item => item.id === 'usa_pacific');
    assert.ok(region);
    const zoneDistance = (a, b) => {
      let dLon = Math.abs((Number(a.lon) || 0) - (Number(b.lon) || 0)) % 360;
      if (dLon > 180) dLon = 360 - dLon;
      return Math.hypot(dLon, (Number(a.lat) || 0) - (Number(b.lat) || 0));
    };
    const zone = context.window.ORBIS_STATES_DB
      .filter(item => item.isSea || item.isSeaZone)
      .sort((a, b) => zoneDistance(region, a) - zoneDistance(region, b))[0];
    assert.ok(zone, '最寄りの海域');
    warm.maritime = { navy: { japan: 100 }, air: { japan: 50 }, seaControl: {}, turn: 0 };
    await api.restore(warm);
    const neutral = api.formationSupply(field.id);
    assert.equal(neutral.relation, 'neutral', '制海なしの中立海域');
    assert.notEqual(neutral.status, 'isolated', '中立海域で孤立しない');
    assert.ok(neutral.level >= 40, `中立海域の海路補給 ${neutral.level}`);
    const friendlySnap = api.snapshot();
    friendlySnap.maritime.seaControl[zone.id] = 'japan';
    await api.restore(friendlySnap);
    const friendly = api.formationSupply(field.id);
    assert.equal(friendly.relation, 'friendly', '自国制海');
    assert.notEqual(friendly.status, 'isolated', '自国海域で孤立しない');
    assert.ok(friendly.level >= 40, `自国海域の海路補給 ${friendly.level}`);
  });

  await check('平和時は第三国の制海を敵扱いせず、戦時だけ敵制海ペナルティを与える', async () => {
    const { api, context } = harness();
    await begin(api);
    const warm = api.snapshot();
    const field = warm.formations.find(item => item.nationId === 'japan' && item.type === 'field');
    assert.ok(field, '野戦部隊');
    field.regionId = 'usa_pacific';
    warm.territories.usa_pacific = 'japan';
    warm.occupations.usa_pacific = 'usa';
    const region = context.window.ORBIS_STATES_DB.find(item => item.id === 'usa_pacific');
    assert.ok(region);
    const zoneDistance = (a, b) => {
      let dLon = Math.abs((Number(a.lon) || 0) - (Number(b.lon) || 0)) % 360;
      if (dLon > 180) dLon = 360 - dLon;
      return Math.hypot(dLon, (Number(a.lat) || 0) - (Number(b.lat) || 0));
    };
    const zone = context.window.ORBIS_STATES_DB
      .filter(item => item.isSea || item.isSeaZone)
      .sort((a, b) => zoneDistance(region, a) - zoneDistance(region, b))[0];
    assert.ok(zone, '最寄りの海域');
    warm.maritime = { navy: { japan: 100, usa: 500 }, air: { japan: 50, usa: 20 }, seaControl: { [zone.id]: 'usa' }, turn: 0 };
    await api.restore(warm);
    const peaceful = api.formationSupply(field.id);
    const summary = api.maritimeSummary();
    const zoneSummary = summary.zones.find(item => item.id === zone.id);
    assert.equal(zoneSummary.relation, 'foreign', '平和時の第三国制海');
    assert.equal(summary.hostile, 0, '敵制海に数えない');
    assert.equal(peaceful.seaControl, 'usa');
    assert.equal(peaceful.relation, 'foreign');
    assert.notEqual(peaceful.status, 'isolated', '平和時の第三国制海で孤立しない');
    assert.ok(peaceful.level >= 40, `平和時の第三国海域の補給 ${peaceful.level}`);
    const atWar = api.snapshot();
    atWar.wars['war-sea-peace-test'] = { attacker: 'japan', defender: 'usa', startedTurn: 0, status: 'active', reason: '制海テスト' };
    await api.restore(atWar);
    const hostile = api.formationSupply(field.id);
    assert.equal(hostile.relation, 'hostile');
    assert.equal(hostile.status, 'isolated');
    assert.ok(hostile.level < peaceful.level, `戦時の敵制海 ${hostile.level} < 平和時 ${peaceful.level}`);
    assert.ok(api.maritimeSummary().hostile > 0, '戦時のみ敵制海に数える');
  });

  await check('空軍の薄い効果が前線の補給に出る', async () => {
    const { api, context } = harness();
    await begin(api);
    const warm = api.snapshot();
    const field = warm.formations.find(item => item.nationId === 'japan' && item.type === 'field');
    assert.ok(field);
    const homeRegion = context.window.ORBIS_STATES_DB.find(region => !region.isSea && !region.isSeaZone
      && region.type !== 'sea' && (warm.territories[region.id] || region.country) === 'japan');
    assert.ok(homeRegion);
    field.regionId = homeRegion.id;
    warm.wars['war-air-test'] = { attacker: 'china', defender: 'japan', startedTurn: 0, status: 'active', reason: '航空妨害テスト' };
    warm.conflicts[field.regionId] = { attacker: 'china', defender: 'japan', months: 1, reason: '航空妨害' };
    warm.maritime = { navy: {}, air: { japan: 10, china: 200 }, seaControl: {}, turn: 0 };
    await api.restore(warm);
    const weak = api.formationSupply(field.id);
    const strongSnap = api.snapshot();
    strongSnap.maritime.air = { japan: 200, china: 10 };
    await api.restore(strongSnap);
    const strong = api.formationSupply(field.id);
    assert.ok(strong.level > weak.level, `自国航空優勢 ${strong.level} > 敵航空優勢 ${weak.level}`);
    assert.ok((weak.interdiction || 0) > 0, '敵航空優勢の補給妨害');
  });

  await check('内戦を戦争パネルと同じ和平会議から妥結できる', async () => {
    const { api } = harness();
    await begin(api);
    const warm = api.snapshot();
    warm.civilWars.japan = { factionId: 'japan_rebels', label: '日本反乱軍', status: 'active', startedTurn: 0, halves: 2 };
    warm.factions.japan_rebels = { parent: 'japan', label: '日本反乱軍', color: '#c2410c' };
    warm.territories.jp_kanto = 'japan_rebels';
    warm.occupations.jp_kanto = 'japan';
    await api.restore(warm);
    const summary = api.civilWarPeaceSummary('japan');
    assert.ok(summary, '内戦和平の要約');
    assert.ok(summary.held.some(item => item.stateId === 'jp_kanto'), '反乱勢力の支配州');
    assert.ok(summary.demands.some(demand => demand.id === 'civil_return'));
    assert.ok(summary.demands.some(demand => demand.id === 'civil_autonomy'));
    const result = api.settleCivilWar('japan', 'return');
    assert.equal(result.ok, true, result.error);
    const after = api.snapshot();
    assert.equal(after.civilWars.japan.status, 'resolved');
    assert.equal(after.territories.jp_kanto, 'japan');
    assert.equal(after.occupations.jp_kanto, undefined);
    assert.ok(!api.listConflicts().civil.some(item => item.nationId === 'japan'));
  });

  await check('戦時得点・和平会議の草案・海空軍状態は保存と再開で残り、旧セーブは既定値で読む', async () => {
    const { api, context } = harness();
    await begin(api);
    assert.equal(api.declareWar('china', '保存テスト'), true);
    const warm = api.snapshot();
    const warId = Object.keys(warm.wars).find(id => warm.wars[id].status === 'active');
    warm.territories.cn_beijing = 'japan';
    warm.occupations.cn_beijing = 'china';
    const zone = context.window.ORBIS_STATES_DB.find(item => item.isSea || item.isSeaZone);
    warm.maritime = { navy: { japan: 123 }, air: { japan: 45 }, seaControl: { [zone.id]: 'japan' }, turn: 0 };
    await api.restore(warm);
    const summary = api.peaceConferenceSummary(warId);
    const hold = summary.demands.find(demand => demand.type === 'hold');
    assert.ok(hold);
    assert.equal(api.togglePeaceDemand(warId, hold.id).ok, true);
    const saved = api.snapshot();
    assert.ok(saved.warScores[warId], '戦時得点');
    assert.deepEqual(json(saved.peaceConferences[warId].draft), [hold.id]);
    const restored = harness().api;
    assert.equal(await restored.restore(saved), true);
    const after = restored.snapshot();
    assert.equal(after.warScores[warId].available, saved.warScores[warId].available);
    assert.deepEqual(json(after.peaceConferences[warId].draft), [hold.id]);
    assert.equal(after.maritime.navy.japan, 123);
    assert.equal(after.maritime.air.japan, 45);
    assert.equal(after.maritime.seaControl[zone.id], 'japan');
    const old = json(saved);
    delete old.maritime;
    delete old.peaceConferences;
    delete old.warScores;
    const oldApi = harness().api;
    assert.equal(await oldApi.restore(old), true);
    assert.deepEqual(json(oldApi.snapshot().maritime), { navy: {}, air: {}, seaControl: {}, turn: -1 });
    assert.deepEqual(json(oldApi.snapshot().peaceConferences), {});
    assert.deepEqual(json(oldApi.snapshot().warScores), {});
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

  await check('攻勢命令のあるプレイヤー部隊だけが前進し、無命令では広がらない', async () => {
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
    const battle = json(ordered.api.snapshot());
    battle.formations = battle.formations.filter(item => item.id === field.id);
    assert.equal(await ordered.api.restore(battle), true);
    assert.equal(await ordered.api.finishTurn(), true);
    const after = ordered.api.snapshot();
    const moved = after.formations.find(item => item.id === field.id);
    assert.notEqual(moved.regionId, field.regionId, '野戦部隊が前進する');
    assert.ok(moved.strength > 0 && moved.strength <= 100, '戦力は0にならない');
    assert.equal(moved.regionId, 'china_cn_he', '前進先は隣接する1州');
    const resolution = after.articles.find(article => article.kind === 'resolution');
    assert.ok(resolution.notes.some(note => note.includes('日本') && note.includes('河北省を') && note.includes('占領')), 'プレイヤー部隊の占領がターン結果に残る');
    assert.ok(ordered.api.verifyOccupationsAdjacent(after, 'japan'), 'プレイヤーの占領は隣接している');

    const idle = harness();
    await begin(idle.api);
    assert.equal(idle.api.declareWar('china', '満州国境の戦線'), true);
    const idleBefore = idle.api.snapshot();
    const idleField = idle.api.listFormations().find(item => item.nationId === 'japan' && item.type === 'field');
    assert.ok(idleField);
    assert.equal(idleBefore.formations.find(item => item.id === idleField.id).order, null);
    assert.equal(await idle.api.finishTurn(), true);
    const idleAfter = idle.api.snapshot();
    const idleMoved = idleAfter.formations.find(item => item.id === idleField.id);
    assert.equal(idleMoved.regionId, idleField.regionId, '命令のないプレイヤー部隊は前進しない');
    assert.equal(idleMoved.order, null, '命令のないプレイヤー部隊に自動命令は付かない');
    const idleGain = Object.entries(idleAfter.territories).filter(([id, owner]) => owner === 'japan' && !Object.hasOwn(idleBefore.territories, id)).length;
    assert.equal(idleGain, 0, 'プレイヤー側の新規占領は0');
  });

  await check('占領後、その州に敵味方の部隊が同居しない', async () => {
    const { api, context } = harness();
    await begin(api);
    assert.equal(api.declareWar('china', '満州国境の戦線'), true);
    const isLand = region => region && !region.isSea && !region.isSeaZone && region.type !== 'sea';
    const db = id => context.window.ORBIS_STATES_DB.find(region => region.id === id);
    const base = json(api.snapshot());
    const holder = region => base.territories[region.id] || region.country;
    const sphere = new Set(['japan']);
    for (const [id, client] of Object.entries(base.clients || {})) if (client.sponsorId === 'japan' && !client.dissolved) sphere.add(id);
    const adjacency = api.landAdjacency();
    let pair = null;
    for (const region of context.window.ORBIS_STATES_DB) {
      if (!isLand(region) || !sphere.has(holder(region))) continue;
      const target = [...(adjacency.get(region.id) || [])].map(db).find(item => isLand(item) && holder(item) === 'china');
      if (target) { pair = { origin: region, target }; break; }
    }
    assert.ok(pair, '日本陣営に隣接する中国領');
    base.formations = [
      { id: 'formation-test-attacker', nationId: 'japan', type: 'field', regionId: pair.origin.id, strength: 92, order: { kind: 'offensive', targetRegionId: pair.target.id, targetNationId: 'china' } },
      { id: 'formation-test-defender', nationId: 'china', type: 'field', regionId: pair.target.id, strength: 70, order: { kind: 'defend' } }
    ];
    base.territories[pair.target.id] = 'china';
    delete base.occupations[pair.origin.id];
    delete base.conflicts[pair.origin.id];
    delete base.occupations[pair.target.id];
    delete base.conflicts[pair.target.id];
    assert.equal(await api.restore(base), true);
    assert.equal(await api.finishTurn(), true);
    const after = api.snapshot();
    assert.equal(after.territories[pair.target.id], 'japan', '攻勢側が対象州を占領する');
    assert.ok(!after.formations.some(item => item.regionId === pair.target.id && item.nationId !== 'japan'), '占領州に敵部隊が残らない');
    const resolution = after.articles.find(article => article.kind === 'resolution');
    assert.ok(resolution.notes.some(note => note.includes('占領') || note.includes('奪還')), '占領がターン結果に残る');
    assert.ok(resolution.notes.some(note => note.includes('退却') || note.includes('撃破または捕捉')), '退却または除去がターン結果に残る');
  });

  await check('隣接する自国・従属圏の陸州があれば防衛側はそこへ退却する', async () => {
    const { api, context } = harness();
    await begin(api);
    assert.equal(api.declareWar('china', '満州国境の戦線'), true);
    const isLand = region => region && !region.isSea && !region.isSeaZone && region.type !== 'sea';
    const db = id => context.window.ORBIS_STATES_DB.find(region => region.id === id);
    const base = json(api.snapshot());
    const holder = region => base.territories[region.id] || region.country;
    const sphere = new Set(['japan']);
    for (const [id, client] of Object.entries(base.clients || {})) if (client.sponsorId === 'japan' && !client.dissolved) sphere.add(id);
    const chinaSphere = new Set(['china']);
    for (const [id, client] of Object.entries(base.clients || {})) if (client.sponsorId === 'china' && !client.dissolved) chinaSphere.add(id);
    const adjacency = api.landAdjacency();
    let pair = null;
    for (const region of context.window.ORBIS_STATES_DB) {
      if (!isLand(region) || !sphere.has(holder(region))) continue;
      const target = [...(adjacency.get(region.id) || [])].map(db).find(item => isLand(item) && holder(item) === 'china'
        && [...(adjacency.get(item.id) || [])].map(db).some(next => isLand(next) && next.id !== region.id && chinaSphere.has(holder(next))));
      if (target) { pair = { origin: region, target }; break; }
    }
    assert.ok(pair, '退却先となる中国側の隣接州がある前線');
    base.formations = [
      { id: 'formation-test-attacker', nationId: 'japan', type: 'field', regionId: pair.origin.id, strength: 92, order: { kind: 'offensive', targetRegionId: pair.target.id, targetNationId: 'china' } },
      { id: 'formation-test-defender', nationId: 'china', type: 'field', regionId: pair.target.id, strength: 70, order: { kind: 'defend' } }
    ];
    base.territories[pair.target.id] = 'china';
    delete base.occupations[pair.target.id];
    delete base.conflicts[pair.target.id];
    assert.equal(await api.restore(base), true);
    assert.equal(await api.finishTurn(), true);
    const after = api.snapshot();
    const defender = after.formations.find(item => item.id === 'formation-test-defender');
    assert.ok(defender, '防衛側部隊は退却して残る');
    assert.notEqual(defender.regionId, pair.target.id, '占領州から離れる');
    assert.ok((api.landAdjacency().get(pair.target.id) || new Set()).has(defender.regionId), '退却先は陸続きの隣接州');
    const destinationHolder = after.territories[defender.regionId] || db(defender.regionId).country;
    assert.ok(chinaSphere.has(destinationHolder), `退却先は自国または従属圏 (${destinationHolder})`);
    assert.equal(defender.order.kind, 'defend', '退却後は防御へ切り替える');
    const resolution = after.articles.find(article => article.kind === 'resolution');
    assert.ok(resolution.notes.some(note => note.includes('退却') && note.includes('中国')), '退却先がターン結果に残る');
  });

  await check('退却先が無ければ防衛側部隊は撃破または捕捉され編成から除かれる', async () => {
    const { api, context } = harness();
    await begin(api);
    assert.equal(api.declareWar('china', '満州国境の戦線'), true);
    const isLand = region => region && !region.isSea && !region.isSeaZone && region.type !== 'sea';
    const db = id => context.window.ORBIS_STATES_DB.find(region => region.id === id);
    const base = json(api.snapshot());
    const holder = region => base.territories[region.id] || region.country;
    const sphere = new Set(['japan']);
    for (const [id, client] of Object.entries(base.clients || {})) if (client.sponsorId === 'japan' && !client.dissolved) sphere.add(id);
    const adjacency = api.landAdjacency();
    let pair = null;
    for (const region of context.window.ORBIS_STATES_DB) {
      if (!isLand(region) || !sphere.has(holder(region))) continue;
      const target = [...(adjacency.get(region.id) || [])].map(db).find(item => isLand(item) && holder(item) === 'china');
      if (target) { pair = { origin: region, target }; break; }
    }
    assert.ok(pair, '日本陣営に隣接する中国領');
    for (const neighborId of adjacency.get(pair.target.id) || []) {
      const neighbor = db(neighborId);
      if (!isLand(neighbor)) continue;
      base.territories[neighborId] = 'japan';
      delete base.occupations[neighborId];
      delete base.conflicts[neighborId];
    }
    base.formations = [
      { id: 'formation-test-attacker', nationId: 'japan', type: 'field', regionId: pair.origin.id, strength: 92, order: { kind: 'offensive', targetRegionId: pair.target.id, targetNationId: 'china' } },
      { id: 'formation-test-defender', nationId: 'china', type: 'field', regionId: pair.target.id, strength: 70, order: { kind: 'defend' } }
    ];
    base.territories[pair.target.id] = 'china';
    delete base.occupations[pair.target.id];
    delete base.conflicts[pair.target.id];
    assert.equal(await api.restore(base), true);
    assert.equal(await api.finishTurn(), true);
    const after = api.snapshot();
    assert.equal(after.territories[pair.target.id], 'japan', '攻勢側が対象州を占領する');
    assert.ok(!after.formations.some(item => item.id === 'formation-test-defender'), '退却先のない防衛側部隊は編成から除かれる');
    assert.ok(!after.formations.some(item => item.regionId === pair.target.id && item.nationId !== 'japan'), '占領州に敵部隊が残らない');
    const resolution = after.articles.find(article => article.kind === 'resolution');
    assert.ok(resolution.notes.some(note => note.includes('撃破または捕捉') && note.includes('中国')), '撃破または捕捉がターン結果に残る');
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
    const playerOccupied = Object.keys(after.occupations).filter(id => after.territories[id] === 'japan' && !beforeOccupations.has(id));
    assert.ok(playerOccupied.length <= 1, `プレイヤー1部隊が1ターンに占領する州は0または1 (${playerOccupied.length})`);
    if (moved.regionId !== startRegionId && playerOccupied.length) {
      assert.equal(playerOccupied.length, 1);
      assert.equal(playerOccupied[0], moved.regionId);
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

  await check('国際戦争中にNPCは自部隊へ命令を出し、プレイヤー部隊へ自動攻勢命令を出さない', async () => {
    const { api } = harness();
    await begin(api);
    assert.equal(api.declareWar('china', '満州国境の戦線'), true);
    const before = api.snapshot();
    const playerBefore = before.formations.filter(item => item.nationId === 'japan');
    const chinaBefore = before.formations.filter(item => item.nationId === 'china');
    assert.ok(playerBefore.length >= 2);
    assert.ok(chinaBefore.length >= 2);
    assert.ok(playerBefore.every(item => item.order === null), 'プレイヤー部隊は未命令');
    const chinaStart = new Map(chinaBefore.map(item => [item.id, item.regionId]));
    assert.equal(await api.finishTurn(), true);
    const after = api.snapshot();
    const playerAfter = after.formations.filter(item => item.nationId === 'japan');
    for (const formation of playerAfter) {
      const previous = playerBefore.find(item => item.id === formation.id);
      assert.ok(previous);
      assert.notEqual(formation.order?.kind, 'offensive', 'プレイヤー部隊に自動攻勢命令が付かない');
      if (formation.regionId !== previous.regionId) {
        assert.equal(formation.order?.kind, 'defend', '占領された州から退却したプレイヤー部隊は防御へ切り替える');
        assert.ok((api.landAdjacency().get(previous.regionId) || new Set()).has(formation.regionId), 'プレイヤー部隊の退却も隣接1州まで');
      } else {
        assert.equal(formation.order, null, 'その場に残るプレイヤー部隊に自動命令が付かない');
      }
    }
    const chinaAfter = after.formations.filter(item => item.nationId === 'china');
    assert.ok(chinaAfter.every(item => ['defend', 'offensive'].includes(item.order?.kind)), 'NPC全部に防御か攻勢が付く');
    assert.ok(chinaAfter.some(item => item.order?.kind === 'offensive'), 'NPCの攻勢命令');
    const adjacency = api.landAdjacency();
    for (const formation of chinaAfter) {
      const start = chinaStart.get(formation.id);
      if (!start || formation.regionId === start) continue;
      assert.ok((adjacency.get(start) || new Set()).has(formation.regionId), `NPCの前進は隣接1州まで (${start} -> ${formation.regionId})`);
    }
  });

  await check('自動発生したNPC戦争は開始直後の占領を伴わない', async () => {
    const { api } = harness();
    assert.equal(await api.start({ nationId: 'japan', difficulty: 'standard', mandate: 'recovery', maxTurns: 0, replace: true }), true);
    const save = json(api.snapshot());
    save.completedTurns = 80;
    save.tension = 95;
    save.wars = {};
    save.occupations = {};
    save.conflicts = {};
    for (const formation of save.formations || []) formation.order = null;
    assert.equal(await api.restore(save), true);
    const before = api.snapshot();
    assert.equal(await api.finishTurn(), true);
    const after = api.snapshot();
    const npcWars = Object.values(after.wars || {}).filter(war => war.status === 'active' && war.npc);
    assert.ok(npcWars.length >= 1, '自動発生したNPC戦争');
    assert.equal(Object.keys(after.occupations || {}).length, 0, '開始直後の占領は0');
    assert.deepEqual(json(after.territories), json(before.territories), '開始直後は領土も動かない');
  });

  await check('動員を上げると兵力増が伸び、兵力と装備で新規部隊を編成できる', async () => {
    const low = harness();
    await begin(low.api);
    const lowStart = low.api.snapshot().economy.japan.manpower;
    assert.equal(await low.api.finishTurn(), true);
    const lowGain = low.api.snapshot().economy.japan.manpower - lowStart;

    const high = harness();
    await begin(high.api);
    assert.equal(high.api.setMobilization(3), true);
    const highStart = high.api.snapshot().economy.japan.manpower;
    assert.equal(await high.api.finishTurn(), true);
    const highGain = high.api.snapshot().economy.japan.manpower - highStart;
    assert.ok(highGain > lowGain, `総動員の兵力増が平時より大きい (${highGain} > ${lowGain})`);

    const beforeRecruit = high.api.snapshot();
    const result = high.api.recruitFormation();
    assert.equal(result.ok, true, result.error);
    const afterRecruit = high.api.snapshot();
    assert.equal(afterRecruit.formations.length, beforeRecruit.formations.length + 1);
    const created = afterRecruit.formations.find(item => item.id === result.formation.id);
    assert.ok(created);
    assert.equal(created.nationId, 'japan');
    assert.equal(created.type, 'field');
    assert.ok(created.strength >= 1);
    assert.ok(afterRecruit.economy.japan.manpower < beforeRecruit.economy.japan.manpower, '新編制で兵力を消費');
    assert.ok(afterRecruit.economy.japan.equipment < beforeRecruit.economy.japan.equipment, '新編制で装備を消費');
    assert.ok((afterRecruit.economy.japan.pendingNotes || []).some(note => note.includes('新編制')), '新編制の予告');
    assert.equal(await high.api.finishTurn(), true);
    const resolution = high.api.snapshot().articles.filter(article => article.kind === 'resolution').at(-1);
    assert.ok(resolution.notes.some(note => note.includes('新編制')), 'ターン結果に新編制が残る');
  });

  await check('軍需寄りの生産配分は民用寄りより装備増と補充が大きい', async () => {
    const high = harness();
    await begin(high.api);
    assert.equal(high.api.setProductionSplit(90), true);
    assert.equal(await high.api.finishTurn(), true);
    const highProduction = high.api.snapshot().economy.japan.lastProduction;

    const low = harness();
    await begin(low.api);
    assert.equal(low.api.setProductionSplit(10), true);
    assert.equal(await low.api.finishTurn(), true);
    const lowProduction = low.api.snapshot().economy.japan.lastProduction;

    assert.ok(highProduction.equipment > lowProduction.equipment, `軍需寄りの装備増 (${highProduction.equipment} > ${lowProduction.equipment})`);
    assert.ok(highProduction.replenished >= lowProduction.replenished, `軍需寄りの補充 (${highProduction.replenished} >= ${lowProduction.replenished})`);
  });

  await check('補給不足の部隊は十分な補給の部隊より攻勢が鈍る', async () => {
    const { api, context } = harness();
    await begin(api);
    assert.equal(api.declareWar('china', '満州国境の戦線'), true);
    const isLand = region => region && !region.isSea && !region.isSeaZone && region.type !== 'sea';
    const db = id => context.window.ORBIS_STATES_DB.find(region => region.id === id);
    const snapshot = json(api.snapshot());
    const currentHolder = region => snapshot.territories[region.id] || region.country;
    let pair = null;
    for (const region of context.window.ORBIS_STATES_DB) {
      if (!isLand(region) || currentHolder(region) !== 'china') continue;
      const neighbor = [...(api.landAdjacency().get(region.id) || [])].map(db).find(item => isLand(item) && currentHolder(item) === 'china');
      if (neighbor) { pair = { origin: region, target: neighbor }; break; }
    }
    assert.ok(pair, '中国領の隣接州');
    const supplied = snapshot.formations.find(item => item.nationId === 'japan' && item.type === 'field'
      && [...(api.landAdjacency().get(item.regionId) || [])].some(id => isLand(db(id)) && currentHolder(db(id)) === 'china'));
    assert.ok(supplied, '中国領に隣接する日本軍野戦部隊');
    const suppliedTarget = [...(api.landAdjacency().get(supplied.regionId) || [])].map(db).find(item => isLand(item) && currentHolder(item) === 'china');
    assert.ok(suppliedTarget);
    supplied.order = { kind: 'offensive', targetRegionId: suppliedTarget.id, targetNationId: 'china' };
    const isolated = { id: 'formation-test-isolated', nationId: 'japan', type: 'field', regionId: pair.origin.id, strength: 100, order: { kind: 'offensive', targetRegionId: pair.target.id, targetNationId: 'china' } };
    snapshot.formations.push(isolated);
    assert.equal(await api.restore(snapshot), true);
    const isolatedSupply = api.formationSupply(isolated.id);
    const suppliedSupply = api.formationSupply(supplied.id);
    assert.equal(isolatedSupply.status, 'isolated', '敵中孤立部隊は補給不足');
    assert.ok(suppliedSupply.level >= 70, `本国から陸続きの部隊は補給十分 (${suppliedSupply.level})`);
    const suppliedStart = supplied.regionId;
    assert.equal(await api.finishTurn(), true);
    const after = api.snapshot();
    const isolatedAfter = after.formations.find(item => item.id === isolated.id);
    const suppliedAfter = after.formations.find(item => item.id === supplied.id);
    assert.equal(isolatedAfter.regionId, pair.origin.id, '補給不足の部隊は前進しない');
    assert.equal(isolatedAfter.order.kind, 'offensive', '命令は残る');
    assert.ok(isolatedAfter.strength < isolated.strength, `補給不足で戦力が落ちる (${isolated.strength} -> ${isolatedAfter.strength})`);
    assert.notEqual(suppliedAfter.regionId, suppliedStart, '補給十分の部隊は前進する');
    assert.equal(suppliedAfter.regionId, suppliedTarget.id);
    const resolution = after.articles.find(article => article.kind === 'resolution');
    assert.ok(resolution.notes.some(note => note.includes('補給不足')), 'ターン結果に補給不足が残る');
  });

  await check('兵力・動員・生産配分・装備・補給は保存と再開で残る', async () => {
    const { api } = harness();
    await begin(api);
    assert.equal(api.setMobilization(2), true);
    assert.equal(api.setProductionSplit(80), true);
    assert.equal(await api.finishTurn(), true);
    const saved = json(api.snapshot());
    assert.ok(saved.formations.some(item => Number.isInteger(item.supply)), '部隊の補給状態を保存');
    const restored = harness().api;
    assert.equal(await restored.restore(saved), true);
    const after = restored.snapshot();
    for (const key of ['manpower', 'mobilization', 'equipment', 'militaryShare']) {
      assert.equal(after.economy.japan[key], saved.economy.japan[key], `保存された${key}`);
    }
    assert.deepEqual(json(after.economy.japan.lastProduction), json(saved.economy.japan.lastProduction));
    const savedFormation = saved.formations.find(item => Number.isInteger(item.supply));
    const restoredFormation = after.formations.find(item => item.id === savedFormation.id);
    assert.equal(restoredFormation.supply, savedFormation.supply);
    assert.equal(restoredFormation.supplyStatus, savedFormation.supplyStatus);

    const old = json(saved);
    delete old.economy;
    const oldApi = harness().api;
    assert.equal(await oldApi.restore(old), true);
    const oldEconomy = oldApi.snapshot().economy.japan;
    assert.ok(oldEconomy);
    assert.equal(oldEconomy.mobilization, 0);
    assert.ok(oldEconomy.manpower > 0 && oldEconomy.equipment >= 0);
  });

  await check('日本で史実寄りの国策を数ターン進め、完了効果で生産と研究補正が変わる', async () => {
    const { api } = harness();
    await begin(api);
    assert.equal(api.focusSummary().treeLabel, '日本');
    assert.equal(api.focusSummary().current, null);
    assert.equal(api.selectFocus('jp_manchukuo').ok, true);
    const before = json(api.snapshot());
    for (let turn = 0; turn < 3; turn++) assert.equal(await api.finishTurn(), true);
    const after = api.snapshot();
    const focus = api.focusSummary();
    assert.ok(focus.completed.includes('jp_manchukuo'), '史実寄り国策の完了');
    assert.equal(focus.current, null);
    assert.equal(focus.modifiers.factoryEfficiency, 5);
    assert.ok(after.economy.japan.equipment > before.economy.japan.equipment, '国策完了で装備が増える');
    assert.ok(focus.politicalPower < focus.maxPoliticalPower, '政治力を消費して進行する');
    const resolution = after.articles.filter(article => article.kind === 'resolution').at(-1);
    assert.ok(resolution.notes.some(note => note.includes('満洲国の経営')), 'ターン結果に国策完了が残る');
  });

  await check('日本の代替史分岐は排他で、選んだ側だけが戦争目標と関係を変える', async () => {
    const { api } = harness();
    await begin(api);
    const base = json(api.snapshot());
    base.nationalFocus.japan.completed = ['jp_manchukuo'];
    base.nationalFocus.japan.current = { id: 'jp_league_withdrawal', progress: 54 };
    base.nationalFocus.japan.politicalPower = 200;
    base.economy.japan.militaryShare = 80;
    assert.equal(await api.restore(base), true);
    assert.equal(await api.finishTurn(), true);
    const historical = api.snapshot();
    assert.ok(historical.nationalFocus.japan.completed.includes('jp_league_withdrawal'));
    assert.ok(historical.nationalFocus.japan.warGoals.includes('china'), '史実寄り分岐で対中戦争目標を解禁');
    assert.ok(Object.values(historical.claims).some(list => list.some(claim => claim.nationId === 'japan')), '戦争目標で請求権が付く');
    assert.ok(api.researchSummary().progressGain > 10, '国策の研究速度補正が実際の研究進行に反映される');
    assert.equal(api.selectFocus('jp_asia_cooperation').ok, false, '排他分岐の反対側はロック');
    const historicalRelation = historical.relations.japan.china;

    const alt = json(base);
    alt.nationalFocus.japan.current = { id: 'jp_asia_cooperation', progress: 54 };
    assert.equal(await api.restore(alt), true);
    assert.equal(await api.finishTurn(), true);
    const alternative = api.snapshot();
    assert.ok(alternative.nationalFocus.japan.completed.includes('jp_asia_cooperation'));
    assert.ok(!alternative.nationalFocus.japan.warGoals.includes('china'), '代替史では対中戦争目標を取らない');
    assert.ok(alternative.relations.japan.china > historicalRelation, '代替史は対中関係を改善する');
    assert.equal(api.selectFocus('jp_league_withdrawal').ok, false, '代替史を選ぶと史実寄り分岐がロック');
  });

  await check('非主要国は共通ツリーの国策を進められる', async () => {
    const { api } = harness();
    assert.equal(await api.start({ nationId: 'siam', difficulty: 'standard', mandate: 'recovery', maxTurns: 24, replace: true }), true);
    const summary = api.focusSummary();
    assert.equal(summary.treeLabel, '共通');
    assert.equal(api.selectFocus('gen_industry').ok, true);
    for (let turn = 0; turn < 3; turn++) assert.equal(await api.finishTurn(), true);
    const after = api.focusSummary();
    assert.ok(after.completed.includes('gen_industry'), '共通ツリーの完了');
    assert.equal(after.modifiers.factoryEfficiency, 10);
  });

  await check('産業研究の完了は未研究より装備生産を増やす', async () => {
    const { api: researchedApi } = harness();
    await begin(researchedApi);
    const base = json(researchedApi.snapshot());
    base.economy.japan.militaryShare = 100;
    const researched = json(base);
    researched.research.japan.current = { id: 'industry_standardization', progress: 44 };
    assert.equal(await researchedApi.restore(researched), true);
    assert.equal(await researchedApi.finishTurn(), true);
    const researchedAfter = researchedApi.snapshot();
    assert.ok(researchedAfter.research.japan.completed.includes('industry_standardization'));
    assert.ok(researchedAfter.economy.japan.lastProduction.equipment > 0);

    const { api: baselineApi } = harness();
    await begin(baselineApi);
    assert.equal(await baselineApi.restore(json(base)), true);
    assert.equal(await baselineApi.finishTurn(), true);
    const baselineAfter = baselineApi.snapshot();
    assert.ok(researchedAfter.economy.japan.lastProduction.equipment > baselineAfter.economy.japan.lastProduction.equipment,
      `産業研究後の装備生産 (${researchedAfter.economy.japan.lastProduction.equipment}) が未研究 (${baselineAfter.economy.japan.lastProduction.equipment}) を上回る`);
  });

  await check('NPCは国策と研究を自動で進め、プレイヤー国は自動選択しない', async () => {
    const { api } = harness();
    await begin(api);
    assert.equal(await api.finishTurn(), true);
    const state = api.snapshot();
    assert.equal(state.nationalFocus.japan.current, null, 'プレイヤー国の国策は自動選択しない');
    assert.equal(state.research.japan.current, null, 'プレイヤー国の研究は自動選択しない');
    assert.equal(state.nationalFocus.japan.politicalPower, 39, 'プレイヤーにも政治力は蓄積する');
    const npcFocus = Object.entries(state.nationalFocus).filter(([id, entry]) => id !== 'japan' && entry.current);
    assert.ok(npcFocus.length > 0, 'NPCが国策を開始する');
    assert.ok(npcFocus.every(([, entry]) => entry.current.progress > 0), 'NPC国策が進行する');
    const npcResearch = Object.entries(state.research).filter(([id, entry]) => id !== 'japan' && entry.current);
    assert.ok(npcResearch.length > 0, 'NPCが研究を開始する');
    assert.ok(npcResearch.every(([, entry]) => entry.current.progress > 0), 'NPC研究が進行する');
  });

  await check('国策・研究・政治力は保存と再開で残り、旧セーブは既定値で読む', async () => {
    const { api } = harness();
    await begin(api);
    assert.equal(api.selectFocus('jp_army_reform').ok, true);
    assert.equal(api.selectResearch('industry_standardization').ok, true);
    assert.equal(await api.finishTurn(), true);
    const saved = json(api.snapshot());
    assert.equal(saved.nationalFocus.japan.current.id, 'jp_army_reform');
    assert.ok(saved.nationalFocus.japan.politicalPower < 39);
    assert.equal(saved.research.japan.current.id, 'industry_standardization');
    assert.ok(saved.research.japan.current.progress > 0);

    const restored = harness().api;
    assert.equal(await restored.restore(saved), true);
    const after = restored.snapshot();
    assert.equal(after.nationalFocus.japan.current.id, saved.nationalFocus.japan.current.id);
    assert.equal(after.nationalFocus.japan.current.progress, saved.nationalFocus.japan.current.progress);
    assert.equal(after.nationalFocus.japan.politicalPower, saved.nationalFocus.japan.politicalPower);
    assert.equal(after.research.japan.current.id, saved.research.japan.current.id);
    assert.equal(after.research.japan.current.progress, saved.research.japan.current.progress);

    const old = json(saved);
    delete old.nationalFocus;
    delete old.research;
    const oldApi = harness().api;
    assert.equal(await oldApi.restore(old), true);
    const oldFocus = oldApi.focusSummary();
    assert.equal(oldFocus.politicalPower, 25);
    assert.equal(oldFocus.current, null);
    assert.equal(oldApi.researchSummary().current, null);
    assert.ok(oldApi.researchSummary().branches.every(branch => branch.items.some(item => item.status === 'available')), '旧セーブでも研究を選べる');
  });

  await check('史実の弧が宣戦とNPC攻勢を起こし、隣接する占領だけが進む', async () => {
    const { api } = harness();
    assert.equal(await api.start({ nationId: 'uk', difficulty: 'story', mandate: 'recovery', maxTurns: 0, replace: true }), true);
    const fired = api.forceWorldArc('germany_poland');
    assert.equal(fired.status, 'fired', 'ポーランド侵攻の弧が発火');
    const start = api.snapshot();
    const war = Object.values(start.wars).find(item => item.attacker === 'germany' && item.defender === 'poland' && item.status === 'active');
    assert.ok(war, 'ドイツ・ポーランド戦争が開始される');
    assert.ok((war.goals?.attacker?.length || 0) >= 10, '戦争目標が複数州に設定される');
    assert.ok(api.listFormations('germany').some(formation => formation.order?.kind === 'offensive'), 'NPC部隊に攻勢命令が付く');
    for (let turn = 0; turn < 4; turn++) assert.equal(await api.finishTurn(), true);
    const after = api.snapshot();
    const held = Object.entries(after.territories || {}).filter(([id, owner]) => owner === 'germany' && id.startsWith('poland_')).map(([id]) => id);
    assert.ok(held.length > 0, 'NPCの前進でポーランド州が占領される');
    assert.ok(api.verifyOccupationsAdjacent(after, 'germany'), '占領はドイツ支配圏に隣接する1州ずつ');
  });

  await check('NPC和平は戦争目標に応じて複数州を地図へ反映する', async () => {
    const { api } = harness();
    assert.equal(await api.start({ nationId: 'uk', difficulty: 'story', mandate: 'recovery', maxTurns: 0, replace: true }), true);
    assert.equal(api.forceWorldArc('germany_poland').status, 'fired');
    const start = api.snapshot();
    const warId = Object.keys(start.wars).find(id => start.wars[id].attacker === 'germany' && start.wars[id].defender === 'poland');
    assert.ok(warId);
    for (let turn = 0; turn < 14; turn++) {
      assert.equal(await api.finishTurn(), true);
      if (api.snapshot().wars[warId].status !== 'active') break;
    }
    const after = api.snapshot();
    assert.notEqual(after.wars[warId].status, 'active', 'NPC和平で戦争が終結する');
    assert.ok(['peace', 'resolved'].includes(after.wars[warId].status));
    assert.ok(after.wars[warId].result, '和平結果が戦争データに残る');
    const held = Object.entries(after.territories || {}).filter(([id, owner]) => owner === 'germany' && id.startsWith('poland_')).map(([id]) => id);
    assert.ok(held.length >= 2, `占領地が1州だけでなく複数州処理される (${held.length}州)`);
    assert.ok((after.wars[warId].result.annexed || []).length >= 2, '複数州の併合が和平結果に記録される');
  });

  await check('プレイヤーの常設方針は主要な史実の弧を遅延・不発にする', async () => {
    const { api } = harness();
    assert.equal(await api.start({ nationId: 'austria', difficulty: 'story', mandate: 'recovery', maxTurns: 0, replace: true }), true);
    assert.equal(api.setStandingPolicy('オーストリアの独立を保障し、独墺併合を阻止する。'), true);
    const forced = api.forceWorldArc('germany_anschluss');
    assert.equal(forced.status, 'delayed', '常設方針でアンシュルスが延期される');
    assert.equal(api.snapshot().territories.austria_at_9, undefined, '阻止中はオーストリアの州が移管されない');
    for (let turn = 0; turn < 12; turn++) assert.equal(await api.finishTurn(), true);
    const status = api.worldArcStatus('germany_anschluss');
    assert.ok(['delayed', 'prevented'].includes(status.status), 'プレイヤー介入で遅延または不発になる');
    const austriaStill = ['austria_at_1', 'austria_at_2', 'austria_at_3', 'austria_at_4', 'austria_at_5', 'austria_at_6', 'austria_at_7', 'austria_at_8', 'austria_at_9']
      .some(id => api.snapshot().territories[id] === 'germany');
    assert.equal(austriaStill, false, 'オーストリアはドイツへ併合されない');
  });

  await check('政治的な併合は既存の領土APIで地図を変える', async () => {
    const { api } = harness();
    assert.equal(await api.start({ nationId: 'uk', difficulty: 'story', mandate: 'recovery', maxTurns: 0, replace: true }), true);
    const fired = api.forceWorldArc('germany_anschluss');
    assert.equal(fired.status, 'fired');
    const after = api.snapshot();
    const austriaStates = ['austria_at_1', 'austria_at_2', 'austria_at_3', 'austria_at_4', 'austria_at_5', 'austria_at_6', 'austria_at_7', 'austria_at_8', 'austria_at_9'];
    assert.ok(austriaStates.every(id => after.territories[id] === 'germany'), 'オーストリア全州がドイツの統治へ移る');
    assert.equal(after.nations.austria.dissolved, true, '併合された国家は溶解状態になる');
    assert.ok(after.worldArcs.log.some(entry => entry.id === 'germany_anschluss' && entry.status === 'fired'), '弧の記録が日付付きで残る');
  });

  await check('圧縮セーブを再開でき、ターン要約が残り、旧セーブも読める', async () => {
    const { api, storage } = harness();
    assert.equal(await api.start({ nationId: 'uk', difficulty: 'story', mandate: 'recovery', maxTurns: 0, replace: true }), true);
    assert.equal(api.forceWorldArc('germany_anschluss').status, 'fired');
    for (let turn = 0; turn < 6; turn++) assert.equal(await api.finishTurn(), true);
    const serialized = storage.get('orbis_campaign_v6');
    assert.ok(serialized);
    assert.ok(!serialized.includes('TEST_ONLY_NOT_A_REAL_KEY'), 'APIキーはセーブに含まれない');
    const saved = JSON.parse(serialized);
    assert.ok(Array.isArray(saved.turnSummaries) && saved.turnSummaries.length >= 6, 'ターン要約が保存される');
    assert.ok(saved.articles.length <= 40, '本文付き記事は直近に絞られる');
    assert.ok(saved.worldArcs.log.length >= 1, '史実の弧の進行が保存される');
    const restored = harness().api;
    assert.equal(await restored.restore(JSON.parse(serialized)), true);
    const resumed = restored.snapshot();
    assert.equal(resumed.completedTurns, saved.completedTurns);
    assert.ok(resumed.turnSummaries.length >= 6);
    assert.ok(resumed.turnSummaries.some(item => item.headline && item.date), '日付と見出しの要約が残る');
    assert.ok(resumed.worldArcs.log.some(entry => entry.id === 'germany_anschluss'));

    const old = json(saved);
    delete old.turnSummaries;
    delete old.worldArcs;
    delete old.undo;
    const oldApi = harness().api;
    assert.equal(await oldApi.restore(old), true, '旧セーブは既定値で読める');
    assert.ok(oldApi.snapshot().turnSummaries.length > 0, '旧セーブでも記事から要約を復元する');
    assert.equal(oldApi.snapshot().completedTurns, saved.completedTurns);
  });

  await check('枢軸敗戦の講和でオーストリア・チェコ・ポーランドが復活し、ドイツが東西に分かれ、日本とイタリアが征服地を失う', async () => {
    const { api, context } = harness();
    assert.equal(await api.start({ nationId: 'uk', difficulty: 'story', mandate: 'recovery', maxTurns: 0, replace: true }), true);
    for (const id of ['germany_anschluss', 'germany_sudeten', 'germany_prague']) assert.equal(api.forceWorldArc(id).status, 'fired');
    const land = vm.runInContext('ORBIS_STATES_DB', context).filter(region => !region.isSea && !region.isSeaZone && region.type !== 'sea');
    const snap = json(api.snapshot());
    for (const region of land.filter(region => region.country === 'poland')) snap.territories[region.id] = 'germany';
    snap.nations.poland.dissolved = true;
    assert.equal(await api.restore(snap), true);
    assert.equal(api.forceWorldArc('italy_ethiopia').status, 'fired');
    assert.equal(api.forceWorldArc('ww2_end_europe').status, 'fired');
    assert.equal(api.forceWorldArc('ww2_end_pacific').status, 'fired');
    const after = api.snapshot();
    const holder = region => after.territories[region.id] || region.country;
    const statesOf = country => land.filter(region => region.country === country);
    for (const country of ['austria', 'czechoslovakia', 'poland']) {
      assert.equal(after.nations[country].dissolved, false, `${country} が復活する`);
      assert.ok(statesOf(country).every(region => holder(region) === country), `${country} の州が復帰する`);
    }
    assert.ok(after.nations.germany.dissolved || land.filter(region => holder(region) === 'germany').length <= 1, '統一ドイツが征服規模のまま残らない');
    assert.equal(after.nations.west_germany?.suzerain, null, '西ドイツは独立国');
    assert.equal(after.nations.east_germany?.suzerain, null, '東ドイツは独立国');
    assert.ok(land.filter(region => holder(region) === 'west_germany').length > 0, '西ドイツが州を保有する');
    assert.ok(land.filter(region => holder(region) === 'east_germany').length > 0, '東ドイツが州を保有する');
    assert.equal(after.dynamicNations.west_germany.name, '西ドイツ');
    assert.equal(after.dynamicNations.east_germany.name, '東ドイツ');
    assert.match(after.dynamicNations.west_germany.color, /^#[0-9a-f]{6}$/i);
    assert.match(after.dynamicNations.east_germany.color, /^#[0-9a-f]{6}$/i);
    assert.equal(after.clients.col_japan_korea.independent, true, '朝鮮が独立する');
    assert.equal(after.nations.col_japan_korea.suzerain, null);
    assert.equal(holder(land.find(region => region.id === 'japan_empire_twn')), 'china', '台湾が中国へ戻る');
    assert.equal(after.nations.manchukuo.dissolved, true, '満洲国が解体される');
    assert.equal(land.filter(region => holder(region) === 'manchukuo').length, 0, '満洲国の州が残らない');
    assert.equal(after.clients.col_italy_libya.independent, true, 'イタリア領リビアが独立する');
    assert.equal(after.clients.col_italy_eastafrica.independent, true, 'イタリア領東アフリカが独立する');
    assert.equal(after.nations.ethiopia.dissolved, false, 'エチオピアが復活する');
    assert.ok(statesOf('ethiopia').every(region => holder(region) === 'ethiopia'), 'エチオピアの州がイタリアから戻る');
  });

  await check('枢軸勝利の逸脱では征服結果を地図に残し、敗戦用の再編を適用しない', async () => {
    const { api, context } = harness();
    assert.equal(await api.start({ nationId: 'uk', difficulty: 'story', mandate: 'recovery', maxTurns: 0, replace: true }), true);
    for (const id of ['germany_anschluss', 'germany_sudeten', 'germany_prague']) assert.equal(api.forceWorldArc(id).status, 'fired');
    const snap = json(api.snapshot());
    snap.territories.russia_ru_mow = 'germany';
    assert.equal(await api.restore(snap), true);
    const result = api.forceWorldArc('ww2_end_europe');
    assert.equal(result.status, 'fired');
    assert.match(result.state.result.summary, /枢軸勝利/);
    const after = api.snapshot();
    assert.equal(after.postwarSettlement.europe.outcome, 'axis_victory');
    assert.equal(after.nations.germany.dissolved, false, '勝利したドイツは存続する');
    assert.equal(after.nations.west_germany, undefined, '西ドイツは作られない');
    assert.equal(after.nations.east_germany, undefined, '東ドイツは作られない');
    const land = vm.runInContext('ORBIS_STATES_DB', context).filter(region => !region.isSea && !region.isSeaZone && region.type !== 'sea');
    const holder = region => after.territories[region.id] || region.country;
    assert.ok(land.filter(region => region.country === 'austria').every(region => holder(region) === 'germany'), 'オーストリア併合は維持される');
  });

  await check('インド独立でパキスタンが州を保有し、他の主要脱植民地化も独立国と州の保有を変える', async () => {
    const { api, context } = harness();
    assert.equal(await api.start({ nationId: 'uk', difficulty: 'story', mandate: 'recovery', maxTurns: 0, replace: true }), true);
    const land = vm.runInContext('ORBIS_STATES_DB', context).filter(region => !region.isSea && !region.isSeaZone && region.type !== 'sea');
    const holder = (snapshot, region) => snapshot.territories[region.id] || region.country;
    const initial = api.snapshot();
    const initialIndependent = Object.values(initial.nations).filter(nation => !nation.dissolved && !nation.suzerain).length;
    assert.equal(api.forceWorldArc('india_independence').status, 'fired');
    let after = api.snapshot();
    assert.equal(after.clients.india.independent, true, 'インドが独立する');
    assert.equal(after.nations.india.suzerain, null);
    assert.ok(after.nations.pakistan && !after.nations.pakistan.dissolved, 'パキスタンが新国家として成立する');
    assert.equal(after.nations.pakistan.suzerain, null, 'パキスタンは宗主国を持たない');
    assert.equal(after.dynamicNations.pakistan.name, 'パキスタン');
    assert.match(after.dynamicNations.pakistan.color, /^#[0-9a-f]{6}$/i);
    const pakistanStates = land.filter(region => region.id.startsWith('india_pk_') && holder(after, region) === 'pakistan');
    assert.ok(pakistanStates.length >= 2, `パキスタンが複数州を保有する (${pakistanStates.length}州)`);
    assert.ok(land.some(region => region.id.startsWith('india_in_') && holder(after, region) === 'india'), 'インド側の州はインドに残る');

    for (const id of ['indonesia_independence', 'indochina_independence', 'philippines_independence', 'africa_french', 'africa_british', 'congo_independence']) {
      assert.equal(api.forceWorldArc(id).status, 'fired', `${id} が発火する`);
    }
    after = api.snapshot();
    for (const id of ['dutch_indies', 'col_france_indochina', 'philippines', 'col_france_fwa', 'col_france_algeria', 'col_uk_africa', 'col_uk_malaya', 'col_belgium_congo']) {
      assert.equal(after.clients[id]?.independent, true, `${id} が独立する`);
      assert.equal(after.nations[id]?.suzerain, null, `${id} が宗主国を持たない`);
    }
    for (const id of ['french_equatorial_africa', 'morocco', 'tunisia', 'madagascar', 'sudan', 'british_somaliland']) {
      assert.ok(after.nations[id] && !after.nations[id].dissolved, `${id} が独立国として存在する`);
      assert.equal(after.nations[id].suzerain, null);
      assert.ok(land.some(region => holder(after, region) === id), `${id} が州を保有する`);
    }
    const finalIndependent = Object.values(after.nations).filter(nation => !nation.dissolved && !nation.suzerain).length;
    assert.ok(finalIndependent > initialIndependent, `独立国数が増える (${initialIndependent}→${finalIndependent})`);
  });

  await check('米国プレイヤー・常設方針なしでも太平洋戦争弧は延期せず発火する', async () => {
    const { api } = harness();
    assert.equal(await api.start({ nationId: 'usa', difficulty: 'story', mandate: 'recovery', maxTurns: 0, replace: true }), true);
    assert.equal(api.snapshot().standingPolicy, '', '常設方針は空');
    const snap = json(api.snapshot());
    snap.worldArcs.states.pacific_war = { status: 'pending', dueHalf: 0, firedHalf: null, delayedUntil: null, delayCount: 0, blockReason: '', result: null };
    assert.equal(await api.restore(snap), true);
    assert.equal(await api.finishTurn(), true);
    const status = api.worldArcStatus('pacific_war');
    assert.equal(status.status, 'fired', `太平洋戦争弧が発火する (${status.status}/${status.blockReason})`);
    assert.ok(status.firedHalf != null);
    const war = Object.values(api.snapshot().wars).find(item => item.arcId === 'pacific_war');
    assert.ok(war && war.attacker === 'japan' && war.defender === 'usa', '日米開戦が記録される');
  });

  await check('バージョン番号をAPIと画面から取得できる', async () => {
    const { api, context } = harness();
    const info = api.versionInfo();
    assert.equal(info.version, '0.7.0');
    assert.equal(info.display, 'v0.7.0');
    assert.equal(info.product, 'ORBIS//1932');
    assert.equal(vm.runInContext('ORBIS_VERSION.version', context), '0.7.0');
    assert.match(htmlSource, /id="orbis-build-version"/);
    assert.match(htmlSource, /src="orbis_version\.js"/);
    assert.match(htmlSource, /id="modal-about"/);
  });

  await check('保存を選んだAPIキーだけ端末に残り、セーブJSONと配布物に含まれない', async () => {
    const storage = new Map();
    const first = harness('custom', storage);
    const endpoint = first.api.settingsInfo().endpoint;
    first.api.configure({ provider: 'custom', endpoint, model: 'fixture-model', apiKey: 'TEST_ONLY_NOT_A_REAL_KEY', remember: true }, true);
    const savedInfo = first.api.settingsInfo();
    assert.equal(savedInfo.hasKey, true);
    assert.equal(savedInfo.persistedHasKey, true, '保存を選ぶとlocalStorageに残る');

    const second = harness('custom', storage);
    const reopened = second.api.reloadSettings();
    assert.equal(reopened.hasKey, true, '再開後もキーが残る');
    assert.equal(reopened.persistedHasKey, true);
    assert.equal(await begin(second.api), true);
    const serialized = storage.get('orbis_campaign_v6') || storage.get('orbis_campaign_v5');
    assert.ok(serialized, 'セーブJSONが存在する');
    assert.ok(!serialized.includes('TEST_ONLY_NOT_A_REAL_KEY'), 'セーブJSONにキーを含めない');
    assert.ok(!JSON.stringify(second.api.snapshot()).includes('TEST_ONLY_NOT_A_REAL_KEY'));

    second.api.configure({ provider: 'custom', endpoint, model: 'fixture-model', apiKey: 'TEST_ONLY_NOT_A_REAL_KEY', remember: false }, true);
    const unsaved = second.api.settingsInfo();
    assert.equal(unsaved.hasKey, true, '画面を開いている間はメモリ上のキーを使える');
    assert.equal(unsaved.persistedHasKey, false, '保存しない選択ではlocalStorageに残さない');
    const third = harness('custom', storage);
    const afterRestart = third.api.reloadSettings();
    assert.equal(afterRestart.hasKey, false, '保存しないキーは再開後に残らない');
    assert.equal(afterRestart.persistedHasKey, false);
  });

  await check('APIキー未入力と無効キーで日本語の明確なエラー状態になる', async () => {
    const { api } = harness();
    assert.throws(
      () => api.configure({ provider: 'openai', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4.1-mini', apiKey: '', remember: false }),
      /APIキーを入力してください/
    );
    const endpoint = api.settingsInfo().endpoint;
    respond = item => item.operation === 'CONNECTION_TEST' ? { status: 401, error: 'invalid api key TEST_ONLY_NOT_A_REAL_KEY' } : null;
    const result = await api.testAIConnection({ provider: 'custom', endpoint, model: 'fixture-model', apiKey: 'TEST_ONLY_NOT_A_REAL_KEY', remember: false });
    assert.equal(result.ok, false);
    assert.match(result.message, /接続を確認できませんでした/, '日本語で失敗理由を示す');
    assert.match(result.message, /APIキー・URL・モデル/, '確認箇所を示す');
    assert.ok(!result.message.includes('TEST_ONLY_NOT_A_REAL_KEY'), 'エラー文言にキーを出さない');
    assert.ok(!JSON.stringify(result).includes('TEST_ONLY_NOT_A_REAL_KEY'), '戻り値にもキーを出さない');
  });

  await check('クレジット画面のデータが主要データ源とライセンスを含む', async () => {
    const { api } = harness();
    const credits = api.creditsInfo();
    const serialized = JSON.stringify(credits);
    for (const expected of ['Natural Earth', 'historical-basemaps', 'GNU GPL v3', '首都座標', 'orbis_events.js', 'flags/', 'Wikimedia Commons', 'Turf.js', 'Playwright', '商用利用可', '要判断']) {
      assert.ok(serialized.includes(expected), `クレジットに ${expected} がある`);
    }
    const statuses = credits.sections.flatMap(section => section.items.map(item => item.status));
    assert.ok(statuses.includes('商用利用可') && statuses.includes('要判断'), '権利区分を表示する');
    assert.match(htmlSource, /id="credits-body"/);
    assert.match(htmlSource, /id="btn-lobby-credits"/);
  });

  await check('配布構築脚本がオフライン用フォルダとZIPを作り、キーを同梱しない', async () => {
    const work = await mkdtemp(path.join(tmpdir(), 'orbis-m7-dist-'));
    try {
      const result = await buildDist({ outDir: path.join(work, 'orbis1932'), zipPath: path.join(work, 'orbis1932.zip') });
      assert.equal(result.version, '0.7.0');
      assert.equal(result.flags, 111);
      assert.equal(result.portraits, 8);
      assert.ok(result.dataFiles >= 1);
      const topLevel = await readdir(result.outDir);
      for (const name of ['index.html', 'orbis_simulator.html', 'orbis_game.js', 'orbis_version.js', 'orbis_credits.js', 'BUILD_INFO.json', 'CREDITS']) {
        assert.ok(topLevel.includes(name), `${name} を同梱する`);
      }
      assert.ok(!topLevel.includes('orbis_simulator.test.mjs'), 'テストを同梱しない');
      const html = await readFile(path.join(result.outDir, 'index.html'), 'utf8');
      assert.ok(!html.includes('fonts.googleapis.com'), '外部フォントに依存しない');
      assert.ok(!/<script\b[^>]*\bsrc=["']https?:/i.test(html), '外部スクリプトに依存しない');
      assert.ok(html.includes('orbis_version.js') && html.includes('orbis_credits.js'));
      const buildInfo = JSON.parse(await readFile(path.join(result.outDir, 'BUILD_INFO.json'), 'utf8'));
      assert.equal(buildInfo.version, '0.7.0');
      assert.equal(buildInfo.offline, true);
      const zipBytes = await readFile(result.zipPath);
      assert.equal(zipBytes.subarray(0, 4).toString('binary'), 'PK\x03\x04');
      assert.ok(zipBytes.length > 1000000);
      try { execFileSync('unzip', ['-t', result.zipPath], { stdio: 'ignore' }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }

      const scan = async dir => {
        let text = '';
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const target = path.join(dir, entry.name);
          if (entry.isDirectory()) text += await scan(target);
          else if (/\.(html|js|json|md|txt)$/i.test(entry.name) || entry.name === 'CREDITS') text += await readFile(target, 'utf8');
        }
        return text;
      };
      const allText = await scan(result.outDir);
      assert.ok(!allText.includes('TEST_ONLY_NOT_A_REAL_KEY'), '配布物にテスト用キーを残さない');
      assert.ok(!/\bsk-[A-Za-z0-9_-]{20,}\b/.test(allText), '配布物に実キーらしき文字列を残さない');
      assert.ok((await stat(result.zipPath)).size > 0);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  await check('M7b長時間ラン脚本は1947・1955・1972のチェックポイントと戦後検証を記録する', async () => {
    const reportPath = '/tmp/opencode/m7b-longrun-smoke.json';
    const report = await runM7bLongRun({ totalHalves: 4, nations: ['usa'], reportPath, requireArcs: false, postwarChecks: false, checkpointHalves: [4] });
    assert.equal(report.ok, true);
    assert.equal(report.mode, 'mock-http');
    assert.equal(report.runs.length, 1);
    const run = report.runs[0];
    assert.ok(run.reachedTarget);
    assert.ok(run.checkpoints.some(item => item.half === 4 && item.topOwners.length), 'チェックポイントが記録される');
    assert.ok(Number.isFinite(run.independence.start) && Number.isFinite(run.independence.final), '独立国数が記録される');
    assert.ok(run.postwar && run.postwar.germany && run.postwar.decolonization, '戦後検証データが記録される');
    const saved = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(saved.mode, 'mock-http');
    assert.ok(saved.summary[0].checkpoints.length > 0);
  });

  await check('長時間ラン脚本は複数開始国で完走し、異常なくレポートを残す', async () => {
    const reportPath = '/tmp/opencode/m7a-longrun-smoke.json';
    const report = await runM7aLongRun({ totalHalves: 4, nations: ['japan', 'usa'], reportPath, requireArcs: false, log: () => {} });
    assert.equal(report.ok, true);
    assert.equal(report.runs.length, 2);
    assert.ok(report.runs.every(run => run.reachedTarget && run.completedHalves === 4));
    assert.ok(report.runs.every(run => run.anomalies.length === 0 && run.invariantFailures.length === 0));
    assert.ok(report.runs.every(run => run.finalSaveBytes > 0));
    assert.ok(report.runs.every(run => Array.isArray(run.worldArcs) && Number.isFinite(run.territoryChanges) && Number.isFinite(run.activeWars)));
    assert.ok(report.runs.every(run => run.intervals.some(interval => interval.half === 4 && interval.topOwners.length && Array.isArray(interval.worldArcs))));
    const saved = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(saved.mode, 'mock-http');
    assert.equal(saved.startedNations.length, 2);
    assert.deepEqual(saved.totals.failures, []);
  });

  console.log(`\n${passed} checks passed. Live provider credentials were not used.`);
} finally {
  await new Promise(resolve => server.close(resolve));
}
