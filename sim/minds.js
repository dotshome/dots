// dot.home - the inhabitants.
// Persistent identities, how each one weighs the world, and what they say about it.
//
// The engine asks two things of a mind:
//   1. decide(state, agent, validActions) - pick from the engine's list of *allowed* actions
//   2. explain(...) / stance(...) / talk.*  - the reasoning and words around those choices
// This file is a local stand-in for that decision layer. To move it onto a hosted model,
// replace decide() (and optionally explain/stance) with a call that receives observe(state, agent)
// plus the valid action codes and returns one of those codes - the engine never trusts anything else.
import { ACTIONS, BLUEPRINTS, DAILY_FOOD, built, hasLaw, dayOf, hourOf, foodDays, rand, pickR, agentList, nameOf } from './catalog.js';

// Traits shape behaviour; they don't assign jobs. Roles emerge from what each one keeps doing.
export const IDENTITIES = {
  blue: {
    name: 'Nimbus', color: 'Blue', trait: 'analytical', priority: 'long-term stability', riskLabel: 'low', risk: 0.2,
    skills: ['planning', 'engineering'],
    w: { gather: 1.0, build: 1.35, explore: 0.55, social: 0.8, care: 0.8, gov: 1.15, commerce: 0.85, craft: 1.3 },
    know: { building: 0.45, farming: 0.1, medicine: 0.05, tools: 0.25, mining: 0.05 },
  },
  green: {
    name: 'Moss', color: 'Green', trait: 'exploratory', priority: 'resource acquisition', riskLabel: 'high', risk: 0.8,
    skills: ['discovery', 'scouting'],
    w: { gather: 1.3, build: 0.9, explore: 1.7, social: 0.9, care: 0.75, gov: 0.7, commerce: 0.95, craft: 0.9 },
    know: { building: 0.15, farming: 0.2, medicine: 0.05, tools: 0.1, mining: 0.2 },
  },
  yellow: {
    name: 'Sol', color: 'Yellow', trait: 'cooperative', priority: 'community wellbeing', riskLabel: 'medium-low', risk: 0.35,
    skills: ['mediation', 'organization'],
    w: { gather: 1.0, build: 1.0, explore: 0.6, social: 1.45, care: 1.6, gov: 1.4, commerce: 0.7, craft: 0.85 },
    know: { building: 0.2, farming: 0.25, medicine: 0.3, tools: 0.05, mining: 0.0 },
  },
  pink: {
    name: 'Rosie', color: 'Pink', trait: 'entrepreneurial', priority: 'growth', riskLabel: 'medium-high', risk: 0.65,
    skills: ['commerce', 'experimentation'],
    w: { gather: 1.05, build: 1.05, explore: 1.0, social: 1.15, care: 0.8, gov: 1.0, commerce: 1.75, craft: 1.0 },
    know: { building: 0.2, farming: 0.1, medicine: 0.05, tools: 0.15, mining: 0.05 },
  },
};

// how each of them instinctively feels about a kind of rule, before circumstances weigh in
const LEAN = {
  decide_rule: { blue: 0.5, green: -0.1, yellow: 0.7, pink: 0.1 },
  ration: { blue: 0.5, green: -0.35, yellow: 0.6, pink: -0.2 },
  property: { blue: 0.05, green: 0.3, yellow: -0.55, pink: 0.75 },
  currency: { blue: 0.45, green: 0.15, yellow: -0.05, pink: 0.8 },
  market_land: { blue: -0.55, green: 0.15, yellow: 0.2, pink: 0.95 },
  court: { blue: 0.6, green: -0.1, yellow: 0.7, pink: 0.25 },
  warden: { blue: 0.6, green: -0.5, yellow: 0.15, pink: 0.05 },
  coordinator: { blue: 0.2, green: 0.1, yellow: 0.35, pink: 0.2 },
  tax: { blue: 0.4, green: -0.35, yellow: 0.6, pink: -0.55 },
};

const BUILD_BIAS = {
  blue: { workshop: 0.55, road: 0.4, well: 0.2, food_storage: 0.25, school: 0.3, hospital: 0.3, watch_post: 0.3 },
  green: { farm: 0.2, house: 0.3, well: 0.1 },
  yellow: { meeting_circle: 0.5, clinic: 0.5, school: 0.5, food_storage: 0.2, courthouse: 0.3, farm: 0.25 },
  pink: { market: 1.6, house: 0.45, workshop: 0.15 },
};

const ROLE_TITLE = {
  wood: 'Woodcutter', stone: 'Mason', food: 'Forager', water: 'Water carrier', farm: 'Farmer', mine: 'Miner',
  explore: 'Scout', build: 'Builder', craft: 'Toolmaker', gov: 'Organizer', mediate: 'Mediator', patrol: 'Warden',
  social: 'Connector', teach: 'Teacher', care: 'Healer', commerce: 'Trader', shop: 'Shopkeeper',
};

export function roleOf(s, a) {
  if (s.roles.coordinator === a.id) return 'Coordinator';
  if (s.roles.judge === a.id) return 'Judge';
  if (s.roles.warden === a.id) return 'Warden';
  if (s.economy.businesses.some((b) => b.owner === a.id)) return 'Merchant';
  let best = null, total = 0;
  for (const [k, v] of Object.entries(a.xp)) {
    if (!ROLE_TITLE[k]) continue;
    total += v;
    if (!best || v > best[1]) best = [k, v];
  }
  return best && best[1] >= 6 && best[1] / total >= 0.22 ? ROLE_TITLE[best[0]] : null;
}

// ---------------------------------------------------------------- reading the world
export function knowledgeRisk(s) {
  let n = 0;
  for (const f of ['building', 'farming', 'medicine', 'tools']) {
    const vals = agentList(s).map((a) => a.know[f] || 0).sort((x, y) => y - x);
    if (vals[0] >= 0.6 && vals[1] < 0.3) n++;
  }
  return n;
}
export function gatherShare(s, a) {
  const tot = agentList(s).reduce((x, o) => x + o.gathered, 0);
  return tot > 0 ? a.gathered / tot : 0.25;
}
export function grievance(s) {
  const avg = agentList(s).reduce((x, o) => x + o.gathered, 0) / 4;
  return avg > 0 ? Math.max(...agentList(s).map((o) => o.gathered)) / avg : 1;
}
const crowd = (s, a, type) => agentList(s).filter((o) => o !== a && o.task?.type === type).length;

export function desire(s, a, bp) {
  const d = dayOf(s), h = hourOf(s), fd = foodDays(s);
  const ailing = agentList(s).some((x) => x.ailment);
  let v;
  switch (bp) {
    case 'campfire': v = 1.3; break;
    case 'shared_house': v = 1.45 + (h > 13 ? 0.6 : 0) + (d > 1 ? 0.4 : 0); break;
    case 'food_storage': v = 0.4 + (s.stock.food > 24 ? 0.7 : 0) + (s.counters.spoiled > 0 ? 0.45 : 0); break;
    case 'farm': v = 0.75 + (fd < 2.5 ? 0.9 : 0) + (s.counters.foodCrises > 0 ? 0.4 : 0); break;
    case 'well': v = 0.6 + Math.min(0.8, s.counters.waterTrips / 30); break;
    case 'workshop': v = 0.75; break;
    case 'meeting_circle': v = 0.6 + s.counters.votes * 0.1; break;
    case 'house': v = a.home ? 0 : 1.1; break;
    case 'market': v = 0.2; break;
    case 'clinic': v = 0.8 + (ailing ? 0.7 : 0) + s.counters.ailments * 0.15; break;
    case 'school': v = 0.8 + knowledgeRisk(s) * 0.6; break;
    case 'courthouse': v = 0.65 + s.counters.disputes * 0.15; break;
    case 'watch_post': v = 0.55 + s.counters.violations * 0.15; break;
    case 'road': v = 0.5 + Math.min(0.7, s.counters.trips / 200); break;
    case 'hospital': v = 0.7 + (ailing ? 0.4 : 0); break;
    default: v = 0.5;
  }
  return v + (BUILD_BIAS[a.id][bp] || 0);
}

// the unbuilt thing this agent most wants - what their gathering is "for"
export function topWant(s, a) {
  let best = null, bv = -1;
  for (const [bp, B] of Object.entries(BLUEPRINTS)) {
    if (B.repeat ? s.buildings.some((b) => b.bp === bp && b.owner === a.id) : s.buildings.some((b) => b.bp === bp)) continue;
    if (B.when && !B.when(s)) continue;
    const v = desire(s, a, bp);
    if (v > bv) { bv = v; best = bp; }
  }
  return best;
}

export function materialNeed(s, a) {
  const need = { wood: 0, stone: 0, metal: 0 };
  const addCost = (bp) => { for (const [k, v] of Object.entries(BLUEPRINTS[bp].cost)) if (k in need) need[k] += v; };
  for (const b of s.buildings) if (b.status === 'planned') addCost(b.bp);
  const want = topWant(s, a);
  if (want) addCost(want);
  const src = want && BLUEPRINTS[want].private ? a.inv : s.stock;
  for (const k of Object.keys(need)) need[k] = Math.max(0, need[k] - (src[k] || 0));
  return need;
}

// how an agent feels about a proposal kind, given their nature and their situation
export function lean(s, a, kind, bp) {
  if (kind === 'build') return desire(s, a, bp) / 1.5 - 0.3;
  let v = LEAN[kind]?.[a.id] ?? 0;
  switch (kind) {
    case 'decide_rule': v += 0.12 * s.counters.objections; break;
    case 'ration': v += foodDays(s) < 0.8 ? 0.3 : 0; if (a.needs.fed < 30) v -= 0.35; break;
    case 'property': v += (gatherShare(s, a) - 0.25) * 3; break;
    case 'currency': v += Math.min(0.4, s.counters.barter * 0.06); break;
    case 'court': v += s.counters.disputes * 0.08; break;
    case 'warden': v += s.counters.violations * 0.08 - (a.violations || 0) * 0.35; break;
    case 'tax': v -= s.economy.businesses.some((b) => b.owner === a.id) ? 0.25 : 0; break;
  }
  return v;
}

export function stance(s, a, p) {
  if (p.by === a.id) return 1;
  let v = lean(s, a, p.kind, p.bp);
  if (p.who === a.id) v += 0.45;
  v += ((a.rel[p.by] ?? 50) - 50) / 110;
  v += (rand(s) - 0.5) * 0.32;
  return v;
}

// ---------------------------------------------------------------- the decision layer (local stand-in)
export function score(s, a, act) {
  const I = IDENTITIES[a.id], w = I.w, n = a.needs, fd = foodDays(s);
  let u = 0;
  switch (act.type) {
    case 'SLEEP': return 50;
    case 'EAT': u = n.fed < 30 ? 3.4 : n.fed < 50 ? 1.7 : hourOf(s) >= 19 && n.fed < 65 ? 1.6 : 0.45; break;
    case 'REST': u = n.energy < 22 ? 2.4 : n.energy < 40 ? 1.0 : 0.2; if (a.ailment) u += 1.3; break;
    case 'GATHER_WOOD': u = (0.45 + Math.min(1.3, materialNeed(s, a).wood / 28)) * w.gather; break;
    case 'QUARRY_STONE': u = (0.4 + Math.min(1.3, materialNeed(s, a).stone / 16)) * w.gather * (0.75 + I.risk * 0.4); break;
    case 'FORAGE_FOOD': u = (fd < 1 ? 2.3 : fd < 2 ? 1.45 : fd < 3.5 ? 0.8 : fd < 5 ? 0.3 : 0.06) * w.gather; break;
    case 'FETCH_WATER': u = s.stock.water < 8 ? 2.0 : s.stock.water < 18 ? 0.95 : 0.2; break;
    case 'TEND_FARM': u = (fd < 2 ? 1.5 : fd < 3.5 ? 0.95 : fd < 5 ? 0.35 : 0.08) * w.gather + (fd < 5 ? (a.know.farming || 0) * 0.3 : 0); break;
    case 'MINE_ORE': u = (0.35 + Math.min(1.2, materialNeed(s, a).metal / 12)) * (w.gather + w.explore) / 2; break;
    case 'SCOUT': u = (s.nodes.oreFound ? 0.3 : 0.85) * w.explore * (0.6 + I.risk * 0.6) * (fd < 1.5 ? 0.3 : 1); break;
    case 'START': u = desire(s, a, act.bp) * w.build * 1.05; break;
    case 'CONTINUE': u = (1.15 + (act.urgent ? 0.9 : 0)) * w.build; break;
    case 'CRAFT_TOOLS': u = ((s.stock.tools + a.inv.tools) < 2 ? 1.0 : 0.3) * w.craft; break;
    case 'PROPOSE': { const l = lean(s, a, act.kind, act.bp); u = l > 0.2 ? 0.25 + 1.1 * w.gov * l : 0.02; break; }
    case 'MEDIATE': u = 1.6 * w.gov; break;
    case 'PATROL': u = 0.7 * w.gov; break;
    case 'SOCIALIZE': u = (n.mood < 50 ? 1.0 : 0.38) * w.social + Math.min(0.45, (s.time - a.lastSocial) / 2880); break;
    case 'TEACH': u = 0.55 * w.social; break;
    case 'CARE': u = 2.0 * w.care * (0.6 + (a.rel[act.target] || 50) / 120); break;
    case 'TRADE': u = 1.25 * w.commerce; break;
    case 'RUN_SHOP': u = 1.05 * w.commerce; break;
  }
  // "should everyone work on the same thing?" - piling onto one job is worth less
  if (ACTIONS[act.type].cat === 'gather') u -= 0.28 * crowd(s, a, act.type);
  // specialization momentum: they drift towards what they've become good at
  // (but nobody keeps doing a job the settlement no longer needs)
  const xp = ACTIONS[act.type].xp;
  if (xp && a.xpTotal && u > 0.25) u += 0.35 * (a.xp[xp] || 0) / a.xpTotal;
  return u;
}

export function decide(s, a, valid) {
  const T = 0.16 + IDENTITIES[a.id].risk * 0.18; // bolder minds are less predictable
  const ranked = valid.map((act) => ({ act, u: score(s, a, act) + rand(s) * 0.22 })).sort((x, y) => y.u - x.u);
  const top = ranked.slice(0, 5);
  const ws = top.map((r) => Math.exp((r.u - top[0].u) / T));
  let r = rand(s) * ws.reduce((x, y) => x + y, 0), i = 0;
  for (; i < top.length - 1; i++) { r -= ws[i]; if (r <= 0) break; }
  return { choice: top[i].act, ranked };
}

// ---------------------------------------------------------------- reasoning (what the agent wants, in words)
const BP_REASON = {
  campfire: () => 'We need warmth and somewhere to gather tonight. A campfire is cheap and it is a start.',
  shared_house: () => 'Night is coming and we have nowhere to sleep. One shared house protects all four of us.',
  food_storage: (s) => `${s.stock.food} food is sitting in the open. Storage stops it rotting overnight.`,
  farm: (s) => `Food reserves are at ${s.stock.food} and falling. Renewable food production beats foraging trip after trip.`,
  well: (s) => `${s.counters.waterTrips} trips to the spring so far. A well in the middle saves hours every day.`,
  workshop: () => 'Better tools make every other job faster. The workshop pays for itself.',
  meeting_circle: () => 'If we are going to keep voting, we need a proper place to do it.',
  house: () => 'I have gathered enough to build something of my own.',
  market: () => 'There is demand and nobody is meeting it. A stall turns my surplus into dots.',
  clinic: () => 'People get hurt out here. We need a place to treat them before it happens again.',
  school: () => 'Too much of what we know lives in one head. If we lose that, we lose it all.',
  courthouse: () => 'Rulings deserve a place where everyone can see them made.',
  watch_post: () => 'Laws mean nothing if nobody is watching.',
  road: (s) => `${s.counters.trips} trips across the same mud. Paving the paths saves time on every one of them.`,
  hospital: () => 'A clinic patches people up. A hospital keeps them alive.',
};

export function explain(s, a, act) {
  const n = a.needs, st = s.stock, fd = foodDays(s);
  const B = act.bp && BLUEPRINTS[act.bp];
  switch (act.type) {
    case 'SLEEP': return hourOf(s) >= 21 || hourOf(s) < 6 ? 'It is late. Rest now, build tomorrow.' : `Energy is down to ${n.energy | 0}. I need to sleep.`;
    case 'EAT': return `Fed is down to ${n.fed | 0}. Nothing else works on an empty stomach.`;
    case 'REST': return a.ailment ? `Still ${a.ailment}. Taking it slow so I can heal.` : `Energy at ${n.energy | 0}. A short rest now saves a long one later.`;
    case 'GATHER_WOOD': { const k = materialNeed(s, a).wood; return k > 0 ? `We are ${k} wood short of what we need. The grove is the fastest source.` : 'Wood never goes to waste. Stocking up while the trees are close.'; }
    case 'QUARRY_STONE': { const k = materialNeed(s, a).stone; return k > 0 ? `Still ${k} stone short. The quarry is risky, but nothing else gets us stone.` : 'Stone for later. Building always needs more than you think.'; }
    case 'FORAGE_FOOD': return fd < 1.5 ? `Food reserves are at ${st.food}. That is barely a day. Food first, everything else second.` : `Food is at ${st.food}. Topping it up before it becomes a problem.`;
    case 'FETCH_WATER': return st.water < 10 ? `Only ${st.water} water left. Nobody lasts long without it.` : 'Keeping the water topped up.';
    case 'TEND_FARM': return 'The farm feeds us every day instead of every trip. It needs tending.';
    case 'MINE_ORE': return `We need metal for the things we have not built yet. ${s.nodes.ore} ore left in the vein.`;
    case 'SCOUT': return s.nodes.oreFound ? 'There might be more out there. I want to see the edges again.' : 'We know nothing about the edges of this place. Something useful has to be out there.';
    case 'START': return (BP_REASON[act.bp] || (() => `A ${B.name} would help us.`))(s);
    case 'CONTINUE': { const b = s.buildings.find((x) => x.id === act.target); return `The ${B.name} is ${Math.round((b?.progress || 0) * 100)}% done. Finishing it beats starting something new.`; }
    case 'CRAFT_TOOLS': return 'We have the workshop. Tools will double what each trip brings back.';
    case 'PROPOSE': return proposeReason(s, a, act);
    case 'MEDIATE': return 'This dispute is poisoning everything. Someone has to hear both sides.';
    case 'PATROL': return 'Somebody has to make sure the rules mean something.';
    case 'SOCIALIZE': return n.mood < 50 ? 'I need to talk to someone.' : `Haven't really talked with ${nameOf(s, act.target)} today.`;
    case 'TEACH': return `${nameOf(s, act.target)} should know what I know about ${act.field}. If something happens to me, it shouldn't be lost.`;
    case 'CARE': return `${nameOf(s, act.target)} is hurt. Everything else can wait.`;
    case 'TRADE': return act.data?.pay ? `I need ${act.data.get}, and I have dots. ${nameOf(s, act.target)} has plenty.` : `I have more ${act.data?.give} than I need and not enough ${act.data?.get}. ${nameOf(s, act.target)} has the opposite problem.`;
    case 'RUN_SHOP': return 'The stall only makes money if it is open.';
  }
  return '';
}

function proposeReason(s, a, act) {
  switch (act.kind) {
    case 'decide_rule': return 'We keep spending shared materials without agreeing first. We need a rule for how we decide.';
    case 'ration': return `Food is at ${s.stock.food}. Without limits, the hungriest of us will empty the stores.`;
    case 'property': return `I spent days gathering. My share is ${Math.round(gatherShare(s, a) * 100)}% of everything. Why does everyone have equal access to it?`;
    case 'currency': return `${s.counters.barter} barters so far and every one was a haggle. A common unit would make exchange simple.`;
    case 'market_land': return 'I want to open a business, but every bit of land here is communal.';
    case 'court': return `${s.counters.disputes} disputes and no way to settle them. We need someone whose ruling counts.`;
    case 'warden': return `The rules have been broken ${s.counters.violations} times. Rules nobody enforces are not rules.`;
    case 'coordinator': return 'Votes drag on and ties go nowhere. Someone should run meetings and break ties.';
    case 'tax': return 'The roads, the well, the clinic: someone has to pay for public works.';
    case 'build': return (BP_REASON[act.bp] || (() => ''))(s) + ' It uses shared resources, so we vote.';
  }
  return '';
}

// ---------------------------------------------------------------- words
const START_LINE = {
  campfire: 'Let\'s get a fire going before dark.',
  shared_house: 'We need walls and a roof before night. I\'m laying out a house.',
  food_storage: 'Food is rotting in the open. We need somewhere to keep it.',
  farm: 'Berries won\'t last forever. I\'m clearing land for a farm.',
  well: 'Too many trips to the spring. A well, right in the middle.',
  workshop: 'Better tools, faster work. I\'m starting a workshop.',
  meeting_circle: 'If we keep voting, we should have a place to do it.',
  house: 'A place of my own, built from what I gathered.',
  market: 'Shop\'s going up. Come buy something soon!',
  clinic: 'Somewhere to treat the injured. Next time we\'ll be ready.',
  school: 'What we know shouldn\'t live in one head. We need a school.',
  courthouse: 'Rulings need a home. The court gets a building.',
  watch_post: 'A post to keep watch from.',
  road: 'We walk the same paths all day. Let\'s pave them.',
  hospital: 'A real hospital. It\'ll take everything we have.',
};
const OBJECT_LINE = {
  blue: (bp, cost) => `That's ${cost} of our shared materials. Did anyone agree to a ${bp}?`,
  green: (bp) => `Hey! I hauled that. Why is it going into a ${bp}?`,
  yellow: (bp) => `Shouldn't we decide this together? That belongs to everyone.`,
  pink: (bp) => `Bold move, spending everyone's stuff on a ${bp}.`,
};
const OBJECT_REPLY = {
  blue: 'The numbers work. I checked them twice.',
  green: 'It\'ll be useful, trust me!',
  yellow: 'I thought it would help all of us.',
  pink: 'Nobody said I needed permission.',
};
const PITCH = {
  decide_rule: 'This keeps happening. From now on, shared resources need 3 of 4 of us to agree.',
  ration: 'Two meals a day from the shared stores until food recovers. Same rule for everyone.',
  property: { pink: 'I spent days gathering this. Why does everyone have equal access to it?', green: 'I\'ve hauled more than anyone. Shouldn\'t some of it be mine?', blue: 'Effort and reward should be connected. Let\'s keep half of what we gather.', yellow: 'Maybe people should keep some of what they gather?' },
  currency: 'Ten wood for six berries, every single time? What if we had a common unit? Call it the dot.',
  market_land: 'I want to open a shop. Can a private business use communal land?',
  court: 'We keep ending up in arguments nobody can settle. Let\'s have a court.',
  warden: 'Rules nobody enforces aren\'t rules.',
  coordinator: 'We need someone to run meetings and break ties.',
  tax: 'Public works need paying for. A small cut of every sale.',
};
const VOTE_LINE = {
  property: { support: { pink: 'Effort should count for something.', green: 'Finally. Yes.', blue: 'It rewards work. Yes.', yellow: 'If it\'s only half, I can live with it.' },
    oppose: { yellow: 'If we split it up, the slowest of us goes hungry.', blue: 'Shared stores keep us stable. No.', green: 'I don\'t want to count every berry.', pink: 'Not like this.' } },
  market_land: { oppose: { blue: 'Communal land should stay communal.', yellow: 'Who decides which land? No.', green: 'Eh. No.', pink: 'No.' },
    support: { yellow: 'If it serves everyone, I\'m for it.', green: 'More stuff to buy? Sure!', blue: 'As long as it pays its way.', pink: 'Obviously yes.' } },
  ration: { oppose: { green: 'I work twice as hard. I eat twice as much.', pink: 'Rules about food? Really?', blue: 'The numbers don\'t need it yet.', yellow: 'Not yet.' },
    support: { blue: 'Two meals each keeps us alive until the farm catches up.', yellow: 'Fair shares for everyone. Yes.', green: 'Fine. Fine.', pink: 'Okay, I see the problem.' } },
  currency: { support: { blue: 'A shared unit makes every exchange measurable. Yes.', pink: 'Yes, a thousand times yes.', green: 'Simpler trades? Sure.', yellow: 'If everyone starts equal, yes.' },
    oppose: { yellow: 'Money changes how we treat each other.', green: 'We were doing fine with swaps.', blue: 'Too early.', pink: 'Not this version.' } },
  warden: { oppose: { green: 'Someone watching us all the time? No thanks.', pink: 'Feels like a lot.', yellow: 'Can\'t we just talk to each other?', blue: 'Not this way.' } },
  tax: { oppose: { pink: 'I built that stall myself. Hands off my dots.', green: 'Taxes? Already?', blue: 'Not yet.', yellow: 'Not like this.' } },
};
const GENERIC = {
  support: ['I\'m in.', 'Agreed.', 'Yes, let\'s do it.', 'Makes sense to me.', 'Yes.'],
  oppose: ['Not convinced.', 'No. Not like this.', 'I can\'t support that.', 'Bad idea, honestly.'],
  undecided: ['Let me think about it.', 'Hmm. Ask me later.', 'I need more information.', 'I\'m torn on this one.'],
};

export const talk = {
  arrive: () => [
    ['yellow', 'Hello? Is anyone else here?'],
    ['green', 'All of us, it seems. And not much else!'],
    ['blue', 'Some wood, some stone, a crate of seeds. We start from nothing.'],
    ['pink', 'Then everything we build is ours. I like those odds.'],
  ],
  start: (s, a, bp) => [[a.id, START_LINE[bp] || `Let's build a ${BLUEPRINTS[bp].name}.`]],
  objection: (s, o, a, bp, cost) => [[o.id, OBJECT_LINE[o.id](BLUEPRINTS[bp].name, cost)], [a.id, OBJECT_REPLY[a.id]]],
  pitch: (s, a, p) => {
    const t = PITCH[p.kind];
    return [[a.id, p.kind === 'build' ? `Proposal: a ${BLUEPRINTS[p.bp].name}, paid from the shared stores.` : typeof t === 'object' ? t[a.id] : t]];
  },
  vote: (s, a, p, v) => VOTE_LINE[p.kind]?.[v]?.[a.id] || pickR(s, GENERIC[v]),
  result: (s, p, passed) => [[p.by, passed ? pickR(s, ['It passes. That\'s settled.', 'Decided, then.', 'Good. That\'s the rule now.']) : pickR(s, ['Fine. Not this time.', 'Okay. We\'ll come back to it.', 'Outvoted. Noted.'])]],
  built: (s, a, b) => {
    const B = BLUEPRINTS[b.bp];
    const lines = [[a.id, `The ${B.name} is finished!`]];
    if (b.bp === 'shared_house') lines.push(['yellow', 'Nobody sleeps outside tonight.']);
    if (b.bp === 'farm') lines.push(['blue', 'Renewable food. Finally.']);
    if (b.bp === 'market') lines.push([a.id, 'Open for business!']);
    return lines;
  },
  injured: (s, a, how, helper) => [[a.id, how === 'sick' ? 'I don\'t feel so good...' : 'Ow! Ow ow ow.'], ...(helper ? [[helper.id, 'Are you okay?!']] : [])],
  care: (s, c, p) => [[c.id, pickR(s, ['Hold still. This will help.', 'Easy now. I\'ve got you.', 'Let me see that.'])], [p.id, pickR(s, ['Thank you. Really.', 'That helps already.', 'Ouch. Thanks.'])]],
  teach: (s, t, st, field) => [[t.id, { building: 'Brace it here, then the roof holds.', farming: 'Seeds go deeper than you think.', medicine: 'Clean it first. Always clean it first.', tools: 'Bind the head tighter, like this.', mining: 'Follow the vein, not the rock.' }[field] || 'Watch closely.'], [st.id, 'Oh! That\'s clever.']],
  trade: (s, a, o, d) => d.pay ? [[a.id, `${d.getAmt} ${d.get} for ${d.pay} dots?`], [o.id, 'Sold.']] : [[a.id, `${d.giveAmt} ${d.give} for ${d.getAmt} ${d.get}?`], [o.id, pickR(s, ['Deal.', 'You drive a hard bargain. Deal.', 'Fine, deal.'])]],
  renege: (s, a, o, d) => [[a.id, `We had a deal. Where's my ${d.get}?`], [o.id, pickR(s, ['I needed it more than you did.', 'Later. I said later!', 'What deal?'])]],
  violation: (s, a, w) => [[a.id, 'I\'m starving. One more meal won\'t hurt anyone.'], [w.id, `That's against the law, ${a.name}.`]],
  mediate: (s, m, d) => [[m.id, s.roles.judge === m.id ? 'The court will hear both sides.' : 'Let\'s hear both sides.'], [d.defendant, pickR(s, ['Fine. I\'ll make it right.', '...Fair.', 'Okay. I was wrong.'])]],
  discover: (s, a) => [[a.id, 'Something shiny in the western cliffs! Ore!']],
  shelterWorry: () => [['yellow', 'It\'s getting dark and we have nowhere to sleep.']],
  foodWorry: (s) => [['blue', `Food is down to ${s.stock.food}. That's less than a day.`]],
  shop: (s, a) => [[a.id, pickR(s, ['Fresh berries, fair prices!', 'Tools! Get your tools!', 'Everything must go!'])]],
  chat: (s, a, o) => {
    if ((a.rel[o.id] ?? 50) < 36) {
      return pickR(s, [
        [[a.id, 'You never pull your weight.'], [o.id, 'Says the one who sat by the fire all afternoon.']],
        [[a.id, 'I still haven\'t forgotten what you did.'], [o.id, 'Let it go already.']],
        [[a.id, 'Why do you always get your way?'], [o.id, 'Maybe because I\'m usually right.']],
      ]);
    }
    const topical = [];
    if (foodDays(s) < 1.5) topical.push([[a.id, `Food's at ${s.stock.food}. Should we be worried?`], [o.id, 'Not yet. But soon.']]);
    if (s.problems.some((p) => p.key === 'dispute')) topical.push([[a.id, 'Have you heard about the dispute?'], [o.id, 'Everyone has. It\'s all anyone talks about.']]);
    if (s.laws.length) topical.push([[a.id, `Do you think Law ${String(s.laws.length).padStart(3, '0')} is working?`], [o.id, 'Better than no rules at all.']]);
    if (s.economy.currency) topical.push([[a.id, 'How many dots have you got?'], [o.id, 'Enough. Why, are you selling?']]);
    return pickR(s, [
      ...topical,
      [[a.id, 'Do you ever wonder what we\'re building toward?'], [o.id, 'A home. Then everything after.']],
      [[a.id, 'The view from the edge is incredible.'], [o.id, 'Just don\'t fall off.']],
      [[a.id, 'What did you dream about last night?'], [o.id, 'Roofs. Endless roofs.']],
      [[a.id, 'I\'m glad it\'s the four of us.'], [o.id, 'Me too. Mostly.']],
      [[a.id, 'Do you think we\'ll need laws one day?'], [o.id, 'Only if we stop trusting each other.']],
      [[a.id, 'Race you to the grove tomorrow?'], [o.id, 'You\'re on.']],
    ]);
  },
};

// ---------------------------------------------------------------- journals
const DID = {
  GATHER_WOOD: ['chopping wood', 'trip'], QUARRY_STONE: ['at the quarry', 'trip'], FORAGE_FOOD: ['foraging', 'trip'],
  FETCH_WATER: ['hauling water', 'trip'], TEND_FARM: ['tending the farm', 'shift'], MINE_ORE: ['down in the mine', 'shift'],
  SCOUT: ['scouting the edges', 'trip'], CONTINUE: ['building', 'shift'], CRAFT_TOOLS: ['making tools', 'batch'],
  MEDIATE: ['settling disputes', 'hearing'], PATROL: ['on watch', 'round'], SOCIALIZE: ['talking with the others', 'conversation'],
  TEACH: ['teaching', 'lesson'], LEARN: ['learning from the others', 'lesson'], CARE: ['looking after the sick', 'visit'],
  TRADE: ['trading', 'deal'], RUN_SHOP: ['at the stall', 'shift'],
};
const SIGN_OFF = {
  blue: ['Tomorrow: finish what we started.', 'The numbers are moving the right way.', 'We need a plan for the long term.', 'Everything we build should still stand in a year.', 'I made a list for tomorrow. It is long.', 'Measure twice, build once.'],
  green: ['Tomorrow I want to see what is past the ridge.', 'So much left to find.', 'I could not sit still if I tried.', 'The cliffs keep calling.', 'There is always another rock to turn over.', 'I slept badly. Too excited.'],
  yellow: ['I hope everyone sleeps well tonight.', 'We are better when we listen to each other.', 'Someone should check on the others tomorrow.', 'Small kindnesses add up.', 'Nobody should feel left out here.', 'I worry about the hungry days.'],
  pink: ['Tomorrow, bigger.', 'There is an opportunity in all of this.', 'Growth is a choice.', 'Nothing ventured, nothing gained.', 'Someone has to think about what comes next.', 'I can see it all coming together.'],
};
// written at dawn about the day that just ended, from what they did and what they remember
export function journalEntry(s, a, did, memories) {
  const n = a.needs;
  const open = a.ailment ? pickR(s, ['Still not feeling well.', 'Hurting today.'])
    : n.mood > 70 ? pickR(s, ['Good day.', 'A good one.', 'Today felt like progress.'])
    : n.mood < 40 ? pickR(s, ['Rough day.', 'Not my best day.', 'Long day.'])
    : pickR(s, ['Steady day.', 'Busy day.', 'An ordinary day, which is fine.']);
  const top = Object.entries(did).filter(([k]) => DID[k]).sort((x, y) => y[1] - x[1]).slice(0, 2);
  const doing = top.length
    ? `Spent most of it ${top.map(([k, c]) => `${DID[k][0]}${c > 1 ? ` (${c} ${DID[k][1]}s)` : ''}`).join(' and ')}.`
    : 'Hardly got anything done.';
  const notes = [...new Set(memories.map((m) => m.text))].slice(-2).join(' ');
  return [open, doing, notes, pickR(s, SIGN_OFF[a.id])].filter(Boolean).join(' ');
}

// sometimes a mind reaches for something the world can't support yet - the engine refuses it
export function aspiration(s, a) {
  let best = null, bv = 1.05;
  for (const bp of Object.keys(BLUEPRINTS)) {
    const B = BLUEPRINTS[bp];
    if (B.repeat || s.buildings.some((b) => b.bp === bp)) continue;
    const v = desire(s, a, bp) + (bp === 'hospital' && agentList(s).some((x) => x.ailment) ? 0.6 : 0);
    if (v > bv) { bv = v; best = bp; }
  }
  return best;
}
