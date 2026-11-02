// Boot. Reads window.GAME (set by each games/<code>/index.html) to pick a rule set, runs the menus,
// and drives the fixed-step simulation + renderer. Code words only on screen; never the real name.
import { RULES, PHASE, TICK, RECEIVERS } from './game/constants.js';
import { Game, emptyInput } from './game/sim.js';
import { TEAMS } from './data/teams.js';
import { Scene } from './render/scene.js';
import { Hud } from './ui/hud.js';
import { Input } from './input.js';
import { Touch } from './ui/touch.js';
import { assets } from './assets/index.js';
import { Sound } from './audio.js';
import { Season } from './game/season.js';

const cfg = window.GAME || { code: 'KODIAK', variant: 'classic', hub: '../../hub.html' };

// Rule-set switch. 'classic' is the faithful set in constants.js; 'house' overlays the tweaks.
export const VARIANTS = {
  classic: RULES,
  house: { ...RULES, name: 'HOUSE RULES', firstDownYards: 25, onFireStreak: 2, playClock: 12 },
};
// FIREFLY keeps your own tweaks on top of the house set, saved in this browser (see rulesEditor).
// CPU difficulty: a speed/power multiplier on the computer's players, saved per door.
const DIFF_KEY = `${cfg.code}.difficulty`;
const DIFFS = [['EASY', 0.88], ['NORMAL', 1], ['HARD', 1.08], ['BLITZ', 1.16]];
let diff = 1; try { diff = Math.min(DIFFS.length - 1, Math.max(0, parseInt(localStorage.getItem(DIFF_KEY) ?? '1', 10) || 0)); } catch { diff = 1; }
const RULES_KEY = `${cfg.code}.rules`;
const getKnob = (r, k) => k.startsWith('points.') ? r.points[k.slice(7)] : r[k];
// Cheat codes (both doors), saved per browser. Renderer ones go to the scene, the rest ride on the rules.
const CODES_KEY = `${cfg.code}.codes`;
const CODES = [
  { k: 'bigHeads', label: 'BIG HEADS' }, { k: 'tiny', label: 'TINY PLAYERS' }, { k: 'night', label: 'NIGHT GAME' },
  { k: 'superTurbo', label: 'SUPER TURBO' }, { k: 'noFumbles', label: 'NO FUMBLES' }, { k: 'allFire', label: 'EVERYONE ON FIRE' },
];
let codes = {}; try { codes = JSON.parse(localStorage.getItem(CODES_KEY) || '{}') || {}; } catch { codes = {}; }
function loadRules() {
  const base = VARIANTS[cfg.variant] || RULES;
  const r = { ...base, points: { ...base.points } };
  if (cfg.variant === 'house') {
    let o = {}; try { o = JSON.parse(localStorage.getItem(RULES_KEY) || '{}') || {}; } catch { o = {}; }
    for (const [k, v] of Object.entries(o)) { if (k.startsWith('points.')) r.points[k.slice(7)] = v; else if (k in r) r[k] = v; }
  }
  if (codes.superTurbo) r.turboDrain = 0;
  if (codes.noFumbles) r.fumbles = false;
  if (codes.allFire) r.alwaysFire = true;
  r.cpuSkill = DIFFS[diff][1];
  return r;
}
let rules = loadRules();
const KNOBS = [
  { k: 'firstDownYards', label: 'FIRST DOWN', min: 5, max: 60, step: 5, fmt: v => v + ' YDS' },
  { k: 'downs', label: 'DOWNS', min: 1, max: 6, step: 1 },
  { k: 'quarterSeconds', label: 'QUARTER', min: 30, max: 600, step: 30, fmt: v => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}` },
  { k: 'playClock', label: 'PLAY CLOCK', min: 5, max: 30, step: 1, fmt: v => v + ' S' },
  { k: 'onFireStreak', label: 'FIRE AFTER', min: 1, max: 6, step: 1, fmt: v => v + ' SCORES' },
  { k: 'onFireBoost', label: 'FIRE BOOST', min: 1, max: 1.6, step: 0.05, fmt: v => 'x' + v.toFixed(2) },
  { k: 'turboSpeed', label: 'TURBO SPEED', min: 1, max: 1.8, step: 0.05, fmt: v => 'x' + v.toFixed(2) },
  { k: 'turboDrain', label: 'TURBO DRAIN', min: 0, max: 90, step: 5, fmt: v => v === 0 ? 'NEVER' : v + ' / S' },
  { k: 'speedScale', label: 'GAME SPEED', min: 0.6, max: 1.6, step: 0.1, fmt: v => Math.round(v * 100) + '%' },
  { k: 'lateHits', label: 'LATE HITS', bool: true },
  { k: 'kickoffs', label: 'KICKOFFS', bool: true },
  { k: 'points.td', label: 'TOUCHDOWN', min: 1, max: 12, step: 1, fmt: v => v + ' PTS' },
  { k: 'points.fg', label: 'FIELD GOAL', min: 0, max: 7, step: 1, fmt: v => v + ' PTS' },
];
const season = new Season(cfg.code, TEAMS);
let seasonGame = null;               // the season fixture the running game counts for

const overlay = document.getElementById('overlay');
const hudEl = document.getElementById('hud');
const canvas = document.getElementById('gl');
const scene = new Scene(canvas);
const hud = new Hud(hudEl, overlay, scene);
const input = new Input();
const touch = new Touch(document.getElementById('app')); input.touch = touch; touch.show(false);
const sound = new Sound(assets);

let game = null, running = false, paused = false, last = 0, acc = 0;
let slotTeam = [0, 1];               // input slot -> team index
let icons = [false, false];
let pickBox = [null, null];
// Instant replay: the last seconds of a scoring play, recorded once per frame while the ball is live.
const REPLAY_FRAMES = 200, REPLAY_SPEED = 0.6;
let ring = [], pendingReplay = null, replay = null;
function recordFrame() {
  const g = game;
  if (g.phase === PHASE.PRESNAP || g.phase === PHASE.KICKOFF) { ring.length = 0; return; }
  if (g.phase !== PHASE.LIVE) return;
  ring.push({
    ents: g.ents.map(t => t.map(e => ({ x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, face: e.face, state: e.state, st: e.st, hasBall: e.hasBall, team: e.team, idx: e.idx, role: e.role, name: e.name, num: e.num, task: e.task, turbo: e.turbo, turboOn: e.turboOn, engaged: e.engaged, blocked: e.blocked, burstT: e.burstT }))),
    ball: { ...g.ball }, fire: g.fire.slice(), poss: g.poss, los: g.los, firstDownX: g.firstDownX,
  });
  if (ring.length > REPLAY_FRAMES) ring.shift();
}
function replayProxy(f) {
  return { ents: f.ents, ball: f.ball, fire: f.fire, poss: f.poss, dir: game.dir, human: [false, false], ctrl: game.ctrl, phase: PHASE.LIVE, special: null, los: f.los, firstDownX: f.firstDownX, teams: game.teams, replay: true, scorer: null, deadReason: '',
    goalLineFor: t => game.goalLineFor(t), carrier() { const h = f.ball.holder; return h ? f.ents[h.team][h.idx] : null; } };
}
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
  let padV = false; const pad = () => { const r = input.poll(0, { keyboard: false }); touch.apply(r); if (Math.abs(r.my) > 0.5 && !padV) step(r.my > 0 ? 1 : -1); padV = Math.abs(r.my) > 0.5; if (r.f[0] || r.start) go(); wrap._raf = requestAnimationFrame(pad); };
  const cleanup = () => { window.removeEventListener('keydown', key); cancelAnimationFrame(wrap._raf); };
  window.addEventListener('keydown', key); wrap._raf = requestAnimationFrame(pad);
  draw(); return wrap;
}

function title() {
  running = false; hudEl.style.visibility = 'hidden'; touch.show(false);
  const s = screen(`<h1>${esc(cfg.code.slice(0, 1))}<span>${esc(cfg.code.slice(1))}</span></h1><h2>${esc(rules.name)}</h2>`);
  s.appendChild(menu([
    { label: '1 PLAYER', run: () => teamSelect(1) },
    { label: '2 PLAYER', run: () => teamSelect(2) },
    { label: 'WATCH CPU DEMO', run: () => { seasonGame = null; startGame([5, 9], [false, false]); } },
    { label: season.active ? 'CONTINUE SEASON' : 'SEASON', run: () => seasonScreen() },
    { label: 'CODES' + (CODES.some(c => codes[c.k]) ? ' ✓' : ''), run: () => codesScreen() },
    { label: 'CPU: ' + DIFFS[diff][0], run: () => { diff = (diff + 1) % DIFFS.length; try { localStorage.setItem(DIFF_KEY, String(diff)); } catch { /* session only */ } rules = loadRules(); title(); } },
    ...(cfg.variant === 'house' ? [{ label: 'HOUSE RULES', run: () => rulesEditor() }] : []),
    { label: assets.ready ? 'DISC DATA LOADED ✓' : (assets.canResume ? 'RESUME DISC DATA' : 'LOAD DISC DATA'), run: () => (assets.canResume && !assets.ready ? resumeDisc() : loadDisc()) },
    { label: 'CONTROLS', run: () => controls() },
    { label: 'BACK OUT', run: () => { location.href = cfg.hub; } },
  ]));
  const p = document.createElement('p'); p.className = 'small';
  p.innerHTML = `${esc(assetStatus)}<br>Rule set: <code>${esc(rules.name)}</code> · ${rules.playersPerSide} a side · ${rules.firstDownYards} yards in ${rules.downs} downs · ${rules.kickoffs ? 'kickoffs' : 'no kickoffs'} · ${rules.lateHits ? 'late hits' : 'no late hits'} · no flags`;
  s.appendChild(p);
}

async function describeAssets() {
  const t = await assets.soundTable();
  return `disc data on (${assets.source || 'loaded'}) · ${assets.zip.entries.size} files · ${[...t.keys()].filter(k => k.endsWith('.mss')).length} sounds · real models, rosters & announcer`;
}
// After any load, keep a copy in browser storage so the next visit needs nothing.
async function keepCopy(msgEl) {
  if (assets.cached) return;
  if (msgEl) msgEl.textContent = 'saving a copy in this browser (one time, about 360 MB)…';
  const ok = await assets.cacheInBrowser(p => { if (msgEl) msgEl.textContent = `saving a copy in this browser… ${Math.round(p * 100)}%`; });
  assetStatus = (await describeAssets()) + (ok ? ' · kept in this browser' : '');
  if (msgEl) msgEl.textContent = ok ? 'done. this browser will load it automatically from now on.' : 'could not keep a copy (storage denied); you can still pick the file each visit.';
}
async function resumeDisc() {
  try { if (await assets.resume()) { assetStatus = await describeAssets(); await sound.init(); await keepCopy(null); } } catch (e) { console.warn(e); }
  title();
}
async function loadDisc() {
  const s = screen(`<h2>LOAD DISC DATA</h2><p class="small">Pick <code>DATA/BASSETS.ZIP</code> from your own copy of the disc (or the whole .iso). It is read in your browser only; nothing is uploaded or stored on the site. The browser keeps its own copy, so you do this once per browser.</p>`);
  const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'CHOOSE FILE'; s.appendChild(b);
  const back = document.createElement('button'); back.className = 'btn'; back.style.marginTop = '12px'; back.textContent = 'BACK'; back.onclick = title; s.appendChild(back);
  if (assets.ready) { const f = document.createElement('button'); f.className = 'btn'; f.style.marginTop = '12px'; f.textContent = 'FORGET DISC DATA IN THIS BROWSER'; f.onclick = async () => { await assets.forgetCache(); location.reload(); }; s.appendChild(f); }
  const msg = document.createElement('p'); msg.className = 'small'; s.appendChild(msg);
  b.onclick = async () => {
    try {
      msg.textContent = 'reading…';
      await assets.pick();
      assetStatus = await describeAssets();
      await sound.init();
      await keepCopy(msg);
      setTimeout(title, 1200);
    } catch (e) { msg.textContent = 'could not load: ' + e.message; }
  };
}

// ---------- house rules (FIREFLY) ----------
function rulesEditor() {
  let o = {}; try { o = JSON.parse(localStorage.getItem(RULES_KEY) || '{}') || {}; } catch { o = {}; }
  const base = VARIANTS.house;
  const s = screen(`<h2>HOUSE RULES</h2><p class="small">Left / right changes a rule. Saved in this browser; this door always plays with them.</p>`);
  const list = document.createElement('div'); list.className = 'rules'; s.appendChild(list);
  const rows = KNOBS.map(kn => { const d = document.createElement('div'); d.className = 'row'; d.innerHTML = `<span class="lbl">${esc(kn.label)}</span><button class="dec">&#9664;</button><span class="val"></span><button class="inc">&#9654;</button>`; list.appendChild(d); return d; });
  const actions = [['RESET TO DEFAULTS', () => { o = {}; save(); }], ['DONE', () => { cleanup(); title(); }]];
  const arows = actions.map(([l]) => { const d = document.createElement('div'); d.className = 'row act'; d.innerHTML = `<span class="lbl">${esc(l)}</span>`; list.appendChild(d); return d; });
  let sel = 0; const n = KNOBS.length + actions.length;
  const cur = kn => kn.k in o ? o[kn.k] : getKnob(base, kn.k);
  const draw = () => {
    KNOBS.forEach((kn, i) => { const v = cur(kn); rows[i].querySelector('.val').textContent = kn.bool ? (v ? 'ON' : 'OFF') : (kn.fmt ? kn.fmt(v) : String(v)); rows[i].classList.toggle('sel', i === sel); rows[i].classList.toggle('changed', kn.k in o); });
    arows.forEach((d, i) => d.classList.toggle('sel', KNOBS.length + i === sel));
  };
  const save = () => { try { localStorage.setItem(RULES_KEY, JSON.stringify(o)); } catch { /* keep for this visit */ } rules = loadRules(); draw(); };
  const adjust = (i, d) => {
    const kn = KNOBS[i]; if (!kn) return; let v = cur(kn);
    if (kn.bool) v = !v; else v = Math.round(Math.min(kn.max, Math.max(kn.min, v + d * kn.step)) * 100) / 100;
    if (v === getKnob(base, kn.k)) delete o[kn.k]; else o[kn.k] = v;
    save();
  };
  const go = () => { if (sel < KNOBS.length) adjust(sel, 1); else actions[sel - KNOBS.length][1](); };
  rows.forEach((d, i) => { d.querySelector('.dec').onclick = () => { sel = i; adjust(i, -1); }; d.querySelector('.inc').onclick = () => { sel = i; adjust(i, 1); }; d.onmouseenter = () => { sel = i; draw(); }; });
  arows.forEach((d, i) => { d.onclick = () => { sel = KNOBS.length + i; go(); }; d.onmouseenter = () => { sel = KNOBS.length + i; draw(); }; });
  const key = e => {
    if (e.code === 'ArrowUp' || e.code === 'KeyW') sel = (sel + n - 1) % n; else if (e.code === 'ArrowDown' || e.code === 'KeyS') sel = (sel + 1) % n;
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') adjust(sel, -1); else if (e.code === 'ArrowRight' || e.code === 'KeyD') adjust(sel, 1);
    else if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyJ') go(); else if (e.code === 'Escape') { cleanup(); title(); return; } else return;
    e.preventDefault(); if (s.isConnected) draw();
  };
  let pv = false, ph = false;
  const pad = () => {
    const r = input.poll(0, { keyboard: false }); touch.apply(r);
    if (Math.abs(r.my) > 0.5 && !pv) { sel = (sel + (r.my > 0 ? 1 : n - 1)) % n; draw(); }
    if (Math.abs(r.mx) > 0.5 && !ph) adjust(sel, r.mx > 0 ? 1 : -1);
    pv = Math.abs(r.my) > 0.5; ph = Math.abs(r.mx) > 0.5;
    if (r.f[0]) go(); else if (r.f[1] || r.start) { cleanup(); title(); }
    if (s.isConnected) s._raf = requestAnimationFrame(pad);
  };
  const cleanup = () => { window.removeEventListener('keydown', key); cancelAnimationFrame(s._raf); };
  window.addEventListener('keydown', key); s._raf = requestAnimationFrame(pad); draw();
}

// ---------- cheat codes ----------
function codesScreen() {
  const s = screen(`<h2>CODES</h2><p class="small">Tap a row to flip it. Saved in this browser.</p>`);
  const list = document.createElement('div'); list.className = 'rules'; s.appendChild(list);
  const items = [...CODES, { k: null, label: 'DONE' }];
  const rows = items.map(it => { const d = document.createElement('div'); d.className = 'row' + (it.k ? '' : ' act'); d.innerHTML = `<span class="lbl">${esc(it.label)}</span>` + (it.k ? '<span class="val"></span>' : ''); list.appendChild(d); return d; });
  let sel = 0; const n = items.length;
  const draw = () => rows.forEach((d, i) => { d.classList.toggle('sel', i === sel); const it = items[i]; if (it.k) { d.querySelector('.val').textContent = codes[it.k] ? 'ON' : 'OFF'; d.classList.toggle('changed', !!codes[it.k]); } });
  const cleanup = () => { window.removeEventListener('keydown', key); cancelAnimationFrame(s._raf); };
  const go = () => { const it = items[sel]; if (!it.k) { cleanup(); title(); return; } codes[it.k] = !codes[it.k]; if (!codes[it.k]) delete codes[it.k]; try { localStorage.setItem(CODES_KEY, JSON.stringify(codes)); } catch { /* session only */ } rules = loadRules(); draw(); };
  rows.forEach((d, i) => { d.onclick = () => { sel = i; go(); }; d.onmouseenter = () => { sel = i; draw(); }; });
  const key = e => {
    if (e.code === 'ArrowUp' || e.code === 'KeyW') sel = (sel + n - 1) % n; else if (e.code === 'ArrowDown' || e.code === 'KeyS') sel = (sel + 1) % n;
    else if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyJ' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') go(); else if (e.code === 'Escape') { cleanup(); title(); return; } else return;
    e.preventDefault(); if (s.isConnected) draw();
  };
  let pv = false;
  const pad = () => {
    const r = input.poll(0, { keyboard: false }); touch.apply(r);
    if (Math.abs(r.my) > 0.5 && !pv) { sel = (sel + (r.my > 0 ? 1 : n - 1)) % n; draw(); } pv = Math.abs(r.my) > 0.5;
    if (r.f[0]) go(); else if (r.f[1] || r.start) { cleanup(); title(); }
    if (s.isConnected) s._raf = requestAnimationFrame(pad);
  };
  window.addEventListener('keydown', key); s._raf = requestAnimationFrame(pad); draw();
}

// ---------- season ----------
function seasonScreen() {
  if (!season.active) { teamSelect(1, id => { season.start(id); seasonScreen(); }); return; }
  const st = season.s, me = TEAMS[st.team], rec = season.recordOf(st.team), nx = season.next();
  const ab = id => esc(TEAMS[id].abbr);
  const s = screen(`<h2>SEASON · ${ab(st.team)} ${rec.w}-${rec.l}</h2>`);
  const cols = document.createElement('div'); cols.className = 'season';
  const sched = st.games.map((g, i) => `<div class="${g.result ? (g.result[0] > g.result[1] ? 'w' : 'l') : ''}">WK ${i + 1} ${g.home ? 'vs' : 'at'} ${ab(g.opp)} ${g.result ? `<b>${g.result[0] > g.result[1] ? 'W' : 'L'} ${g.result[0]}-${g.result[1]}</b>` : ''}</div>`).join('');
  const m = x => x ? `<div>${ab(x[0])} vs ${ab(x[1])} ${x[2] != null ? '<b>' + ab(x[2]) + '</b>' : ''}</div>` : '';
  const po = st.playoffs ? `<div class="hd">PLAYOFFS</div>${m(st.playoffs.semis[0])}${m(st.playoffs.semis[1])}${st.playoffs.final ? '<div class="hd">FINAL</div>' + m(st.playoffs.final) : ''}` : '';
  const stand = season.standings().slice(0, 10).map((r, i) => `<div class="${r.id === st.team ? 'me' : ''}">${i + 1}. ${ab(r.id)} ${r.w}-${r.l}</div>`).join('');
  const ld = (label, key, unit) => { const L = season.leader(key); return L ? `<div>${label} <b>${esc(L.name)}</b> ${ab(L.team)} · ${Math.round(L[key])}${unit}</div>` : ''; };
  const leaders = ld('PASS', 'passYds', ' YDS') + ld('RUSH', 'rushYds', ' YDS') + ld('REC', 'recYds', ' YDS') + ld('TD', 'td', '') + ld('TACKLES', 'tackles', '');
  cols.innerHTML = `<div><div class="hd">SCHEDULE</div>${sched}${po}</div><div><div class="hd">STANDINGS</div>${stand}</div>` + (leaders ? `<div><div class="hd">LEADERS</div>${leaders}</div>` : '');
  s.appendChild(cols);
  const items = [];
  if (nx) items.push({ label: `PLAY ${nx.label}: ${nx.ids.map(ab).join(' VS ')}`, run: () => { seasonGame = nx; startGame(nx.ids, nx.human); } });
  else items.push({ label: st.champion === st.team ? 'YOU ARE THE CHAMPS' : 'SEASON OVER' + (st.champion != null ? ' · ' + TEAMS[st.champion].abbr + ' WON IT' : ''), disabled: true });
  items.push({ label: 'NEW SEASON', run: () => { season.clear(); seasonScreen(); } }, { label: 'TITLE', run: title });
  s.appendChild(menu(items));
}

function controls() {
  const s = screen(`<h2>CONTROLS</h2><p class="small" style="text-align:left;line-height:1.9">
    <b>Move</b> arrows / WASD / left stick &nbsp;·&nbsp; <b>Turbo</b> Shift / L / RT<br>
    <b>A</b> Space or J (snap · dive · jump · tackle · bring up pass icons, then A/B/X/Y or 1-4 throws)<br>
    <b>B</b> K or X (spin · stiff-arm · dive tackle) &nbsp;·&nbsp; <b>Lateral</b> I &nbsp;·&nbsp; <b>Switch defender</b> Q / LB<br>
    <b>Play call</b> arrows + Space, Shift flips the page, P punt, F field goal &nbsp;·&nbsp; <b>Pause</b> Esc / Start<br>
    <b>Kicks</b> A snaps, then A again to stop the meter: the green zone is full power and true aim<br>
    Player 2 uses a second gamepad.</p>`);
  const back = document.createElement('button'); back.className = 'btn'; back.textContent = 'BACK'; back.onclick = title; s.appendChild(back);
}

function teamSelect(players, single = null) {
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
    if (single) { cleanup(); single(sel); return; }
    if (picks.length === 1) {
      s.querySelector('h2').textContent = players === 1 ? 'PICK THE CPU TEAM' : 'PLAYER 2 · PICK YOUR TEAM';
      sel = (sel + 7) % TEAMS.length; draw(); return;
    }
    cleanup();
    if (picks[1] === picks[0]) picks[1] = (picks[0] + 1) % TEAMS.length;
    seasonGame = null; startGame(picks, [true, players === 2]);
  };
  let padH = false, padV = false;
  const pad = () => { const r = input.poll(picks.length === 1 && players === 2 ? 1 : 0, { keyboard: false }); const n = TEAMS.length; if (Math.abs(r.mx) > 0.5 && !padH) { sel = (sel + (r.mx > 0 ? 1 : n - 1)) % n; draw(); } if (Math.abs(r.my) > 0.5 && !padV) { sel = (sel + (r.my > 0 ? 8 : n - 8)) % n; draw(); } padH = Math.abs(r.mx) > 0.5; padV = Math.abs(r.my) > 0.5; if (r.f[0]) choose(); s._raf = requestAnimationFrame(pad); };
  window.addEventListener('keydown', key); s._raf = requestAnimationFrame(pad); draw();
}

// ---------- game ----------
async function startGame(teamIds, human) {
  overlay.innerHTML = '';
  game = new Game({ rules, teams: teamIds, human });
  ring.length = 0; pendingReplay = null; replay = null;
  scene.codes = { bigHeads: !!codes.bigHeads, tiny: !!codes.tiny, night: !!codes.night };
  window.__game = game; window.__scene = scene; window.__assets = assets;   // for console debugging
  if (assets.ready) applyRosters(game);
  scene.build(game.teams); scene.applyCodes();
  hud.setTeams(game.teams);
  if (assets.ready) scene.useAssets(assets);
  hudEl.style.visibility = 'visible'; touch.show(true);
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

window.__frame = now => frame(now);   // dev hook: step the loop by hand when rAF is paused (hidden tabs)
function frame(now) {
  if (!running) return;
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const raws = [input.poll(0), input.poll(1)];
  if (replay) {   // the sim waits during the replay; A or Start skips it
    if (raws[0].start || raws[1].start || raws[0].f[0] || raws[1].f[0]) replay = null;
    else { replay.i += dt * 60 * REPLAY_SPEED; if (replay.i >= replay.frames.length) replay = null; }
    if (replay) { input.endFrame(); scene.update(replayProxy(replay.frames[replay.i | 0]), dt * REPLAY_SPEED); hud.update(game, dt, false); return; }
    input.pressed.clear();
  }
  if (raws[0].start || raws[1].start) togglePause();
  if (!paused) {
    acc += dt;
    let steps = 0;
    while (acc >= TICK && steps < 5) { feedInputs(raws, steps === 0); game.tick(TICK); acc -= TICK; steps++; }
    if (steps) recordFrame();
    drain();
    if (pendingReplay && game.phase === PHASE.PAT_CHOICE) { replay = { frames: pendingReplay, i: 0 }; pendingReplay = null; hud.showBanner('INSTANT REPLAY', 'A TO SKIP'); }
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
    if (ev.type === 'sound' && ev.name === 'touchdown' && ring.length > 40) pendingReplay = ring.slice(-REPLAY_FRAMES);
    if (ev.type === 'sound') { if (ev.name === 'bighit') scene.shake = 0.6; else if (ev.name === 'hit') scene.shake = 0.2; else if (ev.name === 'touchdown') scene.shake = 0.25; if (ev.name === 'touchdown' || ev.name === 'fgood' || ev.name === 'bighit') scene.excite = 1; }
    sound.onEvent(ev, game);
  }
}

// Open / close the play-call and PAT menus for human teams as phases change.
function uiState(raws) {
  for (let slot = 0; slot < 2; slot++) {
    const t = slotTeam[slot]; if (!game.human[t]) continue;
    const want = game.phase === PHASE.PLAYCALL && (t === game.poss ? game.offPick === null : game.defPick === null) ? 'play'
      : game.phase === PHASE.PAT_CHOICE && t === game.poss && !replay ? 'pat' : null;
    const box = pickBox[t];
    if (box && box._kind !== want) { box.remove(); pickBox[t] = null; }
    if (want && !pickBox[t]) {
      const b = want === 'play' ? hud.playcall(game, t, pick => { pickBox[t] = null; input.pressed.clear(); game.choosePlay(t, pick); }) : hud.patChoice(game, t, c => { pickBox[t] = null; input.pressed.clear(); game.choosePat(t, c); });
      b._kind = want; pickBox[t] = b;
      if (slot === 1) { b.style.justifyContent = 'flex-end'; b.style.paddingRight = '24px'; b.querySelector('.box').style.minWidth = '520px'; }
      if (slot === 0 && game.human[0] && game.human[1]) { b.style.justifyContent = 'flex-start'; b.style.paddingLeft = '24px'; b.querySelector('.box').style.minWidth = '520px'; }
    }
    if (pickBox[t] && pickBox[t]._pad && (input.hasPad(slot) || (slot === 0 && touch.enabled))) pickBox[t]._pad(input.poll(slot, { keyboard: false }));
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
  const st = game.stats, P = [...st.players.values()];
  const top = (key, t) => { const p = P.filter(x => x.team === t && x[key] > 0).sort((a, b) => b[key] - a[key])[0]; return p ? `${esc(p.name)} · ${Math.round(p[key])}` : '-'; };
  const row = (l, a, b) => `<tr><td>${l}</td><td>${a}</td><td>${b}</td></tr>`;
  const box = document.createElement('div'); box.className = 'boxscore';
  box.innerHTML = `<table><tr><th></th><th>${esc(game.teams[0].abbr)}</th><th>${esc(game.teams[1].abbr)}</th></tr>` +
    row('PASSING', ...[0, 1].map(t => `${Math.round(st.team[t].passYds)} YDS · ${st.team[t].comp}/${st.team[t].att}`)) +
    row('RUSHING', ...[0, 1].map(t => `${Math.round(st.team[t].rushYds)} YDS`)) +
    row('HITS', st.hits[0], st.hits[1]) + row('TURNOVERS', st.team[0].int + st.team[0].fum, st.team[1].int + st.team[1].fum) +
    row('TOP PASSER', top('passYds', 0), top('passYds', 1)) + row('TOP RUSHER', top('rushYds', 0), top('rushYds', 1)) +
    row('TOP RECEIVER', top('recYds', 0), top('recYds', 1)) + row('TOP TACKLER', top('tackles', 0), top('tackles', 1)) + row('TOUCHDOWNS', top('td', 0), top('td', 1)) + '</table>';
  s.appendChild(box);
  const ids = game.teams.map(t => t.id), hum = game.human.slice();
  if (seasonGame) {
    season.record(seasonGame.ids, game.score.slice(), game.stats); seasonGame = null;
    s.appendChild(menu([{ label: 'CONTINUE SEASON', run: () => seasonScreen() }, { label: 'TITLE', run: () => title() }]));
    return;
  }
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
  // Dev: ?pack=http://127.0.0.1:8779/BASSETS.ZIP loads the archive over local HTTP byte ranges.
  const packUrl = new URLSearchParams(location.search).get('pack');
  // Only this site's own origin or a loopback dev server may supply the archive.
  const packOk = (() => { try { const u = new URL(packUrl, location.href); return u.origin === location.origin || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(u.origin); } catch { return false; } })();
  if (packUrl && packOk) {
    try { await assets.openUrl(packUrl); assets.source = 'local server'; assetStatus = await describeAssets(); title(); return; } catch (e) { console.warn('pack url', e); }
  }
  // Private deployment: the site itself serves the archive (behind the host's login) at /pack/BASSETS.ZIP.
  try {
    const base = location.pathname.replace(/games\/[^/]+\/.*$/, '');
    const probe = await fetch(base + 'pack/BASSETS.ZIP', { method: 'HEAD' });
    if (probe.ok && probe.headers.get('accept-ranges') === 'bytes') { await assets.openUrl(base + 'pack/BASSETS.ZIP'); assets.source = 'this site'; assetStatus = await describeAssets(); title(); return; }
  } catch (e) { /* public site: no archive here */ }
  // Quietly reopen the disc data if the browser remembered the file handle.
  if (await assets.restore().catch(() => false)) { assetStatus = await describeAssets(); title(); }
  else if (assets.canResume) { assetStatus = 'disc data remembered · one click to resume'; title(); }
})();
