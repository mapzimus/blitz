// The game state machine: phases, clock, downs, scoring. Live-ball physics lives in live.js.
import { FIELD, RULES, PHASE, ROLES_OFF, ROLES_DEF, RECEIVERS, MOVE } from './constants.js';
import { kickFactor, meterWave } from './constants.js';
import { TEAMS, roster } from '../data/teams.js';
import { makeEntity, setState, dist2, clamp } from './entity.js';
import { OFFENSE_PAGES, DEFENSE_PAGE, FORMATIONS, DEF_ALIGN, routePoints } from './plays.js';
import { pickPlayAI } from './ai.js';
import { liveTick } from './live.js';

export const emptyInput = () => ({ mx: 0, my: 0, turbo: false, a: false, b: false, pass: -1, sw: false, snap: false, icons: false });

export class Game {
  constructor({ rules = RULES, teams = [0, 1], human = [true, false], seed = 1 } = {}) {
    this.rules = rules;
    this.teams = teams.map(id => ({ ...TEAMS[id], roster: roster(id) }));
    this.human = human;
    this.inputs = [emptyInput(), emptyInput()];
    this.ctrl = [0, 6];
    this.events = [];
    this.pbp = '';
    this.score = [0, 0];
    this.streak = [0, 0];
    this.fire = [false, false];
    this.quarter = 1;
    this.clock = rules.quarterSeconds;
    this.clockStopped = true;
    this.dir = [1, -1];
    this.poss = 0;
    this.down = 1; this.toGo = rules.firstDownYards; this.los = 20; this.firstDownX = 50;
    this.ball = { x: 50, y: FIELD.mid, z: 0, vx: 0, vy: 0, vz: 0, inAir: false, holder: null, target: -1, landX: 0, landY: 0, landT: 0, landZ: 0, kind: 'pass', loose: false };
    this.ents = [[], []];
    this.phase = PHASE.KICKOFF; this.phaseT = 0;
    this.special = null;           // 'kickoff' | 'punt' | 'fg' | 'pat' | 'pat2' | null
    this.meter = null;             // human kick meter {t,val,dur}
    this.scorer = null;            // who just scored (celebration camera)
    this.offPlay = null; this.defPlay = null; this.offPick = null; this.defPick = null;
    this.playType = 'pass'; this.handedOff = false; this.caught = false; this.liveT = 0;
    this.deadT = 0; this.deadReason = ''; this.deadSpot = null; this.whistleX = 0;
    this.stats = { plays: 0, hits: [0, 0], team: [0, 1].map(() => ({ passYds: 0, rushYds: 0, att: 0, comp: 0, int: 0, fum: 0 })), players: new Map() };
    this.catcher = null;
    this.kickoffTeam = 1;          // team 1 kicks to open; home receives
    this.setupKickoff(1);
  }

  // ---------- helpers ----------
  stat(e, key, v = 1) {
    if (!e || !e.name) return;
    const k = e.team + ':' + e.name; let p = this.stats.players.get(k);
    if (!p) { p = { team: e.team, name: e.name, num: e.num, pos: e.role, passYds: 0, rushYds: 0, recYds: 0, td: 0, tackles: 0, ints: 0 }; this.stats.players.set(k, p); }
    p[key] = (p[key] || 0) + v;
  }
  offense() { return this.ents[this.poss]; }
  defense() { return this.ents[1 - this.poss]; }
  carrier() { const h = this.ball.holder; return h ? this.ents[h.team][h.idx] : null; }
  qb() { return this.offense()[0]; }
  goalLineFor(team) { return this.dir[team] > 0 ? FIELD.length : 0; }
  ownGoalFor(team) { return this.dir[team] > 0 ? 0 : FIELD.length; }
  toWorld(team, dx, dy) { const d = this.dir[team]; return [this.los + d * dx, FIELD.mid + d * dy]; }
  yardline(x, team) { return this.dir[team] > 0 ? x : FIELD.length - x; }  // yards from team's own goal
  emit(type, data) { this.events.push({ type, ...data }); }
  banner(text, sub) { this.emit('banner', { text, sub }); }
  say(text) { this.pbp = text; this.emit('pbp', { text }); }
  controlled(team) { return this.ents[team][this.ctrl[team]]; }

  buildEntities() {
    for (let t = 0; t < 2; t++) {
      const isOff = t === this.poss;
      const roles = isOff ? ROLES_OFF : ROLES_DEF;
      const r = isOff ? this.teams[t].roster.offense : this.teams[t].roster.defense;
      this.ents[t] = roles.map((role, i) => {
        const e = makeEntity(t, i, role, r[i]);
        if (!this.human[t] && this.rules.cpuSkill) { e.spd *= this.rules.cpuSkill; e.pow *= this.rules.cpuSkill; }
        const prev = this.ents[t][i];
        if (prev) { e.turbo = prev.turbo; e.x = prev.x; e.y = prev.y; e.face = prev.face; }   // stay where the last play ended
        else { e.turbo = this.rules.turboMax; e.x = this.los || 50; e.y = 10 + i * 5; }
        return e;
      });
    }
  }
  giveBall(team, idx) {
    for (const t of this.ents) for (const e of t) e.hasBall = false;
    const e = this.ents[team][idx];
    e.hasBall = true;
    this.ball.holder = { team, idx }; this.ball.inAir = false; this.ball.loose = false;
    this.ball.x = e.x; this.ball.y = e.y; this.ball.z = 1;
  }
  dropBall() { for (const t of this.ents) for (const e of t) e.hasBall = false; this.ball.holder = null; }

  // ---------- kickoff ----------
  setupKickoff(kicking, fromSpot = this.rules.kickoffSpot) {
    if (this.rules.kickoffs === false) { this.special = null; const rcv = 1 - kicking; this.newDrive(rcv, this.dir[rcv] > 0 ? 20 : FIELD.length - 20); return; }
    this.phase = PHASE.KICKOFF; this.phaseT = 0; this.special = 'kickoff';
    this.meter = this.human[kicking] ? { t: 0, val: 0, dur: 1.2 } : null;
    this.poss = 1 - kicking;                      // receiving team is the offense
    this.kickoffTeam = kicking;
    this.buildEntities();
    const kd = this.dir[kicking];
    const spot = kd > 0 ? fromSpot : FIELD.length - fromSpot;
    this.los = spot;
    const K = this.ents[kicking], R = this.ents[this.poss];
    K.forEach((e, i) => { e.x = spot - kd * (i === 6 ? 7 : 1.5); e.y = 6 + i * 7; e.face = kd > 0 ? 0 : Math.PI; e.task = 'cover'; });
    const ret = R[1];
    ret.x = spot + kd * 55; ret.y = FIELD.mid; ret.task = 'return';
    R.forEach((e, i) => { if (i !== 1) { e.x = spot + kd * (18 + (i % 3) * 6); e.y = 8 + i * 6.5; e.task = 'block'; } e.face = kd > 0 ? Math.PI : 0; });
    this.ball.x = spot; this.ball.y = FIELD.mid; this.ball.z = 0; this.ball.inAir = false; this.ball.loose = false;
    this.dropBall();
    this.ctrl[this.poss] = 1; this.ctrl[kicking] = 6;
    this.clockStopped = true;
    this.liveT = 0; this.handedOff = true; this.caught = false; this.playType = 'kick';
    this.say(`${this.teams[kicking].city} kicks off.`);
  }
  doKick(pf = null) {
    const k = this.ents[this.kickoffTeam][6];
    const kd = this.dir[this.kickoffTeam];
    const f = kickFactor(pf);
    const power = MOVE.kickPower * f.power;
    const ret = this.ents[this.poss][1];
    this.meter = null;
    this.throwBall(k, ret.x + kd * (Math.random() * 10 - 2), ret.y + (Math.random() * 14 - 7) * f.spread, 'kick', 2.3, power);
    this.ball.target = 1;
    this.phase = PHASE.LIVE; this.liveT = 0; this.clockStopped = true;
    this.emit('sound', { name: 'kick' });
  }

  // ---------- play calling ----------
  startPlaycall() {
    this.phase = PHASE.PLAYCALL; this.phaseT = 0; this.scorer = null;
    this.offPick = null; this.defPick = null; this.offPlay = null; this.defPlay = null;
    this.special = this.special === 'pat2' ? 'pat2' : null;
    this.buildEntities();
    this.dropBall();
    // CPU picks with a small delay for feel
    this.aiPickT = 0.8 + Math.random() * 1.2;
    this.ctrl[this.poss] = 0; this.ctrl[1 - this.poss] = 6;
    this.emit('playcall', {});
  }
  choosePlay(team, pick) {
    if (this.phase !== PHASE.PLAYCALL) return;
    if (team === this.poss) {
      if (pick === 'punt' || pick === 'fg') { this.offPick = pick; this.special = pick; }
      else { this.offPick = pick; }
    } else this.defPick = pick;
    if (this.offPick !== null && this.defPick !== null) this.setupFormation();
  }
  setupFormation() {
    const r = this.rules;
    const off = this.offense(), def = this.defense();
    const dir = this.dir[this.poss];
    this.offPlay = typeof this.offPick === 'string' ? null : OFFENSE_PAGES[this.offPick[0]][this.offPick[1]];
    this.defPlay = DEFENSE_PAGE[this.defPick];
    this.psychic = this.offPlay && !this.special && this.offPick[1] === this.defPick && this.offPick[0] === 0 && Math.random() < 0.5;
    const form = this.special ? FORMATIONS.shotgun : FORMATIONS[this.offPlay.form];
    off.forEach((e, i) => {
      let [dx, dy] = form[i];
      if (this.special === 'punt' && i === 0) dx = -13;
      if (this.special === 'fg' && i === 0) dx = -7;
      [e.x, e.y] = this.toWorld(this.poss, dx, dy);
      e.face = dir > 0 ? 0 : Math.PI; e.vx = e.vy = 0; e.state = 'idle'; e.st = 0; e.engaged = -1; e.wp = 0; e.route = null;
      e.task = 'set';
    });
    const align = DEF_ALIGN[this.defPlay.align] || DEF_ALIGN.base;
    def.forEach((e, i) => {
      let [dx, dy] = align[i];
      // corners line up over the widest receivers on their side
      if (i === 4 || i === 5) {
        const side = i === 4 ? -1 : 1;
        let wide = null, wd = 0;
        for (const o of off) { const oy = (o.y - FIELD.mid) * dir; if (Math.sign(oy) === side && Math.abs(oy) > wd && o.role !== 'OL') { wd = Math.abs(oy); wide = o; } }
        if (wide) dy = (wide.y - FIELD.mid) * dir;
      }
      [e.x, e.y] = this.toWorld(this.poss, dx, dy);
      e.face = dir > 0 ? Math.PI : 0; e.vx = e.vy = 0; e.state = 'idle'; e.st = 0; e.engaged = -1; e.wp = 0;
      e.task = 'set';
    });
    this.ball.x = this.los; this.ball.y = FIELD.mid; this.ball.z = 0.3; this.ball.inAir = false; this.ball.loose = false;
    this.dropBall();
    this.phase = PHASE.PRESNAP; this.phaseT = 0;
    this.playType = this.special ? 'kick' : this.offPlay.type;
    this.emit('formation', {});
  }

  snap() {
    if (this.phase !== PHASE.PRESNAP) return;
    const off = this.offense(), def = this.defense();
    const dir = this.dir[this.poss];
    this.phase = PHASE.LIVE; this.liveT = 0; this.handedOff = false; this.caught = false; this.catcher = null; this.qbT = 0; this.intercepted = false;
    this.clockStopped = false; this.stats.plays++;
    this.giveBall(this.poss, 0);
    const pl = this.offPlay;
    if (this.special === 'punt' || this.special === 'fg' || this.special === 'pat') {
      off.forEach((e, i) => { e.task = i === 0 ? 'kicker' : 'block'; });
      def.forEach((e, i) => { e.task = i === 6 ? 'return' : 'rush'; });
      const ret = def[6]; [ret.x, ret.y] = this.toWorld(this.poss, this.special === 'punt' ? 40 : 30, 0);
      this.kickT = this.special === 'punt' ? 1.3 : 1.1;
      this.meter = this.human[this.poss] ? { t: 0, val: 0, dur: 1.1 } : null;
    } else {
      off.forEach((e, i) => {
        const start = [(e.x - this.los) * dir, (e.y - FIELD.mid) * dir];
        const pts = routePoints(pl.routes, i, start);
        if (i === 0) { e.task = 'qb'; return; }
        if (e.role === 'OL') { e.task = 'block'; return; }
        if (pl.type === 'run' && pl.carrier === i) {
          e.task = 'path'; e.route = pl.path.map(([dx, dy]) => this.toWorld(this.poss, dx, dy)); e.wp = 0; return;
        }
        if (pts) { e.task = 'route'; e.route = pts.map(([dx, dy]) => this.toWorld(this.poss, dx, dy)); e.wp = 0; }
        else e.task = 'block';
      });
      if (pl.type === 'run' && pl.carrier === 0) { off[0].task = 'path'; off[0].route = pl.path.map(([dx, dy]) => this.toWorld(this.poss, dx, dy)); off[0].wp = 0; this.handedOff = true; }
      // defense assignments
      const dp = this.defPlay;
      const receivers = RECEIVERS.filter(i => off[i].task === 'route' || off[i].task === 'path');
      let ri = 0;
      def.forEach((e, i) => {
        if (dp.rush.includes(i)) { e.task = 'rush'; return; }
        if (dp.cov === 'man' || this.psychic) {
          // corners take the wideouts on their side, LBs/S take what's left
          let pick = -1;
          if (i === 4 || i === 5) {
            const side = i === 4 ? -1 : 1;
            let best = 1e9;
            for (const r of receivers) { const oy = (off[r].y - FIELD.mid) * dir; if (Math.sign(oy) === side || receivers.length < 2) { const d = Math.abs(off[r].y - e.y); if (d < best) { best = d; pick = r; } } }
          }
          if (pick < 0) { const left = receivers.filter(r => !def.some(d => d.assign === r)); pick = left.length ? left[(ri++) % left.length] : receivers[0]; }
          e.task = 'man'; e.assign = pick;
        } else {
          e.task = 'zone';
          const zones = dp.cov === 'cover2' ? { 2: [7, -7], 3: [7, 7], 4: [9, -16], 5: [9, 16], 6: [18, -9] } :
            dp.cov === 'prevent' ? { 2: [10, -8], 3: [10, 8], 4: [20, -16], 5: [20, 16], 6: [28, 0] } :
              { 2: [6, -6], 3: [6, 6], 4: [12, -15], 5: [12, 15], 6: [16, 0] };
          const z = zones[i] || [8, 0];
          e.zone = this.toWorld(this.poss, z[0], z[1]);
          if (dp.cov === 'cover2' && i === 6) { e.zone = this.toWorld(this.poss, 18, 9); def[3].zone = this.toWorld(this.poss, 18, -9); def[3].task = 'zone'; }
        }
      });
      if (this.psychic) this.banner('PSYCHIC!', 'DEFENSE READ THE PLAY');
    }
    this.emit('sound', { name: 'snap' });
    for (const e of def) e.engaged = -1;
    this.ctrl[1 - this.poss] = this.human[1 - this.poss] ? this.ctrl[1 - this.poss] : 6;
  }

  // ---------- ball flight ----------
  throwBall(from, tx, ty, kind, arc = 1, speed = null) {
    // arc > 1 = slower, higher ball (same landing spot, longer hang time)
    const b = this.ball;
    this.dropBall();
    b.inAir = true; b.loose = false; b.kind = kind; b.lateral = false; b.deflected = false;
    b.x = from.x; b.y = from.y; b.z = kind === 'kick' || kind === 'punt' ? 0.2 : 1.8;
    const d = dist2(b.x, b.y, tx, ty);
    const v = speed || (kind === 'bullet' ? MOVE.ballSpeedBullet : MOVE.ballSpeedLob);
    const t = Math.max(0.35, d / v) * arc;
    const g = MOVE.gravity;
    const landZ = 1.2;
    b.vx = (tx - b.x) / t; b.vy = (ty - b.y) / t;
    b.vz = (landZ - b.z) / t + 0.5 * g * t;
    b.landX = tx; b.landY = ty; b.landT = t; b.landZ = landZ; b.flightT = 0;
    b.thrower = { team: from.team, idx: from.idx };
    from.hasBall = false;
  }

  // ---------- dead ball & downs ----------
  endPlay(reason, x, y) {
    this.meter = null;
    if (this.phase !== PHASE.LIVE) return;
    const prev = this.poss;
    this.phase = PHASE.DEAD; this.deadT = 0; this.deadReason = reason;
    this.deadSpot = [x, y]; this.whistleX = x;
    this.emit('whistle', {});
    const dir = this.dir[this.poss];
    const stop = this.rules.clockStopsOn;
    if (reason === 'incomplete' && stop.includes('incomplete')) this.clockStopped = true;
    if (reason === 'oob' && stop.includes('outOfBounds')) this.clockStopped = true;
    if ((reason === 'turnover') && stop.includes('turnover')) this.clockStopped = true;
    if (reason === 'score' || reason === 'touchback' || reason === 'safety') this.clockStopped = true;
    if (this.special === 'kickoff' || this.special === 'punt') this.clockStopped = reason !== 'tackle';
    const c = this.carrier();
    if (c && !this.special && !this.intercepted && (reason === 'tackle' || reason === 'oob' || reason === 'score')) {
      const gain = (x - this.los) * dir, b = this.ball;
      if (this.caught && this.catcher && b.thrower) {
        this.stat(this.ents[b.thrower.team][b.thrower.idx], 'passYds', gain); this.stat(this.ents[this.catcher.team][this.catcher.idx], 'recYds', gain); this.stats.team[this.poss].passYds += gain;
      } else { this.stat(c, 'rushYds', gain); this.stats.team[this.poss].rushYds += gain; }
      if (reason === 'score') this.stat(c, 'td');
    }
    if (c && reason === 'score' && !this.special) { setState(c, 'celebrate', 4.5); this.scorer = { team: c.team, idx: c.idx }; }
    else if (c) setState(c, 'tackled', 1.2);
    if (reason === 'tackle' && this.intercepted) this.say('Return ends at the ' + Math.round(this.yardline(x, this.poss)) + '.');
    else if (reason === 'tackle' && !this.special) { const gain = (x - this.los) * dir; this.say(gain >= 0 ? `Tackled. Gain of ${gain.toFixed(0)}.` : `Tackled for a loss of ${(-gain).toFixed(0)}.`); }
    else if (reason === 'tackle') this.say('Return ends at the ' + Math.round(this.yardline(x, this.poss)) + '.');
  }

  resolveDead() {
    // Called when the dead-ball window ends. Decides what comes next.
    const r = this.rules;
    const reason = this.deadReason;
    const [x] = this.deadSpot;
    const t = this.poss, dir = this.dir[t];
    if (reason === 'score') {
      if (this.special === 'pat2') { this.score[t] += r.points.patConv; this.special = null; this.banner('2 POINTS!', ''); this.afterScore(t); return; }
      if (this.special === 'fg') { this.score[t] += r.points.fg; this.banner('FIELD GOAL', 'GOOD'); this.scored(t); this.special = null; this.afterScore(t); return; }
      if (this.special === 'pat') { this.score[t] += r.points.patKick; this.special = null; this.afterScore(t); return; }
      this.score[t] += r.points.td;
      this.scored(t);
      this.phase = PHASE.PAT_CHOICE; this.phaseT = 0; this.special = 'pat';
      if (!this.human[t]) this.aiPickT = 1.5;
      return;
    }
    if (reason === 'safety') {
      const d = 1 - t;
      this.score[d] += r.points.safety; this.banner('SAFETY', '');
      this.streak[d]++; this.streak[t] = 0; this.fire[t] = false; this.checkFire(d);
      this.special = null;
      this.setupKickoff(t, 20);
      return;
    }
    if (this.special === 'fg') { this.special = null; this.say('Field goal is no good.'); this.turnover(this.los, true); return; }
    if (this.special === 'pat') { this.special = null; this.say('Extra point is no good.'); this.afterScore(t); return; }
    if (this.special === 'pat2') { this.special = null; this.say('Conversion fails.'); this.afterScore(t); return; }
    if (reason === 'touchback') { this.special = null; this.newDrive(this.poss, this.dir[this.poss] > 0 ? r.touchbackSpot : FIELD.length - r.touchbackSpot); return; }
    if (this.special === 'kickoff' || this.special === 'punt') {
      this.special = null;
      if (this.yardline(x, this.poss) <= 0) { this.say('Touchback.'); this.newDrive(this.poss, this.dir[this.poss] > 0 ? r.touchbackSpot : FIELD.length - r.touchbackSpot); return; }
      this.newDrive(this.poss, clamp(x, 1, 99)); return;
    }
    if (reason === 'turnover' || this.intercepted) { this.special = null; this.intercepted = false; this.newDrive(this.poss, clamp(x, 1, 99)); return; }
    if (this.quarterOver()) return;
    // normal down advance
    this.special = null;
    const gained = (x - this.los) * dir;
    const newLos = clamp(x, 0.5, 99.5);
    if ((this.firstDownX - newLos) * dir <= 0) {
      this.say(`First down! ${this.teams[t].abbr} gains ${gained.toFixed(0)}.`);
      this.setDown(1, newLos);
    } else {
      this.down++;
      if (this.down > r.downs) { this.say('Turnover on downs!'); this.banner('TURNOVER', 'ON DOWNS'); this.turnover(newLos); return; }
      this.los = newLos; this.toGo = Math.abs(this.firstDownX - this.los);
      this.say(`${this.ordinal(this.down)} and ${this.toGoText()}.`);
    }
    this.ball.x = this.los; this.ball.y = FIELD.mid;
    this.startPlaycall();
  }
  setDown(down, los) {
    const dir = this.dir[this.poss];
    this.down = down; this.los = los;
    const goal = this.goalLineFor(this.poss);
    let fd = los + dir * this.rules.firstDownYards;
    if ((goal - fd) * dir < 0) fd = goal;
    this.firstDownX = fd; this.toGo = Math.abs(fd - los);
  }
  toGoText() { return this.firstDownX === this.goalLineFor(this.poss) ? 'GOAL' : Math.ceil(this.toGo); }
  ordinal(n) { return ['', '1st', '2nd', '3rd', '4th'][n] || n + 'th'; }
  newDrive(team, x) {
    this.poss = team;
    this.setDown(1, x);
    if (this.quarterOver()) return;
    this.startPlaycall();
  }
  turnover(x, kick = false) {
    const nt = 1 - this.poss;
    this.poss = nt;
    this.banner(kick ? 'NO GOOD' : 'TURNOVER', '');
    this.newDrive(nt, clamp(x, 1, 99));
  }
  scored(t) {
    this.streak[t]++; this.streak[1 - t] = 0; this.fire[1 - t] = false;
    this.checkFire(t);
  }
  checkFire(t) {
    if (!this.fire[t] && this.streak[t] >= this.rules.onFireStreak) { this.fire[t] = true; this.banner(`${this.teams[t].abbr} IS ON FIRE!`, 'UNSTOPPABLE'); this.emit('sound', { name: 'fire' }); }
  }
  afterScore(t) {
    if (this.quarter > this.rules.quarters) { this.phase = PHASE.FINAL; this.emit('final', {}); return; }   // OT sudden death
    if (this.quarterOver()) return;
    this.setupKickoff(t);
  }
  choosePat(team, choice) {
    if (this.phase !== PHASE.PAT_CHOICE || team !== this.poss) return;
    this.scorer = null;
    const dir = this.dir[team];
    const spot = this.goalLineFor(team) - dir * this.rules.patSpot;
    if (choice === 'kick') { this.special = 'pat'; this.los = spot; this.setDown(1, spot); this.special = 'pat'; this.offPick = 'fg'; this.defPick = 3; this.phase = PHASE.PLAYCALL; this.setupFormation(); this.special = 'pat'; this.playType = 'kick'; }
    else { this.special = 'pat2'; this.setDown(1, spot); this.special = 'pat2'; this.startPlaycall(); }
  }
  quarterOver() {
    if (this.clock > 0) return false;
    const r = this.rules;
    if (this.quarter === r.quarters) {
      if (this.score[0] !== this.score[1]) { this.phase = PHASE.FINAL; this.emit('final', {}); this.banner('FINAL', `${this.teams[0].abbr} ${this.score[0]} - ${this.teams[1].abbr} ${this.score[1]}`); return true; }
      this.quarter++; this.clock = r.overtimeSeconds; this.banner('OVERTIME', 'FIRST SCORE WINS');
      this.setupKickoff(Math.random() < 0.5 ? 0 : 1); return true;
    }
    if (this.quarter > r.quarters) { this.phase = PHASE.FINAL; this.emit('final', {}); return true; }
    this.quarter++; this.clock = r.quarterSeconds;
    if (this.quarter === Math.ceil(r.quarters / 2) + 1) {
      this.dir = [this.dir[0] * -1, this.dir[1] * -1];
      this.banner('HALFTIME', ''); this.phase = PHASE.HALFTIME; this.phaseT = 0; return true;
    }
    // change ends each quarter, keep the drive
    this.dir = [this.dir[0] * -1, this.dir[1] * -1];
    this.los = FIELD.length - this.los; this.firstDownX = FIELD.length - this.firstDownX;
    this.banner(`END OF ${this.ordinal(this.quarter - 1).toUpperCase()}`, '');
    this.ball.x = this.los;
    this.startPlaycall();
    return true;
  }

  // ---------- main tick ----------
  tick(dt) {
    this.phaseT += dt;
    if (this.rules.alwaysFire) { this.fire[0] = true; this.fire[1] = true; }   // cheat code
    const P = this.phase;
    if (!this.clockStopped && (P === PHASE.LIVE || P === PHASE.DEAD || P === PHASE.PLAYCALL || P === PHASE.PRESNAP)) {
      this.clock = Math.max(0, this.clock - dt);
    }
    if (P === PHASE.KICKOFF) {
      const m = this.meter;
      if (m) { m.t += dt; m.val = meterWave(m.t / m.dur); if (this.inputs[this.kickoffTeam].a && m.t > 0.25) this.doKick(m.val); else if (m.t > 3 * m.dur) this.doKick(0.6 + Math.random() * 0.35); }
      else if (this.phaseT > 1.4) this.doKick();
      return;
    }
    if (P === PHASE.PLAYCALL) {
      this.aiPickT -= dt;
      for (let t = 0; t < 2; t++) {
        if (this.human[t]) continue;
        const pending = t === this.poss ? this.offPick === null : this.defPick === null;
        if (pending && this.aiPickT <= 0) {
          if (t === this.poss) {
            const yl = this.yardline(this.los, t), fgDist = 100 - yl + 17;
            if (this.down === 4 && !this.special) {
              if (fgDist < 45 && this.toGo > 3) { this.choosePlay(t, 'fg'); continue; }
              if (yl < 55 && this.toGo > 8) { this.choosePlay(t, 'punt'); continue; }
            }
            this.choosePlay(t, pickPlayAI(this, t, OFFENSE_PAGES, false));
          } else this.choosePlay(t, pickPlayAI(this, t, null, true));
        }
      }
      if (this.phaseT > this.rules.playClock + 5) { // humans stalling: auto-pick
        if (this.offPick === null) this.choosePlay(this.poss, pickPlayAI(this, this.poss, OFFENSE_PAGES, false));
        if (this.defPick === null) this.choosePlay(1 - this.poss, pickPlayAI(this, 1 - this.poss, null, true));
      }
      return;
    }
    if (P === PHASE.PRESNAP) {
      const hum = this.human[this.poss];
      if ((hum && this.inputs[this.poss].snap) || (!hum && this.phaseT > 1.6) || this.phaseT > this.rules.playClock) this.snap();
      else liveTick(this, dt, true);
      return;
    }
    if (P === PHASE.LIVE) { this.liveT += dt; liveTick(this, dt, false); return; }
    if (P === PHASE.DEAD) {
      this.deadT += dt;
      liveTick(this, dt, false);                     // late hits still resolve
      if (this.deadT > this.rules.lateHitWindow) this.resolveDead();
      return;
    }
    if (P === PHASE.PAT_CHOICE) {
      if (!this.human[this.poss]) { this.aiPickT -= dt; if (this.aiPickT <= 0) this.choosePat(this.poss, (this.score[1 - this.poss] - this.score[this.poss] === 2 && this.quarter >= 4) ? 'two' : 'kick'); }
      return;
    }
    if (P === PHASE.HALFTIME) { if (this.phaseT > 3) this.setupKickoff(1 - this.kickoffTeam); return; }
  }

  // ---------- snapshot (host -> client) ----------
  snapshot() {
    const b = this.ball;
    return {
      ph: this.phase, q: this.quarter, ck: Math.round(this.clock * 10) / 10, sc: this.score, ps: this.poss, dn: this.down, tg: this.toGo,
      los: this.los, fd: this.firstDownX, dir: this.dir, fire: this.fire, sp: this.special, ct: this.ctrl, pt: this.playType,
      b: [+b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2), b.inAir ? 1 : 0, b.loose ? 1 : 0, b.holder ? b.holder.team * 10 + b.holder.idx : -1, b.target],
      e: this.ents.map(t => t.map(e => [+e.x.toFixed(2), +e.y.toFixed(2), +e.z.toFixed(2), +e.face.toFixed(2), e.state, e.role, Math.round(e.turbo), e.task])),
      op: this.offPick, dp: this.defPick, pbp: this.pbp, ht: this.handedOff, cg: this.caught,
      ev: this.events.splice(0),
    };
  }
  applySnapshot(s) {
    this.phase = s.ph; this.quarter = s.q; this.clock = s.ck; this.score = s.sc; this.poss = s.ps; this.down = s.dn; this.toGo = s.tg;
    this.los = s.los; this.firstDownX = s.fd; this.dir = s.dir; this.fire = s.fire; this.special = s.sp; this.ctrl = s.ct; this.playType = s.pt;
    const b = this.ball; [b.x, b.y, b.z] = s.b; b.inAir = !!s.b[3]; b.loose = !!s.b[4]; b.holder = s.b[5] < 0 ? null : { team: (s.b[5] / 10) | 0, idx: s.b[5] % 10 }; b.target = s.b[6];
    this.handedOff = s.ht; this.caught = s.cg;
    for (let t = 0; t < 2; t++) {
      if (this.ents[t].length !== 7) this.ents[t] = s.e[t].map((p, i) => makeEntity(t, i, p[5], { name: '', num: 0, spd: 1, pow: 1, hands: 1 }));
      s.e[t].forEach((p, i) => { const e = this.ents[t][i]; e.tx = p[0]; e.ty = p[1]; e.tz = p[2]; e.tface = p[3]; e.state = p[4]; e.role = p[5]; e.turbo = p[6]; e.task = p[7]; e.hasBall = b.holder && b.holder.team === t && b.holder.idx === i; if (e.x === 0 && e.y === 0) { e.x = p[0]; e.y = p[1]; } });
    }
    this.offPick = s.op; this.defPick = s.dp; this.pbp = s.pbp;
    for (const ev of s.ev) this.events.push(ev);
  }
}
