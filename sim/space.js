// dot.home - the Space: the civilization's collective memory.
// Everything that has happened lives in the world state; this module persists it and lays it out
// as the browsable archive visitors see. Today it persists to this browser; the same JSON is what
// a hosted Space (or a database) would hold, so every visitor watches one shared world.
import { BLUEPRINTS, RES, pad, agentList, nameOf, dayOf } from './catalog.js';
import { roleOf } from './minds.js';

const KEY = 'dothome.space.v1';

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function save(s) {
  try {
    const { outbox, ...rest } = s;
    rest.savedAt = Date.now();
    localStorage.setItem(KEY, JSON.stringify(rest));
  } catch { /* storage full or blocked - the world just won't persist */ }
}

export function clear() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// the Space as a tree of sections -> entries, for the archive panel
export function tree(s) {
  const e = s.economy;
  const done = s.buildings.filter((b) => b.status === 'done');
  const underway = s.buildings.filter((b) => b.status !== 'done');
  const label = (b) => `${BLUEPRINTS[b.bp].icon} ${b.owner ? nameOf(s, b.owner) + "'s " : ''}${BLUEPRINTS[b.bp].name}`;
  return [
    {
      name: 'World', items: [
        ['Day', `${dayOf(s)}`],
        ['Resources', RES.map((r) => `${r} ${s.stock[r]}`).join(' · ')],
        ['Buildings', done.length ? done.map(label).join(', ') : 'none yet'],
        ['Under construction', underway.length ? underway.map((b) => `${label(b)} ${b.status === 'planned' ? '(waiting for materials)' : Math.round(b.progress * 100) + '%'}`).join(', ') : 'nothing'],
        ['Infrastructure', ['well', 'road'].filter((k) => done.some((b) => b.bp === k)).map((k) => BLUEPRINTS[k].name).join(', ') || 'none'],
        ['Environment', `${s.nodes.trees.filter((t) => t > 0).length}/14 trees · ${s.nodes.berries.reduce((x, y) => x + y, 0)} berries · ${s.nodes.oreFound ? `ore vein (${s.nodes.ore} left)` : 'unexplored cliffs'}`],
      ],
    },
    {
      name: 'Society', items: [
        ['Population', '4'],
        ['Roles', agentList(s).map((a) => `${a.name}: ${roleOf(s, a) || 'none yet'}`).join(' · ')],
        ['Relationships', relationshipSummary(s)],
        ['Organizations', [s.roles.judge && 'Court', s.roles.warden && 'Watch', s.roles.coordinator && 'Coordinator\'s office', ...e.businesses.map((b) => b.name)].filter(Boolean).join(', ') || 'none'],
        ['Property', e.regime === 'communal' ? 'Everything is communal' : `Gatherers keep ${e.regime === 'mixed' ? 'half' : 'all'} · ${s.buildings.filter((b) => b.owner).map(label).join(', ') || 'no private buildings yet'}`],
      ],
    },
    {
      name: 'Government', items: [
        ['Current laws', s.laws.length ? s.laws.map((l) => `LAW ${pad(l.num, 3)}`).join(', ') : 'none'],
        ['Proposals', s.proposals.length ? `${s.proposals.length} (${s.proposals.filter((p) => p.status === 'passed').length} passed)` : 'none'],
        ['Votes held', `${s.counters.votes}`],
        ['Disputes', s.disputes.length ? `${s.disputes.length} (${s.disputes.filter((d) => d.status === 'open').length} open)` : 'none'],
        ['Court decisions', `${s.disputes.filter((d) => d.status === 'resolved' && d.by === s.roles.judge).length}`],
      ],
    },
    {
      name: 'Economy', items: [
        ['Currency', e.currency ? `the dot (since day ${e.currency.day})` : 'none: barter or sharing'],
        ['Balances', e.currency ? agentList(s).map((a) => `${a.name} ${e.ledger[a.id] ?? 0}`).join(' · ') : 'n/a'],
        ['Treasury', e.currency ? `${e.treasury} dots${e.tax ? ` · tax ${Math.round(e.tax * 100)}%` : ''}` : 'n/a'],
        ['Businesses', e.businesses.map((b) => b.name).join(', ') || 'none'],
        ['Transactions', `${e.transactions.length}`],
        ['Prices', e.currency ? Object.entries(e.prices).map(([k, v]) => `${k} ${v}`).join(' · ') : 'n/a'],
      ],
    },
    {
      name: 'History', items: s.history.filter((h) => h.kind === 'milestone').slice(-8).map((h) => [`Day ${pad(h.day, 3)}`, h.text]),
    },
  ];
}

function relationshipSummary(s) {
  const pairs = [];
  const ids = Object.keys(s.agents);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = s.agents[ids[i]], b = s.agents[ids[j]];
    pairs.push([a, b, ((a.rel[b.id] ?? 50) + (b.rel[a.id] ?? 50)) / 2]);
  }
  pairs.sort((x, y) => y[2] - x[2]);
  const best = pairs[0], worst = pairs[pairs.length - 1];
  return `closest: ${best[0].name} & ${best[1].name} (${Math.round(best[2])}) · most strained: ${worst[0].name} & ${worst[1].name} (${Math.round(worst[2])})`;
}
