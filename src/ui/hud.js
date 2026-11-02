// DOM heads-up display: scoreboard, down & distance, turbo, banners, receiver icons, play-call menu.
import { PHASE, RECEIVERS, RECEIVER_LABELS } from '../game/constants.js';
import { OFFENSE_PAGES, DEFENSE_PAGE, FORMATIONS, routePoints } from '../game/plays.js';

const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Hud {
  constructor(hudEl, overlayEl, scene) {
    this.el = hudEl; this.ov = overlayEl; this.scene = scene;
    this.banner = null; this.bannerT = 0; this.toastT = 0;
    this.el.innerHTML = `
      <div class="scorebar"><div class="team t0"><span class="abbr"></span><span class="pts">0</span></div>
        <div class="mid"><div class="clock">2:00</div><div class="qtr">1ST</div></div>
        <div class="team t1"><span class="abbr"></span><span class="pts">0</span></div></div>
      <div class="downbar"></div>
      <div class="turbo p1"><i></i></div><div class="turbo p2"><i></i></div>
      <div class="fire p1" hidden>ON FIRE</div><div class="fire p2" hidden>ON FIRE</div>
      <div class="icons"></div><div class="pbp"></div>
      <div class="tag" hidden></div>
      <div class="kmeter" hidden><div class="sweet"></div><div class="fill"></div><span>KICK · PRESS A</span></div>`;
    this.q = s => this.el.querySelector(s);
    this.icons = this.q('.icons');
    this.menuState = null;
  }

  setTeams(teams) {
    for (let i = 0; i < 2; i++) { const t = this.q('.team.t' + i); t.style.background = `linear-gradient(${teams[i].primary}, #000)`; t.querySelector('.abbr').textContent = teams[i].abbr; }
  }

  update(g, dt, showIcons) {
    this.q('.t0 .pts').textContent = g.score[0]; this.q('.t1 .pts').textContent = g.score[1];
    this.q('.team.t0').classList.toggle('poss', g.poss === 0); this.q('.team.t1').classList.toggle('poss', g.poss === 1);
    this.q('.clock').textContent = mmss(g.clock);
    this.q('.qtr').textContent = g.quarter > g.rules.quarters ? 'OT' : ['', '1ST', '2ND', '3RD', '4TH'][g.quarter] || g.quarter + 'TH';
    const db = this.q('.downbar');
    if (g.special === 'kickoff') db.textContent = 'KICKOFF';
    else if (g.special === 'pat' || g.special === 'pat2') db.textContent = g.special === 'pat' ? 'EXTRA POINT' : '2-PT CONVERSION';
    else { const yl = g.yardline(g.los, g.poss); db.textContent = `${g.ordinal(g.down)} & ${g.toGoText()}  ·  ${g.teams[g.poss].abbr} ball on ${yl <= 50 ? 'own ' + Math.round(yl) : 'opp ' + Math.round(100 - yl)}`; }
    for (let t = 0; t < 2; t++) {
      const c = g.ents[t][g.ctrl[t]];
      const bar = this.q('.turbo.p' + (t + 1)); bar.hidden = !g.human[t]; if (c) bar.firstElementChild.style.width = (c.turbo / g.rules.turboMax * 100) + '%';
      this.q('.fire.p' + (t + 1)).hidden = !g.fire[t];
    }
    this.q('.pbp').textContent = g.pbp;
    const tag = this.q('.tag'), car = g.carrier();
    if (car && car.name && (g.phase === PHASE.LIVE || g.phase === PHASE.DEAD)) {
      const [x, y, vis] = this.scene.project(car.x, car.y, 2.6);
      tag.hidden = !vis; tag.style.left = x + 'px'; tag.style.top = y + 'px'; tag.textContent = `#${car.num} ${car.name}`; tag.style.borderColor = g.teams[car.team].primary;
    } else tag.hidden = true;
    const km = this.q('.kmeter'); km.hidden = !g.meter; if (g.meter) km.querySelector('.fill').style.width = (g.meter.val * 100) + '%';
    // banner lifetime
    if (this.banner) { this.bannerT -= dt; if (this.bannerT <= 0) { this.banner.remove(); this.banner = null; } }
    // receiver icons over eligible receivers while the QB holds the ball
    this.icons.innerHTML = '';
    if (showIcons) {
      const off = g.offense();
      RECEIVERS.forEach((ri, k) => {
        const r = off[ri]; if (!r || r.task === 'block') return;
        const [x, y, vis] = this.scene.project(r.x, r.y, 2.8);
        if (!vis) return;
        const d = document.createElement('div'); d.className = 'icon'; d.textContent = RECEIVER_LABELS[k];
        d.style.left = x + 'px'; d.style.top = y + 'px'; d.style.background = ['#2ecc40', '#ff4136', '#0074d9', '#ffdc00'][k];
        this.icons.appendChild(d);
      });
    }
  }

  showBanner(text, sub) {
    if (this.banner) this.banner.remove();
    const d = document.createElement('div'); d.className = 'banner'; d.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : '');
    this.el.appendChild(d); this.banner = d; this.bannerT = 2.2;
  }

  // ---------- play call ----------
  // Renders the pick box for `team` (human). Calls onPick(pick) where pick = [page, slot] | 'punt' | 'fg' | defIndex.
  playcall(g, team, onPick, onCursor) {
    const isOff = team === g.poss;
    const box = document.createElement('div'); box.className = 'pick';
    const inner = document.createElement('div'); inner.className = 'box'; box.appendChild(inner);
    let page = 0, sel = 4;
    const title = isOff ? 'OFFENSE · PICK A PLAY' : 'DEFENSE · PICK A PLAY';
    const render = () => {
      const plays = isOff ? OFFENSE_PAGES[page] : DEFENSE_PAGE;
      inner.innerHTML = `<h3>${title}<small>${isOff ? `PAGE ${page + 1}/${OFFENSE_PAGES.length} · ⇧/A-B flip` : 'match their play to read it'}</small></h3><div class="plays"></div>
        <div class="foot"><span>${g.ordinal(g.down)} &amp; ${g.toGoText()}</span><span>${isOff && g.down === g.rules.downs && !g.special ? '<b>[P]</b> PUNT · <b>[F]</b> FIELD GOAL · ' : ''}arrows move · space/J picks</span></div>`;
      const grid = inner.querySelector('.plays');
      plays.forEach((p, i) => {
        const b = document.createElement('button');
        const cv = document.createElement('canvas'); cv.width = 150; cv.height = 84; drawPlay(cv, p, isOff);
        b.appendChild(cv); b.appendChild(document.createTextNode(p.name));
        if (i === sel) b.classList.add('sel');
        b.onmouseenter = () => { sel = i; render(); };
        b.onclick = () => choose();
        grid.appendChild(b);
      });
    };
    const choose = () => { box.remove(); window.removeEventListener('keydown', key); onPick(isOff ? [page, sel] : sel); };
    const key = e => {
      if (e.code === 'ArrowLeft') sel = (sel + 8) % 9; else if (e.code === 'ArrowRight') sel = (sel + 1) % 9;
      else if (e.code === 'ArrowUp') sel = (sel + 6) % 9; else if (e.code === 'ArrowDown') sel = (sel + 3) % 9;
      else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { if (isOff) page = (page + 1) % OFFENSE_PAGES.length; }
      else if (e.code === 'Space' || e.code === 'KeyJ' || e.code === 'Enter') { e.preventDefault(); choose(); return; }
      else if (e.code === 'KeyP' && isOff && g.down === g.rules.downs && !g.special) { box.remove(); window.removeEventListener('keydown', key); onPick('punt'); return; }
      else if (e.code === 'KeyF' && isOff && !g.special) { box.remove(); window.removeEventListener('keydown', key); onPick('fg'); return; }
      else return;
      e.preventDefault(); render();
    };
    window.addEventListener('keydown', key);
    render();
    this.ov.appendChild(box);
    // gamepad hook: main.js calls box._pad(raw) each frame
    box._pad = raw => {
      if (raw.mx < -0.5 && !box._h) { sel = (sel + 8) % 9; render(); } if (raw.mx > 0.5 && !box._h) { sel = (sel + 1) % 9; render(); }
      if (raw.my < -0.5 && !box._v) { sel = (sel + 6) % 9; render(); } if (raw.my > 0.5 && !box._v) { sel = (sel + 3) % 9; render(); }
      box._h = Math.abs(raw.mx) > 0.5; box._v = Math.abs(raw.my) > 0.5;
      if (raw.f[0]) choose(); else if (raw.f[1] && isOff) { page = (page + 1) % OFFENSE_PAGES.length; render(); }
    };
    return box;
  }

  patChoice(g, team, onPick) {
    const box = document.createElement('div'); box.className = 'pick';
    box.innerHTML = `<div class="box"><h3>TOUCHDOWN ${esc(g.teams[team].city.toUpperCase())}<small>extra point</small></h3>
      <div class="menu" style="flex-direction:row"><button class="sel" data-c="kick">KICK · 1 PT</button><button data-c="two">GO FOR 2</button></div></div>`;
    let sel = 0; const btns = [...box.querySelectorAll('button')];
    const render = () => btns.forEach((b, i) => b.classList.toggle('sel', i === sel));
    const choose = () => { box.remove(); window.removeEventListener('keydown', key); onPick(btns[sel].dataset.c); };
    const key = e => { if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { sel = 1 - sel; render(); } else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyJ') { e.preventDefault(); choose(); } };
    btns.forEach((b, i) => { b.onclick = () => { sel = i; choose(); }; });
    window.addEventListener('keydown', key);
    box._pad = raw => { if (Math.abs(raw.mx) > 0.5 && !box._h) { sel = 1 - sel; render(); } box._h = Math.abs(raw.mx) > 0.5; if (raw.f[0]) choose(); };
    this.ov.appendChild(box); return box;
  }

  toast(text) {
    let t = this.el.querySelector('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; this.el.appendChild(t); }
    t.textContent = text; t.hidden = false; clearTimeout(this._tt); this._tt = setTimeout(() => { t.hidden = true; }, 1800);
  }
}

// Little play diagram: offense drives up the canvas.
function drawPlay(cv, p, isOff) {
  const x = cv.getContext('2d'); const W = cv.width, H = cv.height;
  x.fillStyle = '#0f3a1e'; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#2c5'; x.lineWidth = 1; x.beginPath(); x.moveTo(0, H * 0.72); x.lineTo(W, H * 0.72); x.stroke();
  const sx = W / 2, sy = H * 0.72, k = 2.6;
  const P = (dx, dy) => [sx + dy * k, sy - dx * k];
  if (isOff) {
    const form = FORMATIONS[p.form];
    form.forEach(([dx, dy], i) => {
      const [px, py] = P(dx, dy);
      x.fillStyle = i === 0 ? '#ffb03b' : '#fff'; x.beginPath(); x.arc(px, py, 3, 0, Math.PI * 2); x.fill();
      const pts = p.type === 'run' && p.carrier === i ? p.path : routePoints(p.routes, i, [dx, dy]);
      if (!pts) return;
      x.strokeStyle = p.type === 'run' && p.carrier === i ? '#ff6a00' : '#ffe600'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(px, py);
      for (const [ax, ay] of pts) { const [qx, qy] = P(ax, ay); x.lineTo(qx, qy); } x.stroke();
    });
  } else {
    const al = { base: [[1.2, -1.6], [1.2, 1.6], [4.5, -4], [4.5, 4], [6, -17], [6, 17], [13, 0]] }.base;
    al.forEach(([dx, dy], i) => { const [px, py] = P(-dx + 0, dy); x.fillStyle = p.rush.includes(i) ? '#ff4136' : '#6cf'; x.beginPath(); x.arc(px, py + 0, 3, 0, Math.PI * 2); x.fill(); });
    x.fillStyle = '#ccc'; x.font = '11px Arial'; x.textAlign = 'center'; x.fillText(p.cov.toUpperCase() + (p.rush.length > 2 ? ' · BLITZ' : ''), W / 2, H - 6);
  }
}
