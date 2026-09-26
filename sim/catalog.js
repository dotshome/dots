// dot.home - the laws of physics.
// Everything the world allows, what it costs and how long it takes. The agents reason about
// this world; only the engine (engine.js) is allowed to change it.

export const TICK = 10;                 // simulated minutes per engine tick
export const DAY = 24 * 60;
export const DAWN = 6 * 60;
export const BEDTIME = 21 * 60 + 30;
export const MEAL = { food: 2, water: 1 }; // what one meal consumes
export const DAILY_FOOD = 16;           // rough food use of four residents per day

export const RES = ['wood', 'stone', 'food', 'water', 'metal', 'tools'];
export const RES_ICON = { wood: '🪵', stone: '🪨', food: '🍎', water: '💧', metal: '⛓️', tools: '🛠️', dots: '●' };
export const BASE_PRICE = { wood: 1, stone: 1.5, food: 2, water: 0.5, metal: 4, tools: 8 };

// Every machine action an agent can take. `cat` is what personalities weigh, `zone` tells the
// 3D world where it happens, `xp` is the skill it trains (which is how roles emerge).
export const ACTIONS = {
  GATHER_WOOD:  { cat: 'gather',   xp: 'wood',     zone: 'forest',  hours: 2,   energy: 12, verb: 'chopping wood',      icon: '🪵' },
  QUARRY_STONE: { cat: 'gather',   xp: 'stone',    zone: 'quarry',  hours: 2,   energy: 16, verb: 'quarrying stone',    icon: '🪨', risk: 0.035 },
  FORAGE_FOOD:  { cat: 'gather',   xp: 'food',     zone: 'berries', hours: 2,   energy: 8,  verb: 'foraging berries',   icon: '🫐' },
  FETCH_WATER:  { cat: 'gather',   xp: 'water',    zone: 'spring',  hours: 1,   energy: 5,  verb: 'fetching water',     icon: '💧' },
  TEND_FARM:    { cat: 'gather',   xp: 'farm',     zone: 'farm',    hours: 2,   energy: 10, verb: 'tending the farm',   icon: '🌱' },
  MINE_ORE:     { cat: 'gather',   xp: 'mine',     zone: 'ore',     hours: 2,   energy: 18, verb: 'mining ore',         icon: '⛏️', risk: 0.04 },
  SCOUT:        { cat: 'explore',  xp: 'explore',  zone: 'edge',    hours: 3,   energy: 16, verb: 'scouting the edges', icon: '🧭', risk: 0.03 },
  START:        { cat: 'build',    xp: 'build',    zone: 'site',    hours: 1,   energy: 4,  verb: 'laying out',         icon: '📐' },
  CONTINUE:     { cat: 'build',    xp: 'build',    zone: 'site',    hours: 2,   energy: 14, verb: 'building',           icon: '🔨' },
  CRAFT_TOOLS:  { cat: 'craft',    xp: 'craft',    zone: 'workshop', hours: 2,  energy: 10, verb: 'crafting tools',     icon: '🛠️' },
  PROPOSE:      { cat: 'gov',      xp: 'gov',      zone: 'meeting', hours: 1,   energy: 2,  verb: 'making a proposal',  icon: '📜' },
  MEDIATE:      { cat: 'gov',      xp: 'mediate',  zone: 'meeting', hours: 1.5, energy: 4,  verb: 'settling a dispute', icon: '⚖️' },
  PATROL:       { cat: 'gov',      xp: 'patrol',   zone: 'patrol',  hours: 2,   energy: 8,  verb: 'keeping watch',      icon: '🛡️' },
  SOCIALIZE:    { cat: 'social',   xp: 'social',   zone: 'partner', hours: 1,   energy: 1,  verb: 'chatting',           icon: '💬' },
  TEACH:        { cat: 'social',   xp: 'teach',    zone: 'partner', hours: 1.5, energy: 5,  verb: 'teaching',           icon: '📖' },
  CARE:         { cat: 'care',     xp: 'care',     zone: 'patient', hours: 1.5, energy: 6,  verb: 'caring for',         icon: '🩹' },
  TRADE:        { cat: 'commerce', xp: 'commerce', zone: 'partner', hours: 0.5, energy: 1,  verb: 'trading',            icon: '🤝' },
  RUN_SHOP:     { cat: 'commerce', xp: 'shop',     zone: 'shop',    hours: 2,   energy: 5,  verb: 'running the shop',   icon: '🏪' },
  EAT:          { cat: 'survive',  zone: 'stores', hours: 0.5, energy: -3,  verb: 'eating',   icon: '🍎' },
  REST:         { cat: 'survive',  zone: 'home',   hours: 1,   energy: -16, verb: 'resting',  icon: '😌' },
  SLEEP:        { cat: 'survive',  zone: 'bed',    hours: 0,   energy: 0,   verb: 'sleeping', icon: '💤' },
};

// What can be built. Nothing here is a button: a blueprint only becomes possible once the
// world's state makes it so (`when`, `know`), and only the engine decides if it's affordable.
export const BLUEPRINTS = {
  campfire:       { name: 'campfire',       icon: '🔥', cost: { wood: 6, stone: 6 },              labor: 2 },
  shared_house:   { name: 'shared house',   icon: '🏠', cost: { wood: 40, stone: 12 },            labor: 16 },
  food_storage:   { name: 'food storage',   icon: '🧺', cost: { wood: 22, stone: 8 },             labor: 8 },
  farm:           { name: 'farm',           icon: '🌾', cost: { wood: 10 },                       labor: 8,  know: ['farming', 0.3] },
  well:           { name: 'well',           icon: '🪣', cost: { stone: 20 },                      labor: 6,  when: (s) => s.counters.waterTrips >= 12 },
  workshop:       { name: 'workshop',       icon: '🛠️', cost: { wood: 28, stone: 16 },            labor: 12, when: (s) => built(s, 'shared_house') },
  meeting_circle: { name: 'meeting circle', icon: '🗿', cost: { stone: 14 },                      labor: 4,  when: (s) => s.counters.votes >= 1 },
  house:          { name: 'house',          icon: '🏡', cost: { wood: 22, stone: 8 },             labor: 10, private: true, repeat: true, when: (s) => s.economy.regime !== 'communal' },
  market:         { name: 'market stall',   icon: '🏪', cost: { wood: 16 },                       labor: 5,  private: true, when: (s) => hasLaw(s, 'market_land') },
  clinic:         { name: 'clinic',         icon: '🩺', cost: { wood: 26, stone: 14 },            labor: 10, know: ['medicine', 0.4], when: (s) => s.counters.ailments >= 1 },
  school:         { name: 'school',         icon: '🏫', cost: { wood: 30, stone: 18 },            labor: 12, when: (s) => s.counters.lessons >= 6 },
  courthouse:     { name: 'courthouse',     icon: '⚖️', cost: { wood: 24, stone: 26 },            labor: 12, when: (s) => hasLaw(s, 'court') },
  watch_post:     { name: 'watch post',     icon: '🛡️', cost: { wood: 16, stone: 6 },             labor: 5,  when: (s) => hasLaw(s, 'warden') },
  road:           { name: 'stone road',     icon: '🛤️', cost: { stone: 28 },                      labor: 8,  when: (s) => s.counters.trips >= 120 },
  hospital:       { name: 'hospital',       icon: '🏥', cost: { wood: 80, stone: 30, metal: 20 }, labor: 24, know: ['medicine', 0.6], when: (s) => built(s, 'clinic') },
};

// Rules the residents can propose. None of these exist until a problem makes someone propose one.
export const POLICIES = {
  decide_rule: { title: 'How we decide', question: 'Should decisions affecting shared resources require approval from 3 of 4 residents?', law: 'Decisions affecting shared resources require approval from 3 of 4 residents.' },
  ration:      { title: 'Food rationing', question: 'While food is scarce, should each resident take at most two meals a day from the shared stores?', law: 'While food is scarce, each resident takes at most two meals a day from the shared stores.' },
  property:    { title: 'Who owns what we gather', question: 'Should whoever gathers resources keep half of what they gather?', law: 'Whoever gathers resources keeps half. The other half goes to the shared stores.' },
  currency:    { title: 'A common currency', question: 'Should we adopt a common unit of exchange, the dot, with 50 dots issued to every resident?', law: 'The dot is the common unit of exchange. Every resident starts with 50.' },
  market_land: { title: 'Business on common land', question: 'Should private businesses be permitted to occupy communal land?', law: 'Private businesses may occupy communal land.' },
  court:       { title: 'A court', question: 'Should disputes be settled by a court, with {who} as judge?', law: 'Disputes are settled by the court. {who} serves as judge.' },
  warden:      { title: 'Enforcing the rules', question: 'Should {who} be appointed warden to enforce the laws?', law: '{who} is appointed warden and enforces the laws.' },
  coordinator: { title: 'A coordinator', question: 'Should {who} become coordinator, running meetings and breaking ties?', law: '{who} is the settlement coordinator and breaks tied votes.' },
  tax:         { title: 'Public works tax', question: 'Should every sale pay 10% to the shared treasury to fund public works?', law: 'Every sale pays 10% to the shared treasury, which pays wages for public works.' },
  build:       { title: 'Build a {bp}', question: 'Should we build a {bp} with shared resources?' },
};

// ---------------------------------------------------------------- state helpers (pure)
export const dayOf = (s) => Math.floor(s.time / DAY) + 1;
export const minuteOfDay = (s) => s.time % DAY;
export const hourOf = (s) => (s.time % DAY) / 60;
export const isNight = (s) => { const h = hourOf(s); return h >= BEDTIME / 60 || h < DAWN / 60; };
export const pad = (n, w = 2) => String(n).padStart(w, '0');
export const clockOf = (s) => { const m = Math.floor(minuteOfDay(s)); return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
export const built = (s, bp) => s.buildings.some((b) => b.bp === bp && b.status === 'done');
export const building = (s, bp) => s.buildings.find((b) => b.bp === bp && b.status === 'done');
export const hasLaw = (s, kind) => s.laws.some((l) => l.kind === kind);
export const foodDays = (s) => s.stock.food / DAILY_FOOD;
export const agentList = (s) => Object.values(s.agents);
export const nameOf = (s, id) => s.agents[id]?.name ?? id;

// deterministic RNG that lives inside the world state, so a world replays identically
export function rand(s) {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const pickR = (s, arr) => arr[Math.floor(rand(s) * arr.length)];
