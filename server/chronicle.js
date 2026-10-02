// dot.home - the dots keep their own history, in git.
//
// Whenever something worth remembering happens on the island, whoever made it happen commits it to
// chronicle/ under their own name (Nimbus <nimbus@dotshome.world>, Moss, Sol, Rosie). Things nobody
// did on purpose (storms, blights) and each finished day are committed by the engine. Commits are
// pushed every few minutes. Nothing here ever uses the identity of whoever runs the server.
//
// On when this folder is a git repository; off for test copies (DOTHOME_PUBLISH=0) or with DOTHOME_GIT=0.
//
//   chronicle/README.md          the index, rewritten at dawn
//   chronicle/log.md             every notable event, one line (and one commit) each
//   chronicle/milestones.md      the firsts
//   chronicle/laws.md            every law in force, with who proposed it and the vote
//   chronicle/buildings.md       everything ever built or started
//   chronicle/decisions/NNN.md   each numbered decision: who, why, the options, the vote
//   chronicle/days/day-NNN.md    each day as it ended
//   chronicle/journals/<dot>.md  each dot's journal, written at dawn in their own words
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, access, rm } from 'node:fs/promises';
import path from 'node:path';
import { BLUEPRINTS, RES, pad, nameOf, dayOf } from '../sim/catalog.js';
import { IDENTITIES } from '../sim/minds.js';

const SITE = 'https://dotshome.world';
const DIR = 'chronicle';
const ENGINE = { name: 'dot.home engine', email: 'engine@dotshome.world' };
const ORDER = ['blue', 'green', 'yellow', 'pink'];
const SKIP = new Set(['day']); // "Day 5 begins." - the day itself is committed at dawn instead
const PUSH_EVERY = 10 * 60 * 1000;

const dotOf = (s, id) => ({ name: nameOf(s, id), email: `${nameOf(s, id).toLowerCase()}@dotshome.world` });
const p3 = (n) => pad(n, 3);
const when = (x) => `day ${x.day}${x.clock ? ` · ${x.clock}` : ''}`;
const quote = (t) => (t ? `> ${String(t).replace(/\n/g, '\n> ')}` : '');

async function findGit(root) {
  const local = path.join(root, '.tools', 'git', 'cmd', 'git.exe'); // a portable git kept next to the project
  for (const p of [process.env.DOTHOME_GIT_BIN, local, process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Git', 'cmd', 'git.exe')]) {
    if (p) try { await access(p); return p; } catch { /* next */ }
  }
  return 'git'; // hope it's on the PATH
}

export async function createChronicle({ root, data, log }) {
  if (process.env.DOTHOME_GIT === '0' || process.env.DOTHOME_PUBLISH === '0') return null;
  try { await access(path.join(root, '.git')); } catch { return null; }
  const GIT = await findGit(root);
  const STATE = path.join(data, 'chronicle.json');

  // ---- git, one command at a time
  const git = (args, who) => new Promise((resolve, reject) => {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
    if (who) Object.assign(env, { GIT_AUTHOR_NAME: who.name, GIT_AUTHOR_EMAIL: who.email, GIT_COMMITTER_NAME: who.name, GIT_COMMITTER_EMAIL: who.email });
    execFile(GIT, args, { cwd: root, env, windowsHide: true, maxBuffer: 8 << 20, timeout: 120000 }, (err, stdout, stderr) =>
      (err ? reject(Object.assign(err, { detail: `${stderr || ''}${stdout || ''}`.trim() })) : resolve(stdout)));
  });
  const retry = async (args, who) => { // something else may hold the index for a moment
    for (let i = 0; ; i++) {
      try { return await git(args, who); } catch (e) { if (i >= 3 || !/index\.lock/.test(e.detail)) throw e; await new Promise((r) => setTimeout(r, 1500)); }
    }
  };
  try { await git(['--version']); } catch { log('chronicle: git not found - the dots will not commit'); return null; }
  const hasRemote = await git(['remote', 'get-url', 'origin']).then(() => true, () => false);

  let chain = Promise.resolve(), lastErr = '';
  const queue = (fn) => (chain = chain.then(fn).catch((e) => {
    const msg = (e.detail || e.message || String(e)).split('\n')[0];
    if (msg !== lastErr) log(`chronicle: ${msg}`);
    lastErr = msg;
  }));

  let st = null;
  try { st = JSON.parse(await readFile(STATE, 'utf8')); } catch { /* first run */ }
  const saveState = () => writeFile(STATE, JSON.stringify(st));
  let unpushed = 0;

  // ---- writing files and committing them
  const abs = (f) => path.join(root, DIR, f);
  async function apply(job) {
    for (const w of job.writes) {
      await mkdir(path.dirname(abs(w.file)), { recursive: true });
      if (w.append === undefined) { await writeFile(abs(w.file), w.content); continue; }
      let cur;
      try { cur = await readFile(abs(w.file), 'utf8'); } catch { cur = w.head; }
      await writeFile(abs(w.file), cur + w.append);
    }
    const files = [...new Set(job.writes.map((w) => `${DIR}/${w.file}`))];
    await retry(['add', '--', ...files]);
    const msg = ['-m', job.subject];
    if (job.body) msg.push('-m', job.body);
    const co = (job.co || []).filter((c) => c.email !== job.who.email);
    if (co.length) msg.push('-m', co.map((c) => `Co-authored-by: ${c.name} <${c.email}>`).join('\n'));
    try { await retry(['commit', '-q', ...msg, '--', ...files], job.who); unpushed++; lastErr = ''; } catch (e) {
      if (!/nothing (added )?to commit|no changes added/i.test(e.detail)) throw e;
    }
  }

  // ---- the pages (all rendered from the world as it is right now)
  const render = {
    laws(s) {
      const laws = s.laws.map((l) => {
        const p = s.proposals.find((x) => x.num === l.proposal);
        const d = s.decisions.find((x) => x.proposal === l.proposal);
        return `## LAW ${p3(l.num)}\n\n${quote(l.text)}\n\nProposed by **${nameOf(s, l.by)}** · passed ${p?.result || ''} on day ${l.day}${d ? ` · [decision ${p3(d.id)}](decisions/${p3(d.id)}.md)` : ''}\n`;
      });
      return `# Laws\n\nEvery law on the island, in the order they passed. Nobody wrote these for them.\n\n${laws.join('\n') || '_No laws yet. Nobody has needed one._\n'}`;
    },
    buildings(s) {
      const status = (b) => (b.status === 'done' ? `standing since day ${b.done}` : b.status === 'planned' ? 'planned, waiting for materials' : 'under construction');
      const rows = s.buildings.filter((b) => b.bp !== 'road' || b.status === 'done').map((b) => {
        const name = b.owner ? `${nameOf(s, b.owner)}'s ${BLUEPRINTS[b.bp].name}` : `the ${BLUEPRINTS[b.bp].name}`;
        return `| ${name} | ${status(b)} | day ${b.started} | ${nameOf(s, b.by)} |`;
      });
      return `# Buildings\n\nEverything the dots have built, or started to.\n\n| Building | Status | Started | Started by |\n|---|---|---|---|\n${rows.join('\n')}\n`;
    },
    decision(s, d) {
      const kind = { alone: 'decided alone (there was no rule about it yet)', private: 'their own project, their own materials', vote: 'put to a vote' }[d.kind] || d.kind;
      const out = [`# Decision ${p3(d.id)}: ${d.title}`, '', `**${nameOf(s, d.by)}** · ${when(d)} · ${kind}`, ''];
      if (d.reasoning) out.push(quote(`“${d.reasoning}”`), '');
      if (d.options?.length) {
        const bp = s.buildings.find((x) => x.id === d.building)?.bp;
        const chosen = bp ? `START_${bp.toUpperCase()}` : null;
        out.push('The options they weighed:', '', '| | Option | Score |', '|---|---|---|');
        d.options.forEach((o, i) => out.push(`| ${o.code === chosen ? '**→**' : 'ABCD'[i] || ''} | \`${o.code}\` | ${o.u.toFixed(2)} |`));
        out.push('');
      }
      if (d.cost) out.push(`Cost: ${Object.entries(d.cost).map(([k, v]) => `${v} ${k}`).join(', ')}`, '');
      if (d.objection) out.push('## An objection', '', `**${nameOf(s, d.objection.by)}**: “${d.objection.text}”`, '', d.objection.reply ? `**${nameOf(s, d.by)}**: “${d.objection.reply}”` : '', '');
      const p = d.proposal && s.proposals.find((x) => x.num === d.proposal);
      if (p) {
        out.push(`## The vote${p.status === 'open' ? ' (still open)' : `: ${p.status} ${p.result}`}`, '', quote(p.question), '');
        out.push('| | Vote | What they said |', '|---|---|---|');
        for (const id of ORDER) out.push(`| ${nameOf(s, id)} | ${p.votes[id] || (p.status === 'open' ? 'thinking…' : 'abstained')} | ${p.lines?.[id] ? `“${String(p.lines[id]).replace(/\|/g, '/')}”` : ''} |`);
        out.push('');
        if (p.law && p.status === 'passed') out.push(`It became law: ${quote(p.law)}`, '');
      }
      if (d.building) {
        const b = s.buildings.find((x) => x.id === d.building);
        if (b) out.push(`The ${BLUEPRINTS[b.bp].name}: ${b.status === 'done' ? `finished on day ${b.done}` : b.status === 'planned' ? 'waiting for materials' : 'under construction'}.`, '');
      }
      return out.join('\n');
    },
    day(s, d) {
      const events = s.history.filter((h) => h.day === d.day && !SKIP.has(h.kind));
      const out = [`# Day ${d.day}`, '', d.text, ''];
      if (d.highlights?.length) out.push('## Milestones', '', ...d.highlights.map((t) => `- ${t}`), '');
      if (events.length) out.push('## What happened', '', ...events.map((h) => `- \`${h.clock}\` ${h.text}`), '');
      out.push('## The stores at the end of the day', '', `| ${RES.join(' | ')} |`, `|${RES.map(() => '---').join('|')}|`, `| ${RES.map((r) => d.stock?.[r] ?? 0).join(' | ')} |`, '');
      out.push('## Journals', '', ORDER.map((id) => `[${nameOf(s, id)}](../journals/${nameOf(s, id).toLowerCase()}.md#day-${d.day})`).join(' · '), '');
      return out.join('\n');
    },
    readme(s) {
      const standing = s.buildings.filter((b) => b.status === 'done').length;
      const ms = s.history.filter((h) => h.kind === 'milestone').slice(-6).reverse();
      const days = (s.days || []).map((d) => `[${d.day}](days/day-${p3(d.day)}.md)`);
      return [
        '# The chronicle', '',
        `The history of [dot.home](${SITE}), kept by the ones who lived it. Every commit in this folder is made by the`,
        'simulation: when one of the four dots does something worth remembering, they commit it under their own name.',
        'Storms, blights and the end of each day are committed by the engine.', '',
        `**Day ${dayOf(s)}** · 4 residents · ${standing} building${standing === 1 ? '' : 's'} standing · ${s.laws.length} law${s.laws.length === 1 ? '' : 's'} · ${s.economy.currency ? `currency: the ${s.economy.currency.name}` : 'no currency yet'}`, '',
        '## Lately', '', ...ms.map((h) => `- **Day ${h.day}** ${h.text}`), '',
        '## Read', '',
        '- [The island log](log.md): everything, in order',
        '- [Milestones](milestones.md) · [Laws](laws.md) · [Buildings](buildings.md) · [Decisions](decisions/)',
        `- Journals: ${ORDER.map((id) => `[${nameOf(s, id)}](journals/${nameOf(s, id).toLowerCase()}.md)`).join(' · ')}`,
        `- Days: ${days.join(' · ') || 'the first day is not over yet'}`, '',
      ].join('\n');
    },
    logLine: (h) => `- **Day ${h.day}** \`${h.clock}\` ${h.text}\n`,
    journalHead: (s, id) => `# ${nameOf(s, id)}'s journal\n\n${IDENTITIES[id].color} · ${IDENTITIES[id].trait} · cares most about ${IDENTITIES[id].priority}. Written at dawn, about the day before, in their own words.\n\n`,
    journalEntry: (j) => `## Day ${j.day}\n\n${j.text}\n\n`,
  };
  const HEAD = {
    log: '# The island log\n\nEverything worth remembering, in the order it happened. Each line was committed by whoever made it happen.\n\n',
    milestones: '# Milestones\n\nThe firsts.\n\n',
  };
  // pages that depend on the whole world: rewrite whichever changed
  const shown = new Map();
  function stateWrites(s) {
    const pages = { 'laws.md': render.laws(s), 'buildings.md': render.buildings(s) };
    for (const d of s.decisions) pages[`decisions/${p3(d.id)}.md`] = render.decision(s, d);
    const out = [];
    for (const [file, content] of Object.entries(pages)) if (shown.get(file) !== content) { shown.set(file, content); out.push({ file, content }); }
    return out;
  }

  // ---- a new world (or the first run): write the story so far in one commit, by the engine
  async function begin(s) {
    shown.clear();
    const writes = [
      { file: 'README.md', content: render.readme(s) },
      { file: 'log.md', content: HEAD.log + s.history.filter((h) => !SKIP.has(h.kind)).map(render.logLine).join('') },
      { file: 'milestones.md', content: HEAD.milestones + s.history.filter((h) => h.kind === 'milestone').map(render.logLine).join('') },
      ...stateWrites(s),
      ...(s.days || []).map((d) => ({ file: `days/day-${p3(d.day)}.md`, content: render.day(s, d) })),
      ...ORDER.map((id) => ({ file: `journals/${nameOf(s, id).toLowerCase()}.md`, content: render.journalHead(s, id) + (s.journal || []).filter((j) => j.id === id).map(render.journalEntry).join('') })),
    ];
    await rm(path.join(root, DIR), { recursive: true, force: true });
    for (const w of writes) { await mkdir(path.dirname(abs(w.file)), { recursive: true }); await writeFile(abs(w.file), w.content); }
    await retry(['add', '-A', '--', DIR]);
    const days = s.days?.length ? `days 1–${s.days[s.days.length - 1].day}` : 'day 1';
    // a brand-new world: the four of them sign its first commit together
    const fresh = !s.days?.length && s.history[0];
    const four = ORDER.map((id) => dotOf(s, id));
    const msg = fresh ? ['-m', fresh.text, '-m', four.slice(1).map((c) => `Co-authored-by: ${c.name} <${c.email}>`).join('\n')]
      : ['-m', st ? 'A new world begins' : `The story so far: ${days}`];
    try { await retry(['commit', '-q', ...msg, '--', DIR], fresh ? four[0] : ENGINE); unpushed++; } catch (e) {
      if (!/nothing (added )?to commit|no changes added/i.test(e.detail)) throw e;
    }
    st = { seed: s.seed, seq: s.seq || 0, decisions: s.decisions.length };
    await saveState();
    log(`chronicle: wrote the story so far (${days})`);
  }

  // ---- every few seconds: turn whatever is new into commits, each by whoever did it
  function sync(s) {
    if (!st || st.seed !== s.seed) return;
    const jobs = [];
    const fresh = [
      ...s.history.filter((h) => h.n > st.seq && !SKIP.has(h.kind)).map((h) => ({ n: h.n, h })),
      ...(s.days || []).filter((d) => d.n > st.seq).map((d) => ({ n: d.n, d })),
      ...(s.journal || []).filter((j) => j.n > st.seq).map((j) => ({ n: j.n, j })),
    ].sort((a, b) => a.n - b.n);
    const newDecisions = s.decisions.slice(st.decisions);
    for (const { h, d, j } of fresh) {
      if (h) {
        let ids = h.who || [];
        const dec = newDecisions.find((x) => x.day === h.day && x.clock === h.clock && ids[0] === x.by);
        let body = dec?.reasoning ? `“${dec.reasoning}”` : '';
        if (h.kind === 'vote' || (h.kind === 'milestone' && /first vote/.test(h.text))) {
          // a vote is committed by whoever proposed it, with everyone who voted yes as co-authors
          const p = [...s.proposals].reverse().find((x) => x.status !== 'open' && h.text.includes(`"${x.title}"`));
          if (p) {
            ids = [p.by, ...ORDER.filter((id) => id !== p.by && p.votes[id] === 'support')];
            body = ORDER.map((id) => `${nameOf(s, id)}: ${p.votes[id] || 'abstained'}${p.lines?.[id] ? `. “${p.lines[id]}”` : ''}`).join('\n');
          }
        } else if (h.kind === 'proposal') {
          const p = [...s.proposals].reverse().find((x) => x.by === ids[0] && h.text.includes(`#${p3(x.num)}`));
          if (p?.lines?.[p.by]) body = `“${p.lines[p.by]}”`;
        }
        const who = ids.length ? ids.map((id) => dotOf(s, id)) : [ENGINE];
        const writes = [{ file: 'log.md', head: HEAD.log, append: render.logLine(h) }];
        if (h.kind === 'milestone') writes.push({ file: 'milestones.md', head: HEAD.milestones, append: render.logLine(h) });
        writes.push(...stateWrites(s));
        jobs.push({ who: who[0], co: who.slice(1), subject: h.text, body, writes });
      } else if (d) {
        jobs.push({
          who: ENGINE, subject: `Day ${d.day}`, body: d.text,
          writes: [{ file: `days/day-${p3(d.day)}.md`, content: render.day(s, d) }, { file: 'README.md', content: render.readme(s) }, ...stateWrites(s)],
        });
      } else if (j) {
        jobs.push({
          who: dotOf(s, j.id), subject: `Journal, day ${j.day}`, body: j.text,
          writes: [{ file: `journals/${nameOf(s, j.id).toLowerCase()}.md`, head: render.journalHead(s, j.id), append: render.journalEntry(j) }],
        });
      }
    }
    // anything else that changed (a vote cast, a building finished between events) rides along with the next commit
    st.seq = s.seq || st.seq;
    st.decisions = s.decisions.length;
    if (!jobs.length) return;
    queue(async () => { for (const job of jobs) await apply(job); await saveState(); });
  }

  // push whenever this copy is ahead of GitHub (the dots' commits, and any new code)
  function push() {
    if (!hasRemote) return chain;
    return queue(async () => {
      const head = (await git(['rev-parse', 'HEAD'])).trim();
      const remote = (await git(['rev-parse', '--verify', '-q', 'refs/remotes/origin/main']).catch(() => '')).trim();
      if (head === remote && !unpushed) return;
      await retry(['push', '-q', 'origin', 'HEAD:main']);
      unpushed = 0;
    });
  }
  setInterval(push, PUSH_EVERY).unref();

  return {
    // call once the world is loaded: a new world (or a first run) writes the story so far
    async start(s) {
      if (!st || st.seed !== s.seed) await queue(() => begin(s));
      push();
      log(`chronicle: the dots are committing to ${hasRemote ? 'git and pushing to GitHub' : 'git (no remote yet, so nothing is pushed)'}`);
    },
    sync,
    // commit what's pending and push it (on pause / shutdown)
    flush: () => push(),
  };
}
