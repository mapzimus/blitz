// Keyboard + gamepad -> per-player raw input. Edge-triggered buttons are pulses (true for one poll).
// Keyboard P1: arrows/WASD move, Shift or L turbo, Space/J = A, K/X = B, 1-4 pass, Q switch.
// Gamepad: left stick/d-pad move, RT/R1 turbo, A/B/X/Y = face buttons, LB switch, Start pause.
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    window.addEventListener('keydown', e => { if (!this.keys.has(e.code)) this.pressed.add(e.code); this.keys.add(e.code); if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.padPrev = [[], []];
    this.padMap = [null, null];       // which gamepad index drives player slot 0/1
    this.touch = null;                // set by main.js on touch devices
  }

  // Raw state for player slot (0 or 1). Keyboard always feeds slot 0; gamepads attach to free slots.
  poll(slot, { pad = true, keyboard = true } = {}) {
    const r = { mx: 0, my: 0, turbo: false, f: [false, false, false, false], fh: [false, false, false, false], d: [false, false, false, false], sw: false, start: false, any: false };
    const k = this.keys, p = this.pressed;
    if (slot === 0 && keyboard) {
      if (k.has('ArrowLeft') || k.has('KeyA')) r.mx -= 1;
      if (k.has('ArrowRight') || k.has('KeyD')) r.mx += 1;
      if (k.has('ArrowUp') || k.has('KeyW')) r.my -= 1;
      if (k.has('ArrowDown') || k.has('KeyS')) r.my += 1;
      r.turbo = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyL');
      r.f[0] = p.has('Space') || p.has('KeyJ'); r.fh[0] = k.has('Space') || k.has('KeyJ');
      r.f[1] = p.has('KeyK') || p.has('KeyX'); r.fh[1] = k.has('KeyK') || k.has('KeyX');
      r.f[2] = p.has('KeyI'); r.f[3] = p.has('KeyO');
      r.d[0] = p.has('Digit1'); r.d[1] = p.has('Digit2'); r.d[2] = p.has('Digit3'); r.d[3] = p.has('Digit4');
      r.sw = p.has('KeyQ') || p.has('Tab');
      r.start = p.has('Enter') || p.has('Escape');
    }
    // gamepads
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const live = [...pads].filter(g => g && g.connected);
    const padDev = pad ? live[slot] : null;
    if (padDev) {
      const pad = padDev;
      const dz = v => (Math.abs(v) < 0.2 ? 0 : v);
      let mx = dz(pad.axes[0] || 0), my = dz(pad.axes[1] || 0);
      const b = i => !!(pad.buttons[i] && pad.buttons[i].pressed);
      if (b(14)) mx = -1; if (b(15)) mx = 1; if (b(12)) my = -1; if (b(13)) my = 1;
      if (mx || my) { r.mx = mx; r.my = my; }
      const prev = this.padPrev[slot];
      const edge = i => b(i) && !prev[i];
      r.turbo = r.turbo || b(7) || b(5);
      for (let i = 0; i < 4; i++) { r.f[i] = r.f[i] || edge(i); r.fh[i] = r.fh[i] || b(i); }
      r.sw = r.sw || edge(4);
      r.start = r.start || edge(9);
      this.padPrev[slot] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => b(i));
    }
    if (slot === 0 && keyboard && this.touch) this.touch.apply(r);
    const m = Math.hypot(r.mx, r.my); if (m > 1) { r.mx /= m; r.my /= m; }
    r.any = r.f.some(Boolean) || r.d.some(Boolean) || r.start;
    return r;
  }
  hasPad(slot) { const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(g => g && g.connected) : []; return !!pads[slot]; }
  endFrame() { this.pressed.clear(); }
}
