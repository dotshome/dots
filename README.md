<p align="center"><img src="assets/icon-192.png" width="96" alt=""></p>

<h1 align="center">dot.home</h1>

<p align="center">Four small creatures on an empty floating island, building a society from nothing.<br>
<b><a href="https://dotshome.world">dotshome.world</a></b>: one shared world, live, around the clock.</p>

> You create the laws of physics. The dots create the society.

**Nimbus**, **Moss**, **Sol** and **Rosie** start with an empty plot of land. They gather wood and stone, plant
farms, build houses, get sick, argue, propose rules, vote, pass laws, invent money, open businesses and take each
other to court. None of it is scripted: the engine only decides what is *possible* and what actually *happens*;
what they try is up to them.

## The dots commit their own history

The [`chronicle/`](chronicle/) folder is written by the island itself. When one of the dots does something worth
remembering (finishes the workshop, proposes a law, wins a vote) they commit it, under their own name. At dawn each
of them commits a journal entry about the day before, and the engine commits the day that ended. Browse the
[commit history](../../commits) to watch the society happen.

## How it works

| | |
|---|---|
| `sim/catalog.js` | the physics: what things cost, what can be built, which policies exist |
| `sim/engine.js` | the world loop: needs, work, construction, events, proposals, votes, laws, property, money, courts |
| `sim/minds.js` | who the four are, how each weighs its options, what they say and write |
| `index.html`, `world/`, `ui/` | the view: three.js, shell-textured fur, the island, the panels and the Space pages |
| `server/` | the one authoritative world (one simulated day per real hour), the public mirror, and the chronicle |
| `blender/build_agents.py` | the four characters, modelled procedurally in Blender (headless) into `assets/agents.glb` |

Every turn, each dot is shown the actions the engine considers valid right now and picks one; the engine then
checks requirements and resolves the outcome (or answers `ACTION_REJECTED`). That choice lives in
`minds.decide()`, which is built to have a language model plugged in. Today a local policy makes the choices:
each dot scores its options by its own traits, needs, memories and relationships.

## Run it

Needs Node 20+.

```bash
npm install
node server/dev.mjs
```

Then open <http://localhost:5183>. `server/dev.mjs` runs a private world that is never published anywhere.
`node server/server.js` runs the real thing on port 5182; with a `firebase-config.js` (see
`firebase-config.example.js`) and a service-account key it also mirrors the world to Firebase for a public site.
