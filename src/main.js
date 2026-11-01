// Boot. Reads window.GAME (set by each games/<code>/index.html) to pick a rule set, runs the menus,
// and drives the fixed-step simulation + renderer. Code words only on screen; never the real name.
import { RULES, PHASE, TICK, RECEIVERS } from './game/constants.js';
import { Game, emptyInput } from './game/sim.js';
import { TEAMS } from './data/teams.js';
import { Scene } from './render/scene.js';
import { Hud } from './ui/hud.js';
import { Input } from './input.js';
import { assets } from './assets/index.js';
import { Sound } from './audio.js';

const cfg = window.GAME || { code: 'KODIAK', variant: 'classic', hub: '../../hub.html' };

// Rule-set switch. 'classic' is the faithful set in constants.js; 'house' overlays the tweaks.
export const VARIANTS = {
  classic: RULES,
  house: { ...RULES, name: 'HOUSE RULES', firstDownYards: 25, onFireStreak: 2, playClock: 12 },
};
const rules = VARIANTS[cfg.variant] || RULES;

const overlay = document.getElementById('overlay');
const hudEl = document.getElementById('hud');
const canvas = document.getElementById('gl');
const scene = new Scene(canvas);
const hud = new Hud(hudEl, overlay, scene);
const input = new Input();
const sound = new Sound(assets);

let game = null, running = false, paused = false, last = 0, acc = 0;
let slotTeam = [0, 1];               // input slot -> team index
let icons = [false, false];
let pickBox = [null, null];
let assetStatus = 'no disc data loaded · placeholder look, no sound';

// ---------- screens ----------
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function screen(html) { overlay.innerHTML = `<div class="screen">${html}</div>`; return overlay.firstElementChild; }
function menu(items) {
  // items: [{label, run, disabled}] ; keyboard + gamepad navigable
  let sel = items.findIndex(i => !i.disabled); if (sel < 0) sel = 0;
  const wrap = document.createElement('div'); wrap.className = 'menu';
  const btns = items.map((it, i) => { const b = document.createElement('button'); b.textContent = it.label; b.disabled = !!it.disabled; b.onclick = () => { sel = i; go(); }; b.onmouseenter = () => { sel = i; draw(); }; wrap.appendChild(b); return b; });
  const draw = () => btns.forEach((b, i) => b.classList.toggle('sel', i === sel));
  const go = () => { if (!items[sel].disabled) { cleanup(); items[sel].run(); } };
  const step = d => { for (let n = 0; n < items.length; n++) { sel = (sel + d + items.length) % items.length; if (!items[sel].disabled) break; } draw(); };
  const key = e => { if (e.code === 'ArrowUp' || e.code === 'KeyW') step(-1); else if (e.code === 'ArrowDown' || e.code === 'KeyS') step(1); else if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyJ') { e.preventDefault(); go(); } };
  let padV = false; const pad = () => { const r = input.poll(0, { keyboard: false }); if (Math.abs(r.my) > 0.5 && !padV) step(r.my > 0 ? 1 : -1); padV = Math.abs(r.my) > 0.5; if (r.f[0] || r.start) go(); wrap._raf = requestAnimationFrame(pad); };
  const cleanup = () => { window.removeEventListener('keydown', key); cancelAnimationFrame(wrap._raf); };
  window.addEventListener('keydown', key); wrap._raf = requestAnimationFrame(pad);
  draw(); return wrap;
}

function title() {
  running = false; hudEl.style.visibility = 'hidden';
  const s = screen(`<h1>${esc(cfg.code.slice(0, 1))}<span>${esc(cfg.code.slice(1))}</span></h1><h2>${esc(rules.name)}</h2>`);
  s.appendChild(menu([
    { label: '1 PLAYER', run: () => teamSelect(1) },
    { label: '2 PLAYER', run: () => teamSelect(2) },
    { label: 'WATCH CPU DEMO', run: () => startGame([5, 9], [false, false]) },
    { label: assets.ready ? 'DISC DATA LOADED ✓' : 'LOAD DISC DATA', run: () => loadDisc() },
    { label: 'CONTROLS', run: () => controls() },
    { label: 'BACK OUT', run: () => { location.href = cfg.hub; } },
  ]));
  const p = document.createElement('p'); p.className = 'small';
  p.innerHTML = `${esc(assetStatus)}<br>Rule set: <code>${esc(rules.name)}</code> · ${rules.playersPerSide} a side · ${rules.firstDownYards} yards for a first down · no flags`;
  s.appendChild(p);
}

async function loadDisc() {
  const s = screen(`<h2>LOAD DISC DATA</h2><p class="small">Pick <code>DATA/BASSETS.ZIP</code> from your own copy of the disc (or the whole .iso). It is read in your browser only; nothing is uploaded or stored on the site.</p>`);
  const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'CHOOSE FILE'; s.appendChild(b);
  const back = document.createElement('button'); back.className = 'btn'; back.style.marginTop = '12px'; back.textContent = 'BACK'; back.onclick = title; s.appendChild(back);
  const msg = document.createElement('p'); msg.className = 'small'; s.appendChild(msg);
  b.onclick = async () => {
    try {
      msg.textContent = 'reading…';
      await assets.pick();
      const t = await assets.soundTable();
      assetStatus = `disc data loaded · ${assets.zip.entries.size} files · ${[...t.keys()].filter(k => k.endsWith('.mss')).length} sounds · real rosters & announcer on`;
      await sound.init();
      title();
    } catch (e) { msg.textContent = 'could not load: ' + e.message; }
  };
}

function controls() {
  const s = screen(`<h2>CONTROLS</h2><p class="small" style="text-align:left;line-height:1.9">
    <b>Move</b> arrows / WASD / left stick &nbsp;·&nbsp; <b>Turbo</b> Shift / L / RT<br>
    <b>A</b> Space or J (snap · dive · jump · tackle · bring up pass icons, then A/B/X/Y or 1-4 throws)<br>
    <b>B</b> K or X (spin · stiff-arm · dive tackle) &nbsp;·&nbsp; <b>Lateral</b> I &nbsp;·&nbsp; <b>Switch defender</b> Q / LB<br>
    <b>Play call</b> arrows + Space, Shift flips the page, P punt, F field goal &nbsp;·&nbsp; <b>Pause</b> Esc / Start<br>
    Player 2 uses a second gamepad.</p>`);
  const back = document.createElement('button'); back.className = 'btn'; back.textContent = 'BACK'; back.onclick = title; s.appendChild(back);
}

function teamSelect(players) {
  const picks = [];
  const s = screen(`<h2>${players === 1 ? 'PICK YOUR TEAM' : 'PLAYER 1 · PICK YOUR TEAM'}</h2>`);
  const grid = document.createElement('div'); grid.className = 'teams'; s.appendChild(grid);
  let sel = 0;
  const btns = TEAMS.map((t, i) => { const b = document.createElement('button'); b.textContent = t.abbr; b.style.background = t.primary; b.style.color = t.secondary; b.onclick = () => { sel = i; choose(); }; b.onmouseenter = () => { sel = i; draw(); }; grid.appendChild(b); return b; });
  const draw = () => btns.forEach((b, i) => { b.classList.toggle('sel', i === sel); b.classList.toggle('p2', picks.length === 1 && i === sel); });
  const key = e => { const n = TEAMS.length; if (e.code === 'ArrowLeft') sel = (sel + n - 1) % n; else if (e.code === 'ArrowRight') sel = (sel + 1) % n; else if (e.code === 'ArrowUp') sel = (sel + n - 8) % n; else if (e.code === 'ArrowDown') sel = (sel + 8) % n; else if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyJ') { e.preventDefault(); choose(); return; } else if (e.code === 'Escape') { cleanup(); title(); return; } else return; e.preventDefault(); draw(); };
  const cleanup = () => { window.removeEventListener('keydown', key); cancelAnimationFrame(s._raf); };
  const choose = () => {
    picks.push(sel);
    if (picks.length === 1) {
      s.querySelector('h2').textContent = players === 1 ? 'PICK THE CPU TEAM' : 'PLAYER 2 · PICK YOUR TEAM';
      sel = (sel + 7) % TEAMS.length; draw(); return;
    }
    cleanup();
    if (picks[1] === picks[0]) picks[1] = (picks[0] + 1) % TEAMS.length;
    startGame(picks, [true, players === 2]);
  };
  let padH = false, padV = false;
  const pad = () => { const r = input.poll(picks.length === 1 && players === 2 ? 1 : 0, { keyboard: false }); const n = TEAMS.length; if (Math.abs(r.mx) > 0.5 && !padH) { sel = (sel + (r.mx > 0 ? 1 : n - 1)) % n; draw(); } if (Math.abs(r.my) > 0.5 && !padV) { sel = (sel + (r.my > 0 ? 8 : n - 8)) % n; draw(); } padH = Math.abs(r.mx) > 0.5; padV = Math.abs(r.my) > 0.5; if (r.f[0]) choose(); s._raf = requestAnimationFrame(pad); };
  window.addEventListener('keydown', key); s._raf = requestAnimationFrame(pad); draw();
}

// ---------- game ----------
async function startGame(teamIds, human) {
  overlay.innerHTML = '';
  game = new Game({ rules, teams: teamIds, human });
  window.__game = game;                    // for console debugging
  if (assets.ready) applyRosters(game);
  scene.build(game.teams);
  hud.setTeams(game.teams);
  hudEl.style.visibility = 'visible';
  icons = [false, false]; pickBox = [null, null]; paused = false;
  await sound.init(); sound.resume();
  sound.playMusic('tune');
  running = true; last = performance.now(); acc = 0;
  requestAnimationFrame(frame);
}

function applyRosters(g) {
  // Real 2001 names/numbers from the disc roster, mapped onto the 7-man sides by position.
  const teamIdx = { ARI: 0, ATL: 1, BAL: 2, BUF: 3, CAR: 4, CHI: 5, CIN: 6, CLE: 7, DAL: 8, DEN: 9, DET: 10, GB: 11, IND: 12, JAX: 13, KC: 14, MIA: 15, MIN: 16, NE: 17, NO: 18, NYG: 19, NYJ: 20, OAK: 21, PHI: 22, PIT: 23, SD: 24, SF: 25, SEA: 26, STL: 27, TB: 28, TEN: 29, WAS: 30 };
  for (const t of g.teams) {
    const r = assets.roster[teamIdx[t.abbr]]; if (!r) continue;
    const by = p => r.filter(x => x.pos === p);
    const pick = (list, i) => list[i % list.length] || r[0];
    const cv = x => ({ name: x.first + ' ' + x.last, num: x.num, spd: 0.85 + x.ratings[0] / 100 * 0.3, pow: 0.85 + x.ratings[2] / 100 * 0.3, hands: 0.85 + x.ratings[4] / 100 * 0.3 });
    const ol = by('OL'), wr = by('WR'), rb = by('RB'), de = by('DE'), dt = by('DT'), lb = by('LB'), cb = by('CB'), s = by('S');
    t.roster = {
      offense: [cv(pick(by('QB'), 0)), cv(pick(rb, 0)), cv(pick(ol, 0)), cv(pick(ol, 1)), cv(pick(wr, 0)), cv(pick(wr, 1)), cv(pick(wr.length > 2 ? wr : rb, 2))].map((p, i) => ({ ...p, pos: ['QB', 'RB', 'OL', 'OL', 'WR', 'WR', 'WR'][i] })),
      defense: [cv(pick(de, 0)), cv(pick(dt, 0)), cv(pick(lb, 0)), cv(pick(de.length > 1 ? de : lb, 1)), cv(pick(cb, 0)), cv(pick(cb, 1)), cv(pick(s, 0))].map((p, i) => ({ ...p, pos: ['DL', 'DL', 'LB', 'LB', 'CB', 'CB', 'S'][i] })),
    };
  }
  g.buildEntities();
}

function frame(now) {
  if (!running) return;
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const raws = [input.poll(0), input.poll(1)];
  if (raws[0].start || raws[1].start) togglePause();
  if (!paused) {
    acc += dt;
    let steps = 0;
    while (acc >= TICK && steps < 5) { feedInputs(raws, steps === 0); game.tick(TICK); acc -= TICK; steps++; }
    drain();
    uiState(raws);
  }
  input.endFrame();
  const showIcons = [0, 1].some(t => game.human[t] && icons[t] && t === game.poss && game.phase === PHASE.LIVE);
  scene.update(game, paused ? 0 : dt);
  hud.update(game, dt, showIcons);
}

// Translate raw controller state into what the sim expects, with Blitz's two-press passing.
function feedInputs(raws, edge) {
  for (let slot = 0; slot < 2; slot++) {
    const t = slotTeam[slot];
    if (!game.human[t]) continue;
    const raw = raws[slot], dir = game.dir[game.poss];
    const inp = emptyInput();
    inp.mx = -raw.my * dir; inp.my = raw.mx * dir;        // screen-relative: up = downfield
    inp.turbo = raw.turbo;
    if (!edge) { game.inputs[t] = inp; continue; }         // pulses only on the first step of the frame
    const e = game.controlled(t);
    const qbPass = game.phase === PHASE.LIVE && e && e.hasBall && e.role === 'QB' && game.playType === 'pass' && !game.handedOff && !game.special;
    if (qbPass) {
      const d = raw.d.findIndex(Boolean);
      if (d >= 0) { inp.pass = d; icons[t] = true; }
      else if (!icons[t]) { if (raw.f[0]) icons[t] = true; else if (raw.f[1]) inp.b = true; }
      else { const f = raw.f.findIndex(Boolean); if (f >= 0) inp.pass = f; }
    } else {
      icons[t] = false;
      inp.a = raw.f[0]; inp.b = raw.f[1];
      if (raw.f[2] && e && e.hasBall) inp.pass = 0;        // lateral
    }
    inp.sw = raw.sw;
    inp.snap = game.phase === PHASE.PRESNAP && t === game.poss && raw.f[0];
    game.inputs[t] = inp;
  }
}

function drain() {
  for (const ev of game.events.splice(0)) {
    if (ev.type === 'banner') hud.showBanner(ev.text, ev.sub);
    if (ev.type === 'final') setTimeout(finalScreen, 2500);
    sound.onEvent(ev, game);
  }
}

// Open / close the play-call and PAT menus for human teams as phases change.
function uiState(raws) {
  for (let slot = 0; slot < 2; slot++) {
    const t = slotTeam[slot]; if (!game.human[t]) continue;
    const want = game.phase === PHASE.PLAYCALL && (t === game.poss ? game.offPick === null : game.defPick === null) ? 'play'
      : game.phase === PHASE.PAT_CHOICE && t === game.poss ? 'pat' : null;
    const box = pickBox[t];
    if (box && box._kind !== want) { box.remove(); pickBox[t] = null; }
    if (want && !pickBox[t]) {
      const b = want === 'play' ? hud.playcall(game, t, pick => { pickBox[t] = null; input.pressed.clear(); game.choosePlay(t, pick); }) : hud.patChoice(game, t, c => { pickBox[t] = null; input.pressed.clear(); game.choosePat(t, c); });
      b._kind = want; pickBox[t] = b;
      if (slot === 1) b.style.transform = 'translateY(-10px)';
    }
    if (pickBox[t] && pickBox[t]._pad && input.hasPad(slot)) pickBox[t]._pad(input.poll(slot, { keyboard: false }));
  }
}

function togglePause() {
  if (!running) return;
  paused = !paused;
  if (paused) {
    const s = screen(`<h2>PAUSED</h2>`); s.style.background = '#000a';
    s.appendChild(menu([
      { label: 'RESUME', run: () => togglePause() },
      { label: 'QUIT TO TITLE', run: () => { paused = false; title(); } },
      { label: 'BACK OUT', run: () => { location.href = cfg.hub; } },
    ]));
  } else overlay.innerHTML = '';
}

function finalScreen() {
  if (!game || game.phase !== PHASE.FINAL) return;
  const w = game.score[0] === game.score[1] ? null : game.score[0] > game.score[1] ? 0 : 1;
  const s = screen(`<h2>FINAL</h2><h1 style="font-size:min(10vw,80px)">${esc(game.teams[0].abbr)} ${game.score[0]} <span>·</span> ${esc(game.teams[1].abbr)} ${game.score[1]}</h1><h2>${w === null ? 'TIE' : esc(game.teams[w].city.toUpperCase()) + ' WINS'}</h2>`);
  s.style.background = '#000a';
  const ids = game.teams.map(t => t.id), hum = game.human.slice();
  s.appendChild(menu([
    { label: 'REMATCH', run: () => startGame(ids, hum) },
    { label: 'TITLE', run: () => title() },
    { label: 'BACK OUT', run: () => { location.href = cfg.hub; } },
  ]));
}

// ---------- boot ----------
(async () => {
  hudEl.style.visibility = 'hidden';
  title();
  // Quietly reopen the disc data if the browser remembered the file handle.
  if (await assets.restore().catch(() => false)) {
    const t = await assets.soundTable();
    assetStatus = `disc data loaded · ${assets.zip.entries.size} files · ${[...t.keys()].filter(k => k.endsWith('.mss')).length} sounds · real rosters & announcer on`;
    title();
  }
})();
