// On-screen controls for phones: left half is a move stick, right half drags to look, buttons on the right.
// main.js reads `touch.move` (x,y in -1..1), drains `touch.look` (dx,dy pixels) and checks `touch.held`.
export const touch = { active: false, move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set(), taps: [] };

export function initTouch(force = false) {
  const coarse = force || (navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches);
  if (!coarse) return false;
  touch.active = true;
  const root = document.createElement('div'); root.id = 'touch';
  root.innerHTML = `
    <div class="tz left"><div class="stick"><div class="knob"></div></div></div>
    <div class="tz right"></div>
    <div class="tb" data-k="fire">FIRE</div>
    <div class="tb" data-k="jump">JUMP</div>
    <div class="tb" data-k="next">GUN</div>
    <div class="tb" data-k="reload">RLD</div>
    <div class="tb" data-k="crouch">CRCH</div>
    <div class="tb" data-k="board">TAB</div>`;
  document.body.appendChild(root);
  const left = root.querySelector('.left'), right = root.querySelector('.right'), knob = root.querySelector('.knob');
  let stickId = null, stickOrigin = null, lookId = null, lookLast = null;
  const R = 44;
  left.addEventListener('pointerdown', e => { stickId = e.pointerId; stickOrigin = { x: e.clientX, y: e.clientY }; left.setPointerCapture(e.pointerId); e.preventDefault(); });
  left.addEventListener('pointermove', e => {
    if (e.pointerId !== stickId) return;
    let dx = e.clientX - stickOrigin.x, dy = e.clientY - stickOrigin.y;
    const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; }
    touch.move.x = dx / R; touch.move.y = -dy / R;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  });
  const endStick = e => { if (e.pointerId !== stickId) return; stickId = null; touch.move.x = touch.move.y = 0; knob.style.transform = ''; };
  left.addEventListener('pointerup', endStick); left.addEventListener('pointercancel', endStick);
  right.addEventListener('pointerdown', e => { lookId = e.pointerId; lookLast = { x: e.clientX, y: e.clientY }; right.setPointerCapture(e.pointerId); e.preventDefault(); });
  right.addEventListener('pointermove', e => { if (e.pointerId !== lookId) return; touch.look.dx += e.clientX - lookLast.x; touch.look.dy += e.clientY - lookLast.y; lookLast = { x: e.clientX, y: e.clientY }; });
  const endLook = e => { if (e.pointerId === lookId) lookId = null; };
  right.addEventListener('pointerup', endLook); right.addEventListener('pointercancel', endLook);
  for (const b of root.querySelectorAll('.tb')) {
    const k = b.dataset.k;
    b.addEventListener('pointerdown', e => { touch.held.add(k); touch.taps.push(k); b.classList.add('on'); e.preventDefault(); });
    const up = () => { touch.held.delete(k); b.classList.remove('on'); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
  }
  return true;
}
