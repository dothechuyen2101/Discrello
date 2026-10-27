/**
 * Browser end-to-end check of the whole flow against the demo server (no real Discord/Trello).
 *
 *   1. In one terminal:  DISCRELLO_FAKE_INTEGRATIONS=1 DATABASE_URL=pglite://memory PORT=3987 \
 *        PUBLIC_BASE_URL=https://example.test TRELLO_API_SECRET=smoke-secret ADMIN_PASSWORD=correct-horse-battery \
 *        TRELLO_API_KEY=k TRELLO_API_TOKEN=t DISCORD_BOT_TOKEN=d SESSION_SECRET=0123456789abcdef0123456789abcdef \
 *        pnpm --filter @discrello/server start        (after `pnpm build`)
 *   2. In another:       pnpm e2e:demo
 *
 * Needs Google Chrome (CHROME_PATH, default /usr/bin/google-chrome). Screenshots land in scripts/e2e-shots/.
 * Steps: wrong/right login → add server → create role → refuse a non-mentionable role target (422 inline)
 * → save a user target → test ping → add board → map "NFL editor ready" → signed webhook → notification "sent".
 */
import puppeteer from 'puppeteer-core';
import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3987';
const SHOTS = new URL('./e2e-shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const FIX = new URL('../packages/server/test/fixtures/trello/updateCard-move.json', import.meta.url).pathname;
const log = (...a) => console.log('[e2e]', ...a);

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401') && !m.text().includes('422') && !m.text().includes('409')) errors.push(`console: ${m.text()}`); });

let n = 0;
const shot = async (name) => { n += 1; await page.screenshot({ path: `${SHOTS}${String(n).padStart(2, '0')}-${name}.png`, fullPage: true }); };
const text = async () => page.evaluate(() => document.body.innerText);
const waitText = async (t, ms = 8000) => {
  await page.waitForFunction((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), { timeout: ms }, t).catch(async () => {
    throw new Error(`text not found: "${t}"\n--- page text ---\n${(await text()).slice(0, 2000)}`);
  });
};
const xp = (expr) => `::-p-xpath(${expr})`;
const clickButton = async (label, scope = '') => {
  const el = await page.waitForSelector(xp(`${scope}//button[contains(normalize-space(.), "${label}")]`), { timeout: 8000 });
  await el.click();
};
const controlForLabel = async (label, scope = '') =>
  page.waitForSelector(xp(`${scope}//label[contains(normalize-space(.), "${label}")]/following::*[self::input or self::select or self::textarea][1]`), { timeout: 8000 });
const clearAndType = async (el, value) => {
  await el.focus();
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await el.type(value);
};
const fillByLabel = async (label, value, scope = '') => clearAndType(await controlForLabel(label, scope), value);
const selectOption = async (el, optionText) => {
  const value = await el.evaluate((sel, t) => { const o = [...sel.options].find((o) => o.textContent.includes(t)); return o ? o.value : null; }, optionText);
  if (value === null) throw new Error(`option "${optionText}" not found`);
  await el.select(value);
};
const selectByLabelText = async (label, optionText, scope = '') => selectOption(await controlForLabel(label, scope), optionText);
const fillPlaceholder = async (ph, value, scope = '') => {
  const el = await page.waitForSelector(xp(`${scope}//input[contains(@placeholder, "${ph}")]`), { timeout: 8000 });
  await clearAndType(el, value);
};
const clickRadio = async (label, scope = '') => {
  const el = await page.waitForSelector(xp(`${scope}//label[contains(normalize-space(.), "${label}")]//input[@type="radio"]`), { timeout: 8000 });
  await el.click();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // 1. Login (wrong, then right)
  await page.goto(`${BASE}/boards`, { waitUntil: 'networkidle0' });
  await waitText('Admin password');
  await fillByLabel('Admin password', 'wrong-password-here');
  await clickButton('Log in');
  await waitText('Wrong password');
  await shot('login-wrong');
  await fillByLabel('Admin password', 'correct-horse-battery');
  await clickButton('Log in');
  await page.waitForFunction(() => location.pathname === '/boards', { timeout: 8000 });
  await shot('boards-empty');
  log('login ok');

  // 2. Servers
  await page.goto(`${BASE}/guilds`, { waitUntil: 'networkidle0' });
  await clickButton('Add server');
  await selectByLabelText('Server the bot is in', 'Demo Sports Team');
  await fillByLabel('Alert channel ID (optional)', '320000000000000000');
  (await page.waitForSelector('form button[type=submit]')).click();
  await waitText('Demo Sports Team');
  await sleep(400);
  await shot('guild-added');
  log('guild ok');

  // 3. Role + targets
  await page.goto(`${BASE}/roles`, { waitUntil: 'networkidle0' });
  await clickButton('role');
  await fillByLabel('Key', 'editor');
  await fillByLabel('Display name', 'Editor');
  await fillByLabel('Default message template', '{mention} — {card_title} is ready for editing');
  (await page.waitForSelector('form button[type=submit]')).click();
  await waitText('used by 0 mapping');
  await sleep(300);
  await clickButton('Editor');                      // expand the role row
  await waitText('Demo Sports Team');
  await clickRadio('Discord role');
  const roleSel = await page.waitForSelector(xp(`//select[.//option[contains(., "Pick a role")]]`));
  await selectOption(roleSel, 'Uploaders (not mentionable)');
  await clickButton('Save target');
  await waitText('is not mentionable and the bot lacks');
  await waitText('Allow anyone to @mention this role');
  await shot('role-target-422');
  log('422 shown inline ok');
  await clickRadio('Discord user');
  await fillPlaceholder('User ID', '400000000000000000');
  await clickButton('Save target');
  await waitText('user 400000000000000000');
  await sleep(300);
  await shot('role-target-saved');
  log('user target saved ok');
  await selectByLabelText('Send a test ping to', '#sports-pipeline');
  await clickButton('Send test ping');
  await waitText('Test message');
  await sleep(300);
  await shot('role-test-ping');
  log('test ping ok');

  // 4. Add board
  await page.goto(`${BASE}/boards/new`, { waitUntil: 'networkidle0' });
  await fillByLabel('Board URL, short link or ID', 'DeMoBoRd');
  (await page.waitForSelector('form button[type=submit]')).click();
  await waitText('SPORTS (demo)');
  await waitText('NFL editor ready');
  await selectByLabelText('Server', 'Demo Sports Team');
  const chSel = await page.waitForSelector(xp(`//label[contains(normalize-space(.), "Default channel")]/following::select[1]`), { timeout: 8000 });
  await page.waitForFunction((el) => el.options.length > 1, { timeout: 8000 }, chSel);
  await selectOption(chSel, 'sports-pipeline');
  await shot('add-board-form');
  await clickButton('Create');
  await page.waitForFunction(() => /^\/boards\/\d+$/.test(location.pathname), { timeout: 10000 });
  await waitText('NFL editor ready');
  await sleep(500);
  await shot('board-detail');
  log('board added ok');

  // 5. Map "NFL editor ready" → Editor
  const rowScope = `//h3[normalize-space()="NFL editor ready"]/ancestor::div[contains(@class,"rounded-lg")][1]`;
  // The list picker is a tree: open it, open the "People" folder, pick the role.
  await (await page.waitForSelector(xp(`${rowScope}//button[@aria-haspopup="listbox"]`))).click();
  await clickButton('People', `${rowScope}//*[@role="listbox"]`);
  await (await page.waitForSelector(xp(`${rowScope}//*[@role="listbox"]//button[@role="option"][normalize-space(.)="Editor"]`))).click();
  await waitText('is ready for editing');
  await shot('mapping-draft');
  await clickButton('Map list', rowScope);
  await page.waitForSelector(xp(`${rowScope}//button[contains(normalize-space(.), "Save")]`), { timeout: 8000 });
  await sleep(400);
  await shot('mapping-saved');
  log('mapping saved ok');
  await clickButton('Send test', rowScope);
  await waitText('Test message');
  await sleep(300);
  await shot('mapping-test');

  // 6. Signed webhook from "Trello"
  const board = await page.evaluate(async () => (await fetch('/api/boards/1', { credentials: 'same-origin' })).json());
  const cb = board.webhookCallbackUrl;
  const fixture = JSON.parse(readFileSync(FIX, 'utf8'));
  fixture.action.data.listAfter = { id: '64a00000000000000000a003', name: 'NFL editor ready' };
  const body = JSON.stringify(fixture);
  const sig = createHmac('sha1', process.env.TRELLO_API_SECRET ?? 'smoke-secret').update(body + cb).digest('base64');
  const token = cb.split('/').pop();
  const res = await fetch(`${BASE}/webhooks/trello/${token}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-trello-webhook': sig }, body });
  log('webhook', res.status, await res.text());
  await sleep(2500);

  // 7. Notifications
  await page.goto(`${BASE}/notifications`, { waitUntil: 'networkidle0' });
  await waitText('NFL Week 3 recap');
  await waitText('sent');
  await shot('notifications');
  await clickButton('View');
  await waitText('is ready for editing');
  await shot('notification-drawer');
  log('notifications ok');
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle0' });
  await waitText('discrello');
  await shot('settings');
  await page.goto(`${BASE}/boards`, { waitUntil: 'networkidle0' });
  await waitText('SPORTS (demo)');
  await shot('boards-list');
  log('ALL STEPS PASSED');
} catch (err) {
  console.error('E2E FAILED:', err.message);
  await shot('ERROR');
  writeFileSync(`${SHOTS}error-page.txt`, await text());
  console.error('page errors:', errors);
  await browser.close();
  process.exit(1);
}
console.log('page errors:', errors);
await browser.close();
