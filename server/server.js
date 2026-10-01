// dot.home - the live server. One world, running around the clock, watched by everyone.
//
//   node server/server.js           start (or resume) the world
//   node server/server.js --reset   archive the current world and start over at day 1
//
// Env: PORT (default 5182), HOST (default 127.0.0.1: only this computer; set 0.0.0.0 to share on a network)
//      DOTHOME_DAY_SECONDS  real seconds per simulated day (default 3600: one day per hour)
//      DOTHOME_DATA         where the world is saved (default server/data)
//      DOTHOME_PUBLISH=0    never mirror to Firebase or commit to git (server/dev.mjs sets this for a private test copy)
//      DOTHOME_GIT=0        don't let the dots commit their chronicle (server/chronicle.js)
//
// The engine (sim/) is the same code the browser uses; here it is the only copy that runs.
// Browsers get one snapshot when they connect, then a small frame whenever the world changes.
import http from 'node:http';
import { readFile, writeFile, rename, mkdir, copyFile, readdir, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../sim/engine.js';
import { DAY, TICK, dayOf, clockOf } from '../sim/catalog.js';
import { createPublisher } from './firebase.js';
import { createChronicle } from './chronicle.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.resolve(process.env.DOTHOME_DATA || path.join(ROOT, 'server', 'data'));
const FILE = path.join(DATA, 'world.json');
const BACKUPS = path.join(DATA, 'backups');
const PORT = +(process.env.PORT || 5182);
const HOST = process.env.HOST || '127.0.0.1';
const DAY_SECONDS = +(process.env.DOTHOME_DAY_SECONDS || 3600);
const RATE = DAY / DAY_SECONDS; // simulated minutes per real second
const NIGHT = 5;                // once everyone is asleep, nights pass this much faster
// The world never pauses (unless paused on purpose - see pause() below): its clock is tied to the real one. Whenever the server was not running
// (laptop asleep, restart, power cut) it replays the whole gap on its return - at the average pace,
// since nights normally pass faster (15.5 awake hours at 1x + 8.5 asleep at NIGHT x).
const AVG = 24 / (15.5 + 8.5 / NIGHT);
function catchUp(seconds, why) {
  const minutes = seconds * RATE * AVG;
  if (minutes < TICK) return;
  const t0 = Date.now(), d0 = dayOf(S);
  E.step(S, minutes);
  say(`${why}: replayed ${Math.round(seconds)}s of real time (day ${d0} -> day ${dayOf(S)}) in ${Date.now() - t0}ms`);
}
const PUBLIC = new Set(['index.html', 'favicon.ico', 'assets', 'sim', 'world', 'ui']); // nothing else is served
const MAX_VIEWERS = 5000;

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const say = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

// ---------------------------------------------------------------- persistence
async function save() {
  const { outbox, ...rest } = S;
  rest.savedAt = Date.now();
  await mkdir(DATA, { recursive: true });
  await writeFile(FILE + '.tmp', JSON.stringify(rest));
  await rename(FILE + '.tmp', FILE); // atomic: a crash mid-write never corrupts the world
}
async function backup(tag = 'hourly') {
  try {
    await mkdir(BACKUPS, { recursive: true });
    await copyFile(FILE, path.join(BACKUPS, `world-${tag}-${stamp()}.json`));
    const old = (await readdir(BACKUPS)).filter((f) => f.startsWith('world-hourly-')).sort();
    for (const f of old.slice(0, Math.max(0, old.length - 48))) await unlink(path.join(BACKUPS, f));
  } catch { /* nothing saved yet */ }
}
async function loadWorld() {
  if (process.argv.includes('--reset')) {
    await backup('reset');
    try { await unlink(FILE); } catch { /* no world yet */ }
    return null;
  }
  try { return JSON.parse(await readFile(FILE, 'utf8')); } catch { return null; }
}

let S = await loadWorld();
// resume.ps1 leaves this marker: the world was paused on purpose, so no time passed in it and there is nothing to replay
const resuming = await unlink(path.join(DATA, 'RESUMING')).then(() => true, () => false);
if (!S || S.v !== 1) {
  S = E.createWorld();
  say(`a new world begins (seed ${S.seed})`);
} else if (S.paused || resuming) {
  say(`resuming after a pause${S.paused ? ` that began ${new Date(S.paused).toISOString()}` : ''} - picking up exactly where it stopped`);
  delete S.paused;
} else if (S.savedAt) {
  catchUp((Date.now() - S.savedAt) / 1000, 'server was down');
}
S.seq ??= 0;
E.drain(S);
await save();
say(`day ${dayOf(S)} ${clockOf(S)} - one simulated day = ${DAY_SECONDS}s`);

// ---------------------------------------------------------------- streaming to viewers
const viewers = new Set();
let lastSent = S.seq;

function liveInfo() { return { now: Date.now(), rate: RATE, night: NIGHT, viewers: viewers.size }; }
function snapshot() { const { outbox, ...rest } = S; return { ...rest, live: liveInfo() }; }
// a frame is the whole world minus the long logs; logs only send what's new since the last frame
function frame() {
  const { outbox, history, feed, engineLog, proposals, disputes, decisions, journal, days, economy, ...rest } = S;
  const fresh = (arr = []) => arr.filter((x) => (x.n || 0) > lastSent);
  const f = {
    ...rest,
    economy: { ...economy, transactions: undefined },
    proposals: proposals.slice(-25),
    disputes: disputes.slice(-25),
    decisions: (decisions || []).slice(-25),
    add: {
      history: fresh(history), feed: fresh(feed), engineLog: fresh(engineLog), transactions: fresh(economy.transactions),
      journal: fresh(journal), days: fresh(days),
    },
    live: liveInfo(),
  };
  lastSent = S.seq;
  return f;
}
function send(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function broadcast(event, data) {
  if (!viewers.size) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of viewers) res.write(msg);
}

function openStream(req, res) {
  if (viewers.size >= MAX_VIEWERS) { res.writeHead(503); res.end('too many viewers'); return; }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  viewers.add(res); // count the newcomer before their snapshot, so they see themselves
  send(res, 'snapshot', snapshot());
  broadcast('viewers', viewers.size);
  req.on('close', () => { viewers.delete(res); broadcast('viewers', viewers.size); });
}

// ---------------------------------------------------------------- the public mirror (optional)
// With Firebase configured, the world is also mirrored to Firebase for the public site.
const pub = process.env.DOTHOME_PUBLISH === '0' ? null : await createPublisher({ root: ROOT, log: say });
const pace = { rate: RATE, night: NIGHT };
if (pub) await pub.full(S, pace);
// ...and the dots commit their own history to this repository (server/chronicle.js)
const chron = await createChronicle({ root: ROOT, data: DATA, log: say });
if (chron) await chron.start(S);

// ---------------------------------------------------------------- the clock
let last = Date.now(), dirty = false;
setInterval(() => {
  if (S.paused) return; // stopping for a pause: the world is already frozen and saved
  const now = Date.now();
  const dt = (now - last) / 1000; // normally a quarter second; much longer if the machine was asleep
  last = now;
  const catchingUp = dt > 5;
  const before = S.time;
  if (catchingUp) catchUp(dt, 'machine woke up');
  else E.step(S, dt * RATE * (E.allAsleep(S) ? NIGHT : 1));
  const events = [];
  for (const ev of E.drain(S)) {
    if (ev.type === 'say') { if (!catchingUp) events.push({ type: 'say', id: ev.id, text: ev.text }); }
    else if (ev.type === 'history' && ev.e.kind === 'milestone') { events.push({ type: 'milestone', text: ev.e.text, day: ev.e.day }); say(`DAY ${ev.e.day} - ${ev.e.text}`); }
  }
  if (events.length) { broadcast('events', events); pub?.events(events); }
  if (S.time !== before || events.length) dirty = true;
}, 250);
setInterval(() => { if (dirty && !S.paused) { dirty = false; broadcast('frame', frame()); pub?.frame(S, pace); } }, 1000);
setInterval(() => { if (!S.paused) pub?.beat(pace); }, 15000);
setInterval(() => chron?.sync(S), 5000);
setInterval(() => { for (const res of viewers) res.write(': keep-alive\n\n'); }, 20000);
setInterval(() => save().catch((e) => say('save failed', e.message)), 30000);
setInterval(() => backup(), 3600 * 1000);

// ---------------------------------------------------------------- http
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary',
};
const json = (res, data, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }); res.end(JSON.stringify(data)); };

async function serveFile(res, urlPath) {
  const rel = path.normalize(decodeURIComponent(urlPath).replace(/^\/+/, '') || 'index.html');
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) || !PUBLIC.has(rel.split(path.sep)[0])) return json(res, { error: 'not found' }, 404);
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': ext === '.glb' ? 'public, max-age=3600' : 'no-cache' });
    res.end(await readFile(file));
  } catch { json(res, { error: 'not found' }, 404); }
}

// Pausing (server/pause.ps1): freeze the world, tell visitors, save, and stop. The keeper sees the
// PAUSED marker and waits; server/resume.ps1 removes it and the world carries on from the same moment.
const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
async function pause(res) {
  S.paused = Date.now();
  await pub?.pause().catch(() => {});
  chron?.sync(S); // last commits, pushed before stopping (but never wait more than half a minute)
  await Promise.race([chron?.flush(), new Promise((r) => setTimeout(r, 30000))]);
  await save();
  await writeFile(path.join(DATA, 'PAUSED'), new Date().toISOString());
  broadcast('paused', true);
  say(`paused at day ${dayOf(S)} ${clockOf(S)}`);
  json(res, { paused: true, day: dayOf(S), clock: clockOf(S) });
  setTimeout(() => process.exit(0), 300);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/admin/pause' && isLocal(req)) return pause(res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, { error: 'read only' }, 405);
  switch (url.pathname) {
    case '/live': return openStream(req, res);
    case '/health': return json(res, { ok: true, day: dayOf(S), clock: clockOf(S), viewers: viewers.size });
    case '/api/state': return json(res, snapshot());
    case '/api/milestones': return json(res, S.history.filter((h) => h.kind === 'milestone').map(({ day, clock, text }) => ({ day, clock, text })));
    default: return serveFile(res, url.pathname);
  }
});
server.listen(PORT, HOST, () => say(`dot.home is live on http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`));

async function shutdown() {
  say('saving and shutting down');
  await save().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
