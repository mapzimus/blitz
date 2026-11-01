// Boot. Reads window.GAME (set by each games/<code>/index.html) and shows the title screen.
// The live simulation (sim.js + live.js) is not wired in yet, so this is the front door only.
import { RULES } from './game/constants.js';

const cfg = window.GAME || { code: 'KODIAK', variant: 'classic', hub: '../../hub.html' };

// Rule-set switch. 'classic' is the faithful set in constants.js; 'house' overlays the tweaks.
export const VARIANTS = {
  classic: RULES,
  house: { ...RULES, name: 'HOUSE RULES', firstDownYards: 25, onFireStreak: 2, playClock: 12 },
};
const rules = VARIANTS[cfg.variant] || RULES;

const overlay = document.getElementById('overlay');
overlay.innerHTML = `
  <div class="screen">
    <h1>${cfg.code.slice(0, 1)}<span>${cfg.code.slice(1)}</span></h1>
    <h2>UNDER CONSTRUCTION</h2>
    <div class="menu">
      <button disabled>1 PLAYER</button>
      <button disabled>2 PLAYER</button>
      <button id="back">BACK OUT</button>
    </div>
    <p class="small">Rule set loaded: <code>${rules.name}</code> &middot; ${rules.playersPerSide} a side &middot; ${rules.firstDownYards} yds to go</p>
  </div>`;
document.getElementById('back').onclick = () => { location.href = cfg.hub; };
