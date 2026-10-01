// dot.home - the Space, as pages. The civilization's shared memory laid out like a workspace:
// folders, pages and subpages, every one written by the simulation and updated live.
// Each page has its own address (#/space/decisions/007), so any moment can be linked and shared.
import { BLUEPRINTS, RES, RES_ICON, pad, dayOf, clockOf, nameOf, agentList } from '../sim/catalog.js';
import { IDENTITIES, roleOf } from '../sim/minds.js';
import { esc, dotHTML, barHTML, agentSections, describeTask, taskIcon } from './panels.js';

const ORDER = ['blue', 'green', 'yellow', 'pink'];
const D3 = (n) => pad(n, 3);
const article = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
const HOW = { alone: 'decided alone (no rule existed yet)', private: 'a private decision', vote: 'put to a vote' };
const STANCE = { support: 'SUPPORT', oppose: 'OPPOSE', undecided: 'UNDECIDED' };

export function createSpaceView({ colors, mapData, onOpen, onClose }) {
  const root = document.getElementById('spaceView');
  const tree = root.querySelector('.sv-tree');
  const page = root.querySelector('.sv-page');
  const tip = root.querySelector('.sv-tip');
  const expanded = new Set(['world', 'society', 'economy']);
  let current = 'home', isOpen = false, last = { page: '', tree: '' }, tPage = 0, tTree = 0, held = false, S = null;
  const dot = (id) => dotHTML(colors, id);
  const link = (path, label) => `<a href="#/space/${path}" data-go="${path}">${label}</a>`;
  const who = (id) => `${dot(id)}${link(`society/citizens/${id}`, esc(nameOf(S, id)))}`;

  // ---------------------------------------------------------------- navigation
  root.addEventListener('pointerdown', () => (held = true));
  addEventListener('pointerup', () => setTimeout(() => (held = false), 0));
  root.addEventListener('click', (e) => {
    if (e.target.closest('.sv-close')) { e.preventDefault(); close(); return; }
    if (e.target.closest('.sv-menu')) { root.classList.toggle('side-open'); return; }
    const fold = e.target.closest('[data-fold]');
    if (fold) { const k = fold.dataset.fold; expanded.has(k) ? expanded.delete(k) : expanded.add(k); last.tree = ''; draw(); return; }
    const a = e.target.closest('[data-go]');
    if (a) { e.preventDefault(); go(a.dataset.go); root.classList.remove('side-open'); }
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) close(); });

  function go(path, push = true) {
    current = path || 'home';
    const top = current.split('/')[0];
    if (['history', 'decisions', 'journal'].includes(top) || ['world', 'society', 'economy'].includes(top)) expanded.add(top);
    if (push && location.hash !== `#/space/${current}`) location.hash = `#/space/${current}`;
    last = { page: '', tree: '' };
    draw();
    page.scrollTop = 0;
  }
  function open(path) {
    if (!isOpen) { isOpen = true; root.classList.add('open'); onOpen?.(); }
    go(path, false);
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    root.classList.remove('open');
    if (location.hash.startsWith('#/space')) history.replaceState(null, '', location.pathname + location.search);
    onClose?.();
  }

  // ---------------------------------------------------------------- the page tree
  function sections(s) {
    const days = [...(s.days || [])].reverse();
    const decisions = [...(s.decisions || [])].reverse();
    return [
      { path: 'home', icon: '🏠', title: 'Home — AI Society' },
      { path: 'world', icon: '🌍', title: 'World', kids: [
        { path: 'world/state', icon: '📄', title: 'Current State' },
        { path: 'world/resources', icon: '📄', title: 'Resources' },
        { path: 'world/map', icon: '🗺️', title: 'Map' },
        { path: 'world/infrastructure', icon: '📄', title: 'Infrastructure' },
      ] },
      { path: 'society', icon: '👥', title: 'Society', kids: [
        { path: 'society/citizens', icon: '📄', title: 'Citizens', kids: ORDER.map((id) => ({ path: `society/citizens/${id}`, icon: '•', color: id, title: nameOf(s, id) })) },
        { path: 'society/relationships', icon: '📄', title: 'Relationships' },
        { path: 'society/rules', icon: '📄', title: 'Rules' },
        { path: 'society/government', icon: '📄', title: 'Government' },
      ] },
      { path: 'economy', icon: '💰', title: 'Economy', kids: [
        { path: 'economy/inventory', icon: '📄', title: 'Inventory' },
        { path: 'economy/businesses', icon: '📄', title: 'Businesses' },
        { path: 'economy/currency', icon: '📄', title: 'Currency' },
        { path: 'economy/transactions', icon: '📄', title: 'Transactions' },
      ] },
      { path: 'history', icon: '📜', title: 'History', count: days.length + 1, kids: [
        { path: `history/day-${D3(dayOf(s))}`, icon: '📄', title: `Day ${D3(dayOf(s))} (today)` },
        ...days.slice(0, 40).map((d) => ({ path: `history/day-${D3(d.day)}`, icon: '📄', title: `Day ${D3(d.day)}` })),
      ] },
      { path: 'decisions', icon: '🗳️', title: 'Decisions', count: decisions.length, kids: decisions.slice(0, 40).map((d) => ({ path: `decisions/${D3(d.id)}`, icon: '📄', title: `#${D3(d.id)} — ${d.title}` })) },
      { path: 'journal', icon: '📓', title: 'Agent Journal', kids: ORDER.map((id) => ({ path: `journal/${id}`, icon: '•', color: id, title: nameOf(s, id) })) },
    ];
  }

  function treeHTML(nodes, depth = 0) {
    return nodes.map((n) => {
      const hasKids = n.kids && n.kids.length;
      const isOpenNode = hasKids && (expanded.has(n.path) || current.startsWith(n.path + '/'));
      const active = current === n.path;
      const icon = n.color ? `<i class="dot" style="--c:${colors[n.color]}"></i>` : `<span class="ic">${n.icon}</span>`;
      return `<div class="sv-node" style="--d:${depth}">
        <div class="sv-row ${active ? 'on' : ''}">
          ${hasKids ? `<button class="caret ${isOpenNode ? 'open' : ''}" data-fold="${n.path}" aria-label="Expand">▸</button>` : '<span class="caret-pad"></span>'}
          <a href="#/space/${n.path}" data-go="${n.path}">${icon}<span class="t">${esc(n.title)}</span>${n.count ? `<span class="n">${n.count}</span>` : ''}</a>
        </div>
        ${isOpenNode ? treeHTML(n.kids, depth + 1) : ''}
      </div>`;
    }).join('');
  }

  // ---------------------------------------------------------------- small building blocks
  const crumbs = (path) => {
    const parts = path.split('/');
    const out = [link('home', 'dot.home Space')];
    for (let i = 0; i < parts.length - 1; i++) out.push(link(parts.slice(0, i + 1).join('/'), esc(titleCase(parts[i]))));
    return `<div class="crumbs">${out.join(' / ')}</div>`;
  };
  const titleCase = (w) => w.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  const meta = (s) => `<div class="pmeta">Written by the simulation · updated Day ${D3(dayOf(s))} ${clockOf(s)}</div>`;
  const head = (s, path, icon, title, lead = '') => `${crumbs(path)}<h1><span class="pi">${icon}</span>${esc(title)}</h1>${meta(s)}${lead ? `<p class="lead">${lead}</p>` : ''}`;
  const table = (cols, rows, cls = '') => `<table class="${cls}"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const cards = (items) => `<div class="cards">${items.map(([path, icon, title, sub]) => `<a class="pcard" href="#/space/${path}" data-go="${path}"><span class="pi">${icon}</span><b>${esc(title)}</b><span>${sub}</span></a>`).join('')}</div>`;
  const empty = (t) => `<p class="empty">${t}</p>`;
  const decisionLink = (d) => link(`decisions/${D3(d.id)}`, `#${D3(d.id)} — ${esc(d.title)}`);

  // one small line chart per measure: a single series needs no legend; hover reads exact values
  function spark(label, pts) {
    const W = 320, H = 96, P = { l: 30, r: 46, t: 10, b: 20 };
    if (pts.length < 2) return `<figure class="spark"><figcaption>${label}</figcaption>${empty('Not enough days yet.')}</figure>`;
    const max = Math.max(1, ...pts.map((p) => p.v));
    const x = (i) => P.l + (i / (pts.length - 1)) * (W - P.l - P.r);
    const y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
    const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const lastP = pts[pts.length - 1];
    return `<figure class="spark"><figcaption>${label}</figcaption>
      <svg viewBox="0 0 ${W} ${H}" data-series='${JSON.stringify(pts.map((p) => [p.label, p.v]))}' data-pl="${P.l}" data-pr="${P.r}" data-w="${W}">
        <line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${y(max)}" y2="${y(max)}"/>
        <line class="axis" x1="${P.l}" x2="${W - P.r}" y1="${H - P.b}" y2="${H - P.b}"/>
        <text class="tick" x="${P.l - 6}" y="${y(max) + 4}" text-anchor="end">${max}</text>
        <text class="tick" x="${P.l - 6}" y="${H - P.b + 4}" text-anchor="end">0</text>
        <text class="tick" x="${P.l}" y="${H - 4}">${esc(pts[0].label)}</text>
        <text class="tick" x="${W - P.r}" y="${H - 4}" text-anchor="end">${esc(lastP.label)}</text>
        <polyline points="${line}"/>
        <circle cx="${x(pts.length - 1)}" cy="${y(lastP.v)}" r="4"/>
        <text class="val" x="${x(pts.length - 1) + 8}" y="${y(lastP.v) + 4}">${lastP.v}</text>
        <line class="xh" x1="0" x2="0" y1="${P.t}" y2="${H - P.b}" style="display:none"/>
      </svg></figure>`;
  }
  page.addEventListener('pointermove', (e) => {
    const svg = e.target.closest('svg[data-series]');
    if (!svg) { tip.style.display = 'none'; page.querySelectorAll('.xh').forEach((l) => (l.style.display = 'none')); return; }
    const data = JSON.parse(svg.dataset.series), r = svg.getBoundingClientRect();
    const W = +svg.dataset.w, pl = +svg.dataset.pl, pr = +svg.dataset.pr;
    const sx = (e.clientX - r.left) / r.width * W;
    const i = Math.max(0, Math.min(data.length - 1, Math.round((sx - pl) / (W - pl - pr) * (data.length - 1))));
    const xx = pl + (i / (data.length - 1)) * (W - pl - pr);
    const xh = svg.querySelector('.xh');
    xh.setAttribute('x1', xx); xh.setAttribute('x2', xx); xh.style.display = '';
    tip.innerHTML = `<b>${esc(data[i][0])}</b> ${data[i][1]}`;
    tip.style.display = 'block';
    tip.style.left = `${e.clientX + 12}px`; tip.style.top = `${e.clientY - 28}px`;
  });
  page.addEventListener('pointerleave', () => { tip.style.display = 'none'; });

  // ---------------------------------------------------------------- pages
  function home(s) {
    const milestones = s.history.filter((h) => h.kind === 'milestone').slice(-6).reverse();
    const decisions = (s.decisions || []).slice(-5).reverse();
    const built = s.buildings.filter((b) => b.status === 'done').length;
    return `${head(s, 'home', '🏠', 'Home — AI Society', 'Four autonomous agents on an empty patch of land. Nobody tells them what a society should look like. This Space is their shared memory: every page is written by the simulation as it happens, and nothing here is scripted.')}
      <div class="stats">
        <div><b>${dayOf(s)}</b><span>day</span></div><div><b>4</b><span>population</span></div>
        <div><b>${built}</b><span>buildings</span></div><div><b>${s.laws.length}</b><span>laws</span></div>
        <div><b>${(s.decisions || []).length}</b><span>decisions</span></div>
        ${s.economy.currency ? `<div><b>${ORDER.reduce((t, id) => t + (s.economy.ledger[id] || 0), 0) + s.economy.treasury}</b><span>dots in circulation</span></div>` : ''}
      </div>
      <h2>Right now</h2>
      <ul class="rows">${ORDER.map((id) => `<li>${who(id)} <span class="muted">${taskIcon(s.agents[id])} ${esc(describeTask(s, s.agents[id]))}</span></li>`).join('')}</ul>
      <h2>Latest milestones</h2>
      ${milestones.length ? `<ul class="rows">${milestones.map((h) => `<li><span class="day">${link(`history/day-${D3(h.day)}`, `Day ${D3(h.day)}`)}</span> ${esc(h.text)}</li>`).join('')}</ul>` : empty('Nothing yet. Give them time.')}
      <h2>Recent decisions</h2>
      ${decisions.length ? `<ul class="rows">${decisions.map((d) => `<li>${decisionLink(d)} <span class="muted">· ${esc(nameOf(s, d.by))}, Day ${D3(d.day)}</span></li>`).join('')}</ul>` : empty('No decisions that shape the settlement yet.')}
      <h2>Pages</h2>
      ${cards([
        ['world/state', '🌍', 'World', 'state, resources, map, infrastructure'],
        ['society/citizens', '👥', 'Society', 'citizens, relationships, rules, government'],
        ['economy/inventory', '💰', 'Economy', 'inventory, businesses, currency, transactions'],
        ['history', '📜', 'History', `${(s.days || []).length + 1} days so far`],
        ['decisions', '🗳️', 'Decisions', `${(s.decisions || []).length} recorded`],
        ['journal', '📓', 'Agent Journal', 'what each of them wrote'],
      ])}`;
  }

  function worldState(s) {
    const house = s.buildings.find((b) => b.bp === 'shared_house');
    const weather = s.time < (s.stormUntil || 0) ? '⛈️ storm' : s.time < (s.droughtUntil || 0) ? '☀️ drought' : 'clear';
    return `${head(s, 'world/state', '📄', 'Current State', 'The objective truth every agent is given before it decides anything.')}
      <h2>World state</h2>
      ${table(['', ''], [
        ['Day / time', `Day ${dayOf(s)} · ${clockOf(s)}`], ['Population', '4'], ['Weather', weather],
        ['Shared stores', RES.map((r) => `${RES_ICON[r]} ${s.stock[r]}`).join('&nbsp; ')],
        ['Shelter', house ? (house.status === 'done' ? 'shared house finished' : `shared house ${Math.round(house.progress * 100)}%`) : 'none'],
        ['Property', s.economy.regime === 'communal' ? 'everything is communal' : 'gatherers keep half'],
        ['Currency', s.economy.currency ? 'the dot' : 'none'],
      ], 'kvt')}
      <h2>Problems</h2>
      ${s.problems.length ? `<ul class="rows">${s.problems.map((p) => `<li>⚠️ ${esc(p.text)}</li>`).join('')}</ul>` : empty('No open problems right now.')}
      <h2>Counters</h2>
      ${table(['', ''], Object.entries(s.counters).map(([k, v]) => [esc(k.replace(/([A-Z])/g, ' $1').toLowerCase()), v]), 'kvt')}`;
  }

  function resources(s) {
    const days = s.days || [];
    const series = (r) => [...days.map((d) => ({ label: `Day ${d.day}`, v: d.stock[r] })), { label: 'now', v: s.stock[r] }];
    const shown = RES.filter((r) => s.stock[r] || days.some((d) => d.stock[r]));
    return `${head(s, 'world/resources', '📄', 'Resources', 'What is in the shared stores, measured at the end of every day. Hover a chart to read a day.')}
      ${table(['Resource', 'Shared stores', 'Held privately'], RES.map((r) => [`${RES_ICON[r]} ${r}`, s.stock[r], ORDER.reduce((t, id) => t + s.agents[id].inv[r], 0)]))}
      <h2>Over time</h2>
      <div class="sparks">${shown.map((r) => spark(`${RES_ICON[r]} ${r}`, series(r))).join('')}</div>
      <h2>Nature</h2>
      ${table(['', ''], [
        ['Trees standing', `${s.nodes.trees.filter((t) => t > 0).length} of ${s.nodes.trees.length}`],
        ['Berries on the bushes', s.nodes.berries.reduce((a, b) => a + b, 0)],
        ['Quarry', `${s.nodes.quarry} stone left`],
        ['Ore vein', s.nodes.oreFound ? `${s.nodes.ore} ore left` : 'not discovered'],
      ], 'kvt')}`;
  }

  function map(s) {
    const m = mapData();
    const sc = 26, c = 260; // world units -> svg px
    const P = (x, z) => [c + x * sc, c + z * sc];
    const outline = m.outline.map(([x, z]) => P(x, z).join(',')).join(' ');
    const zone = (k, icon, label) => { const [x, y] = P(...m.zones[k]); return `<g class="zone"><text x="${x}" y="${y}" class="zi">${icon}</text><text x="${x}" y="${y + 18}" class="zl">${label}</text></g>`; };
    const bld = m.buildings.map((b) => {
      const [x, y] = P(b.x, b.z), w = Math.max(14, b.size * sc * 0.8);
      const B = BLUEPRINTS[b.bp];
      return `<g class="bld ${b.status}"><rect x="${x - w / 2}" y="${y - w / 2}" width="${w}" height="${w}" rx="6" style="${b.owner ? `stroke:${colors[b.owner]}` : ''}"/><text x="${x}" y="${y + 5}" class="bi">${B.icon}</text>${b.status !== 'done' ? `<text x="${x}" y="${y + w / 2 + 12}" class="zl">${b.status === 'planned' ? 'planned' : Math.round(b.progress * 100) + '%'}</text>` : ''}</g>`;
    }).join('');
    const trees = m.trees.map((t) => { const [x, y] = P(t.x, t.z); return `<circle cx="${x}" cy="${y}" r="${t.alive ? 6 : 2.5}" class="${t.alive ? 'tree' : 'stump'}"/>`; }).join('');
    const ags = m.agents.map((a) => { const [x, y] = P(a.x, a.z); return `<g class="ag"><circle cx="${x}" cy="${y}" r="8" style="fill:${colors[a.id]}"/><text x="${x}" y="${y - 12}" class="an">${esc(a.name)}${a.inside ? ' 💤' : ''}</text></g>`; }).join('');
    return `${head(s, 'world/map', '🗺️', 'Map', 'The plot from above, live. Buildings appear where they are raised; dots show where each agent is right now.')}
      <div class="mapwrap"><svg viewBox="0 0 520 520" class="map">
        <polygon points="${outline}" class="land"/>
        ${trees}
        ${zone('quarry', '🪨', 'quarry')}${zone('spring', '💧', 'spring')}${zone('berries', '🫐', 'berries')}${zone('forest', '', 'grove')}${m.oreFound ? zone('ore', '⛏️', 'ore vein') : ''}${zone('stores', '📦', 'shared stores')}
        ${bld}${ags}
      </svg></div>
      <ul class="legend">${ORDER.map((id) => `<li>${dot(id)}${esc(nameOf(s, id))}</li>`).join('')}<li>▢ building (outlined in an owner's colour if private)</li></ul>`;
  }

  function infrastructure(s) {
    const rows = s.buildings.map((b) => {
      const B = BLUEPRINTS[b.bp];
      const d = (s.decisions || []).find((x) => x.building === b.id);
      const status = b.status === 'done' ? `finished day ${b.done}` : b.status === 'planned' ? 'waiting for materials' : `${Math.round(b.progress * 100)}% built`;
      return [`${B.icon} ${esc(B.name)}`, status, b.owner ? who(b.owner) : 'shared', `day ${b.started}`, d ? decisionLink(d) : '–'];
    });
    return `${head(s, 'world/infrastructure', '📄', 'Infrastructure', 'Everything they have built or started building, and the decision behind each.')}
      ${rows.length ? table(['Building', 'Status', 'Owner', 'Started', 'Decision'], rows) : empty('Nothing built yet. It is still an empty plot.')}`;
  }

  function citizens(s) {
    return `${head(s, 'society/citizens', '📄', 'Citizens', 'Four residents. Traits shape them; roles are earned from what they actually do.')}
      <div class="cards">${ORDER.map((id) => {
        const a = s.agents[id], I = IDENTITIES[id], role = roleOf(s, a);
        return `<a class="pcard who" href="#/space/society/citizens/${id}" data-go="society/citizens/${id}" style="--c:${colors[id]}"><i class="sw"></i><b>${esc(a.name)}</b><span>${I.color} · ${I.trait}${role ? ` · ${esc(role)}` : ''}</span><span class="muted">${taskIcon(a)} ${esc(describeTask(s, a))}</span></a>`;
      }).join('')}</div>`;
  }

  function citizen(s, id) {
    const a = s.agents[id];
    if (!a) return notFound(s);
    const I = IDENTITIES[id];
    const mine = (s.decisions || []).filter((d) => d.by === id).slice(-6).reverse();
    const notes = (s.journal || []).filter((j) => j.id === id).slice(-2).reverse();
    return `${head(s, `society/citizens/${id}`, '', `${a.name}`, `Agent ${I.color} · ${I.trait} · priority: ${I.priority}`)}
      <div class="detail citizen" style="--c:${colors[id]}">${agentSections(s, id, colors)}</div>
      <h2>Decisions ${esc(a.name)} made</h2>
      ${mine.length ? `<ul class="rows">${mine.map((d) => `<li>${decisionLink(d)} <span class="muted">· Day ${D3(d.day)}</span></li>`).join('')}</ul>` : empty('None that shaped the settlement yet.')}
      <h2>From the journal</h2>
      ${notes.length ? notes.map((j) => `<blockquote><span class="muted">Day ${D3(j.day)}</span> ${esc(j.text)}</blockquote>`).join('') + `<p>${link(`journal/${id}`, 'Read the whole journal →')}</p>` : empty('The first entry is written at dawn on day 2.')}`;
  }

  function relationships(s) {
    // one hue, light to dark: how much each resident (row) trusts each other resident (column)
    const cell = (v) => {
      const k = v / 100;
      const bg = `color-mix(in oklab, #4f6bff ${Math.round(12 + k * 80)}%, #f4f6ff)`;
      return `<td class="heat" style="background:${bg};color:${k > 0.55 ? '#fff' : '#1c1f2e'}" title="${v}">${v}</td>`;
    };
    const rows = ORDER.map((r) => `<tr><th>${dot(r)}${esc(nameOf(s, r))}</th>${ORDER.map((c) => (r === c ? '<td class="self">—</td>' : cell(Math.round(s.agents[r].rel[c] ?? 50)))).join('')}</tr>`).join('');
    const pairs = [];
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      const a = ORDER[i], b = ORDER[j];
      pairs.push([a, b, Math.round(((s.agents[a].rel[b] ?? 50) + (s.agents[b].rel[a] ?? 50)) / 2)]);
    }
    pairs.sort((x, y) => y[2] - x[2]);
    return `${head(s, 'society/relationships', '📄', 'Relationships', 'Trust, from 0 to 100. Read across a row: how much that resident trusts each of the others. It is not always mutual.')}
      <table class="matrix"><thead><tr><th></th>${ORDER.map((c) => `<th>${dot(c)}${esc(nameOf(s, c))}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
      <h2>Pairs</h2>
      <ul class="rows">${pairs.map(([a, b, v]) => `<li>${who(a)} &amp; ${who(b)} <span class="muted">· ${v}${v >= 70 ? ' · close' : v < 40 ? ' · strained' : ''}</span></li>`).join('')}</ul>`;
  }

  function rules(s) {
    return `${head(s, 'society/rules', '📄', 'Rules', 'Every law here was proposed by one of them and passed by vote. None existed on day one.')}
      ${s.laws.length ? s.laws.map((l) => {
        const d = (s.decisions || []).find((x) => x.proposal === l.proposal);
        return `<div class="law"><b>LAW ${D3(l.num)}</b><p>${esc(l.text)}</p><span class="muted small">Passed day ${D3(l.day)} · proposed by ${who(l.by)}${d ? ` · ${decisionLink(d)}` : ''}</span></div>`;
      }).join('') : empty('No laws yet. So far, whoever has the materials just decides.')}`;
  }

  function government(s) {
    const r = s.roles;
    const rule = s.laws.find((l) => l.kind === 'decide_rule');
    const props = [...s.proposals].reverse().slice(0, 30).map((p) => {
      const d = (s.decisions || []).find((x) => x.proposal === p.num);
      return [`#${D3(p.num)}`, d ? decisionLink(d) : esc(p.title), who(p.by), p.status === 'open' ? 'voting' : `${p.status} ${p.result}`, ORDER.map((id) => `${dot(id)}${p.votes[id] ? STANCE[p.votes[id]][0] : '·'}`).join(' ')];
    });
    const disputes = [...s.disputes].reverse().slice(0, 20).map((d) => [`#${D3(d.num)}`, `${who(d.plaintiff)} v. ${who(d.defendant)}`, esc(d.about), d.status === 'open' ? 'open' : `${esc(d.ruling)}${d.by ? ` (${esc(nameOf(s, d.by))})` : ''}`]);
    return `${head(s, 'society/government', '📄', 'Government', 'Who holds which role, how decisions get made, and every proposal and dispute so far.')}
      <h2>Offices</h2>
      ${table(['', ''], [['Coordinator', r.coordinator ? who(r.coordinator) : 'none yet'], ['Judge', r.judge ? who(r.judge) : 'none yet'], ['Warden', r.warden ? who(r.warden) : 'none yet']], 'kvt')}
      <h2>How decisions are made</h2>
      <p>${rule ? esc(rule.text) : 'There is no rule yet. Whoever has the materials can just start building.'}</p>
      <h2>Proposals</h2>
      ${props.length ? table(['#', 'Proposal', 'By', 'Result', 'Votes'], props) : empty('Nobody has proposed anything yet.')}
      <h2>Disputes</h2>
      ${disputes.length ? table(['#', 'Parties', 'About', 'Ruling'], disputes) : empty('No disputes. Yet.')}`;
  }

  function inventory(s) {
    return `${head(s, 'economy/inventory', '📄', 'Inventory', 'Everything that exists, and who it belongs to.')}
      <h2>Shared stores</h2>
      ${table(RES.map((r) => `${RES_ICON[r]} ${r}`), [RES.map((r) => s.stock[r])])}
      <h2>Private holdings</h2>
      ${s.economy.regime === 'communal' ? empty('Nothing is privately owned. Everything gathered goes to the shared stores.') : table(['', ...RES.map((r) => `${RES_ICON[r]}`), ...(s.economy.currency ? ['●'] : [])], ORDER.map((id) => [who(id), ...RES.map((r) => s.agents[id].inv[r] || ''), ...(s.economy.currency ? [s.economy.ledger[id] ?? 0] : [])]))}`;
  }

  function businesses(s) {
    const e = s.economy;
    return `${head(s, 'economy/businesses', '📄', 'Businesses', 'Private enterprises. None of them were planned; each one started because someone saw an opportunity.')}
      ${e.businesses.length ? table(['Business', 'Owner', 'Open since', 'Sales'], e.businesses.map((b) => {
        const sales = e.transactions.filter((t) => t.to === b.owner && t.what.includes('stall'));
        return [esc(b.name), who(b.owner), `day ${b.day}`, `${sales.length} recent · ${sales.reduce((x, t) => x + t.amount, 0)} dots`];
      })) : empty(e.currency ? 'The currency exists, but nobody has opened a business yet.' : 'No businesses. There is not even a currency yet.')}`;
  }

  function currency(s) {
    const e = s.economy;
    if (!e.currency) return `${head(s, 'economy/currency', '📄', 'Currency')}${empty(`No currency. ${e.regime === 'communal' ? 'Nothing is owned, so nothing is traded.' : `Exchange happens by barter: ${s.counters.barter} trades so far.`}`)}`;
    const max = Math.max(1, ...ORDER.map((id) => e.ledger[id] || 0));
    return `${head(s, 'economy/currency', '📄', 'Currency', `The dot, adopted on day ${e.currency.day}.`)}
      <h2>Ledger</h2>
      <div class="kv bars wide">${ORDER.map((id) => `<span>${dot(id)}${esc(nameOf(s, id))}</span><span class="led">${barHTML((e.ledger[id] || 0) / max * 100, colors[id])}<b>${e.ledger[id] || 0}</b></span>`).join('')}</div>
      ${table(['', ''], [['Treasury', `${e.treasury} dots`], ['Tax', e.tax ? `${Math.round(e.tax * 100)}% of every sale` : 'none']], 'kvt')}
      <h2>Prices</h2>
      ${table(RES.map((r) => `${RES_ICON[r]} ${r}`), [RES.map((r) => `${e.prices[r]} ●`)])}`;
  }

  function transactions(s) {
    const t = [...s.economy.transactions].reverse().slice(0, 80);
    const party = (x) => (x === 'treasury' ? '🏛️ treasury' : who(x));
    return `${head(s, 'economy/transactions', '📄', 'Transactions', 'Every trade, sale, wage and fine, newest first.')}
      ${t.length ? table(['When', 'From', 'To', 'Dots', 'What'], t.map((x) => [`D${D3(x.day)} ${x.clock}`, party(x.from), party(x.to), x.amount || '', esc(x.what)])) : empty('No transactions yet.')}`;
  }

  function historyIndex(s) {
    const days = [...(s.days || [])].reverse();
    return `${head(s, 'history', '📜', 'History', 'One page per day. The record is written at dawn, when the day before is over.')}
      <ul class="rows days">
        <li>${link(`history/day-${D3(dayOf(s))}`, `<b>Day ${D3(dayOf(s))}</b>`)} <span class="muted">· today, still being written</span></li>
        ${days.map((d) => `<li>${link(`history/day-${D3(d.day)}`, `<b>Day ${D3(d.day)}</b>`)} <span class="muted">· ${esc(d.text)}</span>${d.highlights.length ? `<div class="hl">${d.highlights.map((h) => `★ ${esc(h)}`).join('<br>')}</div>` : ''}</li>`).join('')}
      </ul>`;
  }

  function dayPage(s, n) {
    const rec = (s.days || []).find((d) => d.day === n);
    const today = n === dayOf(s);
    if (!rec && !today) return notFound(s);
    const events = s.history.filter((h) => h.day === n && h.kind !== 'day');
    const talk = s.feed.filter((f) => f.day === n);
    const notes = (s.journal || []).filter((j) => j.day === n);
    const decided = (s.decisions || []).filter((d) => d.day === n);
    return `${head(s, `history/day-${D3(n)}`, '📄', `Day ${D3(n)}${today ? ' (today)' : ''}`, rec ? esc(rec.text) : 'Still being written.')}
      ${rec?.highlights.length ? `<div class="callout">${rec.highlights.map((h) => `★ ${esc(h)}`).join('<br>')}</div>` : ''}
      ${rec ? `<h2>Shared stores at the end of the day</h2>${table(RES.map((r) => `${RES_ICON[r]} ${r}`), [RES.map((r) => rec.stock[r])])}` : ''}
      <h2>Decisions</h2>
      ${decided.length ? `<ul class="rows">${decided.map((d) => `<li>${decisionLink(d)} <span class="muted">· ${esc(nameOf(s, d.by))} ${d.clock}</span></li>`).join('')}</ul>` : empty('None.')}
      <h2>What happened</h2>
      ${events.length ? `<ul class="rows log">${events.map((h) => `<li><span class="clk">${h.clock}</span>${h.kind === 'milestone' ? '<b>★ ' + esc(h.text) + '</b>' : esc(h.text)}</li>`).join('')}</ul>` : empty('The detailed log for this day has been summarized.')}
      ${notes.length ? `<h2>Journal entries</h2>${notes.map((j) => `<blockquote>${who(j.id)}<br>${esc(j.text)}</blockquote>`).join('')}` : ''}
      ${talk.length ? `<h2>Overheard</h2><ul class="rows log">${talk.slice(-30).map((f) => `<li><span class="clk">${f.clock}</span>${dot(f.id)}<b>${esc(nameOf(s, f.id))}</b> ${esc(f.text)}</li>`).join('')}</ul>` : ''}`;
  }

  function decisionsIndex(s) {
    const ds = [...(s.decisions || [])].reverse();
    const how = (d) => {
      if (d.kind !== 'vote') return HOW[d.kind];
      const p = s.proposals.find((x) => x.num === d.proposal);
      return p ? (p.status === 'open' ? 'vote in progress' : `vote: ${p.status} ${p.result}`) : 'vote';
    };
    return `${head(s, 'decisions', '🗳️', 'Decisions', 'Every choice that shaped the settlement: who made it, why, and whether anyone objected.')}
      ${ds.length ? table(['#', 'Decision', 'By', 'How', 'When'], ds.map((d) => [`#${D3(d.id)}`, link(`decisions/${D3(d.id)}`, esc(d.title)), who(d.by), how(d), `Day ${D3(d.day)}`])) : empty('No decisions yet.')}`;
  }

  function decisionPage(s, n) {
    const d = (s.decisions || []).find((x) => x.id === n);
    if (!d) return notFound(s);
    const b = d.building && s.buildings.find((x) => x.id === d.building);
    const p = d.kind === 'vote' && s.proposals.find((x) => x.num === d.proposal);
    const outcome = b ? `${BLUEPRINTS[b.bp].icon} ${BLUEPRINTS[b.bp].name}: ${b.status === 'done' ? `finished on day ${b.done}` : b.status === 'planned' ? 'waiting for materials' : `${Math.round(b.progress * 100)}% built`}` : '';
    const law = p && p.status === 'passed' && s.laws.find((l) => l.proposal === p.num);
    return `${head(s, `decisions/${D3(n)}`, '🗳️', `Decision #${D3(n)} — ${d.title}`)}
      ${table(['', ''], [['Decided by', who(d.by)], ['When', `Day ${D3(d.day)} · ${d.clock}`], ['How', esc(HOW[d.kind] || d.kind)], ...(d.cost ? [['Cost', Object.entries(d.cost).map(([k, v]) => `${v} ${k}`).join(', ')]] : [])], 'kvt')}
      ${d.reasoning ? `<h2>Why</h2><blockquote>“${esc(d.reasoning)}”<br><span class="muted">— ${esc(nameOf(s, d.by))}</span></blockquote>` : ''}
      ${d.options?.length ? `<h2>Options on the table</h2><ol class="opts big">${d.options.map((o, i) => `<li class="${o.code === `START_${(b?.bp || '').toUpperCase()}` ? 'pick' : ''}"><b>${'ABCD'[i]}</b><code>${esc(o.code)}</code><span>${o.u.toFixed(2)}</span></li>`).join('')}</ol><p class="muted small">The engine listed what was possible; the decision layer chose one.</p>` : ''}
      ${d.objection ? `<h2>Objection</h2><blockquote>${who(d.objection.by)}: “${esc(d.objection.text)}”${d.objection.reply ? `<br>${who(d.by)}: “${esc(d.objection.reply)}”` : ''}</blockquote>` : ''}
      ${p ? `<h2>The vote</h2><p class="q">${esc(p.question)}</p>
        <ul class="rows">${ORDER.map((id) => `<li>${who(id)} <b class="st ${p.votes[id] || 'pending'}">${p.votes[id] ? STANCE[p.votes[id]] : p.status === 'open' ? 'THINKING…' : 'ABSTAINED'}</b>${p.lines?.[id] ? ` <span class="muted">“${esc(p.lines[id].replace(/^\S+\s/, (m) => (/[👍👎🤔]/u.test(m) ? '' : m)))}”</span>` : ''}</li>`).join('')}</ul>
        <p><b class="${p.status}">${p.status === 'open' ? 'Voting is still open.' : `${p.status.toUpperCase()} ${p.result}`}</b></p>
        ${law ? `<div class="law"><b>LAW ${D3(law.num)}</b><p>${esc(law.text)}</p></div>` : ''}` : ''}
      ${outcome ? `<h2>Outcome</h2><p>${outcome} · ${link('world/infrastructure', 'Infrastructure')}</p>` : ''}`;
  }

  function journalIndex(s) {
    return `${head(s, 'journal', '📓', 'Agent Journal', 'Each of them writes an entry at dawn about the day before, from what they did and what they remember.')}
      <div class="cards">${ORDER.map((id) => {
        const j = (s.journal || []).filter((x) => x.id === id).slice(-1)[0];
        return `<a class="pcard who" href="#/space/journal/${id}" data-go="journal/${id}" style="--c:${colors[id]}"><i class="sw"></i><b>${esc(nameOf(s, id))}</b><span class="muted">${j ? `Day ${D3(j.day)}: ${esc(j.text.slice(0, 120))}${j.text.length > 120 ? '…' : ''}` : 'No entries yet.'}</span></a>`;
      }).join('')}</div>`;
  }

  function journal(s, id) {
    if (!s.agents[id]) return notFound(s);
    const entries = (s.journal || []).filter((x) => x.id === id).reverse();
    return `${head(s, `journal/${id}`, '📓', `${nameOf(s, id)}'s journal`)}
      ${entries.length ? entries.map((j) => `<div class="entry"><span class="day">${link(`history/day-${D3(j.day)}`, `Day ${D3(j.day)}`)}</span><p>${esc(j.text)}</p></div>`).join('') : empty('The first entry is written at dawn on day 2.')}`;
  }

  function folder(s, path, icon, title, kids) {
    return `${head(s, path, icon, title)}${cards(kids)}`;
  }
  const notFound = (s) => `${head(s, current, '❓', 'Page not found')}${empty('This page does not exist (yet).')}`;

  function render(s) {
    const [a, b, c] = current.split('/');
    switch (a) {
      case 'home': return home(s);
      case 'world':
        if (!b) return folder(s, 'world', '🌍', 'World', [['world/state', '📄', 'Current State', 'the truth every agent sees'], ['world/resources', '📄', 'Resources', 'stores and charts'], ['world/map', '🗺️', 'Map', 'the plot from above'], ['world/infrastructure', '📄', 'Infrastructure', 'everything built']]);
        return { state: worldState, resources, map, infrastructure }[b]?.(s) ?? notFound(s);
      case 'society':
        if (!b) return folder(s, 'society', '👥', 'Society', [['society/citizens', '📄', 'Citizens', 'the four residents'], ['society/relationships', '📄', 'Relationships', 'who trusts whom'], ['society/rules', '📄', 'Rules', `${s.laws.length} laws`], ['society/government', '📄', 'Government', 'offices, proposals, disputes']]);
        if (b === 'citizens') return c ? citizen(s, c) : citizens(s);
        return { relationships, rules, government }[b]?.(s) ?? notFound(s);
      case 'economy':
        if (!b) return folder(s, 'economy', '💰', 'Economy', [['economy/inventory', '📄', 'Inventory', 'who owns what'], ['economy/businesses', '📄', 'Businesses', `${s.economy.businesses.length} open`], ['economy/currency', '📄', 'Currency', s.economy.currency ? 'the dot' : 'none yet'], ['economy/transactions', '📄', 'Transactions', `${s.economy.transactions.length} recent`]]);
        return { inventory, businesses, currency, transactions }[b]?.(s) ?? notFound(s);
      case 'history': return b ? dayPage(s, +b.replace('day-', '')) : historyIndex(s);
      case 'decisions': return b ? decisionPage(s, +b) : decisionsIndex(s);
      case 'journal': return b ? journal(s, b) : journalIndex(s);
    }
    return notFound(s);
  }

  function draw(now = performance.now()) {
    if (!isOpen || !S) return;
    if (held) return;
    if (now - tTree > 1500 || !last.tree) {
      tTree = now;
      const h = treeHTML(sections(S));
      if (h !== last.tree) { last.tree = h; tree.innerHTML = h; }
    }
    if (now - tPage > 1000 || !last.page) {
      tPage = now;
      const h = `<article>${render(S)}</article>`;
      if (h !== last.page) { const keep = page.scrollTop; last.page = h; page.innerHTML = h; page.scrollTop = keep; }
    }
  }

  return {
    open, close, go,
    get isOpen() { return isOpen; },
    update(s, now) { S = s; draw(now); },
  };
}
