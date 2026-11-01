// On-screen controls for phones/tablets: a virtual stick on the left, buttons on the right.
// Produces the same raw-input shape as Input.poll() and is merged into player slot 0.
const buzz = () => { try { if (navigator.vibrate) navigator.vibrate(8); } catch { /* not allowed */ } };

export class Touch {
  constructor(root) {
    this.enabled = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    this.state = { mx: 0, my: 0, turbo: false, held: new Set(), pressed: new Set() };
    if (!this.enabled) return;
    this.el = document.createElement('div'); this.el.className = 'touch';
    this.el.innerHTML = `
      <div class="stick"><div class="knob"></div></div>
      <div class="pad">
        <button data-k="turbo" class="turbo">TURBO</button>
        <button data-k="f1" class="b">B</button>
        <button data-k="f0" class="a">A</button>
        <button data-k="f2" class="x">X</button>
        <button data-k="f3" class="y">Y</button>
      </div>
      <div class="top"><button data-k="sw">SWITCH</button><button data-k="start">MENU</button></div>`;
    root.appendChild(this.el);
    const stick = this.el.querySelector('.stick'), knob = this.el.querySelector('.knob');
    let id = null, cx = 0, cy = 0;
    const R = 46, DEAD = 7;   // px: tiny wobbles around the centre do not move the player
    const move = t => {
      let dx = t.clientX - cx, dy = t.clientY - cy; const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      if (d < DEAD) { this.state.mx = 0; this.state.my = 0; return; }
      const k = (d - DEAD) / Math.max(1, Math.min(d, R) - DEAD) / Math.min(d, R);   // rescale so full tilt is reached at the rim
      this.state.mx = dx * k; this.state.my = dy * k;
    };
    stick.addEventListener('touchstart', e => { const t = e.changedTouches[0]; id = t.identifier; const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; move(t); e.preventDefault(); }, { passive: false });
    stick.addEventListener('touchmove', e => { for (const t of e.changedTouches) if (t.identifier === id) move(t); e.preventDefault(); }, { passive: false });
    const end = e => { for (const t of e.changedTouches) if (t.identifier === id) { id = null; knob.style.transform = ''; this.state.mx = 0; this.state.my = 0; } };
    stick.addEventListener('touchend', end); stick.addEventListener('touchcancel', end);
    for (const b of this.el.querySelectorAll('button')) {
      const k = b.dataset.k;
      b.addEventListener('touchstart', e => { this.state.held.add(k); this.state.pressed.add(k); b.classList.add('on'); buzz(); e.preventDefault(); }, { passive: false });
      const up = e => { this.state.held.delete(k); b.classList.remove('on'); e.preventDefault(); };
      b.addEventListener('touchend', up, { passive: false }); b.addEventListener('touchcancel', up, { passive: false });
    }
  }
  show(on) { if (this.el) this.el.style.display = on ? '' : 'none'; }
  // merge into a raw input record (edge pulses consumed per poll)
  apply(r) {
    if (!this.enabled) return r;
    const s = this.state;
    if (s.mx || s.my) { r.mx = s.mx; r.my = s.my; }
    r.turbo = r.turbo || s.held.has('turbo');
    for (let i = 0; i < 4; i++) { if (s.pressed.has('f' + i)) r.f[i] = true; if (s.held.has('f' + i)) r.fh[i] = true; }
    if (s.pressed.has('sw')) r.sw = true;
    if (s.pressed.has('start')) r.start = true;
    s.pressed.clear();
    r.any = r.any || r.f.some(Boolean) || r.start;
    return r;
  }
}
