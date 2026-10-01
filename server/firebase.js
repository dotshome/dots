// dot.home - mirrors the world into Firebase Realtime Database for the public site.
//
// The simulation only ever runs here, on the laptop. Firebase just relays what this writes,
// so visitors connect to Firebase and nothing on the internet ever connects to this machine.
// Turned on when both exist:  firebase-config.js (public web config, also used by the site)
//                             server/firebase-key.json (service-account key - secret, never served)
//
// Layout under /world (every value is a JSON string, so arrays/nulls survive Firebase untouched):
//   seed, live {now, rate, night}, core, agents/<id>, lists/<proposals|disputes|decisions>/b<block>,
//   logs/<kind>/n<10-digit seq>  (append-only, trimmed to a cap), events/<ms>_<i> (speech + milestones, ~2 min)
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const LOGS = { history: 300, feed: 120, engineLog: 60, transactions: 120, journal: 400, days: 100000 };
// keys get a letter prefix: all-number keys make Firebase turn objects into sparse arrays
const key10 = (n) => `n${String(n).padStart(10, '0')}`;
const BLOCK = 25; // long lists are written in blocks of 25, so a change rewrites one block, not the list

export async function createPublisher({ root, log }) {
  let config, credentials, admin;
  try { config = (await import(pathToFileURL(path.join(root, 'firebase-config.js')).href)).default; } catch { return null; }
  try { credentials = JSON.parse(await readFile(path.join(root, 'server', 'firebase-key.json'), 'utf8')); } catch {
    log('firebase: firebase-config.js found but server/firebase-key.json is missing - not publishing');
    return null;
  }
  try { admin = (await import('firebase-admin')).default; } catch { log('firebase: run `npm install` to publish'); return null; }

  const app = admin.initializeApp({ credential: admin.credential.cert(credentials), databaseURL: config.databaseURL });
  const world = admin.database(app).ref('world');
  const sent = new Map();                 // path -> JSON last written, so only real changes go out
  const written = Object.fromEntries(Object.keys(LOGS).map((k) => [k, []])); // log keys we've written, oldest first
  let lastSeq = 0, eventN = 0, failing = false;
  const fail = (e) => { if (!failing) log(`firebase: write failed (${e.message}) - will keep retrying`); failing = true; };
  const ok = () => { if (failing) log('firebase: writing again'); failing = false; };

  const logsOf = (S) => ({
    history: S.history, feed: S.feed, engineLog: S.engineLog, transactions: S.economy.transactions,
    journal: S.journal || [], days: S.days || [],
  });
  const liveInfo = (extra) => ({ now: Date.now(), ...extra });

  function chunks(S) {
    const { outbox, history, feed, engineLog, proposals, disputes, decisions, journal, days, agents, economy, ...core } = S;
    const out = { core: JSON.stringify({ ...core, economy: { ...economy, transactions: undefined } }) };
    for (const [id, a] of Object.entries(agents)) out[`agents/${id}`] = JSON.stringify(a);
    for (const [name, list] of Object.entries({ proposals, disputes, decisions: decisions || [] })) {
      if (!list.length) out[`lists/${name}/b0000`] = '[]';
      for (let i = 0; i < list.length; i += BLOCK) out[`lists/${name}/b${String(i / BLOCK).padStart(4, '0')}`] = JSON.stringify(list.slice(i, i + BLOCK));
    }
    return out;
  }

  // everything, from scratch: on start, and whenever the world was reset
  async function full(S, live) {
    const all = { seed: S.seed, live: liveInfo(live), events: null, logs: {} };
    sent.clear();
    for (const [p, v] of Object.entries(chunks(S))) { sent.set(p, v); setPath(all, p, v); }
    for (const [kind, list] of Object.entries(logsOf(S))) {
      const keep = list.slice(-LOGS[kind]).filter((x) => x.n);
      written[kind] = keep.map((x) => key10(x.n));
      all.logs[kind] = Object.fromEntries(keep.map((x) => [key10(x.n), JSON.stringify(x)]));
    }
    lastSeq = S.seq || 0;
    await world.set(all).then(ok, fail);
    log(`firebase: published the world to ${config.databaseURL}`);
  }
  const setPath = (obj, p, v) => { const parts = p.split('/'); let o = obj; while (parts.length > 1) { const k = parts.shift(); o = o[k] ??= {}; } o[parts[0]] = v; };

  return {
    full,
    // the world changed: send only the pieces that differ, plus any new log entries
    frame(S, live) {
      const upd = {};
      for (const [p, v] of Object.entries(chunks(S))) if (sent.get(p) !== v) { sent.set(p, v); upd[p] = v; }
      for (const [kind, list] of Object.entries(logsOf(S))) {
        for (const x of list) {
          if (!x.n || x.n <= lastSeq) continue;
          const k = key10(x.n);
          upd[`logs/${kind}/${k}`] = JSON.stringify(x);
          written[kind].push(k);
        }
        while (written[kind].length > LOGS[kind]) upd[`logs/${kind}/${written[kind].shift()}`] = null;
      }
      lastSeq = S.seq || lastSeq;
      upd.live = liveInfo(live);
      world.update(upd).then(ok, fail);
    },
    // speech bubbles and milestone banners, the moment they happen
    events(list) {
      if (!list.length) return;
      const t = Date.now();
      world.child(`events/${t}_${String(eventN++ % 1000).padStart(3, '0')}`).set(JSON.stringify(list)).then(ok, fail);
    },
    // tell visitors the experiment is paused (the next heartbeat after a resume clears it)
    pause() { return world.child('live').update({ paused: true, now: Date.now() }); },
    // a heartbeat so visitors can tell the server is up, and old events are cleared away
    async beat(live) {
      world.child('live').set(liveInfo(live)).then(ok, fail);
      try {
        const old = await world.child('events').orderByKey().endAt(`${Date.now() - 120000}_999`).get();
        if (old.exists()) { const rm = {}; old.forEach((c) => { rm[c.key] = null; }); await world.child('events').update(rm); }
      } catch (e) { fail(e); }
    },
  };
}
