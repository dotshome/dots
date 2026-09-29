// dot.home - the observer's interface. Read-only: visitors watch, they don't steer.
import { ACTIONS, BLUEPRINTS, RES, RES_ICON, pad, dayOf, clockOf, hourOf, nameOf } from '../sim/catalog.js';
import { IDENTITIES, roleOf } from '../sim/minds.js';
import { openProposal } from '../sim/engine.js';
import * as space from '../sim/space.js';

export const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ORDER = ['blue', 'green', 'yellow', 'pink'];
const STANCE = { support: 'SUPPORT', oppose: 'OPPOSE', undecided: 'UNDECIDED' };
const KIND_ICON = { milestone: '★', law: '§', vote: '✓', proposal: '📜', dispute: '⚖', build: '🔨', problem: '!', role: '◆', event: '•', day: '☀' };
// the top bar's sky: drawn, so it looks the same on every phone (emoji don't)
const RAYS = (c, d) => `<path d="${d}" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/>`;
const SKY_ICON = {
  day: `<circle cx="12" cy="12" r="4.6" fill="#ffb21e"/>${RAYS('#ffb21e', 'M12 2.6v2.1M12 19.3v2.1M2.6 12h2.1M19.3 12h2.1M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M5.4 18.6l1.5-1.5M17.1 6.9l1.5-1.5')}`,
  dawn: `<path d="M5.6 16.5a6.4 6.4 0 0 1 12.8 0z" fill="#ff9447"/>${RAYS('#ff9447', 'M12 4.6v2.1M4.9 8.4l1.5 1.5M19.1 8.4l-1.5 1.5')}${RAYS('#e0773a', 'M3 19.6h18')}`,
  night: '<path d="M20.4 14.1A8.6 8.6 0 1 1 9.9 3.6a6.8 6.8 0 0 0 10.5 10.5z" fill="#7d88dc"/><circle cx="18.6" cy="5.2" r="1.3" fill="#7d88dc"/>',
};
SKY_ICON.dusk = SKY_ICON.dawn.replaceAll('#ff9447', '#ff7a59').replace('#e0773a', '#c95a52');

export function describeTask(s, a) {
  const t = a.task;
  if (!t) return 'deciding what to do';
  const who = (id) => nameOf(s, id);
  switch (t.type) {
    case 'CONTINUE': return `building the ${BLUEPRINTS[t.bp]?.name}`;
    case 'START': return `laying out ${BLUEPRINTS[t.bp]?.name === 'house' ? 'a house of their own' : 'the ' + BLUEPRINTS[t.bp]?.name}`;
    case 'SOCIALIZE': return `talking with ${who(t.target)}`;
    case 'TEACH': return t.partner ? `learning from ${who(t.target)}` : `teaching ${who(t.target)} ${t.field}`;
    case 'TRADE': return `trading with ${who(t.target)}`;
    case 'CARE': return `caring for ${who(t.target)}`;
    case 'PROPOSE': return 'making a proposal';
    case 'SLEEP': return a.asleep ? 'asleep' : 'heading to bed';
    default: return ACTIONS[t.type]?.verb || t.type.toLowerCase();
  }
}
export const taskIcon = (a) => (a.ailment ? '🩹' : a.task ? ACTIONS[a.task.type]?.icon || '' : '');
export const dotHTML = (colors, id) => `<i class="dot" style="--c:${colors[id]}"></i>`;
export const barHTML = (v, c = 'var(--accent)') => `<span class="bar"><span style="width:${Math.max(0, Math.min(100, v))}%;background:${c}"></span></span>`;
export const needColor = (k, v) => (v < 25 ? '#ff6b6b' : v < 50 ? '#ffb347' : { energy: '#5ec8ff', fed: '#7bd88f', health: '#ff7eb6', mood: '#c39bff' }[k]);

// everything about one agent: what they're doing, who they are, how they last decided, what they remember
export function agentSections(s, id, colors) {
  const a = s.agents[id], I = IDENTITIES[id], t = a.trace, e = s.economy;
  const dot = (o) => dotHTML(colors, o), bar = barHTML;
  const rel = Object.entries(a.rel).sort((x, y) => y[1] - x[1]);
  const opts = t ? t.options.map((o, i) => `<li class="${o.code === t.decision ? 'pick' : ''}"><b>${'ABCD'[i]}</b><code>${esc(o.code)}</code><span>${o.u.toFixed(2)}</span></li>`).join('') : '';
  const rej = a.rejected && dayOf(s) - a.rejected.day <= 2 ? `<div class="reject"><b>ACTION_REJECTED</b> <code>${esc(a.rejected.code)}</code><div class="small">Requires: ${Object.entries(a.rejected.cost).map(([k, v]) => `${v} ${k}`).join(', ')}</div>${a.rejected.reasons.map((r) => `<div class="small">✗ ${esc(r)}</div>`).join('')}<div class="small muted">Day ${pad(a.rejected.day, 3)} ${a.rejected.clock}. The agent wanted it; the engine said no.</div></div>` : '';
  return `<div class="now">${taskIcon(a)} ${esc(describeTask(s, a))}${a.ailment ? ` · <b class="bad">${a.ailment}</b>` : ''}</div>
    <h4>Identity</h4>
    <div class="kv"><span>Trait</span><b>${I.trait}</b><span>Priority</span><b>${I.priority}</b><span>Risk tolerance</span><b>${I.riskLabel}</b><span>Skills</span><b>${I.skills.join(' / ')}</b></div>
    <h4>Needs</h4>
    <div class="kv bars">${['energy', 'fed', 'health', 'mood'].map((k) => `<span>${k}</span>${bar(a.needs[k], needColor(k, a.needs[k]))}`).join('')}</div>
    <h4>Latest decision <span class="muted small">Day ${t ? pad(t.day, 3) + ' ' + t.clock : '–'}</span></h4>
    ${t ? `<div class="trace">
      <div class="step"><span>Observation</span><pre>${esc(JSON.stringify(t.observation, null, 1).replace(/\n\s*/g, ' '))}</pre></div>
      <div class="step"><span>Reasoning</span><p>“${esc(t.reasoning)}”</p></div>
      <div class="step"><span>Valid actions</span><ol class="opts">${opts}</ol></div>
      <div class="step"><span>Decision</span><code class="big">${esc(t.decision)}</code></div>
      <div class="step"><span>Simulation</span><p>${esc(t.result || 'in progress…')}</p></div>
    </div>` : '<p class="muted small">No decisions yet.</p>'}
    ${rej}
    <h4>Holdings</h4>
    <div class="chips">${RES.filter((r) => a.inv[r]).map((r) => `<span>${RES_ICON[r]} ${a.inv[r]}</span>`).join('') || '<span class="muted">nothing personal</span>'}${e.currency ? `<span>● ${e.ledger[id] ?? 0} dots</span>` : ''}</div>
    <h4>Knowledge</h4>
    <div class="kv bars">${Object.entries(a.know).map(([k, v]) => `<span>${k}</span>${bar(v * 100, '#9fb4ff')}`).join('')}</div>
    <h4>Relationships</h4>
    <div class="kv bars">${rel.map(([o, v]) => `<span>${dot(o)}${esc(nameOf(s, o))}</span>${bar(v, v < 40 ? '#ff6b6b' : colors[o])}`).join('')}</div>
    <h4>Memories</h4>
    <ul class="mem">${a.memories.slice(-7).reverse().map((m) => `<li><span class="muted">Day ${pad(m.day, 3)}</span> ${esc(m.text)}</li>`).join('') || '<li class="muted">Nothing worth remembering yet.</li>'}</ul>`;
}

export function createUI({ colors, dev = false, onSelect, onSpeed, onReset, onClose }) {
  const $ = (id) => document.getElementById(id);
  let tab = 'agents', selected = null, feedTab = 'talk', histFilter = 'all';
  let lastPanel = 0, lastSide = 0, held = false;
  const html = new Map(); // only touch the DOM when the content really changed
  const setHTML = (el, h) => { if (html.get(el) !== h) { html.set(el, h); el.innerHTML = h; } };
  // never redraw under a pressed pointer, or the click lands on a node that no longer exists
  for (const id of ['panel', 'left']) {
    $(id).addEventListener('pointerdown', () => (held = true));
  }
  addEventListener('pointerup', () => setTimeout(() => (held = false), 0));
  addEventListener('pointercancel', () => (held = false));

  // ---- static wiring
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; if (tab !== 'agents') selected = null; refreshTabs(); lastPanel = 0; }));
  document.querySelectorAll('#feedTabs button').forEach((b) => b.addEventListener('click', () => { feedTab = b.dataset.f; document.querySelectorAll('#feedTabs button').forEach((x) => x.classList.toggle('on', x === b)); lastSide = 0; }));
  document.querySelectorAll('#speed button').forEach((b) => b.addEventListener('click', () => onSpeed(+b.dataset.s)));
  $('panel').addEventListener('click', (e) => {
    const row = e.target.closest('[data-agent]');
    if (row) { onSelect(row.dataset.agent); return; }
    const f = e.target.closest('[data-filter]');
    if (f) { histFilter = f.dataset.filter; lastPanel = 0; return; }
    if (e.target.closest('#reset')) onReset();
    if (e.target.closest('#closeAgent')) onClose();
  });
  // on small screens the decision card is a one-line ticker: the first tap opens it, a tap on a voter selects them
  const compact = matchMedia('(max-width: 900px), (max-height: 500px)');
  $('decision').addEventListener('click', (e) => {
    const card = $('decision');
    if (compact.matches && !card.classList.contains('open')) { card.classList.add('open'); return; }
    const r = e.target.closest('[data-agent]');
    if (r) onSelect(r.dataset.agent);
    else if (compact.matches) card.classList.remove('open');
  });
  $('railToggle')?.addEventListener('click', () => document.body.classList.toggle('rail-open'));
  $('railClose')?.addEventListener('click', () => document.body.classList.remove('rail-open'));
  function refreshTabs() { document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab)); }

  const dot = (id) => dotHTML(colors, id);
  const bar = barHTML;

  // ---- top bar + resources
  function top(s, speed) {
    const h = hourOf(s);
    const day = `Day ${dayOf(s)}`, time = clockOf(s);
    if ($('cDay').textContent !== day) $('cDay').textContent = day;
    if ($('cTime').textContent !== time) $('cTime').textContent = time;
    const phase = h < 5.5 || h >= 21 ? 'night' : h < 7 ? 'dawn' : h >= 19 ? 'dusk' : 'day';
    if ($('clock').dataset.phase !== phase) { $('clock').dataset.phase = phase; $('cSky').innerHTML = SKY_ICON[phase]; }
    document.querySelectorAll('#speed button').forEach((b) => b.classList.toggle('on', +b.dataset.s === speed));
    const e = s.economy;
    setHTML($('res'), RES.map((r) => `<span title="${r} in the shared stores">${RES_ICON[r]} <b>${s.stock[r]}</b></span>`).join('')
      + (e.currency ? `<span title="shared treasury">🏛️ <b>${e.treasury}</b><small>dots</small></span>` : ''));
  }

  // ---- left column: current event, live decision, feed
  function side(s) {
    const notable = [...s.history].reverse().find((h) => h.kind !== 'day');
    if (notable) {
      $('evText').textContent = notable.text;
      $('evMeta').innerHTML = `${notable.who.map(dot).join('')} Day ${pad(notable.day, 3)} · ${notable.clock}${notable.kind === 'milestone' ? ' · <b class="ms">milestone</b>' : ''}`;
    }
    const p = openProposal(s) || [...s.proposals].reverse().find((x) => x.closed && s.time - x.closed < 8 * 60);
    const card = $('decision');
    if (!p) {
      const busy = ORDER.map((id) => s.agents[id]).filter((a) => a.trace).sort((x, y) => (y.trace.day * 1440 + +y.trace.clock.replace(':', '')) - (x.trace.day * 1440 + +x.trace.clock.replace(':', '')))[0];
      setHTML(card, `<h3>Live decision</h3><p class="q muted">No vote in progress. Each dot is choosing its own next action.</p>`
        + (busy ? `<div class="mini-trace" data-agent="${busy.id}">${dot(busy.id)}<b>${esc(busy.name)}</b> → <code>${esc(busy.trace.decision)}</code><p>“${esc(busy.trace.reasoning)}”</p></div>` : ''));
    } else {
      const open = p.status === 'open';
      setHTML(card, `<h3>${open ? 'Live decision' : 'Decided'} <span class="tag-num">#${pad(p.num, 3)}</span></h3>
        <p class="q">${esc(p.question)}</p>
        <p class="muted small">Proposed by ${dot(p.by)}${esc(nameOf(s, p.by))} · Day ${pad(p.day, 3)} ${p.clock}${open ? '' : ` · <b class="${p.status}">${p.status.toUpperCase()} ${p.result}</b>`}</p>
        <div class="votes">${ORDER.map((id) => {
          const v = p.votes[id];
          return `<div class="vote" data-agent="${id}">${dot(id)}<span>${esc(nameOf(s, id))}</span><b class="st ${v || 'pending'}">${v ? STANCE[v] : open ? 'THINKING…' : 'ABSTAINED'}</b></div>`;
        }).join('')}</div>`);
    }
    const lines = feedTab === 'talk' ? s.feed.slice(-40) : s.engineLog.slice(-40);
    const feed = $('feed');
    const before = html.get(feed);
    setHTML(feed, lines.map((l) => feedTab === 'talk'
      ? `<div class="line">${dot(l.id)}<span><b>${esc(nameOf(s, l.id))}</b> ${esc(l.text)}</span></div>`
      : `<div class="line eng ${l.ok ? '' : 'bad'}"><code>${esc(l.clock)}</code><span>${esc(l.text)}</span></div>`).join(''));
    if (html.get(feed) !== before) feed.scrollTop = 1e6;
  }

  // ---- right panel
  function agentsTab(s) {
    return ORDER.map((id) => {
      const a = s.agents[id], I = IDENTITIES[id], role = roleOf(s, a);
      return `<div class="who" data-agent="${id}" style="--c:${colors[id]}">
        <i class="sw"></i>
        <div><b>${esc(a.name)}</b> <span class="muted small">${I.color} · ${I.trait}</span>${role ? ` <span class="chip">${esc(role)}</span>` : ''}
        <div class="small">${taskIcon(a)} ${esc(describeTask(s, a))}</div>
        <div class="needs">${['energy', 'fed', 'health', 'mood'].map((k) => `<span title="${k} ${Math.round(a.needs[k])}">${bar(a.needs[k], needColor(k, a.needs[k]))}</span>`).join('')}</div></div>
      </div>`;
    }).join('') + '<p class="muted small pad">Traits shape them. Roles are earned from what they actually do.</p>';
  }
  function agentDetail(s, id) {
    const a = s.agents[id], I = IDENTITIES[id], role = roleOf(s, a);
    return `<div class="detail" style="--c:${colors[id]}">
      <div class="dhead"><i class="sw big"></i><div><b class="dn">${esc(a.name)}</b><div class="muted small">Agent ${I.color} · ${I.trait}${role ? ` · <span class="chip">${esc(role)}</span>` : ''}</div></div><button id="closeAgent" aria-label="Close">✕</button></div>
      ${agentSections(s, id, colors)}
    </div>`;
  }

  function spaceTab(s) {
    return `<button class="openspace">📚 Open the full Space</button><p class="muted small pad">DOT.HOME SPACE: the civilization's shared memory. Every inhabitant reads from it; only the engine writes to it.</p>`
      + space.tree(s).map((sec) => `<details open><summary>${sec.name}</summary><dl>${sec.items.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></details>`).join('')
      + (dev ? `<div class="pad"><p class="muted small">Dev · seed ${s.seed} · persisted in this browser.</p><button id="reset" class="ghost">Start a new world</button></div>` : '');
  }

  function historyTab(s) {
    const keep = (h) => h.kind !== 'day' && (histFilter === 'all' || (histFilter === 'milestones' ? h.kind === 'milestone' : ['law', 'vote', 'proposal', 'dispute'].includes(h.kind)));
    const rows = s.history.filter(keep).slice(-160).reverse();
    let day = null, out = '';
    for (const h of rows) {
      if (h.day !== day) { day = h.day; out += `<div class="dayhead">DAY ${pad(day, 3)}</div>`; }
      out += `<div class="hist ${h.kind}"><span class="k">${KIND_ICON[h.kind] || '•'}</span><span class="t">${esc(h.text)}</span><span class="c">${h.clock}</span></div>`;
    }
    return `<div class="filters">${['all', 'milestones', 'politics'].map((f) => `<button data-filter="${f}" class="${histFilter === f ? 'on' : ''}">${f}</button>`).join('')}</div>${out || '<p class="muted pad">Nothing yet.</p>'}`;
  }

  function lawsTab(s) {
    const laws = s.laws.map((l) => `<div class="law"><b>LAW ${pad(l.num, 3)}</b><p>${esc(l.text)}</p><span class="muted small">Day ${pad(l.day, 3)} · proposed by ${dot(l.by)}${esc(nameOf(s, l.by))} · proposal #${pad(l.proposal, 3)}</span></div>`).join('');
    const props = [...s.proposals].reverse().map((p) => `<div class="prop"><span class="tag-num">#${pad(p.num, 3)}</span><div><b>${esc(p.title)}</b><div class="small muted">${dot(p.by)}${esc(nameOf(s, p.by))} · Day ${pad(p.day, 3)}</div></div><b class="${p.status}">${p.status === 'open' ? 'VOTING' : p.status.toUpperCase() + ' ' + p.result}</b></div>`).join('');
    const disputes = [...s.disputes].reverse().slice(0, 8).map((d) => `<div class="prop"><span class="tag-num">⚖ ${pad(d.num, 3)}</span><div><b>${esc(nameOf(s, d.plaintiff))} v. ${esc(nameOf(s, d.defendant))}</b><div class="small muted">${esc(d.about)}${d.ruling ? ` · ruling: ${esc(d.ruling)}` : ''}</div></div><b class="${d.status === 'open' ? 'open' : 'passed'}">${d.status.toUpperCase()}</b></div>`).join('');
    return `<h4 class="pad">Laws</h4>${laws || '<p class="muted small pad">No laws. Nobody has needed one yet.</p>'}
      <h4 class="pad">Proposals</h4>${props || '<p class="muted small pad">No proposals yet.</p>'}
      ${disputes ? `<h4 class="pad">Disputes</h4>${disputes}` : ''}`;
  }

  function economyTab(s) {
    const e = s.economy;
    const regime = { communal: 'Everything gathered goes to the shared stores.', mixed: 'Whoever gathers keeps half; half goes to the shared stores.', private: 'Whoever gathers keeps everything.' }[e.regime];
    if (!e.currency) {
      const barter = e.transactions.filter((t) => t.what.startsWith('barter')).slice(-8).reverse();
      return `<div class="pad"><h4>Property</h4><p>${regime}</p><h4>Currency</h4><p class="muted">None yet. ${e.regime === 'communal' ? 'Nothing is owned, so nothing is traded.' : `Exchange is by barter (${s.counters.barter} so far).`}</p>
        ${barter.length ? `<h4>Barter</h4>${barter.map((t) => `<div class="tx">${dot(t.from)}${dot(t.to)} ${esc(t.what.replace('barter: ', ''))} <span class="muted small">D${pad(t.day, 3)}</span></div>`).join('')}` : ''}</div>`;
    }
    const max = Math.max(1, ...ORDER.map((id) => e.ledger[id] || 0));
    return `<div class="pad"><h4>Property</h4><p>${regime}</p>
      <h4>Ledger <span class="muted small">the dot, since day ${e.currency.day}</span></h4>
      <div class="kv bars">${ORDER.map((id) => `<span>${dot(id)}${esc(nameOf(s, id))}</span><span class="led">${bar((e.ledger[id] || 0) / max * 100, colors[id])}<b>${e.ledger[id] || 0}</b></span>`).join('')}</div>
      <p class="small">Treasury <b>${e.treasury}</b> dots${e.tax ? ` · tax ${Math.round(e.tax * 100)}% of every sale` : ''}</p>
      <h4>Prices</h4><div class="chips">${RES.map((r) => `<span>${RES_ICON[r]} ${e.prices[r]}</span>`).join('')}</div>
      <h4>Businesses</h4><p>${e.businesses.map((b) => esc(b.name) + ` <span class="muted small">since day ${b.day}</span>`).join('<br>') || '<span class="muted">none yet</span>'}</p>
      <h4>Transactions</h4>${e.transactions.slice(-14).reverse().map((t) => `<div class="tx">${t.from === 'treasury' ? '🏛️' : dot(t.from)}→${t.to === 'treasury' ? '🏛️' : dot(t.to)} <b>${t.amount || ''}</b> ${esc(t.what)} <span class="muted small">D${pad(t.day, 3)}</span></div>`).join('')}</div>`;
  }

  function panel(s) {
    const el = $('panel');
    const keep = el.scrollTop;
    setHTML(el, tab === 'agents' ? (selected ? agentDetail(s, selected) : agentsTab(s))
      : tab === 'space' ? spaceTab(s) : tab === 'history' ? historyTab(s) : tab === 'laws' ? lawsTab(s) : economyTab(s));
    el.scrollTop = keep;
  }

  // ---- milestone toasts
  const toasts = [];
  let toastT = 0;
  function toast(text, day) { toasts.push({ text, day }); if (toasts.length > 4) toasts.shift(); }
  function tickToast(dt) {
    toastT -= dt;
    const el = $('toast');
    if (toastT <= 0 && toasts.length) {
      const t = toasts.shift();
      el.innerHTML = `<span>DAY ${pad(t.day, 3)}</span>${esc(t.text)}`;
      el.classList.add('show');
      toastT = 4.2;
    } else if (toastT <= 0.4) el.classList.remove('show');
  }

  return {
    select(id) { selected = id; tab = 'agents'; refreshTabs(); lastPanel = 0; document.body.classList.add('rail-open'); },
    deselect() { selected = null; lastPanel = 0; },
    get selected() { return selected; },
    toast,
    update(s, speed, now, dt) {
      tickToast(dt);
      top(s, speed);
      if (held) return;
      if (now - lastSide > 250) { lastSide = now; side(s); }
      if (now - lastPanel > 600) { lastPanel = now; panel(s); }
    },
  };
}
