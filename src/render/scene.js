// Three.js presentation of the sim. World axes: X = field length (yards), Z = field width, Y = up.
import * as THREE from 'three';
import { FIELD, PHASE } from '../game/constants.js';
import { buildField, buildStadium, buildExtras, buildBall, PlayerKit, TEAM_CODE } from './models.js';

const YD = 1;                              // 1 world unit = 1 yard
const lerp = (a, b, t) => a + (b - a) * t;

export class Scene {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070910);
    this.scene.fog = new THREE.Fog(0x070910, 90, 260);
    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.5, 400);
    this.camPos = new THREE.Vector3(30, 14, 26.67); this.camLook = new THREE.Vector3(50, 1, 26.67);
    this.camera.position.copy(this.camPos); this.camera.lookAt(this.camLook);
    this.players = [[], []];
    this.teams = null;
    this.t = 0;
    this.kit = null; this.rigs = [[], []]; this.assetsOn = false; this.assetRoot = null;
    this.lights();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  lights() {
    this.scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x203018, 0.75));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    sun.position.set(50, 80, -40); sun.target.position.set(50, 0, 26); this.scene.add(sun.target);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    const c = sun.shadow.camera; c.left = -70; c.right = 70; c.top = 40; c.bottom = -40; c.near = 10; c.far = 200;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x8fb0ff, 0.5); fill.position.set(50, 40, 90); this.scene.add(fill);
  }

  // ---------- static world ----------
  build(teams) {
    this.teams = teams;
    if (this.world) this.scene.remove(this.world);
    const W = this.world = new THREE.Group(); this.scene.add(W);
    // field
    const tex = new THREE.CanvasTexture(fieldCanvas(teams));
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const field = new THREE.Mesh(new THREE.PlaneGeometry(120, FIELD.width), new THREE.MeshLambertMaterial({ map: tex }));
    field.rotation.x = -Math.PI / 2; field.position.set(50, 0, FIELD.mid); field.receiveShadow = true; field.userData.drawn = true; W.add(field);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0x1d3a1c }));
    apron.rotation.x = -Math.PI / 2; apron.position.set(50, -0.02, FIELD.mid); apron.receiveShadow = true; W.add(apron);
    // stands
    const crowd = new THREE.CanvasTexture(crowdCanvas()); crowd.wrapS = crowd.wrapT = THREE.RepeatWrapping; crowd.repeat.set(16, 3);
    const standMat = new THREE.MeshLambertMaterial({ map: crowd });
    const mk = (w, d, x, z, rot) => { const g = new THREE.Mesh(new THREE.BoxGeometry(w, 18, d), standMat); g.position.set(x, 9, z); g.rotation.y = rot; g.rotation.x = rot === 0 ? 0 : 0; W.add(g); };
    mk(160, 30, 50, -24, 0); mk(160, 30, 50, FIELD.width + 24, 0); mk(90, 30, -34, FIELD.mid, Math.PI / 2); mk(90, 30, 134, FIELD.mid, Math.PI / 2);
    for (const m of W.children.slice(-4)) { m.rotation.x = 0; m.userData.drawn = true; }
    // tilt stands by shearing look: just lower front faces via a second wedge
    // goal posts
    const yellow = new THREE.MeshStandardMaterial({ color: 0xffd400, metalness: 0.3, roughness: 0.5 });
    for (const x of [-10, 110]) {
      const g = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.3, 10), yellow); post.position.set(0, 1.65, 0); g.add(post);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 6.2, 10), yellow); bar.rotation.x = Math.PI / 2; bar.position.set(0, 3.3, 0); g.add(bar);
      for (const s of [-3.1, 3.1]) { const up = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 10, 8), yellow); up.position.set(0, 8.3, s); g.add(up); }
      g.position.set(x, 0, FIELD.mid); g.traverse(o => { o.castShadow = true; }); g.userData.drawn = true; W.add(g);
    }
    // markers
    this.los = new THREE.Mesh(new THREE.PlaneGeometry(0.18, FIELD.width), new THREE.MeshBasicMaterial({ color: 0x2b6cff, transparent: true, opacity: 0.85 }));
    this.los.rotation.x = -Math.PI / 2; this.los.position.y = 0.02; W.add(this.los);
    this.fdl = new THREE.Mesh(new THREE.PlaneGeometry(0.18, FIELD.width), new THREE.MeshBasicMaterial({ color: 0xffe600, transparent: true, opacity: 0.9 }));
    this.fdl.rotation.x = -Math.PI / 2; this.fdl.position.y = 0.02; W.add(this.fdl);
    // ball
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), new THREE.MeshStandardMaterial({ color: 0x6b3a1e, roughness: 0.7 }));
    this.ball.scale.set(1.7, 1, 1); this.ball.castShadow = true; W.add(this.ball);
    this.ballShadow = blob(0.5); W.add(this.ballShadow);
    // control rings
    this.rings = [0, 1].map(t => { const r = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 24), new THREE.MeshBasicMaterial({ color: t === 0 ? 0xffb03b : 0x4ea1ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide })); r.rotation.x = -Math.PI / 2; r.position.y = 0.03; W.add(r); return r; });
    // players
    this.players = [0, 1].map(t => Array.from({ length: 7 }, () => { const p = makePlayer(teams[t]); W.add(p.group); return p; }));
  }

  // Replace the drawn field/stadium/capsules with the disc's models. Safe to call before or after build().
  async useAssets(assets) {
    if (!assets.ready) return;
    try {
      if (!this.kit) this.kit = await new PlayerKit(assets).load();
      if (this.assetRoot) this.scene.remove(this.assetRoot);
      const root = this.assetRoot = new THREE.Group(); this.scene.add(root);
      const home = TEAM_CODE[this.teams[0].abbr] || 'md', away = TEAM_CODE[this.teams[1].abbr] || 'md';
      root.add(await buildField(assets));
      root.add(await buildStadium(assets, home));
      root.add(await buildExtras(assets, home, away, 1 + ((Math.random() * 5) | 0)));
      try { const ball = await buildBall(assets); this.ball.visible = false; this.realBall = ball; root.add(ball); } catch (e) { console.warn('ball', e); }
      this.scene.background = null; this.scene.fog = null;
      // real players
      this.rigs = [[], []];
      for (let t = 0; t < 2; t++) {
        const code = TEAM_CODE[this.teams[t].abbr] || 'md';
        for (let i = 0; i < 7; i++) {
          const rig = await this.kit.build(code, t === 0, ['joh', 'bub', 'gum', 'cwo', 'wil', 'tar', 'jul', 'vic', 'cha', 'rhe', 'mik'][(t * 7 + i) % 11]);
          rig.play('ready_01'); root.add(rig.root); this.rigs[t].push(rig);
        }
        for (const p of this.players[t]) p.group.visible = false;
      }
      if (this.world) { for (const o of this.world.children) if (o.userData.drawn) o.visible = false; }
      this.scene.children.filter(o => o.isHemisphereLight).forEach(l => { l.intensity = 1.0; });   // let the sun do the shaping; grass now takes shadows
      this.assetsOn = true;
    } catch (e) { console.error('useAssets failed', e); }
  }

  project(x, y, z) {
    const v = new THREE.Vector3(x, z, y).project(this.camera);
    return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight, v.z < 1];
  }

  // ---------- per frame ----------
  update(g, dt) {
    this.t += dt;
    if (!this.world) return;
    const dir = g.dir[g.poss];
    for (let t = 0; t < 2; t++) {
      const ents = g.ents[t];
      for (let i = 0; i < 7; i++) {
        const e = ents[i], p = this.players[t][i];
        if (!e) { p.group.visible = false; continue; }
        if (this.assetsOn && this.rigs[t][i]) { p.group.visible = false; poseRig(this.rigs[t][i], e, dt, g.fire[t]); continue; }
        p.group.visible = true;
        poseEntity(p, e, this.t, g.fire[t]);
      }
      const c = g.ents[t][g.ctrl[t]];
      this.rings[t].visible = !!c && g.human[t] && g.phase !== PHASE.PLAYCALL;
      if (c) this.rings[t].position.set(c.x, 0.03, c.y);
    }
    const b = g.ball;
    const holder = g.carrier();
    this.ball.visible = !(holder && false);
    this.ball.position.set(b.x, Math.max(0.17, b.z + (holder ? 0.95 : 0.17)), b.y);
    if (b.inAir) { this.ball.rotation.z += dt * 18; this.ball.rotation.y = Math.atan2(-b.vy, b.vx); } else { this.ball.rotation.z = 0; this.ball.rotation.y = holder ? -holder.face : 0; }
    if (holder) { this.ball.position.x += Math.cos(holder.face) * 0.35; this.ball.position.z += Math.sin(holder.face) * 0.35; this.ball.position.y = 0.9 + holder.z; if (holder.state === 'down' || holder.state === 'tackled') this.ball.position.y = 0.35; }
    this.ballShadow.position.set(b.x, 0.015, b.y); this.ballShadow.visible = b.inAir || b.loose;
    if (this.realBall) {
      const rb = this.realBall; rb.position.copy(this.ball.position); rb.rotation.copy(this.ball.rotation);
      if (holder && this.assetsOn) {
        // carry it in the right hand (HAnim id 12) when the rig exists
        const rig = this.rigs[holder.team] && this.rigs[holder.team][holder.idx];
        const hand = rig && rig.bones[rig.kit.frameOfId[12]];
        if (hand) { hand.getWorldPosition(rb.position); rb.position.y += 0.05; rb.rotation.set(0, -holder.face, 0.3); }
      }
    }
    const showMarks = !g.special && (g.phase === PHASE.PLAYCALL || g.phase === PHASE.PRESNAP || g.phase === PHASE.LIVE || g.phase === PHASE.DEAD);
    this.los.visible = showMarks; this.fdl.visible = showMarks && g.firstDownX !== g.goalLineFor(g.poss);
    this.los.position.x = g.los; this.los.position.z = FIELD.mid; this.fdl.position.x = g.firstDownX; this.fdl.position.z = FIELD.mid;
    this.updateCamera(g, dt);
    this.renderer.render(this.scene, this.camera);
  }

  updateCamera(g, dt) {
    const dir = g.dir[g.poss];
    const b = g.ball;
    let fx, fy, px, py, ph, lh = 1.2;
    const k = 1 - Math.exp(-dt * 4.5);
    if (g.phase === PHASE.PLAYCALL || g.phase === PHASE.PAT_CHOICE || g.phase === PHASE.HALFTIME || g.phase === PHASE.FINAL) {
      fx = g.los + dir * 10; fy = FIELD.mid; px = g.los - dir * 26; py = FIELD.mid; ph = 22;
    } else if (g.phase === PHASE.KICKOFF) {
      fx = g.los + dir * 20; fy = FIELD.mid; px = g.los - dir * 24; py = FIELD.mid; ph = 16;
    } else {
      const c = g.carrier();
      const tx = c ? c.x : b.x, ty = c ? c.y : b.y;
      const ahead = b.inAir ? 10 : 7;
      fx = tx + dir * ahead; fy = lerp(ty, FIELD.mid, 0.35);
      px = tx - dir * 19; py = lerp(ty, FIELD.mid, 0.55); ph = 12.5;
      if (g.phase === PHASE.DEAD) { px = tx - dir * 14; ph = 9; lh = 0.8; }
    }
    this.camPos.x = lerp(this.camPos.x, px, k); this.camPos.y = lerp(this.camPos.y, ph, k); this.camPos.z = lerp(this.camPos.z, py, k);
    this.camLook.x = lerp(this.camLook.x, fx, k); this.camLook.y = lerp(this.camLook.y, lh, k); this.camLook.z = lerp(this.camLook.z, fy, k);
    this.camera.position.copy(this.camPos); this.camera.lookAt(this.camLook);
  }
}

// ---------- disc-model players ----------
function poseRig(rig, e, dt, fire) {
  const g = rig.root;
  g.position.set(e.x, e.z, e.y);
  g.rotation.y = -e.face - Math.PI / 2;
  const sp = Math.hypot(e.vx, e.vy);
  let clip = 'stand_b_01', loop = true, speed = 1;
  switch (e.state) {
    case 'dive': clip = e.hasBall ? 'dive_2h_01' : 'ddiv_02_m'; loop = false; speed = 1.4; break;
    case 'down': clip = 'fall_f_02'; loop = false; speed = 1.6; break;
    case 'tackled': clip = 'fall_b_03'; loop = false; speed = 1.4; break;
    case 'jump': clip = 'hurdle_01'; loop = false; speed = 1.3; break;
    case 'spin': clip = 'c_spin_02'; loop = false; speed = 1.5; break;
    case 'stiff': clip = 'bc_stiffarm'; loop = false; speed = 1.5; break;
    case 'celebrate': clip = 'ts_celeb_01'; break;
    case 'throw': clip = 'qb_pass_m_01'; loop = false; speed = 1.6; break;
    case 'catch': clip = e.z > 0.3 ? 'catch_jump_01' : 'wave_catch_01'; loop = false; speed = 1.8; break;
    case 'hit': clip = 'hit_fd_03'; loop = false; speed = 1.3; break;
    default:
      if (e.task === 'set' || e.task === 'kicker') clip = e.role === 'QB' ? 'lu_qb_01_i' : (e.role === 'OL' ? 'lu_cen_01_i' : (e.role === 'WR' ? 'lu_wr_01_i' : (['DL', 'LB', 'CB', 'S'].includes(e.role) ? 'def_ready_01' : 'ready_01')));
      else if (sp > 1.5) { clip = e.hasBall ? 'rz_run_01' : (sp > 7 ? 'run_01' : 'jog_01'); speed = 0.55 + sp / 9; }
      else clip = e.task === 'block' && e.engaged >= 0 ? 'hold_01_c' : 'stand_b_01';
  }
  if (!rig.play(clip, { loop, speed })) rig.play('stand_b_01');
  rig.update(dt);
}

// ---------- players ----------
function makePlayer(team) {
  const primary = new THREE.Color(team.primary), secondary = new THREE.Color(team.secondary);
  const jersey = new THREE.MeshStandardMaterial({ color: primary, roughness: 0.85 });
  const pants = new THREE.MeshStandardMaterial({ color: secondary, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x9c6b4a, roughness: 0.9 });
  const helmet = new THREE.MeshStandardMaterial({ color: primary, roughness: 0.3, metalness: 0.25 });
  const group = new THREE.Group();
  const body = new THREE.Group(); group.add(body);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.46, 0.55, 6, 12), jersey); torso.position.y = 1.25; torso.castShadow = true; body.add(torso);
  const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.2, 5, 10), pants); hips.position.y = 0.78; body.add(hips);
  const legs = [-0.2, 0.2].map(z => { const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.5, 4, 8), pants); l.position.set(0, 0.42, z); l.castShadow = true; body.add(l); return l; });
  const arms = [-0.6, 0.6].map(z => { const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.5, 4, 8), jersey); a.position.set(0, 1.25, z); body.add(a); return a; });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.33, 14, 12), helmet); head.position.y = 2.0; head.castShadow = true; body.add(head);
  const mask = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 6, 12, Math.PI), new THREE.MeshStandardMaterial({ color: 0xdddddd })); mask.position.set(0.22, 1.9, 0); mask.rotation.y = Math.PI / 2; mask.rotation.z = Math.PI; body.add(mask);
  const shadow = blob(0.7); group.add(shadow);
  group.scale.setScalar(0.92);
  return { group, body, torso, legs, arms, head, jersey, helmet, shadow, bob: Math.random() * 6 };
}

function poseEntity(p, e, t, fire) {
  const g = p.group, b = p.body;
  g.position.set(e.x, 0, e.y);
  g.rotation.y = -e.face;
  const sp = Math.hypot(e.vx, e.vy);
  const run = Math.min(1, sp / 8);
  const cyc = t * (6 + run * 9) + p.bob;
  b.position.y = e.z + (e.state === 'run' || e.state === 'idle' ? Math.abs(Math.sin(cyc)) * 0.08 * run : 0);
  b.rotation.set(0, 0, 0);
  b.rotation.z = -run * 0.22;                                 // lean into the run
  p.legs[0].rotation.z = Math.sin(cyc) * 0.9 * run; p.legs[1].rotation.z = -Math.sin(cyc) * 0.9 * run;
  p.arms[0].rotation.z = -Math.sin(cyc) * 0.8 * run; p.arms[1].rotation.z = Math.sin(cyc) * 0.8 * run;
  switch (e.state) {
    case 'dive': b.rotation.z = -1.35; b.position.y = 0.5 + e.z; break;
    case 'down': case 'tackled': b.rotation.z = -1.55; b.position.y = 0.25; break;
    case 'jump': b.position.y = e.z; p.legs[0].rotation.z = 0.8; p.legs[1].rotation.z = 0.8; break;
    case 'spin': b.rotation.y = (1 - e.st / 0.5) * Math.PI * 2; break;
    case 'stiff': p.arms[1].rotation.z = -1.4; break;
    case 'celebrate': b.position.y = Math.abs(Math.sin(t * 9)) * 0.5; p.arms[0].rotation.z = 2.8; p.arms[1].rotation.z = -2.8; break;
  }
  if (e.state === 'down' || e.state === 'tackled') { g.position.x += Math.cos(e.face) * 0.6; g.position.z += Math.sin(e.face) * 0.6; }
  const glow = fire ? 0.35 + 0.25 * Math.sin(t * 14 + p.bob) : 0;
  p.jersey.emissive.setRGB(glow, glow * 0.35, 0); p.helmet.emissive.setRGB(glow, glow * 0.3, 0);
  p.shadow.position.y = 0.012 - e.z * 0;
  p.shadow.scale.setScalar(1 - Math.min(0.5, e.z * 0.3));
}

function blob(r) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.012; return m;
}

// ---------- canvases ----------
function fieldCanvas(teams) {
  const S = 24; // px per yard
  const c = document.createElement('canvas'); c.width = 120 * S; c.height = Math.round(FIELD.width * S);
  const x = c.getContext('2d');
  const X = yd => (yd + 10) * S;
  for (let i = 0; i < 20; i++) { x.fillStyle = i % 2 ? '#2f7a2e' : '#2a6e29'; x.fillRect(X(i * 5), 0, 5 * S, c.height); }
  // end zones
  for (const [t, x0] of [[teams[0], -10], [teams[1], 100]]) {
    x.fillStyle = t.primary; x.fillRect(X(x0), 0, 10 * S, c.height);
    x.save(); x.translate(X(x0 + 5), c.height / 2); x.rotate(x0 < 0 ? -Math.PI / 2 : Math.PI / 2);
    x.fillStyle = t.secondary; x.font = `bold ${S * 6.5}px Impact, Arial Narrow, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.strokeStyle = '#000'; x.lineWidth = 6; x.strokeText(t.name.toUpperCase(), 0, 0); x.fillText(t.name.toUpperCase(), 0, 0); x.restore();
  }
  // lines
  x.strokeStyle = '#ffffff'; x.lineWidth = Math.max(2, S * 0.12);
  for (let yd = 0; yd <= 100; yd += 5) { x.beginPath(); x.moveTo(X(yd), 0); x.lineTo(X(yd), c.height); x.stroke(); }
  x.lineWidth = Math.max(3, S * 0.25); for (const yd of [0, 100]) { x.beginPath(); x.moveTo(X(yd), 0); x.lineTo(X(yd), c.height); x.stroke(); }
  x.strokeRect(1, 1, c.width - 2, c.height - 2);
  // hashes
  x.lineWidth = Math.max(2, S * 0.1);
  for (let yd = 1; yd < 100; yd++) { if (yd % 5 === 0) continue; for (const hy of [FIELD.hashL, FIELD.hashR, 0.6, FIELD.width - 0.6]) { x.beginPath(); x.moveTo(X(yd), hy * S - S * 0.35); x.lineTo(X(yd), hy * S + S * 0.35); x.stroke(); } }
  // numbers
  x.fillStyle = '#ffffff'; x.font = `bold ${S * 5.5}px Impact, Arial Narrow, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let yd = 10; yd <= 90; yd += 10) {
    const n = yd <= 50 ? yd : 100 - yd;
    for (const [hy, rot] of [[12, Math.PI / 2], [FIELD.width - 12, -Math.PI / 2]]) {
      x.save(); x.translate(X(yd), hy * S); x.rotate(rot); x.fillText(String(n).padStart(2, '0'), 0, 0); x.restore();
    }
  }
  // midfield logo placeholder (team 0 initials)
  x.save(); x.translate(X(50), c.height / 2); x.fillStyle = 'rgba(255,255,255,0.12)'; x.beginPath(); x.arc(0, 0, S * 7, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#fff'; x.font = `bold ${S * 7}px Impact`; x.rotate(Math.PI / 2); x.fillText(teams[0].abbr, 0, 0); x.restore();
  return c;
}

function crowdCanvas() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const x = c.getContext('2d');
  x.fillStyle = '#1a1c24'; x.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 2600; i++) { x.fillStyle = `hsl(${Math.random() * 360},${30 + Math.random() * 40}%,${25 + Math.random() * 45}%)`; x.fillRect(Math.random() * 256, Math.random() * 128, 3, 4); }
  return c;
}
