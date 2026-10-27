// Builds the English tutorial video (docs/video/discrello-tutorial.en.mp4) from the demo server
// (in-memory fake Discord/Trello: no real server, user or board appears, nothing is sent anywhere).
// Setup and usage: see README.md in this folder.
// Pipeline: narration (Piper TTS) -> per-scene screen recording (puppeteer screencast, paced to the
// narration) -> per-scene mux with burned-in captions -> concat -> loudness-normalised MP4 + SRT.
import puppeteer from 'puppeteer-core';
import ffmpegPath from 'ffmpeg-static';
import { execFileSync, spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, 'out');
const REPO = path.resolve(HERE, '../..');
const PIPER = process.env.PIPER_BIN ?? path.join(HERE, 'piper/piper/piper');
const VOICE = process.env.PIPER_VOICE ?? path.join(HERE, 'piper/en_US-lessac-medium.onnx');
const PORT = 3987;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'correct-horse-battery';
const SECRET = 'smoke-secret';
const W = 1280;
const H = 720;
const DPR = 1.5; // 1920x1080 output
const LEAD_IN = 0.35; // seconds of silence before narration in each scene
const TAIL = 0.7; // seconds after narration ends before cutting
for (const d of ['audio', 'video', 'subs', 'seg'])
  mkdirSync(path.join(OUT, d), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[video]', ...a);

// ---------------------------------------------------------------- narration
const scenes = [
  {
    id: 'title',
    html: 'title',
    say: 'Welcome to Discrello. In the next few minutes, you will learn how to connect a Trello board to Discord, so the right person is pinged the moment a card lands in their list.',
  },
  {
    id: 'idea',
    html: 'idea',
    say: 'Here is the idea. Each Trello list is a stage owned by a role, like script writer, editor, or uploader. When someone moves a card into a list, Discrello posts a message in Discord that mentions the person responsible for that stage, and names the card.',
  },
  { id: 'login', say: 'Open Discrello in your browser, and sign in with the admin password.' },
  {
    id: 'servers',
    say: 'First, connect your Discord server. After inviting the Discrello bot to the server, open Servers, and click Add server. Pick the server from the list. You can also add an alert channel, where Discrello reports problems. Save, and the server shows bot OK.',
  },
  {
    id: 'role-create',
    say: 'Next, open Roles. A role is a stage in your pipeline. Click New role, enter a short key and a display name, and write the default message. Placeholders like mention and card title are filled in automatically.',
  },
  {
    id: 'role-refused',
    say: 'Now choose who gets pinged for this role. Expand the role, and pick a Discord user or a Discord role. Discrello checks with Discord before saving. This role is not mentionable, so nobody would actually be notified. The save is refused, and the message explains how to fix it.',
  },
  {
    id: 'role-ok',
    say: 'Pick a target that works, such as a team member, and save. Then send a test ping, to confirm that the mention really reaches someone.',
  },
  {
    id: 'board-add',
    say: "Now connect a Trello board. Open Boards, and click Add board. Paste the board's address, and click Fetch. Choose the Discord server and the channel for the pings, then create the board. Discrello registers the Trello webhook for you.",
  },
  {
    id: 'board-map',
    say: "Every list on the board appears here. Choose the role responsible for a list. The message is pre-filled from the role's default, and the preview shows exactly what will be posted. Click Map list to save, and repeat for each stage of your pipeline.",
  },
  { id: 'board-test', say: 'Use Send test, to post a sample message to the real channel.' },
  {
    id: 'live',
    html: 'live',
    say: 'That is all the setup. From now on, when someone moves a card into a mapped list, the ping arrives in Discord within seconds.',
  },
  {
    id: 'notifications',
    say: 'Open Notifications, to see everything Discrello sent: the card, the list, the role, and the status. Sent means Discord confirmed the mention. If a message fails, the reason is shown here, and you can retry it once the problem is fixed.',
  },
  {
    id: 'events',
    say: "The Webhook events tab answers the question: why didn't it ping? Every delivery from Trello is listed. Here, a card moved into a list with no mapping, so nothing was sent.",
  },
  {
    id: 'settings',
    say: 'Finally, Settings shows whether Trello and Discord are connected, and lets you change the default message. Discrello re-checks your setup every fifteen minutes, and warns your alert channel if a permission changes.',
  },
  {
    id: 'outro',
    html: 'outro',
    say: 'That is Discrello. For more details, see the user guide in the docs folder. Thanks for watching!',
  },
];

function wavDuration(file) {
  const b = readFileSync(file);
  const byteRate = b.readUInt32LE(28);
  let off = 12;
  while (off < b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'data') return size / byteRate;
    off += 8 + size;
  }
  throw new Error(`no data chunk in ${file}`);
}

function synthesize() {
  scenes.forEach((s, i) => {
    s.n = String(i).padStart(2, '0');
    s.wav = path.join(OUT, 'audio', `${s.n}-${s.id}.wav`);
    execFileSync(
      PIPER,
      [
        '--model',
        VOICE,
        '--output_file',
        s.wav,
        '--sentence_silence',
        '0.3',
        '--length_scale',
        '1.05',
      ],
      {
        input: s.say,
        stdio: ['pipe', 'ignore', 'ignore'],
      },
    );
    s.audio = wavDuration(s.wav);
    log(`tts ${s.n} ${s.id}: ${s.audio.toFixed(1)}s`);
  });
}

// ---------------------------------------------------------------- cards (HTML scenes)
const CARD_CSS = `
  *{box-sizing:border-box;margin:0}
  body{width:${W}px;height:${H}px;overflow:hidden;font-family:'Ubuntu Sans','DejaVu Sans',sans-serif;
    background:radial-gradient(1200px 700px at 20% 10%,#4338ca 0%,#1e1b4b 55%,#0b0a1f 100%);color:#fff}
  .fade{opacity:0;animation:in .7s ease forwards}
  @keyframes in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}`;

function titleHtml() {
  return `<!doctype html><html><head><style>${CARD_CSS}
    .wrap{height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 110px}
    .kicker{font-size:22px;letter-spacing:.18em;text-transform:uppercase;color:#a5b4fc}
    h1{font-size:96px;font-weight:800;margin:14px 0 18px}
    p{font-size:30px;color:#e0e7ff;max-width:900px;line-height:1.35}
    .flow{margin-top:46px;display:flex;gap:18px;align-items:center;font-size:22px;color:#c7d2fe}
    .pill{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);padding:10px 18px;border-radius:999px}
  </style></head><body><div class="wrap">
    <div class="kicker fade">User guide</div>
    <h1 class="fade" style="animation-delay:.15s">Discrello</h1>
    <p class="fade" style="animation-delay:.35s">Ping the right person in Discord the moment a Trello card lands in their list.</p>
    <div class="flow fade" style="animation-delay:.7s"><span class="pill">Trello card moved</span>→<span class="pill">Discrello</span>→<span class="pill">@person in Discord</span></div>
  </div></body></html>`;
}

function ideaHtml() {
  const stage = (t, who, d) =>
    `<div class="stage fade" style="animation-delay:${d}s"><div class="list">${t}</div><div class="who">${who}</div></div>`;
  return `<!doctype html><html><head><style>${CARD_CSS}
    .wrap{padding:70px 90px}
    h2{font-size:44px;margin-bottom:34px}
    .row{display:flex;gap:14px;align-items:stretch}
    .stage{flex:1;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);border-radius:14px;padding:18px}
    .list{font-size:20px;font-weight:700}
    .who{margin-top:10px;font-size:17px;color:#c7d2fe}
    .arrow{align-self:center;color:#818cf8;font-size:28px}
    .msg{margin-top:56px;display:flex;gap:16px;align-items:flex-start;background:#313338;border-radius:14px;padding:22px 26px;width:860px}
    .av{width:46px;height:46px;border-radius:50%;background:#5865f2;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:22px}
    .name{font-weight:700;font-size:19px}.bot{background:#5865f2;font-size:12px;border-radius:4px;padding:1px 5px;margin-left:6px;vertical-align:2px}
    .text{margin-top:6px;font-size:21px;color:#dbdee1}.mention{background:rgba(88,101,242,.3);color:#c9cdfb;border-radius:4px;padding:0 3px}
  </style></head><body><div class="wrap">
    <h2 class="fade">One list = one stage = one role</h2>
    <div class="row">
      ${stage('Script Writer Ready', 'script writer', 0.4)}<div class="arrow fade" style="animation-delay:.5s">→</div>
      ${stage('SW QC STEP', 'script QC', 0.7)}<div class="arrow fade" style="animation-delay:.8s">→</div>
      ${stage('NFL editor ready', 'editor', 1.0)}<div class="arrow fade" style="animation-delay:1.1s">→</div>
      ${stage('QC step', 'editor QC', 1.3)}<div class="arrow fade" style="animation-delay:1.4s">→</div>
      ${stage('ready to upload', 'uploader', 1.6)}
    </div>
    <div class="msg fade" style="animation-delay:9s"><div class="av">D</div><div>
      <div class="name">Discrello<span class="bot">BOT</span></div>
      <div class="text"><span class="mention">@edith_editor</span> — NFL Week 3 recap is ready for editing</div></div></div>
  </div></body></html>`;
}

function liveHtml(content) {
  return `<!doctype html><html><head><style>${CARD_CSS}
    body{background:#0f1020;display:flex;gap:28px;padding:56px 60px}
    .panel{border-radius:16px;overflow:hidden}
    .trello{flex:1.05;background:linear-gradient(135deg,#0c66e4,#09326c);padding:22px}
    .tt{font-size:22px;font-weight:700;margin-bottom:16px}
    .lists{display:flex;gap:12px;position:relative}
    .lst{width:178px;background:#101204;background:#f1f2f4;color:#172b4d;border-radius:12px;padding:10px;min-height:300px}
    .lh{font-weight:700;font-size:15px;margin-bottom:10px}
    .card{background:#fff;color:#172b4d;border-radius:8px;padding:10px;font-size:14px;box-shadow:0 1px 1px rgba(9,30,66,.25);margin-bottom:8px}
    .moving{position:absolute;left:10px;top:44px;width:158px;z-index:5;box-shadow:0 8px 18px rgba(0,0,0,.35);
      animation:move 2.4s cubic-bezier(.5,0,.2,1) 1.4s forwards}
    @keyframes move{0%{transform:translate(0,0) rotate(0)}15%{transform:translate(0,-6px) rotate(-3deg)}85%{transform:translate(380px,-6px) rotate(-3deg)}100%{transform:translate(380px,0) rotate(0)}}
    .discord{flex:1;background:#313338;display:flex;flex-direction:column}
    .dh{padding:16px 20px;border-bottom:1px solid #1f2023;font-weight:700;color:#f2f3f5;font-size:18px}
    .dh span{color:#80848e}
    .feed{padding:22px 20px;flex:1;display:flex;flex-direction:column;justify-content:flex-end}
    .m{display:flex;gap:14px;opacity:0;animation:in .6s ease 4.4s forwards}
    .av{width:44px;height:44px;border-radius:50%;background:#5865f2;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;flex:none}
    .name{font-weight:700;font-size:17px}.bot{background:#5865f2;font-size:11px;border-radius:4px;padding:1px 5px;margin-left:6px;vertical-align:2px}
    .time{color:#949ba4;font-size:12px;margin-left:8px;font-weight:400}
    .text{margin-top:4px;font-size:18px;color:#dbdee1;line-height:1.4}
    .mention{background:rgba(88,101,242,.3);color:#c9cdfb;border-radius:4px;padding:0 3px}
    .ping{position:absolute;right:86px;top:80px;background:#f23f43;color:#fff;font-weight:800;font-size:15px;border-radius:999px;padding:4px 10px;opacity:0;animation:in .4s ease 4.8s forwards}
  </style></head><body>
    <div class="panel trello"><div class="tt">SPORTS (demo) — Trello</div>
      <div class="lists">
        <div class="lst"><div class="lh">Script Writer Ready</div><div class="card" style="visibility:hidden">x</div><div class="card">NBA Finals preview</div></div>
        <div class="lst"><div class="lh">SW QC STEP</div><div class="card">Golf swing tips</div></div>
        <div class="lst"><div class="lh">NFL editor ready</div></div>
        <div class="card moving">NFL Week 3 recap</div>
      </div></div>
    <div class="panel discord"><div class="dh"><span>#</span> sports-pipeline</div>
      <div class="feed"><div class="m"><div class="av">D</div><div>
        <div class="name">Discrello<span class="bot">BOT</span><span class="time">Today at 10:42</span></div>
        <div class="text">${content}</div></div></div></div></div>
    <div class="ping">@ 1</div>
  </body></html>`;
}

function outroHtml() {
  return `<!doctype html><html><head><style>${CARD_CSS}
    .wrap{height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 110px}
    h1{font-size:72px;font-weight:800;margin-bottom:26px}
    li{font-size:27px;color:#e0e7ff;margin:12px 0;list-style:none}
    code{font-family:'DejaVu Sans Mono',monospace;background:rgba(255,255,255,.12);padding:3px 10px;border-radius:8px;font-size:24px}
  </style></head><body><div class="wrap">
    <h1 class="fade">That's Discrello</h1>
    <ul style="padding:0">
      <li class="fade" style="animation-delay:.3s">Only card <b>moves</b> trigger a ping.</li>
      <li class="fade" style="animation-delay:.6s">A save is refused if nobody would really be notified.</li>
      <li class="fade" style="animation-delay:.9s">User guide: <code>docs/USER_GUIDE.en.md</code></li>
    </ul></div></body></html>`;
}

// ---------------------------------------------------------------- demo server + API
let server;
async function startServer() {
  server = spawn('node', [path.join(REPO, 'packages/server/dist/index.js')], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      LOG_LEVEL: 'warn',
      DATABASE_URL: 'pglite://memory',
      PUBLIC_BASE_URL: 'https://discrello.example.com',
      TRELLO_API_KEY: 'k',
      TRELLO_API_TOKEN: 't',
      TRELLO_API_SECRET: SECRET,
      DISCORD_BOT_TOKEN: 'd',
      ADMIN_PASSWORD: PASSWORD,
      SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      DISCRELLO_FAKE_INTEGRATIONS: '1',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error('demo server did not start');
}

let cookie = '';
async function api(method, url, body) {
  if (!cookie) {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    cookie = r.headers.get('set-cookie').split(';')[0];
  }
  const r = await fetch(`${BASE}${url}`, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function trelloMove({
  actionId,
  cardName,
  toId,
  toName,
  fromName = 'Script Writer Ready',
  type = 'updateCard',
}) {
  const board = (await api('GET', '/api/boards')).find((b) => b.trelloShortLink === 'DeMoBoRd');
  const detail = await api('GET', `/api/boards/${board.id}`);
  const data = {
    card: {
      id: `64a0000000000000000c${actionId.slice(-4)}`,
      name: cardName,
      shortLink: `Cd${actionId.slice(-6)}`,
    },
    board: { id: '5f1a2b3c4d5e6f7a8b9c0d1e', name: 'SPORTS (demo)', shortLink: 'DeMoBoRd' },
  };
  if (type === 'updateCard') {
    data.listBefore = { id: '64a00000000000000000a001', name: fromName };
    data.listAfter = { id: toId, name: toName };
  } else data.list = { id: toId, name: toName };
  const body = JSON.stringify({
    action: {
      id: actionId,
      type,
      date: new Date().toISOString(),
      data,
      memberCreator: { id: 'm1', username: 'jane', fullName: 'Jane Doe' },
    },
  });
  const sig = createHmac('sha1', SECRET)
    .update(body + detail.webhookCallbackUrl)
    .digest('base64');
  const token = detail.webhookCallbackUrl.split('/').pop();
  const r = await fetch(`${BASE}/webhooks/trello/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-trello-webhook': sig },
    body,
  });
  log('webhook', r.status, await r.text());
}

// ---------------------------------------------------------------- browser helpers
let browser;
let page;
let mouse = { x: W / 2, y: H / 2 };
const xp = (e) => `::-p-xpath(${e})`;

async function installCursor() {
  await page.evaluateOnNewDocument(() => {
    const install = () => {
      if (document.getElementById('__cur')) return;
      const st = document.createElement('style');
      st.textContent =
        '#__cur{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-200px,-200px)}' +
        '.__rip{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:3px solid rgba(99,102,241,.9);' +
        'pointer-events:none;z-index:2147483646;animation:__rip .5s ease-out forwards}' +
        '@keyframes __rip{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}';
      document.documentElement.appendChild(st);
      const c = document.createElement('div');
      c.id = '__cur';
      c.innerHTML =
        '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2.5l6.8 18 2.4-7.3 7.3-2.4z" fill="#111827" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      document.documentElement.appendChild(c);
      addEventListener(
        'mousemove',
        (e) => (c.style.transform = `translate(${e.clientX - 4}px,${e.clientY - 3}px)`),
        true,
      );
      addEventListener(
        'mousedown',
        (e) => {
          const r = document.createElement('div');
          r.className = '__rip';
          r.style.left = `${e.clientX}px`;
          r.style.top = `${e.clientY}px`;
          document.documentElement.appendChild(r);
          setTimeout(() => r.remove(), 600);
        },
        true,
      );
    };
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', install);
    else install();
  });
}

async function moveTo(handle) {
  await handle.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await sleep(120);
  const b = await handle.boundingBox();
  const x = b.x + Math.min(b.width / 2, 60);
  const y = b.y + b.height / 2;
  const dist = Math.hypot(x - mouse.x, y - mouse.y);
  await page.mouse.move(x, y, { steps: Math.max(12, Math.min(40, Math.round(dist / 18))) });
  mouse = { x, y };
  await sleep(180);
}
async function click(handle) {
  await moveTo(handle);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
  await sleep(350);
}
async function typeInto(handle, text, delay = 38) {
  await click(handle);
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text, { delay });
  await sleep(250);
}
async function selectOption(handle, optionText) {
  await moveTo(handle);
  await page.waitForFunction(
    (el, t) => [...el.options].some((o) => o.textContent.includes(t)),
    { timeout: 8000 },
    handle,
    optionText,
  );
  const value = await handle.evaluate(
    (el, t) => [...el.options].find((o) => o.textContent.includes(t)).value,
    optionText,
  );
  // No real click: a native <select> popup is not captured by the screencast and can swallow clicks.
  await handle.evaluate((el) => el.focus());
  await handle.select(value);
  await sleep(450);
}
const byButton = (label, scope = '') =>
  page.waitForSelector(xp(`${scope}//button[contains(normalize-space(.), "${label}")]`), {
    timeout: 8000,
  });
const byLabel = (label, scope = '') =>
  page.waitForSelector(
    xp(
      `${scope}//label[contains(normalize-space(.), "${label}")]/following::*[self::input or self::select or self::textarea][1]`,
    ),
    { timeout: 8000 },
  );
const byPlaceholder = (ph) =>
  page.waitForSelector(xp(`//input[contains(@placeholder, "${ph}")]`), { timeout: 8000 });
const waitText = (t, ms = 8000) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: ms }, t);
async function restoreCursor() {
  await page.mouse.move(mouse.x + 1, mouse.y + 1);
  await page.mouse.move(mouse.x, mouse.y);
}
async function goto(url) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle0' });
  await restoreCursor();
}
async function navTo(label) {
  await click(await page.waitForSelector(xp(`//header//nav//a[normalize-space(.)="${label}"]`)));
  await page.waitForNetworkIdle({ idleTime: 300 }).catch(() => {});
}

// ---------------------------------------------------------------- scene actions
const MAP_ROW = (list) =>
  `//h3[normalize-space()="${list}"]/ancestor::div[contains(@class,"rounded-lg")][1]`;
const actions = {
  async login() {
    await typeInto(await byLabel('Admin password'), PASSWORD, 55);
    await click(await byButton('Log in'));
    await page.waitForFunction(() => location.pathname === '/boards', { timeout: 8000 });
  },
  async servers() {
    await navTo('Servers');
    await sleep(600);
    await click(await byButton('Add server'));
    await selectOption(await byLabel('Server the bot is in'), 'Demo Sports Team');
    await typeInto(await byLabel('Alert channel ID'), '320000000000000000', 28);
    await click(await page.waitForSelector('form button[type=submit]'));
    await waitText('bot OK');
  },
  async 'role-create'() {
    await navTo('Roles');
    await sleep(700);
    await click(await byButton('New role'));
    await typeInto(await byLabel('Key'), 'editor');
    await typeInto(await byLabel('Display name'), 'Editor');
    await typeInto(
      await byLabel('Default message template'),
      '{mention} — {card_title} is ready for editing',
      32,
    );
    await sleep(500);
    await click(await page.waitForSelector('form button[type=submit]'));
    await page.waitForSelector(xp('//button[normalize-space(.)="▸ Editor"]'), { timeout: 8000 });
  },
  async 'role-refused'() {
    await click(await page.waitForSelector(xp('//button[normalize-space(.)="▸ Editor"]')));
    await sleep(600);
    await click(
      await page.waitForSelector(
        xp('//label[contains(normalize-space(.), "Discord role")]//input[@type="radio"]'),
      ),
    );
    await selectOption(
      await page.waitForSelector(xp('//select[.//option[contains(., "Pick a role")]]')),
      'Uploaders',
    );
    await click(await byButton('Save target'));
    await waitText('Allow anyone to @mention this role');
  },
  async 'role-ok'() {
    await click(
      await page.waitForSelector(
        xp('//label[contains(normalize-space(.), "Discord user")]//input[@type="radio"]'),
      ),
    );
    await typeInto(await byPlaceholder('User ID'), '400000000000000000', 26);
    await click(await byButton('Save target'));
    await waitText('user 400000000000000000');
    await sleep(500);
    await selectOption(await byLabel('Send a test ping to'), 'sports-pipeline');
    await click(await byButton('Send test ping'));
    await waitText('Test message');
  },
  async 'board-add'() {
    await navTo('Boards');
    await sleep(500);
    await click(await page.waitForSelector(xp('//a[contains(@href,"/boards/new")]')));
    await typeInto(
      await byLabel('Board URL, short link or ID'),
      'https://trello.com/b/DeMoBoRd/sports',
      30,
    );
    await click(await byButton('Fetch'));
    await waitText('NFL editor ready');
    await sleep(500);
    await selectOption(await byLabel('Server'), 'Demo Sports Team');
    const ch = await page.waitForSelector(
      xp('//label[contains(normalize-space(.), "Default channel")]/following::select[1]'),
    );
    await page.waitForFunction((el) => el.options.length > 1, { timeout: 8000 }, ch);
    await selectOption(ch, 'sports-pipeline');
    await click(await byButton('Create board'));
    await page.waitForFunction(() => /^\/boards\/\d+$/.test(location.pathname), { timeout: 10000 });
    await waitText('webhook active');
  },
  async 'board-map'() {
    const row = MAP_ROW('NFL editor ready');
    await selectOption(await page.waitForSelector(xp(`${row}//select`)), 'Editor');
    await waitText('is ready for editing');
    await sleep(1500);
    await click(await byButton('Map list', row));
    await page.waitForSelector(xp(`${row}//button[contains(normalize-space(.), "Send test")]`), {
      timeout: 8000,
    });
    await sleep(800);
    const row2 = MAP_ROW('Script Writer Ready');
    await selectOption(await page.waitForSelector(xp(`${row2}//select`)), 'Script Writer');
    await sleep(900);
    await click(await byButton('Map list', row2));
    await page.waitForSelector(xp(`${row2}//button[contains(normalize-space(.), "Send test")]`), {
      timeout: 8000,
    });
  },
  async 'board-test'() {
    await click(await byButton('Send test', MAP_ROW('NFL editor ready')));
    await waitText('Test message');
  },
  async notifications() {
    await navTo('Notifications');
    await waitText('NFL Week 3 recap');
    await sleep(2200);
    await click(await byButton('View'));
    await sleep(600);
  },
  async events() {
    const close = await page.$(xp('//button[normalize-space(.)="Close"]'));
    if (close) await click(close);
    await sleep(300);
    await click(await byButton('Webhook events'));
    await waitText('no_mapping');
  },
  async settings() {
    await navTo('Settings');
    await waitText('Trello');
    await sleep(1500);
    const maint = await page.$(
      xp('//*[contains(normalize-space(.), "Re-check mentions")][self::button]'),
    );
    if (maint) await moveTo(maint);
  },
};

// ---------------------------------------------------------------- recording
async function record(scene) {
  const file = path.join(OUT, 'video', `${scene.n}-${scene.id}.webm`);
  if (scene.html) {
    const html =
      scene.html === 'title'
        ? titleHtml()
        : scene.html === 'idea'
          ? ideaHtml()
          : scene.html === 'outro'
            ? outroHtml()
            : liveHtml(scene.liveContent);
    await page.setContent(html, { waitUntil: 'load' });
  }
  const rec = await page.screencast({ path: file, ffmpegPath, fps: 30 });
  const t0 = Date.now();
  await sleep(300);
  if (!scene.html) await actions[scene.id]();
  const target = (LEAD_IN + scene.audio + TAIL) * 1000;
  const left = target - (Date.now() - t0);
  if (left > 0) await sleep(left);
  else log(`  scene ${scene.id}: actions ran ${(-left / 1000).toFixed(1)}s longer than narration`);
  await rec.stop();
  scene.video = file;
  log(`recorded ${scene.n} ${scene.id} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// ---------------------------------------------------------------- captions + assembly
const assTime = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${sec}`;
};
const srtTime = (s) => {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
function chunks(text) {
  const sentences = text.match(/[^.!?:]+[.!?:]+/g) ?? [text];
  const out = [];
  for (const s of sentences.map((x) => x.trim())) {
    if (s.length <= 90) out.push(s);
    else {
      const parts = s.split(/,\s+/);
      let cur = '';
      for (const p of parts) {
        const next = cur ? `${cur}, ${p}` : p;
        if (next.length > 90 && cur) {
          out.push(`${cur},`);
          cur = p;
        } else cur = next;
      }
      if (cur) out.push(cur);
    }
  }
  return out;
}
function cueTimes(scene) {
  const parts = chunks(scene.say);
  const total = parts.reduce((a, p) => a + p.length, 0);
  let t = LEAD_IN;
  return parts.map((p) => {
    const d = (scene.audio * p.length) / total;
    const cue = { start: t, end: t + d, text: p };
    t += d;
    return cue;
  });
}
function writeAss(scene) {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,DejaVu Sans,40,&H00FFFFFF,&H00FFFFFF,&H64000000,&H64000000,0,0,0,0,100,100,0,0,3,14,0,2,160,160,44,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = cueTimes(scene).map(
    (c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Cap,,0,0,0,,${c.text}`,
  );
  scene.ass = path.join(OUT, 'subs', `${scene.n}-${scene.id}.ass`);
  writeFileSync(scene.ass, `${header}${lines.join('\n')}\n`);
}
function mediaDuration(file) {
  // Screencast webm files carry no duration in their header: decode and read the last timestamp.
  const out = execFileSync(
    ffmpegPath,
    [
      '-hide_banner',
      '-nostats',
      '-progress',
      'pipe:1',
      '-i',
      file,
      '-map',
      '0:v:0',
      '-f',
      'null',
      '-',
    ],
    {
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  ).toString();
  const times = [...out.matchAll(/out_time_us=(\d+)/g)].map((m) => Number(m[1]));
  if (!times.length) throw new Error(`no duration for ${file}`);
  return Math.max(...times) / 1e6 + 1 / 30;
}
function ff(args) {
  execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: 'inherit',
  });
}
function buildSegment(scene) {
  writeAss(scene);
  const vdur = mediaDuration(scene.video);
  scene.duration = vdur;
  const fadeOut = Math.max(0, vdur - 0.3).toFixed(2);
  scene.seg = path.join(OUT, 'seg', `${scene.n}-${scene.id}.mp4`);
  const vf = [
    `scale=1920:1080:flags=lanczos`,
    `fps=30`,
    `subtitles=${scene.ass}:fontsdir=/usr/share/fonts/truetype/dejavu`,
    `fade=t=in:st=0:d=0.25`,
    `fade=t=out:st=${fadeOut}:d=0.3`,
    `format=yuv420p`,
  ].join(',');
  ff([
    '-i',
    scene.video,
    '-i',
    scene.wav,
    '-filter_complex',
    `[0:v]${vf}[v];[1:a]aresample=48000,adelay=${Math.round(LEAD_IN * 1000)}:all=1,apad,atrim=0:${vdur.toFixed(3)}[a]`,
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-t',
    vdur.toFixed(3),
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-r',
    '30',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-ar',
    '48000',
    '-ac',
    '2',
    scene.seg,
  ]);
  log(`segment ${scene.n} ${scene.id}: ${vdur.toFixed(1)}s`);
}
function assemble() {
  const list = path.join(OUT, 'segments.txt');
  writeFileSync(list, scenes.map((s) => `file '${s.seg}'`).join('\n') + '\n');
  const joined = path.join(OUT, 'joined.mp4');
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);
  const final = path.join(OUT, 'discrello-tutorial.en.mp4');
  ff([
    '-i',
    joined,
    '-c:v',
    'copy',
    '-af',
    'loudnorm=I=-16:TP=-1.5:LRA=11',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-ar',
    '48000',
    '-movflags',
    '+faststart',
    final,
  ]);
  // Soft subtitles for players / uploads (same text as the burned-in captions)
  let offset = 0;
  let n = 1;
  const srt = [];
  for (const s of scenes) {
    for (const c of cueTimes(s)) {
      srt.push(`${n++}\n${srtTime(offset + c.start)} --> ${srtTime(offset + c.end)}\n${c.text}\n`);
    }
    offset += s.duration;
  }
  writeFileSync(path.join(OUT, 'discrello-tutorial.en.srt'), srt.join('\n'));
  log(`final: ${final} (${mediaDuration(final).toFixed(1)}s)`);
}

// ---------------------------------------------------------------- main
const only = process.argv[2]; // optional: comma-separated scene ids to (re)record
try {
  synthesize();
  await startServer();
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--font-render-hinting=none',
      `--force-device-scale-factor=${DPR}`,
    ],
    defaultViewport: { width: W, height: H, deviceScaleFactor: DPR },
  });
  page = await browser.newPage();
  await installCursor();
  for (const scene of scenes) {
    // Not recorded: state the next scene starts from.
    if (scene.id === 'login') await goto('/boards');
    if (scene.id === 'role-create') {
      // a second role, configured off-camera, so the board can map two stages
      const sw = await api('POST', '/api/roles', {
        key: 'script_writer',
        displayName: 'Script Writer',
        defaultTemplate: '{mention} — {card_title} is ready for script writing',
      });
      const guild = (await api('GET', '/api/guilds'))[0];
      await api('PUT', `/api/roles/${sw.id}/targets/${guild.id}`, {
        kind: 'user',
        id: '410000000000000000',
      });
    }
    if (scene.id === 'live') {
      await trelloMove({
        actionId: '64a1b2c3d4e5f60718290001',
        cardName: 'NFL Week 3 recap',
        toId: '64a00000000000000000a003',
        toName: 'NFL editor ready',
      });
      await trelloMove({
        actionId: '64a1b2c3d4e5f60718290002',
        cardName: 'Golf swing tips',
        toId: '64a00000000000000000a002',
        toName: 'SW QC STEP',
      });
      await sleep(2500);
      const n = await api('GET', '/api/notifications?limit=5');
      const content = n.items.find((i) => i.cardName === 'NFL Week 3 recap')?.content ?? '';
      scene.liveContent = content
        .replace('<@400000000000000000>', '<span class="mention">@edith_editor</span>')
        .replace('— ', '— ');
    }
    if (scene.id === 'notifications') await goto('/boards');
    if (
      scene.html === undefined &&
      ['login'].includes(scene.id) === false &&
      page.url().startsWith('about:')
    )
      await goto('/boards');
    if (
      only &&
      !only.split(',').includes(scene.id) &&
      existsSync(path.join(OUT, 'video', `${scene.n}-${scene.id}.webm`))
    ) {
      // keep the earlier recording, but still replay the actions so the app state matches
      if (!scene.html) await actions[scene.id]?.();
      scene.video = path.join(OUT, 'video', `${scene.n}-${scene.id}.webm`);
      continue;
    }
    await record(scene);
  }
  await browser.close();
  for (const s of scenes) buildSegment(s);
  assemble();
} catch (err) {
  console.error(err);
  if (page) await page.screenshot({ path: path.join(OUT, 'error.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  server?.kill();
}
