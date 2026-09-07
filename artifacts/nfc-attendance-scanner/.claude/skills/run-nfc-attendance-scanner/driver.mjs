#!/usr/bin/env node
/**
 * Headless driver for the NFC attendance scanner.
 *
 * Speaks CDP to Chromium over --remote-debugging-pipe (fds 3/4) rather than a
 * TCP port. A port works here too, but the pipe needs no free port, no
 * /json/list polling, and leaves nothing listening if the driver dies.
 *
 *   node .claude/skills/run-nfc-attendance-scanner/driver.mjs smoke
 *
 * Or import it and drive your own flow:
 *
 *   import { launch } from './.claude/skills/run-nfc-attendance-scanner/driver.mjs';
 *   const app = await launch();
 *   await app.setMode('enroll');
 *   await app.scan('04A1B2C3D4E5F6');
 *   await app.shot('whatever');
 *   await app.close();
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const CHROMIUM =
  process.env.CHROMIUM_BIN ||
  process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
  '/repl/tools/bin/chromium';
// 23205 is the artifact's own port (.replit-artifact `localPort`), i.e. the
// server the Replit runner already has up. Override with APP_URL.
const APP_URL = process.env.APP_URL || 'http://localhost:23205/';
const SHOT_DIR = process.env.SHOT_DIR || '/tmp/nfc-scanner-shots';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Selectors the app exposes. Keep in sync with the data-testid attributes. */
export const SEL = {
  station: '[data-testid="scanner-station"]',
  scannerInput: '[data-testid="input-scanner-hidden"]',
  form: '[data-testid="form-enrollment"]',
  formInputs: '[data-testid="form-enrollment"] input',
  submit: '[data-testid="form-enrollment"] button[type="submit"]',
  email: '[data-testid="input-email"]',
  regenerate: '[data-testid="button-regenerate-email"]',
  collision: '[data-testid="text-email-collision"]',
  useSuggested: '[data-testid="button-use-suggested-email"]',
  dialog: '[data-testid="dialog-email-conflict"]',
  dialogInput: '[data-testid="input-conflict-email"]',
  dialogSave: '[data-testid="button-conflict-save"]',
  dialogSuggested: '[data-testid="button-conflict-suggested"]',
  dialogDismiss: '[data-testid="button-conflict-dismiss"]',
  count: '[data-testid="text-attendance-count"]',
  // Session rotation: End Session opens the summary, whose "Start New Session"
  // opens the confirmation dialog. Nothing rotates without the dialog.
  endSession: '[data-testid="button-end-session"]',
  summaryNewSession: '[data-testid="button-summary-new-session"]',
  newSessionDialog: '[data-testid="dialog-new-session"]',
  newSessionConfirm: '[data-testid="button-dialog-confirm"]',
  newSessionCancel: '[data-testid="button-dialog-cancel"]',
  // Routes off the scanner (`/roster`, `/dashboard`) and the links back.
  linkRoster: '[data-testid="link-roster"]',
  linkDashboard: '[data-testid="link-dashboard"]',
  linkScanner: '[data-testid="link-scanner"]',
  rosterPage: '[data-testid="roster-page"]',
  rosterSearch: '[data-testid="input-roster-search"]',
  rosterCount: '[data-testid="text-roster-count"]',
  rosterTable: '[data-testid="table-roster"]',
  dashboardPage: '[data-testid="dashboard-page"]',
  dashboard: '[data-testid="dashboard"]',
  uniqueStudents: '[data-testid="text-unique-students"]',
  sessionsCount: '[data-testid="text-sessions-count"]',
  unidentifiedTaps: '[data-testid="text-unidentified-taps"]',
  unidentifiedCards: '[data-testid="text-unidentified-cards"]',
};

export async function launch({ url = APP_URL, shotDir = SHOT_DIR, profile } = {}) {
  mkdirSync(shotDir, { recursive: true });
  const userDataDir = profile || `/tmp/nfc-driver-profile-${Date.now()}`;

  const child = spawn(
    CHROMIUM,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--remote-debugging-pipe',
      `--user-data-dir=${userDataDir}`,
      '--window-size=1280,940',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
  );

  const wr = child.stdio[3];
  const rd = child.stdio[4];
  let buf = Buffer.alloc(0);
  let seq = 0;
  const pending = new Map();

  rd.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    let i;
    while ((i = buf.indexOf(0)) !== -1) {
      const msg = JSON.parse(buf.subarray(0, i).toString());
      buf = buf.subarray(i + 1);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });

  const raw = (method, params = {}, sessionId) =>
    new Promise((res) => {
      const id = ++seq;
      pending.set(id, res);
      wr.write(
        JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0',
      );
    });

  await sleep(1500);
  const { result: { targetId } } = await raw('Target.createTarget', { url: 'about:blank' });
  const { result: { sessionId } } = await raw('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  const cmd = (m, p) => raw(m, p, sessionId);
  await cmd('Page.enable');
  await cmd('Runtime.enable');

  const evaluate = async (expression) => {
    const r = await cmd('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.result?.exceptionDetails) {
      throw new Error(
        r.result.exceptionDetails.exception?.description || 'evaluate failed',
      );
    }
    return r.result?.result?.value;
  };

  const waitFor = async (expression, label = expression, timeout = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await evaluate(expression)) return true;
      await sleep(150);
    }
    throw new Error(`timed out waiting for: ${label}`);
  };

  // React tracks its own value on the DOM node, so `el.value = x` is ignored.
  // Go through the native setter and fire a bubbling input event instead.
  const FILL = `(sel,val,i)=>{const el=document.querySelectorAll(sel)[i];
    if(!el) throw new Error('no element for '+sel+'['+i+']');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,val);
    el.dispatchEvent(new Event('input',{bubbles:true}));return el.value;}`;

  const app = {
    child,
    evaluate,
    waitFor,
    cmd,

    fill: (sel, value, index = 0) =>
      evaluate(`(${FILL})(${JSON.stringify(sel)},${JSON.stringify(value)},${index})`),

    value: (sel) => evaluate(`(document.querySelector(${JSON.stringify(sel)})||{}).value`),

    text: (sel) =>
      evaluate(`(document.querySelector(${JSON.stringify(sel)})||{}).innerText || ''`),

    exists: (sel) => evaluate(`!!document.querySelector(${JSON.stringify(sel)})`),

    click: (sel) =>
      evaluate(
        `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.click();return true;})()`,
      ),

    clickText: (label) =>
      evaluate(`(()=>{const e=[...document.querySelectorAll('button')]
        .find(b=>b.textContent.trim().includes(${JSON.stringify(label)}));
        if(!e)return false;e.click();return true;})()`),

    async open() {
      await cmd('Page.navigate', { url });
      await waitFor(`!!document.querySelector('${SEL.station}')`, 'app boot');
      await sleep(800);
      return app;
    },

    /**
     * Follow an in-app link and wait for the page it lands on. Client-side
     * routing only — a raw Page.navigate to /roster would ask the dev server
     * for a file that isn't there.
     */
    async goto(linkSel, arrivedSel, label = arrivedSel) {
      await app.click(linkSel);
      await waitFor(`!!document.querySelector('${arrivedSel}')`, label);
      await sleep(500);
    },

    /** 'checkin' | 'enroll' — the header toggle. */
    async setMode(mode) {
      await app.clickText(mode === 'enroll' ? 'Enroll' : 'Check-in');
      await sleep(400);
    },

    /**
     * Simulate an HID reader: the scanner input is hidden and auto-focused,
     * and a reader types the UID then sends Enter. UID must be 14 hex chars
     * (see isValidUid in src/lib/scan-format.ts) or the app rejects the scan.
     */
    async scan(uid) {
      await app.fill(SEL.scannerInput, uid);
      await evaluate(`(()=>{document.querySelector('${SEL.scannerInput}')
        .dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return true;})()`);
      await sleep(250);
    },

    /** Fill the three derivation inputs; the email auto-fills from them. */
    async fillEnrollment({ firstName, lastName, gradYear }) {
      await app.fill(SEL.formInputs, firstName, 0);
      await app.fill(SEL.formInputs, lastName, 1);
      await app.fill(SEL.formInputs, String(gradYear), 2);
      await sleep(350);
    },

    async saveEnrollment() {
      await app.click(SEL.submit);
      await waitFor(`!document.querySelector('${SEL.form}')`, 'enrollment saved');
    },

    /** Everything currently in IndexedDB, as "First Last 'yy -> email". */
    readRoster: () =>
      evaluate(`new Promise(res=>{const q=indexedDB.open('attendance-scanner-local');
        q.onsuccess=()=>{const g=q.result.transaction('persons','readonly')
          .objectStore('persons').getAll();
        g.onsuccess=()=>res(g.result.map(p=>p.firstName+' '+p.lastName+" '"
          +String(p.gradYear).slice(-2)+'  ->  '+p.email));};})`),

    async shot(name) {
      const r = await cmd('Page.captureScreenshot', { format: 'png' });
      const path = `${shotDir}/${name}.png`;
      writeFileSync(path, Buffer.from(r.result.data, 'base64'));
      return path;
    },

    close() {
      child.kill();
    },
  };

  return app.open();
}

/** End-to-end enrollment + email-collision flow. Exits non-zero on failure. */
async function smoke() {
  const app = await launch();
  const ok = (label, cond) => {
    console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
    if (!cond) process.exitCode = 1;
  };

  await app.setMode('enroll');

  await app.scan('04A1B2C3D4E5F6');
  await app.waitFor(`!!document.querySelector('${SEL.form}')`, 'form after scan');
  await app.fillEnrollment({ firstName: 'Jane', lastName: 'Smith', gradYear: 2027 });
  ok('email derives live', (await app.value(SEL.email)) === 'jsmith27@stjohnschs.org');
  console.log('       screenshot:', await app.shot('1-live-derivation'));
  await app.saveEnrollment();

  await app.scan('04F6E5D4C3B2A1');
  await app.waitFor(`!!document.querySelector('${SEL.form}')`, 'form after 2nd scan');
  await app.fillEnrollment({ firstName: 'Jane', lastName: 'Smith', gradYear: 2027 });
  await app.waitFor(`!!document.querySelector('${SEL.dialog}')`, 'conflict dialog');
  ok('conflict dialog names the holder',
    (await app.text(SEL.dialog)).includes('Jane Smith, class of 2027'));
  console.log('       screenshot:', await app.shot('2-conflict-dialog'));

  await app.fill(SEL.dialogInput, 'jane@gmail.com');
  await app.click(SEL.dialogSave);
  await sleep(300);
  ok('rejects an address outside the school domain', await app.exists(SEL.dialog));

  await app.fill(SEL.dialogInput, 'janesmith27@stjohnschs.org');
  await app.click(SEL.dialogSave);
  await app.waitFor(`!document.querySelector('${SEL.dialog}')`, 'dialog closed');
  ok('accepts the real address',
    (await app.value(SEL.email)) === 'janesmith27@stjohnschs.org');
  console.log('       screenshot:', await app.shot('3-resolved'));
  await app.saveEnrollment();

  const roster = await app.readRoster();
  console.log('\nroster in IndexedDB:');
  roster.forEach((r) => console.log('   ' + r));
  ok('two students, two distinct addresses',
    roster.length === 2 && new Set(roster.map((r) => r.split('->')[1])).size === 2);

  app.close();
  console.log(process.exitCode ? '\nSMOKE FAILED' : '\nSMOKE PASSED');
}

if (process.argv[2] === 'smoke') await smoke();
