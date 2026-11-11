#!/usr/bin/env node
/**
 * Historical playtest 1932-03 .. (max 36 turns / mock AI)
 * Output: /opt/cursor/artifacts/playtest_log.json + screenshots
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile, readFile } from 'node:fs/promises';

const artifactDir = '/opt/cursor/artifacts';
const pageUrl = pathToFileURL(new URL('../orbis_simulator.html', import.meta.url).pathname).href;

const eventDb = JSON.parse(
  (await readFile(new URL('../orbis_events.js', import.meta.url), 'utf8'))
    .replace(/^window\.WORLD_EVENT_DB\s*=\s*/, '')
    .replace(/;\s*$/, ''),
);

function gameDate(completedTurns) {
  const startYear = 1932;
  const startMonth = 3;
  const m0 = startMonth - 1 + completedTurns;
  return { year: startYear + Math.floor(m0 / 12), month: (m0 % 12) + 1 };
}

const SIAM_PLAN = new Map([
  [0, '世界恐慌下、バンコクの米価と税収を安定させ、農民の不満を抑える緊急策を打ち出す。'],
  [2, '六月革命後の体制として、絶対王政から立憲君主制への移行を閣議で正式に宣言する。'],
  [4, '新憲法の運用開始に伴い、軍部と文官の権限分担を明文化し、各地の治安維持を指示する。'],
  [6, '立憲革命の残る反対派を統合し、議会開会と予算編成を優先する。'],
  [10, '経済恐慌の波及を受けた南部農村の税免除と公共事業を拡大する。'],
  [15, '1933年秋の政治危機に備え、バンコク警備と地方縦隊の配置を点検する。'],
  [19, '保皇派の反乱（ボーワラート乱）鎮圧後、軍部主導の政権再編を進める。'],
  [24, 'ラーマ7世の国外滞在を踏まえ、摂政体制の外交方針を整理する。'],
  [30, '仏領インドシナとの国境警備を強化し、通商協定の再交渉を準備する。'],
  [35, '1935年初頭、議会政治の定着と財政再建を国家方針としてまとめる。'],
]);

const JAPAN_PLAN = new Map([
  [0, '満州事変後の満洲国承認に向け、外務省と軍部の方針を調整する。'],
  [11, '国際連盟脱退に向け、満州関連の答弁書と国内説明を準備する。'],
  [17, '広田弘毅内閣の協調外交と軍備拡張のバランスを閣議で確認する。'],
  [24, '二・二六事件後の統制経済と満州開発投資を点検する。'],
  [29, '日中関係の悪化に備え、北支駐屯軍への補給線を確認する（盧溝橋前夜）。'],
  [35, '対華局部戦の拡大リスクを評議し、外交余地を維持する方針を示す。'],
]);

function mockPayload(operation, payload) {
  const ctx = payload?.context || {};
  const date = ctx.date || '1932年3月';
  const year = parseInt(date, 10) || 1932;
  const baseTension = typeof ctx.tension === 'number' ? ctx.tension : 42;
  const national = ctx.nationalAction;
  const convIds = Array.isArray(ctx.conversations) ? ctx.conversations.map(c => c.id).filter(Boolean) : [];
  const primaryActionId = convIds[0] || national?.id;
  const actionResults = national ? [{
    actionId: national.id,
    text: '方針は閣議に反映され、限られた財源の範囲で準備が進んだ。',
    outcome: 'partial',
    effects: { mil: 0, eco: 0, stb: 0, treasury: 0, prestige: 0, tension: 0 },
    evidence: [national.id],
    relations: [],
  }] : [];

  const hits = eventDb.filter(e => e.year === year && (!e.date?.includes('-') || e.date.includes(String(year))));
  const dev = hits.slice(0, 2).map(e => ({ headline: e.title, body: e.summary.slice(0, 200) }));
  while (dev.length < 2) dev.push({ headline: '国際情勢', body: '世界恐慌の波が各国の財政と外交を揺らしている。' });

  if (operation === 'BRIEFING') {
    const nation = ctx.playerNationId || 'siam';
    const domestic = nation === 'japan' ? 'domestic:ig_military' : 'domestic:ig_parliament';
  const foreignA = nation === 'japan' ? 'client:manchukuo' : 'ministry:uk';
    const foreignB = nation === 'japan' ? 'ministry:usa' : 'ministry:france';
    return {
      headline: `${date} の情勢`,
      briefing: `MOCK: ${date}時点の概況。史実カレンダー参照イベント: ${hits.map(h => h.title).slice(0, 3).join('、') || 'なし'}`,
      telegrams: [
        { actorId: domestic, subject: '国内優先課題', text: '今月の国家方針について具体化を求む。', urgency: 'important', choices: [{ label: '了承', text: '了解した。' }, { label: '保留', text: '検討する。' }] },
        { actorId: foreignA, subject: '外交', text: '通商と安全保障の枠組みで協議したい。', urgency: 'routine', choices: [{ label: '了承', text: '了解した。' }, { label: '保留', text: '検討する。' }] },
        { actorId: foreignB, subject: '地域情勢', text: '近隣の動きについて情報交換を求む。', urgency: 'important', choices: [{ label: '了承', text: '了解した。' }, { label: '保留', text: '検討する。' }] },
      ],
    };
  }
  if (operation === 'ACTOR') {
    return { reply: '承知した。月末の裁定を待つ。', stance: 'consider', memory: 'MOCK交渉継続', choices: [{ label: '了承', text: '了解した。' }] };
  }
  return {
    headline: `${date}の月次裁定`,
    article: `MOCK裁定: ${national?.text?.slice(0, 80) || '方針なし'}。${dev[0].headline}が世界紙面を支配した。`,
    delta: { mil: 0, eco: 0, stb: 0, treasury: 0, prestige: 0, tension: baseTension >= 88 ? -6 : baseTension >= 78 ? -3 : 0 },
    reasoning: [{ text: '提出された国家方針とMOCK世界動向を踏まえた。', sourceActionIds: national ? [national.id] : [] }],
    developments: dev,
    groups: ['ig_military', 'ig_industrialists', 'ig_labor', 'ig_parliament'].map(groupId => ({
      groupId, delta: 1, reason: 'MOCK: 各派への回答を記録。', sourceActionIds: primaryActionId ? [primaryActionId] : [],
    })),
    relations: [], otherNations: [], actorUpdates: [], treaties: [], commitments: [], territoryChanges: [], clientChanges: [], leadershipChanges: [], memory: `MOCK ${date}`, npcEvents: [], conflictChanges: [], actionResults,
  };
}

async function runCampaign(page, nationId, plan, label, shots, log) {
  const maxTurns = 70;
  const run = { label, nationId, maxTurns, months: [], issues: [] };
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof Orbis !== 'undefined' && ORBIS_STATES_DB?.length);
  await page.evaluate(() => {
    localStorage.removeItem('orbis_campaign_v5');
    localStorage.removeItem('orbis_campaign_v4');
    window.confirm = () => true;
    Orbis.configure({ provider: 'custom', endpoint: 'http://127.0.0.1/mock', model: 'mock', apiKey: 'TEST_ONLY_NOT_A_REAL_KEY', remember: false });
  });
  const sel = page.locator(`[data-nation-id="${nationId}"]`);
  await sel.click();
  await page.evaluate(async ({ id, turns }) => {
    state.lobbyNationId = id;
    const len = document.getElementById('campaign-length');
    if (len) len.value = String(turns);
    renderLobbyNationsGrid();
    await Orbis.start({ nationId: id, maxTurns: turns, replace: true });
  }, { id: nationId, turns: maxTurns });
  await page.waitForFunction(() => document.getElementById('lobby-overlay')?.classList.contains('hidden'), { timeout: 120000 });
  await page.waitForFunction(() => Orbis.snapshot()?.phase === 'playing', { timeout: 180000 });

  for (let step = 0; step < maxTurns; step++) {
    const snap0 = await page.evaluate(() => Orbis.snapshot());
    const gd = gameDate(snap0.completedTurns);
    const action = plan.get(snap0.completedTurns) || `${gd.year}年${gd.month}月: 国内安定と財政再建を優先し、隣国との関係を維持する。`;

    const errBefore = await page.evaluate(() => ({ e: document.getElementById('game-error')?.textContent || '', busy: false }));
    await page.evaluate(text => Orbis.submitAction(text), action);
    await page.evaluate(async () => {
      const snap = Orbis.snapshot();
      if (snap?.phase !== 'playing' || !snap.briefing?.telegrams) return;
      for (const telegram of snap.briefing.telegrams) {
        await Orbis.send('承知した。予算の範囲で優先順位を付けて進める。', telegram.actorId);
      }
    });
    const turnsBefore = snap0.completedTurns;
    await page.evaluate(() => Orbis.finishTurn());
    try {
      await page.waitForFunction(t => (Orbis.snapshot()?.completedTurns ?? 0) > t, turnsBefore, { timeout: 180000 });
      await page.waitForFunction(() => { const p = Orbis.snapshot()?.phase; return p === 'playing' || p === 'ended'; }, { timeout: 180000 });
    } catch (e) {
      const shot = `${artifactDir}/playtest-issue-${label}-turn${step}.png`;
      await page.screenshot({ path: shot, fullPage: true });
      run.issues.push({ turn: step, date: `${gd.year}-${gd.month}`, type: 'timeout', action, screenshot: shot });
      break;
    }

    const snap = await page.evaluate(() => {
      const c = Orbis.snapshot();
      const n = c.nations[c.playerNationId];
      const terr = Object.entries(c.territories).filter(([id, owner]) => owner !== (window.ORBIS_STATES_DB.find(r => r.id === id)?.country));
      return {
        date: c.completedTurns,
        hudDate: document.getElementById('hud-date')?.textContent,
        phase: c.phase,
        tension: c.tension,
        treasury: c.treasury,
        prestige: c.prestige,
        mil: n?.mil, eco: n?.eco, stb: n?.stb,
        groups: n?.groups,
        articles: c.articles.slice(-2).map(a => ({ kind: a.kind, headline: a.headline, turn: a.turn })),
        actionText: c.nationalAction?.text || c.actionHistory?.at(-1)?.order,
        territoryOverrides: terr.length,
        ending: c.ending?.title || null,
      };
    });

    const gameErr = await page.evaluate(() => {
      const el = document.getElementById('game-error');
      if (!el || el.hidden) return '';
      const span = el.querySelector('span');
      return span?.textContent?.trim() || '';
    });
    if (gameErr) {
      const shot = `${artifactDir}/playtest-issue-${label}-turn${step}.png`;
      await page.screenshot({ path: shot, fullPage: true });
      run.issues.push({ turn: step, type: 'game-error', message: gameErr, screenshot: shot });
    }

    run.months.push({ step, calendar: gd, action, snap, mock: true });

    if (gd.month === 12 || step === maxTurns - 1) {
      const fn = `${artifactDir}/playtest-${label}-${gd.year}-end.png`;
      await page.screenshot({ path: fn, fullPage: true });
      shots.push({ nation: label, year: gd.year, file: fn });
    }

    if (snap.ending) break;
  }
  log.campaigns.push(run);
}

await mkdir(artifactDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.route('**/*', async route => {
  const req = route.request();
  if (req.method() !== 'POST' || !req.url().includes('127.0.0.1')) return route.continue();
  let body = {};
  try { body = req.postDataJSON() || {}; } catch { body = {}; }
  const texts = (body.messages || []).filter(m => m.role === 'user').map(m => m.content);
  const payload = texts.map(t => { try { return JSON.parse(t); } catch { return null; } }).find(v => v?.operation);
  const op = payload?.operation;
  const data = mockPayload(op, payload);
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) }, finish_reason: 'stop' }] }) });
});

const page = await context.newPage();
const log = { generatedAt: new Date().toISOString(), mockDisclaimer: 'AI裁定は127.0.0.1モック。本物のLLMでは未検証。', engineLimit: 'maxTurns最大70（1932年3月〜1937年12月）。', campaigns: [], eventDbSample: eventDb.filter(e => e.year >= 1932 && e.year <= 1937).length, screenshots: [] };
const shots = log.screenshots;

await runCampaign(page, 'siam', SIAM_PLAN, 'siam', shots, log);
await runCampaign(page, 'japan', JAPAN_PLAN, 'japan', shots, log);

await browser.close();
await writeFile(`${artifactDir}/playtest_log.json`, JSON.stringify(log, null, 2));
console.log('Playtest complete:', log.campaigns.map(c => `${c.label} ${c.months.length} months, ${c.issues.length} issues`));
