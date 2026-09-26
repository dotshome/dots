// dot.home - the simulation engine. It owns reality.
//
//   WORLD STATE -> OBSERVATION -> REASONING -> VALID ACTIONS -> DECISION -> SIMULATION -> CONSEQUENCE -> MEMORY
//
// Agents can want anything (minds.js), but nothing happens unless this file says it is possible,
// pays for it, and resolves it. Everything is deterministic given the seed stored in the state.
import {
  TICK, DAY, DAWN, MEAL, RES, ACTIONS, BLUEPRINTS, POLICIES, BASE_PRICE,
  dayOf, hourOf, minuteOfDay, isNight, clockOf, pad, built, building, hasLaw, foodDays, agentList, nameOf, rand, pickR,
} from './catalog.js';
import * as mind from './minds.js';

export const AGENT_IDS = ['blue', 'green', 'yellow', 'pink'];
export const TREE_WOOD = 10;
export const TREES = 14;
export const BUSHES = 6;
export const BUSH_MAX = 6;
const STORAGE_CAP = 70;
const LIGHT_WORK = ['GATHER_WOOD', 'QUARRY_STONE', 'FORAGE_FOOD', 'FETCH_WATER', 'REST', 'TEND_FARM'];
const PREREQ = {
  well: 'requires 12 trips to the spring', workshop: 'requires a finished shared house', meeting_circle: 'requires a first vote',
  house: 'requires private property', market: 'requires a law allowing businesses', clinic: 'requires someone to have been hurt or sick',
  school: 'requires 6 lessons taught', courthouse: 'requires a court', watch_post: 'requires a warden', road: 'requires 120 trips',
  hospital: 'requires a clinic',
};
const POLICY_WHEN = {
  decide_rule: (s) => s.counters.objections >= 2,
  ration: (s) => foodDays(s) < 0.9 && dayOf(s) >= 3,
  property: (s, a) => s.economy.regime === 'communal' && dayOf(s) >= 5 && mind.gatherShare(s, a) >= 0.27 && mind.grievance(s) >= 1.15,
  currency: (s) => s.economy.regime !== 'communal' && s.counters.barter >= 3,
  market_land: (s) => !!s.economy.currency,
  court: (s) => s.counters.disputes >= 2,
  warden: (s) => s.counters.violations >= 2,
  coordinator: (s) => s.counters.votes >= 5 && s.counters.failedVotes >= 1,
  tax: (s) => !!s.economy.currency && s.economy.businesses.length >= 1 && s.counters.sales >= 4,
};

// ---------------------------------------------------------------- creation
function newAgent(id) {
  const I = mind.IDENTITIES[id];
  return {
    id, name: I.name,
    needs: { energy: 92, fed: 85, health: 100, mood: 72 },
    inv: { wood: 0, stone: 0, food: 0, water: 0, metal: 0, tools: 0 },
    know: { ...I.know }, xp: {}, xpTotal: 0,
    rel: Object.fromEntries(AGENT_IDS.filter((o) => o !== id).map((o) => [o, 55])),
    task: null, asleep: false, ailment: null, home: null, role: null,
    meals: 0, gathered: 0, consumed: 0, violations: 0,
    memories: [], trace: null, lastSocial: 0, aspired: 0,
  };
}

export function createWorld(seed = (Math.random() * 2 ** 31) | 0) {
  const s = {
    v: 1, seed, rng: seed, time: DAWN, acc: 0,
    stock: { wood: 12, stone: 6, food: 26, water: 18, metal: 0, tools: 0 },
    nodes: { trees: Array(TREES).fill(TREE_WOOD), quarry: 600, berries: Array(BUSHES).fill(BUSH_MAX), oreFound: false, ore: 160 },
    buildings: [], nextId: 1,
    agents: Object.fromEntries(AGENT_IDS.map((id) => [id, newAgent(id)])),
    proposals: [], laws: [], disputes: [],
    economy: { regime: 'communal', currency: null, ledger: {}, treasury: 0, tax: 0, transactions: [], businesses: [], prices: { ...BASE_PRICE } },
    counters: { votes: 0, failedVotes: 0, trips: 0, waterTrips: 0, lessons: 0, disputes: 0, violations: 0, ailments: 0, objections: 0, barter: 0, sales: 0, spoiled: 0, foodCrises: 0, projects: 0 },
    roles: { judge: null, warden: null, coordinator: null },
    peak: { food: 26 }, patrolUntil: 0, rationActive: false,
    problems: [], problemSeen: {}, history: [], milestones: {}, feed: [], engineLog: [],
    decisions: [], journal: [], days: [],
  };
  log(s, 'The four dots arrive on an empty plot of land.', 'milestone', AGENT_IDS);
  s.milestones.arrive = 1;
  for (const [id, text] of mind.talk.arrive()) say(s, id, text);
  return s;
}

// ---------------------------------------------------------------- outputs (history, speech, engine log)
function emit(s, ev) { (s.outbox ??= []).push(ev); }
export function drain(s) { const out = s.outbox || []; s.outbox = []; return out; }
// every appended record gets a sequence number, so a live server can stream "everything after n"
const seq = (s) => (s.seq = (s.seq || 0) + 1);
function log(s, text, kind = 'event', who = []) {
  const e = { n: seq(s), day: dayOf(s), clock: clockOf(s), text, kind, who };
  s.history.push(e);
  if (s.history.length > 800) s.history.splice(0, s.history.length - 800);
  emit(s, { type: 'history', e });
  return e;
}
function milestone(s, key, text, who = []) {
  if (s.milestones[key]) return false;
  s.milestones[key] = dayOf(s);
  log(s, text, 'milestone', who);
  return true;
}
function say(s, id, text) {
  if (!text) return;
  s.feed.push({ n: seq(s), day: dayOf(s), clock: clockOf(s), id, text });
  if (s.feed.length > 120) s.feed.shift();
  emit(s, { type: 'say', id, text });
}
const sayAll = (s, lines) => lines.forEach(([id, text]) => say(s, id, text));
function engineLog(s, text, ok = true) {
  s.engineLog.push({ n: seq(s), day: dayOf(s), clock: clockOf(s), text, ok });
  if (s.engineLog.length > 80) s.engineLog.shift();
  emit(s, { type: 'engine', text, ok });
}
function remember(s, a, text, w = 1) {
  a.memories.push({ day: dayOf(s), text, w });
  if (a.memories.length > 36) { // forget the least important old memory
    let k = 0;
    for (let i = 1; i < a.memories.length - 6; i++) if (a.memories[i].w < a.memories[k].w) k = i;
    a.memories.splice(k, 1);
  }
}
function relate(a, b, d) {
  if (!a || !b || a === b) return;
  a.rel[b.id] = Math.max(0, Math.min(100, (a.rel[b.id] ?? 50) + d));
}
const article = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
const sumCost = (c) => Object.values(c).reduce((x, y) => x + y, 0);
const costText = (c) => Object.entries(c).map(([k, v]) => `-${v} ${k}`).join(' ');
const afford = (src, cost) => Object.entries(cost).every(([k, v]) => (src[k] || 0) >= v);
const pay = (src, cost) => { for (const [k, v] of Object.entries(cost)) src[k] -= v; };
const toolsOf = (s, a) => a.inv.tools + s.stock.tools;
const skill = (a, xp) => 1 + Math.min(0.8, (a.xp[xp] || 0) / 25);
const lawNum = (s, kind) => pad(s.laws.find((l) => l.kind === kind)?.num ?? 0, 3);
export const openProposal = (s) => s.proposals.find((p) => p.status === 'open');

// gathered goods go to the shared stores, to the gatherer, or both - depending on the laws they made
function deposit(s, a, res, n) {
  a.gathered += n * (BASE_PRICE[res] ?? 1);
  const r = s.economy.regime;
  const keep = res === 'water' ? 0 : r === 'private' ? n : r === 'mixed' ? Math.ceil(n / 2) : 0;
  a.inv[res] += keep;
  s.stock[res] += n - keep;
  if (res === 'food') s.peak.food = Math.max(s.peak.food, s.stock.food);
  return keep;
}

// ---------------------------------------------------------------- the clock
// worlds saved by older versions of the engine get the newer fields
function migrate(s) {
  s.decisions ??= []; s.journal ??= []; s.days ??= [];
  for (const a of agentList(s)) a.today ??= {};
}

export function step(s, minutes) {
  migrate(s);
  s.acc += minutes;
  let guard = 0;
  while (s.acc >= TICK && guard++ < 5000) { s.acc -= TICK; tick(s); }
}
export const allAsleep = (s) => agentList(s).every((a) => a.asleep);

function tick(s) {
  s.time += TICK;
  const m = minuteOfDay(s);
  if (m === DAWN) dawn(s);
  if (m % 60 === 0) hourly(s);
  for (const a of agentList(s)) needs(s, a);
  for (const a of agentList(s)) if (a.task && s.time >= a.task.end) complete(s, a);
  const k = (s.time / TICK) % 4; // rotate who thinks first, so nobody always gets first pick
  for (let i = 0; i < 4; i++) { const a = s.agents[AGENT_IDS[(i + k) % 4]]; if (!a.task) think(s, a); }
  resolveProposals(s);
}

function needs(s, a) {
  const n = a.needs;
  n.fed = Math.max(0, n.fed - 0.6);
  if (!a.asleep) n.energy = Math.max(0, n.energy - 0.22);
  if (n.fed < 12) { n.health -= 0.3; n.mood -= 0.25; }
  if (a.ailment) n.health -= built(s, 'clinic') ? 0.04 : 0.1;
  else if (n.fed > 40 && n.health < 100) n.health += 0.08;
  n.mood += (62 - n.mood) * 0.004;
  for (const k of ['energy', 'fed', 'health', 'mood']) n[k] = Math.max(0, Math.min(100, n[k]));
}

function dawn(s) {
  const d = dayOf(s);
  chronicle(s, d - 1);
  log(s, `Day ${d} begins.`, 'day');
  // spoilage: without storage, food rots overnight; storage only holds so much
  if (s.stock.food > 8) {
    const stored = built(s, 'food_storage');
    const lost = Math.floor(stored ? Math.max(s.stock.food * 0.01, (s.stock.food - STORAGE_CAP) * 0.1) : s.stock.food * 0.08);
    if (lost > 0) {
      s.stock.food -= lost; s.counters.spoiled += lost;
      if (lost >= 2) log(s, stored ? `${lost} food spoils: the storage is over capacity.` : `${lost} food spoils overnight without storage.`, 'problem');
    }
  }
  s.nodes.berries = s.nodes.berries.map((b) => Math.min(BUSH_MAX, b + 2));
  s.nodes.trees = s.nodes.trees.map((t) => (t <= 0 ? (rand(s) < 0.35 ? 2 : 0) : Math.min(TREE_WOOD, t + 2)));
  for (const a of agentList(s)) a.meals = 0;
  worldEvents(s, d);
  s.rationActive = hasLaw(s, 'ration') && s.stock.food < 40;
  updatePrices(s);
}

// At dawn the day that just ended goes into the record: a chronicle entry with a resource
// snapshot, and a journal entry from each of the four, written in their own voice.
function chronicle(s, day) {
  if (day < 1) return;
  const prev = s.days[s.days.length - 1]?.stock ?? { wood: 12, stone: 6, food: 26, water: 18, metal: 0, tools: 0 };
  const today = s.history.filter((h) => h.day === day);
  const highlights = today.filter((h) => h.kind === 'milestone').map((h) => h.text);
  const votes = today.filter((h) => h.kind === 'vote' || (h.kind === 'milestone' && h.text.includes('first vote'))).length;
  const lines = s.feed.filter((f) => f.day === day).length;
  const delta = (k) => (s.stock[k] === prev[k] ? `${k} steady at ${s.stock[k]}` : `${k} ${prev[k]} → ${s.stock[k]}`);
  const text = [
    highlights.length ? `${highlights.length} milestone${highlights.length > 1 ? 's' : ''}.` : 'No milestones.',
    votes ? `${votes} vote${votes > 1 ? 's' : ''}.` : '',
    `${delta('food')}, ${delta('wood')}, ${delta('stone')}.`,
    lines ? `${lines} things said.` : '',
  ].filter(Boolean).join(' ');
  s.days.push({ n: seq(s), day, stock: { ...s.stock }, highlights, text });
  for (const a of agentList(s)) {
    const mems = a.memories.filter((m) => m.day === day);
    s.journal.push({ n: seq(s), day, id: a.id, text: mind.journalEntry(s, a, a.today || {}, mems) });
    a.today = {};
  }
  if (s.journal.length > 400) s.journal.splice(0, s.journal.length - 400);
}

// The world throws problems at them. How they respond is entirely up to them.
function worldEvents(s, d) {
  const r = rand(s);
  const farm = building(s, 'farm');
  if (d >= 6 && farm && r < 0.07) {
    farm.growth = 0;
    s.nodes.berries = s.nodes.berries.map((b) => Math.floor(b / 2));
    if (!milestone(s, 'blight', 'A blight hits the crops. The farm has to start over.')) log(s, 'A blight hits the crops again.', 'problem');
    emit(s, { type: 'weather', kind: 'blight' });
  } else if (d >= 4 && r < 0.15) {
    const lost = Math.floor(s.stock.wood * 0.3);
    s.stormUntil = s.time + 10 * 60;
    log(s, `A storm tears through the settlement overnight.${lost ? ` ${lost} wood is ruined.` : ''}`, 'problem');
    s.stock.wood -= lost;
    emit(s, { type: 'weather', kind: 'storm' });
  } else if (d >= 5 && r < 0.22) {
    s.droughtUntil = s.time + 2 * DAY;
    log(s, 'The spring runs low. A drought has begun.', 'problem');
    emit(s, { type: 'weather', kind: 'drought' });
  } else if (s.stock.food > 50 && r < 0.3) {
    const lost = Math.floor(s.stock.food * 0.4);
    s.stock.food -= lost;
    if (!milestone(s, 'pests', `Pests get into the food stores overnight. ${lost} food is lost.`)) log(s, `Pests again: ${lost} food lost.`, 'problem');
  }
  for (const a of agentList(s)) if (!a.ailment && rand(s) < (a.needs.fed < 30 ? 0.06 : 0.022)) ail(s, a, 'sick', 'with a fever');
}

function hourly(s) {
  // planned projects start as soon as the shared stores can pay for them
  for (const b of s.buildings) {
    if (b.status !== 'planned') continue;
    const B = BLUEPRINTS[b.bp];
    if (afford(s.stock, B.cost)) { pay(s.stock, B.cost); b.status = 'building'; log(s, `Materials are ready: construction of the ${B.name} begins.`, 'build'); emit(s, { type: 'site', b }); }
  }
  detectProblems(s);
  for (const a of agentList(s)) {
    const r = mind.roleOf(s, a);
    if (r && r !== a.role) {
      const first = !agentList(s).some((o) => o.role === r);
      a.role = r;
      if (first && !['Coordinator', 'Judge', 'Warden', 'Merchant'].includes(r)) log(s, `${a.name} has become the settlement's ${r}.`, 'role', [a.id]);
    }
  }
}

function updatePrices(s) {
  if (!s.economy.currency) return;
  for (const r of RES) {
    const supply = s.stock[r] + agentList(s).reduce((x, a) => x + a.inv[r], 0);
    s.economy.prices[r] = Math.round(BASE_PRICE[r] * Math.max(0.5, Math.min(3, 30 / (supply + 6))) * 10) / 10;
  }
}

function detectProblems(s) {
  const p = [];
  const h = hourOf(s), fd = foodDays(s);
  const sheltered = built(s, 'shared_house');
  if (!sheltered && h >= 15 && h < 22) p.push({ key: 'shelter', text: 'Night is approaching and there is no shelter.' });
  if (fd < 1.25) p.push({ key: 'food_critical', text: `Food is critical: ${s.stock.food} left.` });
  else if (fd < 2.5) p.push({ key: 'food_low', text: `Food supply is declining: ${s.stock.food} left.` });
  if (s.stock.water < 8) p.push({ key: 'water_low', text: `Water is running low: ${s.stock.water} left.` });
  if (s.time < (s.droughtUntil || 0)) p.push({ key: 'drought', text: 'Drought: the spring is running dry.' });
  if (s.stock.food > 24 && !built(s, 'food_storage')) p.push({ key: 'spoilage', text: 'Food is spoiling without storage.' });
  for (const a of agentList(s)) if (a.ailment) p.push({ key: 'ailing_' + a.id, text: `${a.name} is ${a.ailment}.` });
  if (s.disputes.some((d) => d.status === 'open')) p.push({ key: 'dispute', text: 'A dispute is unresolved.' });
  if (mind.knowledgeRisk(s)) p.push({ key: 'knowledge', text: 'Key knowledge lives in only one resident.' });
  if (s.counters.objections >= 2 && !hasLaw(s, 'decide_rule')) p.push({ key: 'governance', text: 'There is no agreed way to decide on shared resources.' });
  for (const x of p) {
    const seen = s.problemSeen[x.key];
    if (seen && s.time - seen < DAY) continue;
    if (!s.problems.some((q) => q.key === x.key)) {
      if (x.key === 'food_critical') {
        s.counters.foodCrises++;
        if (!milestone(s, 'food_crisis', 'Food reserves fall below 20%.')) log(s, x.text, 'problem');
        sayAll(s, mind.talk.foodWorry(s));
      } else if (x.key === 'shelter') {
        log(s, x.text, 'problem');
        sayAll(s, mind.talk.shelterWorry(s));
      } else if (!x.key.startsWith('ailing_')) log(s, x.text, 'problem');
    }
    s.problemSeen[x.key] = s.time;
  }
  s.problems = p;
}

// ---------------------------------------------------------------- observe -> reason -> valid actions -> decide
export function observe(s, a) {
  const house = s.buildings.find((b) => b.bp === 'shared_house');
  return {
    agent: a.id,
    world_state: {
      day: dayOf(s), time: clockOf(s), population: 4,
      food: s.stock.food, wood: s.stock.wood, stone: s.stock.stone, water: s.stock.water,
      shelter_completion: house ? +(house.status === 'done' ? 1 : house.progress).toFixed(2) : 0,
    },
    personal_state: { energy: Math.round(a.needs.energy), fed: Math.round(a.needs.fed), health: Math.round(a.needs.health), role: a.role },
    problems: s.problems.map((p) => p.key),
  };
}

// what the world can support for this agent right now: the constrained answer set
export function requirements(s, a, bp) {
  const B = BLUEPRINTS[bp];
  if (B.repeat ? s.buildings.some((b) => b.bp === bp && b.owner === a.id) : s.buildings.some((b) => b.bp === bp)) return { ok: false, silent: true, reasons: ['already exists'] };
  const reasons = [];
  if (B.when && !B.when(s)) reasons.push(PREREQ[bp] || 'not possible yet');
  if (B.know && (a.know[B.know[0]] || 0) < B.know[1]) reasons.push(`${B.know[0]} knowledge ${(a.know[B.know[0]] || 0).toFixed(2)}/${B.know[1]}`);
  const src = B.private ? a.inv : s.stock;
  for (const [k, v] of Object.entries(B.cost)) if ((src[k] || 0) < v) reasons.push(`insufficient ${k}: ${src[k] || 0}/${v}`);
  if (!B.private && s.buildings.filter((b) => b.status !== 'done' && !b.owner).length >= 2) reasons.push('two shared projects already underway');
  return { ok: !reasons.length, needsVote: !B.private && hasLaw(s, 'decide_rule'), reasons };
}

function interruptible(s, o) {
  return !o.asleep && !o.task?.partner && (!o.task || LIGHT_WORK.includes(o.task.type));
}

function canRepropose(s, kind, bp) {
  const last = [...s.proposals].reverse().find((p) => p.kind === kind && p.bp === bp);
  return !last || (last.status === 'failed' && s.time - last.closed > 2 * DAY);
}

function tradeFor(s, a, partners) {
  if (s.economy.regime === 'communal') return null;
  const wants = [];
  if (a.needs.fed < 55 && a.inv.food < MEAL.food && s.stock.food < 12) wants.push('food');
  if (!a.home && !s.buildings.some((b) => b.bp === 'house' && b.owner === a.id)) {
    for (const r of ['wood', 'stone']) if (a.inv[r] < BLUEPRINTS.house.cost[r]) wants.push(r);
  }
  if (hasLaw(s, 'market_land') && a.id === s.proposals.find((p) => p.kind === 'market_land' && p.status === 'passed')?.by
    && !s.buildings.some((b) => b.bp === 'market') && a.inv.wood < BLUEPRINTS.market.cost.wood) wants.push('wood');
  if (s.nodes.oreFound && toolsOf(s, a) === 0 && (a.xp.mine || a.id === 'green')) wants.push('tools');
  for (const get of wants) {
    for (const o of partners) {
      const spare = o.inv[get] - (get === 'tools' ? 0 : 3);
      if (spare < (get === 'tools' ? 1 : 3)) continue;
      const shortfall = get === 'food' ? 6 : get === 'tools' ? 1 : (BLUEPRINTS.house.cost[get] || 4) - a.inv[get];
      const getAmt = Math.max(1, Math.min(shortfall, spare, 8));
      if (s.economy.currency) {
        const price = Math.ceil(getAmt * s.economy.prices[get]);
        if ((s.economy.ledger[a.id] || 0) >= price) return { partner: o.id, get, getAmt, pay: price };
      } else {
        const give = RES.filter((r) => r !== get && r !== 'water' && a.inv[r] - (BLUEPRINTS.house.cost[r] || 0) >= 4)
          .sort((x, y) => a.inv[y] * BASE_PRICE[y] - a.inv[x] * BASE_PRICE[x])[0];
        if (!give) continue;
        const giveAmt = Math.ceil(getAmt * BASE_PRICE[get] / BASE_PRICE[give]);
        if (a.inv[give] >= giveAmt) return { partner: o.id, get, getAmt, give, giveAmt };
      }
    }
  }
  return null;
}

export function validActions(s, a) {
  const out = [];
  const add = (type, extra = {}) => out.push({ type, code: type, ...extra });
  const h = hourOf(s), n = a.needs;
  if (isNight(s) || h >= 21 || n.energy < 8) { add('SLEEP'); if (isNight(s)) return out; }
  const others = agentList(s).filter((o) => o !== a);
  // eating: a hungry resident past the ration might break the law - but only when desperate
  const fromStock = s.stock.food >= MEAL.food && !(s.rationActive && a.meals >= 2 && !(n.fed < 22 && (mind.IDENTITIES[a.id].risk > 0.5 || n.fed < 10)));
  const desperate = s.economy.regime !== 'communal' && n.fed < 25 && others.some((o) => o.inv.food >= 4);
  if (n.fed < 78 && (a.inv.food >= MEAL.food || fromStock || desperate)) add('EAT');
  if (n.energy < 65 || a.ailment) add('REST');
  const free = others.filter((o) => interruptible(s, o));
  if (free.length && s.time - a.lastSocial > 180) {
    const o = free.sort((x, y) => (a.rel[y.id] ?? 50) - (a.rel[x.id] ?? 50) + (rand(s) - 0.5) * 30)[0];
    add('SOCIALIZE', { target: o.id, code: `TALK_TO_${o.name.toUpperCase()}` });
  }
  if (!a.ailment) {
    if (s.nodes.trees.some((t) => t > 0)) add('GATHER_WOOD');
    if (s.nodes.quarry > 0) add('QUARRY_STONE');
    if (s.nodes.berries.reduce((x, y) => x + y, 0) >= 2) add('FORAGE_FOOD');
    add('FETCH_WATER');
    if (built(s, 'farm')) add('TEND_FARM');
    if (s.nodes.oreFound && s.nodes.ore > 0 && toolsOf(s, a) >= 1) add('MINE_ORE');
    if (h < 15 && n.energy > 45) add('SCOUT');
    for (const b of s.buildings) {
      if (b.status === 'building' && (!b.owner || b.owner === a.id)) add('CONTINUE', { target: b.id, bp: b.bp, code: `CONTINUE_${b.bp.toUpperCase()}`, urgent: b.bp === 'shared_house' && h >= 13 });
    }
    for (const bp of Object.keys(BLUEPRINTS)) {
      const r = requirements(s, a, bp);
      if (!r.ok) continue;
      if (r.needsVote) { if (!openProposal(s) && canRepropose(s, 'build', bp)) add('PROPOSE', { kind: 'build', bp, code: `PROPOSE_${bp.toUpperCase()}` }); }
      else add('START', { bp, code: `START_${bp.toUpperCase()}` });
    }
    const src = s.economy.regime === 'communal' ? s.stock : a.inv;
    if (built(s, 'workshop') && afford(src, { wood: 3, stone: 2 })) add('CRAFT_TOOLS');
  }
  if (!openProposal(s)) {
    for (const [kind, when] of Object.entries(POLICY_WHEN)) {
      if (!hasLaw(s, kind) && canRepropose(s, kind) && when(s, a)) add('PROPOSE', { kind, code: `PROPOSE_${kind.toUpperCase()}` });
    }
  }
  const patient = others.find((o) => o.ailment && !others.some((x) => x.task?.type === 'CARE' && x.task.target === o.id));
  if (patient && !a.ailment) add('CARE', { target: patient.id, code: `CARE_FOR_${patient.name.toUpperCase()}` });
  for (const f of ['building', 'farming', 'medicine', 'tools', 'mining']) {
    if ((a.know[f] || 0) < 0.5) continue;
    const st = free.find((o) => (o.know[f] || 0) < 0.35);
    if (st) { add('TEACH', { target: st.id, field: f, code: `TEACH_${f.toUpperCase()}` }); break; }
  }
  const deal = tradeFor(s, a, free);
  if (deal) add('TRADE', { target: deal.partner, data: deal, code: `TRADE_WITH_${nameOf(s, deal.partner).toUpperCase()}` });
  if (s.buildings.some((b) => b.bp === 'market' && b.owner === a.id && b.status === 'done')) add('RUN_SHOP');
  const dispute = s.disputes.find((d) => d.status === 'open' && d.plaintiff !== a.id && d.defendant !== a.id);
  if (dispute && (!s.roles.judge || s.roles.judge === a.id)) add('MEDIATE', { target: dispute.id, code: s.roles.judge === a.id ? 'HOLD_COURT' : 'MEDIATE' });
  if (s.roles.warden === a.id && built(s, 'watch_post')) add('PATROL');
  return out;
}

function think(s, a) {
  if (a.asleep) return;
  vote(s, a);
  // 1. the reasoning layer sometimes reaches for something the world can't support yet; the engine refuses it
  if (a.aspired !== dayOf(s) && dayOf(s) >= 2 && !isNight(s) && rand(s) < 0.06) {
    a.aspired = dayOf(s);
    const bp = mind.aspiration(s, a);
    const r = bp && requirements(s, a, bp);
    if (r && !r.ok && !r.silent) {
      engineLog(s, `ACTION_REJECTED  ${a.name} → START_${bp.toUpperCase()}: ${r.reasons.join('; ')}`, false);
      a.rejected = { day: dayOf(s), clock: clockOf(s), code: `START_${bp.toUpperCase()}`, reasons: r.reasons, cost: BLUEPRINTS[bp].cost };
      remember(s, a, `Wanted to build ${article(BLUEPRINTS[bp].name)} ${BLUEPRINTS[bp].name}, but the world said no (${r.reasons[0]}).`, 1);
    }
  }
  // 2. the engine lists what is actually possible; 3. the decision layer picks one of those
  const valid = validActions(s, a);
  if (!valid.length) valid.push({ type: 'REST', code: 'REST' });
  const { choice, ranked } = mind.decide(s, a, valid);
  a.trace = {
    day: dayOf(s), clock: clockOf(s),
    observation: observe(s, a),
    reasoning: mind.explain(s, a, choice),
    options: ranked.slice(0, 4).map((r) => ({ code: r.act.code, u: +r.u.toFixed(2) })),
    decision: choice.code, result: null,
  };
  begin(s, a, choice);
}

// ---------------------------------------------------------------- simulation: begin + complete
function begin(s, a, act) {
  const A = ACTIONS[act.type];
  let hours = A.hours;
  const t = { type: act.type, code: act.code, bp: act.bp, target: act.target, kind: act.kind, field: act.field, data: act.data, zone: A.zone, start: s.time, end: 0 };
  switch (act.type) {
    case 'SLEEP': {
      a.asleep = true;
      const m = minuteOfDay(s);
      t.end = s.time + (m < DAWN ? DAWN - m : DAY - m + DAWN);
      t.bed = a.home ? 'home' : built(s, 'shared_house') ? 'house' : built(s, 'campfire') ? 'fire' : 'ground';
      break;
    }
    case 'START': t.target = startProject(s, a, act.bp); break;
    case 'PROPOSE': t.target = propose(s, a, act.kind, act.bp); break;
    case 'FETCH_WATER': if (built(s, 'well')) { hours = 0.5; t.zone = 'well'; } break;
    case 'SOCIALIZE': {
      const o = s.agents[act.target];
      pull(s, a, o, 'SOCIALIZE', hours);
      a.lastSocial = o.lastSocial = s.time;
      t.argument = (a.rel[o.id] ?? 50) < 36;
      sayAll(s, mind.talk.chat(s, a, o));
      break;
    }
    case 'TEACH': { const o = s.agents[act.target]; pull(s, a, o, 'TEACH', hours); sayAll(s, mind.talk.teach(s, a, o, act.field)); break; }
    case 'CARE': sayAll(s, mind.talk.care(s, a, s.agents[act.target])); break;
    case 'TRADE': { const o = s.agents[act.target]; pull(s, a, o, 'TRADE', hours); sayAll(s, mind.talk.trade(s, a, o, act.data)); break; }
    case 'MEDIATE': { const d = s.disputes.find((x) => x.id === act.target); if (d) sayAll(s, mind.talk.mediate(s, a, d)); break; }
    case 'RUN_SHOP': if (rand(s) < 0.4) sayAll(s, mind.talk.shop(s, a)); break;
  }
  if (!t.end) t.end = s.time + Math.max(1, Math.round(hours * 60 / TICK)) * TICK;
  a.task = t;
  emit(s, { type: 'act', id: a.id, task: t });
}

// the partner drops whatever light work they were doing to join in
function pull(s, a, o, type, hours) {
  o.task = { type, code: type, target: a.id, zone: 'partner', partner: true, start: s.time, end: s.time + Math.max(1, Math.round(hours * 60 / TICK)) * TICK };
  emit(s, { type: 'act', id: o.id, task: o.task });
}

function ail(s, a, kind, where) {
  if (a.ailment) return;
  a.ailment = kind;
  a.needs.health = Math.max(5, a.needs.health - (kind === 'injured' ? 28 : 15));
  s.counters.ailments++;
  const helper = pickR(s, agentList(s).filter((o) => o !== a));
  if (!milestone(s, 'first_ailment', `${a.name} is ${kind} ${where}: the settlement's first medical emergency.`, [a.id])) log(s, `${a.name} is ${kind} ${where}.`, 'event', [a.id]);
  sayAll(s, mind.talk.injured(s, a, kind, helper));
  remember(s, a, `Got ${kind} ${where}.`, 2);
}

function complete(s, a) {
  const t = a.task;
  a.task = null;
  const A = ACTIONS[t.type];
  a.needs.energy = Math.max(0, Math.min(100, a.needs.energy - A.energy));
  if (A.xp && !t.partner) { a.xp[A.xp] = (a.xp[A.xp] || 0) + 1; a.xpTotal++; }
  a.today = a.today || {};
  const did = t.type === 'TEACH' && t.partner ? 'LEARN' : t.type;
  a.today[did] = (a.today[did] || 0) + 1;
  const mult = skill(a, A.xp);
  const tools = toolsOf(s, a) > 0 ? 1.35 : 1;
  const growKnow = (f, d) => { a.know[f] = Math.min(1, (a.know[f] || 0) + d); };
  let res = '';
  switch (t.type) {
    case 'GATHER_WOOD': {
      let want = Math.round(5 * mult * tools), got = 0;
      for (let i = 0; i < s.nodes.trees.length && got < want; i++) {
        const take = Math.min(s.nodes.trees[i], want - got);
        s.nodes.trees[i] -= take; got += take;
      }
      const kept = deposit(s, a, 'wood', got);
      s.counters.trips++;
      res = `+${got} wood${kept ? ` (${kept} kept)` : ''}. Stores: ${s.stock.wood} wood.`;
      break;
    }
    case 'QUARRY_STONE': {
      const got = Math.min(s.nodes.quarry, Math.round(4 * mult * tools));
      s.nodes.quarry -= got;
      const kept = deposit(s, a, 'stone', got);
      s.counters.trips++;
      res = `+${got} stone${kept ? ` (${kept} kept)` : ''}. Stores: ${s.stock.stone} stone.`;
      if (rand(s) < A.risk * (1.3 - Math.min(1, (a.xp.stone || 0) / 20)) * (0.6 + mind.IDENTITIES[a.id].risk)) { ail(s, a, 'injured', 'at the quarry'); res += ' Injured!'; }
      break;
    }
    case 'FORAGE_FOOD': {
      let want = Math.round(5 * mult), got = 0;
      for (let i = 0; i < s.nodes.berries.length && got < want; i++) {
        const take = Math.min(s.nodes.berries[i], want - got);
        s.nodes.berries[i] -= take; got += take;
      }
      const kept = deposit(s, a, 'food', got);
      const before = a.know.farming || 0;
      growKnow('farming', 0.035);
      if (before < 0.3 && a.know.farming >= 0.3) log(s, `${a.name} works out how the seeds in the crate could be grown.`, 'event', [a.id]);
      s.counters.trips++;
      res = `+${got} food${kept ? ` (${kept} kept)` : ''}. Stores: ${s.stock.food} food.`;
      break;
    }
    case 'FETCH_WATER': {
      const dry = s.time < (s.droughtUntil || 0);
      const got = built(s, 'well') ? (dry ? 7 : 10) : dry ? 3 : 8;
      s.stock.water += got;
      s.counters.trips++;
      if (!built(s, 'well')) s.counters.waterTrips++;
      res = `+${got} water. Stores: ${s.stock.water}.`;
      break;
    }
    case 'TEND_FARM': {
      const farm = building(s, 'farm');
      if (!farm) break;
      const before = farm.growth || 0;
      // crops grow with time as well as care: tending again right away does little
      const fresh = Math.min(1, (s.time - (farm.tended || 0)) / (5 * 60));
      farm.tended = s.time;
      farm.growth = before + 0.22 * mult * (0.25 + 0.75 * fresh);
      growKnow('farming', 0.04);
      res = `Farm growth ${Math.round(before * 100)}% → ${Math.round(Math.min(1, farm.growth) * 100)}%.`;
      if (farm.growth >= 1) {
        farm.growth -= 1;
        const got = Math.round(12 * (0.8 + (a.know.farming || 0) * 0.3));
        deposit(s, a, 'food', got);
        res += ` Harvest: +${got} food.`;
        if (!milestone(s, 'first_harvest', `${a.name} brings in the first harvest: ${got} food.`, [a.id])) engineLog(s, `${a.name} harvests ${got} food.`);
      }
      break;
    }
    case 'MINE_ORE': {
      const got = Math.min(s.nodes.ore, Math.round(2 * mult));
      s.nodes.ore -= got;
      const kept = deposit(s, a, 'metal', got);
      growKnow('mining', 0.05);
      if (rand(s) < 0.15) { if (a.inv.tools > 0) a.inv.tools--; else if (s.stock.tools > 0) s.stock.tools--; res += 'A tool breaks. '; }
      res += `+${got} metal${kept ? ` (${kept} kept)` : ''}.`;
      if (rand(s) < A.risk * (0.6 + mind.IDENTITIES[a.id].risk)) { ail(s, a, 'injured', 'in the mine'); res += ' Injured!'; }
      break;
    }
    case 'SCOUT': {
      if (!s.nodes.oreFound && rand(s) < 0.4) {
        s.nodes.oreFound = true;
        milestone(s, 'ore', `${a.name} discovers an ore vein in the western cliffs.`, [a.id]);
        sayAll(s, mind.talk.discover(s, a));
        emit(s, { type: 'discover' });
        res = 'Discovered an ore vein!';
      } else if (s.nodes.trees.filter((t) => t <= 0).length >= 3 && rand(s) < 0.5) {
        let n = 0;
        s.nodes.trees = s.nodes.trees.map((t) => (t <= 0 && n++ < 3 ? TREE_WOOD : t));
        log(s, `${a.name} finds a stand of young trees past the ridge.`, 'event', [a.id]);
        res = 'Found new trees.';
      } else if (rand(s) < 0.5) {
        const got = 4 + Math.floor(rand(s) * 4);
        deposit(s, a, 'food', got);
        res = `Found wild berries: +${got} food.`;
      } else res = 'Found nothing but a great view.';
      if (rand(s) < A.risk * (0.6 + mind.IDENTITIES[a.id].risk)) { ail(s, a, 'injured', 'while scouting the cliffs'); res += ' Injured!'; }
      break;
    }
    case 'START': {
      const b = s.buildings.find((x) => x.id === t.target);
      res = b?.status === 'planned' ? `${BLUEPRINTS[t.bp].name} planned; waiting for materials.` : `Site laid out for the ${BLUEPRINTS[t.bp].name}. Cost: ${costText(BLUEPRINTS[t.bp].cost)}.`;
      growKnow('building', 0.01);
      break;
    }
    case 'CONTINUE': {
      const b = s.buildings.find((x) => x.id === t.target);
      if (!b || b.status !== 'building') { res = 'Nothing left to build.'; break; }
      const B = BLUEPRINTS[b.bp], before = b.progress;
      b.labor += 2 * mult * (0.8 + (a.know.building || 0) * 0.5);
      b.progress = Math.min(1, b.labor / B.labor);
      growKnow('building', 0.02);
      res = `${B.name}: ${Math.round(before * 100)}% → ${Math.round(b.progress * 100)}%.`;
      if (s.economy.currency && !b.owner && s.economy.treasury >= 3) {
        s.economy.treasury -= 3; s.economy.ledger[a.id] = (s.economy.ledger[a.id] || 0) + 3;
        txn(s, 'treasury', a.id, 3, `wages for the ${B.name}`);
        res += ' Paid 3 dots in wages.';
      }
      if (b.progress >= 1) finish(s, b, a);
      emit(s, { type: 'progress', b });
      break;
    }
    case 'CRAFT_TOOLS': {
      const src = s.economy.regime === 'communal' ? s.stock : a.inv;
      if (!afford(src, { wood: 3, stone: 2 })) { res = 'Not enough materials.'; break; }
      pay(src, { wood: 3, stone: 2 });
      let made = 1;
      if (src.metal >= 1) { src.metal--; made = 2; }
      src.tools += made;
      growKnow('tools', 0.06);
      milestone(s, 'first_tools', `${a.name} crafts the settlement's first tools.`, [a.id]);
      res = `+${made} tools.`;
      break;
    }
    case 'PROPOSE': res = 'Proposal on the table.'; break;
    case 'MEDIATE': res = mediate(s, a, t.target); break;
    case 'PATROL': s.patrolUntil = s.time + 6 * 60; res = 'Kept watch. All quiet.'; break;
    case 'SOCIALIZE': {
      const o = s.agents[t.target];
      if (!o) break;
      const argued = (a.rel[o.id] ?? 50) < 36;
      if (t.partner) break; // the initiator resolves the conversation
      if (argued) {
        relate(a, o, -5); relate(o, a, -5);
        a.needs.mood -= 6; o.needs.mood -= 6;
        log(s, `${a.name} and ${o.name} argue.`, 'event', [a.id, o.id]);
        remember(s, a, `Argued with ${o.name}.`, 2); remember(s, o, `${a.name} picked a fight with me.`, 2);
        res = 'It turned into an argument.';
      } else {
        relate(a, o, 4); relate(o, a, 4);
        a.needs.mood = Math.min(100, a.needs.mood + 8); o.needs.mood = Math.min(100, o.needs.mood + 8);
        res = `Good talk. Trust with ${o.name}: ${a.rel[o.id]}.`;
      }
      break;
    }
    case 'TEACH': {
      if (t.partner) break;
      const o = s.agents[t.target];
      const gain = built(s, 'school') ? 0.25 : 0.15;
      o.know[t.field] = Math.min(1, (o.know[t.field] || 0) + gain);
      s.counters.lessons++;
      relate(a, o, 3); relate(o, a, 4);
      milestone(s, 'first_lesson', `${a.name} teaches ${o.name} ${t.field}: the first lesson.`, [a.id, o.id]);
      remember(s, o, `${a.name} taught me ${t.field}.`, 1.5);
      res = `${o.name}'s ${t.field}: ${(o.know[t.field] - gain).toFixed(2)} → ${o.know[t.field].toFixed(2)}.`;
      break;
    }
    case 'CARE': {
      const p = s.agents[t.target];
      if (!p) break;
      p.needs.health = Math.min(100, p.needs.health + (built(s, 'hospital') ? 50 : built(s, 'clinic') ? 35 : 22));
      growKnow('medicine', 0.12);
      relate(p, a, 9); relate(a, p, 4);
      milestone(s, 'first_care', `${a.name} cares for ${p.name}: the first act of medicine.`, [a.id, p.id]);
      remember(s, p, `${a.name} took care of me when I was ${p.ailment}.`, 3);
      if (p.ailment && (p.needs.health >= 70 || rand(s) < 0.4)) { log(s, `${p.name} recovers.`, 'event', [p.id]); p.ailment = null; }
      res = `${p.name}'s health: ${Math.round(p.needs.health)}.`;
      break;
    }
    case 'TRADE': if (!t.partner) res = trade(s, a, t.data); break;
    case 'RUN_SHOP': res = runShop(s, a); break;
    case 'EAT': res = eat(s, a); break;
    case 'REST': {
      if (a.ailment && rand(s) < 0.18) { log(s, `${a.name} recovers.`, 'event', [a.id]); a.ailment = null; }
      res = `Energy ${Math.round(a.needs.energy)}.`;
      break;
    }
    case 'SLEEP': {
      a.asleep = false;
      const gain = { home: 75, house: 70, fire: 52, ground: 42 }[t.bed] ?? 42;
      a.needs.energy = Math.min(100, a.needs.energy + gain);
      a.needs.mood += t.bed === 'ground' ? -8 : t.bed === 'fire' ? -1 : 6;
      if (t.bed === 'ground' && rand(s) < 0.12) ail(s, a, 'sick', 'after a cold night outside');
      res = `Slept (${t.bed}). Energy ${Math.round(a.needs.energy)}.`;
      break;
    }
  }
  if (a.trace && a.trace.decision === t.code && !a.trace.result) a.trace.result = res;
  if (!t.partner && res && !['SLEEP', 'EAT', 'REST'].includes(t.type)) engineLog(s, `${a.name} ${t.code}: ${res}`);
  emit(s, { type: 'done', id: a.id, task: t, res });
}

function eat(s, a) {
  let src = a.inv.food >= MEAL.food ? a.inv : s.stock.food >= MEAL.food ? s.stock : null;
  if (!src && s.economy.regime !== 'communal' && a.needs.fed < 25 && theft(s, a)) src = a.inv;
  if (!src) return 'Nothing to eat.';
  if (src === s.stock) {
    if (s.rationActive && a.meals >= 2) violation(s, a);
    a.meals++;
  }
  src.food -= MEAL.food;
  a.consumed += MEAL.food;
  if (s.stock.water >= MEAL.water) s.stock.water -= MEAL.water;
  else { a.needs.mood -= 4; a.needs.health -= 2; }
  const before = a.needs.fed;
  a.needs.fed = Math.min(100, a.needs.fed + (built(s, 'campfire') ? 46 : 40));
  return `Fed ${Math.round(before)} → ${Math.round(a.needs.fed)}.`;
}

// once things can be owned, they can be stolen: a starving resident with nothing takes from someone who has plenty
function theft(s, a) {
  const victim = agentList(s).filter((o) => o !== a && o.inv.food >= 4).sort((x, y) => y.inv.food - x.inv.food)[0];
  if (!victim) return null;
  victim.inv.food -= MEAL.food;
  a.inv.food += MEAL.food;
  s.counters.violations++;
  a.violations++;
  if (!milestone(s, 'first_theft', `${a.name} takes food from ${victim.name}'s stores: the first theft.`, [a.id, victim.id])) log(s, `${a.name} takes food from ${victim.name}.`, 'event', [a.id, victim.id]);
  say(s, a.id, 'I had nothing left. I\'m sorry.');
  say(s, victim.id, `${a.name}! That was mine!`);
  remember(s, victim, `${a.name} stole food from me.`, 3);
  openDispute(s, victim, a, `took ${MEAL.food} food without asking`, { res: 'food', amt: MEAL.food + 2 });
  return victim;
}

function violation(s, a) {
  s.counters.violations++;
  a.violations++;
  const law = lawNum(s, 'ration');
  const watched = s.roles.warden && s.roles.warden !== a.id && (s.time < s.patrolUntil || rand(s) < 0.5);
  const witness = watched ? s.agents[s.roles.warden] : agentList(s).filter((o) => o !== a).sort((x, y) => mind.IDENTITIES[y.id].w.gov - mind.IDENTITIES[x.id].w.gov)[0];
  if (!milestone(s, 'first_violation', `${a.name} takes a third ration from the shared stores: the first law is broken (Law ${law}).`, [a.id])) {
    log(s, `${a.name} breaks Law ${law}, taking an extra ration.`, 'event', [a.id]);
  }
  sayAll(s, mind.talk.violation(s, a, witness));
  relate(witness, a, -6);
  remember(s, a, `Broke the ration law because I was starving.`, 2);
  if (watched && s.economy.currency) {
    const fine = Math.min(10, s.economy.ledger[a.id] || 0);
    s.economy.ledger[a.id] -= fine; s.economy.treasury += fine;
    txn(s, a.id, 'treasury', fine, `fine for breaking Law ${law}`);
    log(s, `Warden ${witness.name} fines ${a.name} ${fine} dots.`, 'law', [witness.id, a.id]);
  } else {
    openDispute(s, witness, a, `broke Law ${law} (took an extra ration)`, { res: 'food', amt: 4 });
  }
}

function openDispute(s, plaintiff, defendant, about, data) {
  const d = { id: s.nextId++, num: s.disputes.length + 1, plaintiff: plaintiff.id, defendant: defendant.id, about, data, day: dayOf(s), status: 'open' };
  s.disputes.push(d);
  s.counters.disputes++;
  relate(plaintiff, defendant, -5);
  if (!milestone(s, 'first_dispute', `${plaintiff.name} and ${defendant.name} enter the first dispute: ${defendant.name} ${about}.`, [plaintiff.id, defendant.id])) {
    log(s, `Dispute #${pad(d.num, 3)}: ${plaintiff.name} vs ${defendant.name}. ${defendant.name} ${about}.`, 'dispute', [plaintiff.id, defendant.id]);
  }
  remember(s, plaintiff, `${defendant.name} ${about}.`, 2);
  remember(s, defendant, `${plaintiff.name} filed a dispute against me.`, 2);
}

function mediate(s, m, id) {
  const d = s.disputes.find((x) => x.id === id);
  if (!d || d.status !== 'open') return 'Already resolved.';
  const p = s.agents[d.plaintiff], df = s.agents[d.defendant];
  const court = s.roles.judge === m.id;
  let ruling = 'a warning';
  if (d.data) {
    const { res, amt } = d.data;
    const give = Math.min(amt, df.inv[res]);
    if (give > 0) { df.inv[res] -= give; p.inv[res] += give; ruling = `return ${give} ${res}`; }
    else if (s.economy.currency && (s.economy.ledger[df.id] || 0) > 0) {
      const fine = Math.min(8, s.economy.ledger[df.id]);
      s.economy.ledger[df.id] -= fine; s.economy.ledger[p.id] = (s.economy.ledger[p.id] || 0) + fine;
      txn(s, df.id, p.id, fine, `restitution, dispute #${pad(d.num, 3)}`);
      ruling = `pay ${fine} dots`;
    } else ruling = 'a day of shared work';
  }
  d.status = 'resolved'; d.ruling = ruling; d.by = m.id; d.closed = dayOf(s);
  relate(p, df, 6); relate(df, p, 4); relate(p, m, 4); relate(df, m, 2);
  const text = court
    ? `The court rules on dispute #${pad(d.num, 3)}: ${df.name} must ${ruling.startsWith('a ') ? 'accept ' + ruling : ruling}.`
    : `${m.name} mediates between ${p.name} and ${df.name}: ${ruling}.`;
  if (!milestone(s, court ? 'first_ruling' : 'first_mediation', text, [m.id, p.id, df.id])) log(s, text, court ? 'law' : 'event', [m.id, p.id, df.id]);
  return `Resolved: ${ruling}.`;
}

function txn(s, from, to, amount, what) {
  s.economy.transactions.push({ n: seq(s), day: dayOf(s), clock: clockOf(s), from, to, amount, what });
  if (s.economy.transactions.length > 120) s.economy.transactions.shift();
}

function trade(s, a, d) {
  const o = s.agents[d.partner];
  if (!o) return 'Trade fell through.';
  const has = d.pay ? (s.economy.ledger[a.id] || 0) >= d.pay : a.inv[d.give] >= d.giveAmt;
  if (!has || o.inv[d.get] < d.getAmt) return 'Trade fell through.';
  // a hungry or distrustful partner might take the goods and not deliver
  const renege = rand(s) < 0.2 * (1.2 - (o.rel[a.id] ?? 50) / 100) + (d.get === 'food' && o.needs.fed < 30 ? 0.25 : 0);
  if (d.pay) { s.economy.ledger[a.id] -= d.pay; s.economy.ledger[o.id] = (s.economy.ledger[o.id] || 0) + d.pay; }
  else { a.inv[d.give] -= d.giveAmt; o.inv[d.give] += d.giveAmt; }
  if (renege) {
    sayAll(s, mind.talk.renege(s, a, o, d));
    openDispute(s, a, o, `never delivered ${d.getAmt} ${d.get}`, { res: d.get, amt: d.getAmt });
    return `${o.name} took the payment and never delivered.`;
  }
  o.inv[d.get] -= d.getAmt; a.inv[d.get] += d.getAmt;
  relate(a, o, 3); relate(o, a, 3);
  const what = d.pay ? `${d.getAmt} ${d.get} for ${d.pay} dots` : `${d.giveAmt} ${d.give} ↔ ${d.getAmt} ${d.get}`;
  if (d.pay) txn(s, a.id, o.id, d.pay, `${d.getAmt} ${d.get}`);
  else { s.counters.barter++; txn(s, a.id, o.id, 0, `barter: ${what}`); }
  if (!milestone(s, 'first_trade', `${a.name} and ${o.name} make the first trade: ${what}.`, [a.id, o.id])) engineLog(s, `TRADE ${a.name} ↔ ${o.name}: ${what}`);
  return `Traded ${what}.`;
}

function runShop(s, a) {
  // the stall restocks from the shared stores at wholesale, then sells to whoever needs something
  const pr = s.economy.prices;
  if (a.inv.food < 4 && s.stock.food > 20 && (s.economy.ledger[a.id] || 0) >= 6) {
    s.stock.food -= 6; a.inv.food += 6;
    const cost = Math.ceil(6 * pr.food * 0.6);
    s.economy.ledger[a.id] -= cost; s.economy.treasury += cost;
    txn(s, a.id, 'treasury', cost, 'wholesale food for the stall');
  }
  const buyers = agentList(s).filter((o) => o !== a && (s.economy.ledger[o.id] || 0) > 0);
  let sold = null;
  for (const o of buyers) {
    const want = o.needs.fed < 65 && o.inv.food < 4 && a.inv.food >= 3 ? 'food'
      : toolsOf(s, o) === 0 && a.inv.tools >= 1 ? 'tools'
      : !o.home && a.inv.wood >= 6 && o.inv.wood < 10 ? 'wood' : null;
    if (!want) continue;
    const amt = want === 'tools' ? 1 : 3;
    const price = Math.max(1, Math.ceil(amt * pr[want]));
    if ((s.economy.ledger[o.id] || 0) < price) continue;
    const tax = Math.floor(price * s.economy.tax);
    a.inv[want] -= amt; o.inv[want] += amt;
    s.economy.ledger[o.id] -= price; s.economy.ledger[a.id] += price - tax; s.economy.treasury += tax;
    txn(s, o.id, a.id, price, `${amt} ${want} at ${a.name}'s stall${tax ? ` (${tax} tax)` : ''}`);
    s.counters.sales++;
    sold = `Sold ${amt} ${want} to ${o.name} for ${price} dots.`;
    if (!milestone(s, 'first_sale', `${o.name} becomes ${a.name}'s first customer.`, [a.id, o.id])) engineLog(s, `SALE ${sold}`);
    break;
  }
  return sold || 'A slow day at the stall.';
}

// ---------------------------------------------------------------- building
// Every choice that shapes the settlement becomes a numbered decision in the record.
function recordDecision(s, a, d) {
  const entry = { id: s.decisions.length + 1, day: dayOf(s), clock: clockOf(s), by: a.id, ...d };
  s.decisions.push(entry);
  return entry;
}

function startProject(s, a, bp, viaProposal = null) {
  const B = BLUEPRINTS[bp];
  const src = B.private ? a.inv : s.stock;
  const b = { id: s.nextId++, bp, owner: B.private ? a.id : null, by: a.id, status: 'building', labor: 0, progress: 0, growth: 0, started: dayOf(s) };
  if (afford(src, B.cost)) pay(src, B.cost); else b.status = 'planned';
  s.buildings.push(b);
  s.counters.projects++;
  if (viaProposal) {
    const d = s.decisions.find((x) => x.proposal === viaProposal.num);
    if (d) d.building = b.id;
  } else {
    const fromTrace = a.trace?.decision === `START_${bp.toUpperCase()}`;
    recordDecision(s, a, {
      kind: B.private ? 'private' : 'alone',
      title: B.private ? `${a.name} builds ${bp === 'house' ? 'a house of their own' : `${article(B.name)} ${B.name}`}` : `Build ${article(B.name)} ${B.name}`,
      reasoning: fromTrace ? a.trace.reasoning : '',
      options: fromTrace ? a.trace.options : [],
      cost: B.cost, building: b.id, objection: null,
    });
  }
  const firstOfKind = s.buildings.filter((x) => x.bp === bp).length === 1;
  const text = b.status === 'planned'
    ? `${a.name} plans ${article(B.name)} ${B.name}; it starts once materials are ready.`
    : `${a.name} begins construction of ${B.private ? 'their own ' + B.name : `${article(B.name)} ${B.name}`}.`;
  const keyed = {
    shared_house: 'Construction begins on the first house.', farm: `${a.name} begins clearing land for the first farm.`,
    house: `${a.name} begins the first privately owned house.`, market: `${a.name} begins building the first business.`,
  }[bp];
  if (!(keyed && firstOfKind && milestone(s, 'start_' + bp, keyed, [a.id]))) log(s, text, 'build', [a.id]);
  sayAll(s, mind.talk.start(s, a, bp));
  if (!B.private && !hasLaw(s, 'decide_rule')) objections(s, a, b);
  emit(s, { type: 'site', b });
  return b.id;
}

// before there are any rules, spending shared materials on your own idea causes friction
function objections(s, a, b) {
  const cost = sumCost(BLUEPRINTS[b.bp].cost);
  if (cost < 14) return;
  let worst = null, wv = -0.1;
  for (const o of agentList(s)) {
    if (o === a || (o.rel[a.id] ?? 50) > 78) continue;
    const top = mind.topWant(s, o);
    const v = mind.desire(s, o, b.bp) - 0.8 * (top && top !== b.bp ? mind.desire(s, o, top) : 0) + (rand(s) - 0.5) * 0.3;
    if (v < wv) { wv = v; worst = o; }
  }
  if (!worst) return;
  s.counters.objections++;
  relate(worst, a, -7); relate(a, worst, -4);
  const B = BLUEPRINTS[b.bp];
  const what = `${worst.name} objects to ${a.name} spending shared materials on ${article(B.name)} ${B.name}.`;
  if (!milestone(s, 'first_disagreement', `The first disagreement: ${what}`, [worst.id, a.id])) log(s, what, 'event', [worst.id, a.id]);
  const lines = mind.talk.objection(s, worst, a, b.bp, `${cost}`);
  sayAll(s, lines);
  const d = s.decisions.find((x) => x.building === b.id);
  if (d) d.objection = { by: worst.id, text: lines[0][1], reply: lines[1]?.[1] };
  remember(s, worst, `${a.name} spent shared materials on ${article(B.name)} ${B.name} without asking.`, 2);
  remember(s, a, `${worst.name} objected to my ${B.name}.`, 1.5);
}

function finish(s, b, a) {
  const B = BLUEPRINTS[b.bp];
  b.status = 'done'; b.done = dayOf(s); b.progress = 1;
  const owner = b.owner && s.agents[b.owner];
  if (b.bp === 'house' && owner) owner.home = b.id;
  if (b.bp === 'market' && owner) s.economy.businesses.push({ owner: owner.id, name: `${owner.name}'s Stall`, day: dayOf(s) });
  const keyed = {
    campfire: 'The first fire is lit.',
    shared_house: 'The first house is finished. Tonight, nobody sleeps outside.',
    farm: `${a.name} establishes the first farm.`,
    food_storage: 'Food storage is finished. Nothing rots overnight anymore.',
    workshop: 'The workshop opens.',
    well: 'The well is dug. Water, right in the middle of the settlement.',
    meeting_circle: 'The meeting circle is raised: a place to decide things together.',
    house: `${owner?.name} finishes the first privately owned house.`,
    market: `${owner?.name} opens the first business: ${owner?.name}'s Stall.`,
    clinic: 'The settlement opens its first clinic.',
    school: 'The first school opens.',
    courthouse: 'The courthouse is finished.',
    watch_post: 'The watch post goes up.',
    road: 'The first stone road is laid.',
    hospital: 'The hospital opens.',
  }[b.bp];
  if (!(keyed && milestone(s, 'built_' + b.bp, keyed, [a.id]))) log(s, `${owner ? owner.name + "'s" : 'The'} ${B.name} is finished.`, 'build', [a.id]);
  sayAll(s, mind.talk.built(s, owner || a, b));
  for (const o of agentList(s)) if (!b.owner || o === owner) o.needs.mood = Math.min(100, o.needs.mood + 6);
  emit(s, { type: 'built', b });
}

// ---------------------------------------------------------------- governance
function propose(s, a, kind, bp) {
  const P = POLICIES[kind];
  const trusted = (exclude = []) => agentList(s).filter((o) => !exclude.includes(o.id))
    .map((o) => [o, agentList(s).filter((x) => x !== o).reduce((t, x) => t + (x.rel[o.id] ?? 50), 0)])
    .sort((x, y) => y[1] - x[1])[0][0].id;
  const who = kind === 'court' ? trusted() : kind === 'coordinator' ? trusted([s.roles.judge].filter(Boolean))
    : kind === 'warden' ? agentList(s).filter((o) => o.id !== s.roles.judge && !o.violations).sort((x, y) => mind.IDENTITIES[y.id].w.gov - mind.IDENTITIES[x.id].w.gov)[0]?.id ?? a.id : null;
  const fill = (str) => str && str.replace('{who}', nameOf(s, who)).replace('{bp}', bp ? BLUEPRINTS[bp].name : '');
  const p = {
    id: s.nextId++, num: s.proposals.length + 1, kind, bp, who, by: a.id,
    title: fill(P.title), question: fill(P.question), law: fill(P.law),
    day: dayOf(s), clock: clockOf(s), opened: s.time, closes: s.time + 8 * 60,
    votes: Object.fromEntries(AGENT_IDS.map((id) => [id, id === a.id ? 'support' : null])), status: 'open',
  };
  s.proposals.push(p);
  log(s, `Proposal #${pad(p.num, 3)} by ${a.name}: ${p.question}`, 'proposal', [a.id]);
  const pitch = mind.talk.pitch(s, a, p);
  sayAll(s, pitch);
  p.lines = { [a.id]: pitch[0]?.[1] };
  recordDecision(s, a, { kind: 'vote', title: p.title, proposal: p.num, reasoning: a.trace?.decision?.startsWith('PROPOSE_') ? a.trace.reasoning : '' });
  emit(s, { type: 'proposal', p });
  return p.id;
}

function vote(s, a) {
  const p = openProposal(s);
  if (!p || p.votes[a.id] === 'support' || p.votes[a.id] === 'oppose') return;
  const v = mind.stance(s, a, p);
  let choice = v > 0.12 ? 'support' : v < -0.12 ? 'oppose' : 'undecided';
  if (p.votes[a.id] === 'undecided') choice = v >= 0 ? 'support' : 'oppose'; // second look: commit
  if (choice === p.votes[a.id]) return;
  p.votes[a.id] = choice;
  const line = mind.talk.vote(s, a, p, choice);
  (p.lines ??= {})[a.id] = line;
  say(s, a.id, `${{ support: '👍', oppose: '👎', undecided: '🤔' }[choice]} ${line}`);
  emit(s, { type: 'vote', id: a.id, p, choice });
}

function resolveProposals(s) {
  const p = openProposal(s);
  if (!p) return;
  const done = AGENT_IDS.every((id) => p.votes[id] === 'support' || p.votes[id] === 'oppose');
  if (!done && (s.time < p.closes || isNight(s))) return;
  const yes = AGENT_IDS.filter((id) => p.votes[id] === 'support').length;
  const no = AGENT_IDS.filter((id) => p.votes[id] === 'oppose').length;
  let passed = yes >= 3;
  let tie = '';
  if (!passed && yes === 2 && no === 2 && s.roles.coordinator) {
    passed = p.votes[s.roles.coordinator] === 'support';
    tie = ` Coordinator ${nameOf(s, s.roles.coordinator)} breaks the tie.`;
  }
  p.status = passed ? 'passed' : 'failed';
  p.closed = s.time;
  p.result = `${yes}–${no}`;
  s.counters.votes++;
  if (!passed) s.counters.failedVotes++;
  const by = s.agents[p.by];
  for (const id of AGENT_IDS) {
    if (id === p.by) continue;
    if (p.votes[id] === 'oppose') { relate(by, s.agents[id], -4); remember(s, by, `${nameOf(s, id)} voted against my proposal on "${p.title}".`, 1); }
    if (p.votes[id] === 'support') relate(by, s.agents[id], 3);
  }
  const verdict = `"${p.title}" ${passed ? 'passes' : 'fails'} ${p.result}.${tie}`;
  if (!milestone(s, 'first_vote', `The dots conduct their first vote: ${verdict}`, AGENT_IDS)) log(s, `Vote on proposal #${pad(p.num, 3)}: ${verdict}`, 'vote', AGENT_IDS);
  sayAll(s, mind.talk.result(s, p, passed));
  emit(s, { type: 'resolved', p });
  if (passed) enact(s, p);
}

function enact(s, p) {
  const a = s.agents[p.by];
  if (p.kind === 'build') { startProject(s, a, p.bp, p); return; }
  const law = { num: s.laws.length + 1, kind: p.kind, text: p.law, day: dayOf(s), by: p.by, proposal: p.num };
  s.laws.push(law);
  if (!milestone(s, 'first_law', `The first law passes. LAW ${pad(law.num, 3)}: ${law.text}`, [p.by])) log(s, `LAW ${pad(law.num, 3)}: ${law.text}`, 'law', [p.by]);
  switch (p.kind) {
    case 'ration': s.rationActive = s.stock.food < 40; break;
    case 'property': s.economy.regime = 'mixed'; milestone(s, 'property', 'Private property is recognized: whoever gathers keeps half.', [p.by]); break;
    case 'currency':
      s.economy.currency = { name: 'dot', day: dayOf(s) };
      for (const id of AGENT_IDS) s.economy.ledger[id] = 50;
      updatePrices(s);
      milestone(s, 'currency', 'The settlement adopts a currency: the dot. 200 dots enter circulation.', [p.by]);
      break;
    case 'court': s.roles.judge = p.who; milestone(s, 'court', `The settlement creates a court. ${nameOf(s, p.who)} becomes the first judge.`, [p.who]); break;
    case 'warden': s.roles.warden = p.who; milestone(s, 'warden', `${nameOf(s, p.who)} becomes the settlement's first warden.`, [p.who]); break;
    case 'coordinator': s.roles.coordinator = p.who; milestone(s, 'coordinator', `${nameOf(s, p.who)} is elected the settlement's first coordinator.`, [p.who]); break;
    case 'tax': s.economy.tax = 0.1; milestone(s, 'tax', 'The first tax: 10% of every sale goes to public works.', [p.by]); break;
  }
}
