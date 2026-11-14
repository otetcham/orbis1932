#!/usr/bin/env node
/**
 * M8c QA スクリーンショットと主要UIフローの自動確認。モックHTTPのみ。
 * 出力先はリポジトリ外の /workspace/pm/orbis1932/m8c/。
 * m8b の変更前／変更後 PNG と camera JSON は上書きしない。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const artifactDir = '/workspace/pm/orbis1932/m8c';
const camera = JSON.parse(await readFile('/workspace/pm/orbis1932/m8b/europe-default-camera.json', 'utf8'));
const pageUrl = pathToFileURL(new URL('../orbis_simulator.html', import.meta.url).pathname).href;
await mkdir(artifactDir, { recursive: true });

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = await import('playwright-core'));
}

const choices = [
  { label: '了承', text: '了解しました。' },
  { label: '保留', text: '検討します。' }
];
const opening = {
  headline: 'M8c QA 用の概況',
  briefing: 'QA 撮影用のモック概況です。',
  telegrams: [
    { actorId: 'adviser', subject: '確認', text: '国策と前線を確認します。', urgency: 'important', choices },
    { actorId: 'domestic:ig_military', subject: '軍備', text: '配備を確認します。', urgency: 'important', choices },
    { actorId: 'ministry:usa', subject: '外交', text: '情勢を確認します。', urgency: 'routine', choices }
  ]
};
const reply = () => ({ reply: '確認しました。', stance: 'consider', memory: 'QA 撮影。', choices });
const evaluation = () => ({
  headline: 'QA 用裁定', article: 'モック裁定。',
  delta: { mil: 0, eco: 0, stb: 0, treasury: 0, prestige: 0, tension: 0 },
  reasoning: [{ text: 'モック。', sourceActionIds: [] }],
  developments: [], groups: [], relations: [], otherNations: [], actorUpdates: [],
  treaties: [], commitments: [], territoryChanges: [], clientChanges: [], leadershipChanges: [],
  memory: '継続', npcEvents: [], conflictChanges: [], actionResults: []
});

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--no-sandbox']
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await context.route('**/*', async route => {
  const request = route.request();
  if (request.method() !== 'POST' || !request.url().includes('127.0.0.1')) return route.continue();
  let body = {};
  try { body = request.postDataJSON() || {}; } catch { body = {}; }
  const texts = (body.messages || []).filter(item => item.role === 'user').map(item => item.content);
  const payload = texts.map(value => { try { return JSON.parse(value); } catch { return null; } }).find(value => value?.operation);
  const data = payload?.operation === 'BRIEFING' ? opening
    : payload?.operation === 'ACTOR' ? reply()
      : payload?.operation === 'CONNECTION_TEST' ? { ok: true } : evaluation();
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) }, finish_reason: 'stop' }] }) });
});

const page = await context.newPage();
const errors = [];
const checks = [];
page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));

function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
  if (!ok) throw new Error(`QA失敗: ${name}${detail ? ` (${detail})` : ''}`);
}

async function shot(name) {
  await page.screenshot({ path: `${artifactDir}/${name}.png`, fullPage: false });
}

async function prepare(nationId = 'germany', options = {}) {
  await page.evaluate(async ({ id, maxTurns }) => {
    await Orbis.start({ nationId: id, difficulty: 'standard', mandate: 'recovery', maxTurns, replace: true });
    if (!maxTurns) {
      document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
      document.body.classList.remove('dialog-open');
      Orbis.completeOnboarding();
    }
    const toast = document.getElementById('game-toast');
    if (toast) toast.hidden = true;
    window.ORBIS_PLAYBACK?.stop?.();
    document.getElementById('turn-playback-card')?.remove();
  }, { id: nationId, maxTurns: options.maxTurns || 0 });
  await page.waitForTimeout(250);
}

async function flatCamera(lon, lat, scale) {
  return page.evaluate(({ lon, lat, scale }) => {
    state.mapProjection = 'flat';
    state.mapTransform.scale = scale;
    state.mapTransform.x = -2800;
    state.mapTransform.y = -1052.432;
    applyFlatTransform();
    updateMapVisuals();
    return { scale: state.mapTransform.scale, x: state.mapTransform.x, y: state.mapTransform.y };
  }, { lon, lat, scale });
}

async function assertDateChipHidden() {
  const chip = await page.evaluate(() => {
    document.getElementById('turn-playback-card')?.remove();
    const card = document.createElement('div');
    card.id = 'turn-playback-card';
    card.className = 'turn-playback-card visible';
    card.innerHTML = '<div class="tp-date">1948年8月（前半）</div><strong>日付チップの重なり確認</strong>';
    document.body.appendChild(card);
    const date = card.querySelector('.tp-date');
    const dialog = document.querySelector('dialog[open]');
    if (!dialog) return { dialogOpen: false };
    const style = getComputedStyle(card);
    const rect = date.getBoundingClientRect();
    const dialogRect = dialog.getBoundingClientRect();
    const overlaps = rect.width > 0 && rect.height > 0 && !(rect.right < dialogRect.left || rect.left > dialogRect.right || rect.bottom < dialogRect.top || rect.top > dialogRect.bottom);
    return { dialogOpen: true, visibility: style.visibility, opacity: style.opacity, overlaps };
  });
  await page.evaluate(() => document.getElementById('turn-playback-card')?.remove());
  check('ダイアログ中の日付チップ非表示', chip.dialogOpen && (chip.visibility === 'hidden' || Number(chip.opacity) === 0), JSON.stringify(chip));
}

try {
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof Orbis !== 'undefined' && window.ORBIS_STATES_DB?.length, { timeout: 120000 });
  await page.evaluate(() => Orbis.configure({ provider: 'custom', endpoint: 'http://127.0.0.1/mock', model: 'mock', apiKey: 'TEST_ONLY_NOT_A_REAL_KEY', remember: false }));
  await page.waitForTimeout(250);

  const lobby = await page.evaluate(() => ({
    nations: [...document.querySelectorAll('[data-nation-id]')].map(node => node.dataset.nationId),
    version: document.getElementById('orbis-build-version')?.textContent || ''
  }));
  for (const id of ['japan', 'germany', 'usa', 'uk', 'russia', 'china']) check(`ロビーに ${id} がある`, lobby.nations.includes(id));
  check('画面のバージョンが v1.0.0-rc1', lobby.version === 'v1.0.0-rc1', lobby.version);
  await shot('qa-lobby');

  await page.evaluate(() => Orbis.start({ nationId: 'japan', difficulty: 'standard', mandate: 'recovery', maxTurns: 0, replace: true }));
  await page.waitForFunction(() => Orbis.snapshot()?.phase === 'playing', { timeout: 120000 });
  await page.waitForSelector('#modal-onboarding[open]', { timeout: 30000 });
  await shot('qa-onboarding');
  check('導入案内が開始後に表示される', await page.evaluate(() => document.getElementById('modal-onboarding')?.open === true));
  await page.evaluate(() => Orbis.completeOnboarding());
  await page.waitForTimeout(200);

  await prepare('germany');
  const cameraState = await flatCamera(camera.lon, camera.lat, camera.scale);
  await page.waitForTimeout(450);
  const ussr = await page.evaluate(() => {
    const label = document.querySelector('#labels-layer text[data-label-key="c:russia"]');
    const viewport = currentMapViewportBounds();
    const x = Number(label?.getAttribute('x'));
    const y = Number(label?.getAttribute('y'));
    return {
      text: label?.textContent || '',
      x, y,
      inside: x - 80 >= viewport.minX && x + 80 <= viewport.maxX && y >= viewport.minY && y <= viewport.maxY,
      labels: document.querySelectorAll('.map-label-country').length
    };
  });
  check('欧州カメラでソ連の国名が見える', ussr.text === 'ソビエト連邦', ussr.text);
  check('ソ連の国名アンカーが画面内', ussr.inside, JSON.stringify(ussr));
  await shot('europe-ussr-label');
  await shot('qa-flat-map');

  await page.evaluate(() => { state.mapProjection = 'globe'; state.globe.lon = 10; state.globe.lat = 48; state.globe.zoom = 1.2; updateMapVisuals(); });
  await page.waitForTimeout(350);
  await shot('qa-globe');
  check('球体切替で国名ラベルが描画される', await page.evaluate(() => document.querySelectorAll('#labels-layer .map-label-country').length > 0));

  await page.evaluate(() => { handleStateSelect('jp_kanto'); });
  await page.waitForTimeout(250);
  const inspector = await page.evaluate(() => ({
    open: document.getElementById('state-inspector')?.classList.contains('open'),
    name: document.getElementById('insp-state-name')?.textContent || ''
  }));
  check('州パネルが開く', inspector.open && inspector.name.length > 0, JSON.stringify(inspector));
  await shot('qa-state-panel');

  await page.evaluate(() => Orbis.openCountryCard('japan'));
  await page.waitForSelector('#modal-country-card[open]', { timeout: 30000 });
  await shot('qa-country-popup');
  check('国名ポップアップが開く', await page.evaluate(() => document.getElementById('modal-country-card')?.open === true));
  await page.evaluate(() => document.querySelector('[data-close-dialog="modal-country-card"]')?.click());

  await page.evaluate(() => Orbis.openPanel('menu'));
  await page.waitForSelector('#window-menu:not([hidden])');
  const hud = await page.evaluate(() => ({
    date: document.getElementById('hud-date')?.textContent || '',
    turn: document.getElementById('hud-turn')?.textContent || '',
    mil: document.getElementById('hud-mil')?.textContent || '',
    settings: Boolean(document.getElementById('btn-open-ai-settings'))
  }));
  check('上部HUDとメニューが読める', Boolean(hud.date && hud.turn && hud.mil && hud.settings), JSON.stringify(hud));
  await shot('qa-hud-menu');

  await page.evaluate(() => Orbis.openSettings());
  await page.waitForSelector('#modal-ai-settings[open]', { timeout: 30000 });
  await page.evaluate(() => { const key = document.getElementById('input-api-key'); if (key) key.value = ''; });
  const settings = await page.evaluate(() => ({
    keyValue: document.getElementById('input-api-key')?.value || '',
    mute: Boolean(document.getElementById('toggle-audio-muted')),
    hasSavedKey: Orbis.settingsInfo().hasKey
  }));
  check('設定に実キーを表示しない', settings.keyValue === '', settings.keyValue);
  check('ミュート切替がある', settings.mute);
  await shot('qa-settings-mute');
  await page.evaluate(() => document.querySelector('[data-close-dialog="modal-ai-settings"]')?.click());

  await page.evaluate(() => Orbis.openCredits());
  await page.waitForSelector('#modal-credits[open]', { timeout: 30000 });
  const credits = await page.evaluate(() => document.getElementById('modal-credits')?.textContent || '');
  check('クレジットに権利情報がある', /historical-basemaps/.test(credits) && /効果音/.test(credits));
  await shot('qa-credits');
  await page.evaluate(() => document.querySelector('[data-close-dialog="modal-credits"]')?.click());

  await prepare('japan');
  await page.evaluate(() => Orbis.openFocusPanel());
  await page.waitForSelector('#modal-focus[open]', { timeout: 30000 });
  const focus = await page.evaluate(() => {
    const nodes = document.querySelectorAll('#focus-panel-body [data-focus-node]').length;
    Orbis.setFocusGraphView({ scale: 0.9, x: 10, y: 10 });
    Orbis.zoomFocusGraph(1.1);
    Orbis.showFocusDetail('jp_china_incident');
    return { nodes, detail: document.getElementById('focus-detail')?.textContent?.trim() || '', zoom: Orbis.focusGraphView().scale };
  });
  check('国策グラフに25件以上のノードがある', focus.nodes >= 25, String(focus.nodes));
  check('国策の効果詳細が読める', focus.detail.length >= 10);
  await assertDateChipHidden();
  await shot('qa-focus-graph');
  await page.evaluate(() => document.querySelector('[data-close-dialog="modal-focus"]')?.click());

  await page.evaluate(() => Orbis.openResearchPanel());
  await page.waitForSelector('#modal-research[open]', { timeout: 30000 });
  const research = await page.evaluate(() => ({
    items: document.querySelectorAll('#research-panel-body .research-item').length,
    current: Orbis.researchSummary()?.current?.name || ''
  }));
  check('研究画面に選択肢がある', research.items >= 4, String(research.items));
  await shot('qa-research');
  await page.evaluate(() => document.querySelector('[data-close-dialog="modal-research"]')?.click());

  await page.evaluate(() => Orbis.openEconomyPanel());
  await page.waitForSelector('#modal-economy[open]', { timeout: 30000 });
  const economy = await page.evaluate(() => ({
    mobilization: document.querySelectorAll('[data-economy-mobilization]').length,
    share: Boolean(document.getElementById('economy-military-share')),
    recruit: Boolean(document.querySelector('[data-economy-recruit]'))
  }));
  check('生産・動員の操作がある', economy.mobilization >= 2 && economy.share && economy.recruit, JSON.stringify(economy));
  await shot('qa-economy');
  await page.evaluate(() => document.querySelector('[data-close-dialog="modal-economy"]')?.click());

  const diplomacy = await page.evaluate(async () => {
    Orbis.openPanel('chat');
    Orbis.openActor('ministry:usa');
    const sent = await Orbis.send('通商条件と極東の安定について協議したい。', 'ministry:usa');
    return { sent, used: Orbis.snapshot()?.usedActions };
  });
  await page.waitForFunction(() => (document.getElementById('chat-stream-box')?.textContent || '').includes('確認しました'), { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(250);
  await shot('qa-diplomacy');
  check('外交電報の返電が表示される', diplomacy.sent && (await page.evaluate(() => (document.getElementById('chat-stream-box')?.textContent || '').includes('確認しました'))), JSON.stringify(diplomacy));

  await page.evaluate(() => globalThis.openSituationBriefing?.());
  await page.waitForSelector('#modal-adviser-briefing[open]', { timeout: 30000 });
  await shot('qa-adviser-briefing');
  check('顧問ブリーフィングが開く', await page.evaluate(() => document.getElementById('modal-adviser-briefing')?.open === true));
  await page.evaluate(() => document.querySelector('[data-close-dialog="modal-adviser-briefing"]')?.click());

  await page.evaluate(() => {
    Orbis.openPanel('actions');
    const input = document.getElementById('standing-policy-input');
    if (input) input.value = '対中は穏健に、軍備は漸進する。';
    Orbis.setStandingPolicy('対中は穏健に、軍備は漸進する。');
  });
  await page.waitForTimeout(200);
  check('常設方針を保存できる', await page.evaluate(() => Orbis.snapshot()?.standingPolicy?.includes('穏健')));
  await shot('qa-standing-policy');

  await prepare('japan');
  const war = await page.evaluate(() => {
    Orbis.declareWar('china', 'QA確認のための戦争');
    const snapshot = Orbis.snapshot();
    const entry = Object.entries(snapshot.wars).find(([, value]) => value.status === 'active' && value.attacker === 'japan');
    const formation = snapshot.formations.find(item => item.nationId === 'japan' && item.type === 'field');
    const targets = formation ? Orbis.formationTargets(formation.id) : [];
    if (formation && targets.length) Orbis.setFormationOrder(formation.id, { kind: 'offensive', targetRegionId: targets[0].regionId, targetNationId: targets[0].nationId });
    Orbis.openWarPanel();
    return {
      warId: entry?.[0] || null,
      order: formation ? Orbis.listFormations().find(item => item.id === formation.id)?.order?.kind : null,
      target: targets[0]?.regionId || ''
    };
  });
  await page.waitForSelector('#modal-war-panel[open]', { timeout: 30000 });
  check('戦争パネルで攻勢命令を出せる', Boolean(war.warId) && war.order === 'offensive', JSON.stringify(war));
  await shot('qa-war-orders');

  const peace = await page.evaluate(() => {
    const snapshot = JSON.parse(JSON.stringify(Orbis.snapshot()));
    snapshot.territories.cn_beijing = 'japan';
    snapshot.occupations.cn_beijing = 'china';
    if (!Orbis.restore(snapshot)) return { ok: false };
    const warEntry = Object.entries(Orbis.snapshot().wars).find(([, value]) => value.status === 'active' && value.attacker === 'japan' && value.defender === 'china');
    if (!warEntry) return { ok: false };
    Orbis.openPeaceConference(warEntry[0]);
    return { ok: true, warId: warEntry[0], demands: Orbis.peaceConferenceSummary(warEntry[0])?.demands?.length || 0 };
  });
  await page.waitForSelector('#modal-peace[open]', { timeout: 30000 });
  check('和平会議が開き要求を選べる', peace.ok && peace.demands > 0, JSON.stringify(peace));
  await shot('qa-peace-conference');
  await page.evaluate(() => document.querySelector('[data-close-dialog="modal-peace"]')?.click());

  await page.evaluate(() => Orbis.openPanel('menu'));
  const save = await page.evaluate(() => {
    const before = Orbis.snapshot().completedTurns;
    const restored = Orbis.restore(JSON.parse(JSON.stringify(Orbis.snapshot())));
    return { before, restored, hasSave: Boolean(localStorage.getItem('orbis_campaign_v6')) };
  });
  check('セーブJSONを再読込できる', save.restored && save.hasSave, JSON.stringify(save));
  await shot('qa-save-menu');

  await page.evaluate(async () => {
    Orbis.closeInfoPanels?.();
    const before = Orbis.snapshot().completedTurns;
    await Orbis.finishTurn();
    window.QA_UNDO_BEFORE = before;
  });
  await page.waitForFunction(() => Orbis.snapshot()?.completedTurns > (window.QA_UNDO_BEFORE ?? 0), { timeout: 120000 });
  const undo = await page.evaluate(() => {
    const before = Orbis.snapshot().completedTurns;
    const ok = Orbis.undoLastTurn();
    return { before, after: Orbis.snapshot().completedTurns, ok };
  });
  check('ターン終了とUndoが機能する', undo.ok && undo.after === undo.before - 1, JSON.stringify(undo));
  await shot('qa-undo');

  await page.evaluate(() => Orbis.openFocusPanel());
  await page.waitForSelector('#modal-focus[open]', { timeout: 30000 });
  await assertDateChipHidden();
  await shot('qa-date-chip-dialog');
  await page.evaluate(() => document.querySelector('[data-close-dialog="modal-focus"]')?.click());

  await page.evaluate(async () => {
    await Orbis.start({ nationId: 'japan', difficulty: 'story', mandate: 'recovery', maxTurns: 24, replace: true });
    const snapshot = JSON.parse(JSON.stringify(Orbis.snapshot()));
    snapshot.completedTurns = 23;
    snapshot.maxTurns = 24;
    snapshot.phase = 'playing';
    snapshot.nations.japan.eco = 92;
    snapshot.nations.japan.stb = 92;
    snapshot.treasury = 80;
    snapshot.tension = 35;
    Orbis.restore(snapshot);
    Orbis.completeOnboarding();
    await Orbis.finishTurn();
  });
  await page.waitForSelector('#game-ending[open]', { timeout: 30000 });
  const ending = await page.evaluate(() => ({
    title: document.getElementById('ending-title')?.textContent || '',
    body: document.getElementById('game-ending')?.textContent || ''
  }));
  check('結末ダイアログが表示される', ending.title.length > 0 || ending.body.includes('国家目標'), ending.title);
  await shot('qa-ending');

  check('コンソールエラーがない', errors.length === 0, errors.join(' / '));
  await writeFile(`${artifactDir}/ui-checks.json`, JSON.stringify({
    generatedAt: new Date().toISOString(),
    mock: true,
    liveProviderCredentialsUsed: false,
    camera,
    checks,
    errors
  }, null, 2));
  console.log(`QA checks: ${checks.length} / errors: ${errors.length}`);
  console.log(`キャプチャ: ${artifactDir}`);
} catch (error) {
  await writeFile(`${artifactDir}/ui-checks.json`, JSON.stringify({
    generatedAt: new Date().toISOString(),
    mock: true,
    liveProviderCredentialsUsed: false,
    camera,
    checks,
    errors,
    failure: error?.message || String(error)
  }, null, 2)).catch(() => {});
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
} finally {
  await browser.close();
}
