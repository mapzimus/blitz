// Headless CPU-vs-CPU run of the rules engine. Usage: node tools/simtest.mjs [seconds] [seed]
import { Game } from '../src/game/sim.js';
import { TICK, PHASE } from '../src/game/constants.js';
const secs = +process.argv[2] || 200;
const g = new Game({ teams: [5, 9], human: [false, false] });
let t = 0, lastPhase = '', lastPbp = '';
const clock = () => `${g.quarter}Q ${Math.floor(g.clock / 60)}:${String(Math.floor(g.clock % 60)).padStart(2, '0')}`;
for (let i = 0; i < secs / TICK; i++) {
  g.tick(TICK); t += TICK;
  for (const ev of g.events.splice(0)) {
    if (ev.type === 'banner') console.log(`${t.toFixed(1)}s [${clock()}] *** ${ev.text} ${ev.sub || ''}`);
  }
  if (g.pbp !== lastPbp) { lastPbp = g.pbp; console.log(`${t.toFixed(1)}s [${clock()}] ${g.teams[g.poss].abbr} ${g.ordinal(g.down)}&${g.toGoText()} @x=${g.los.toFixed(0)} | ${g.pbp}`); }
  if (g.phase !== lastPhase) { lastPhase = g.phase; if (g.phase === PHASE.PRESNAP) console.log(`   ${g.special ? g.special.toUpperCase() : (g.offPlay && g.offPlay.name)} vs ${g.defPlay && g.defPlay.name}${g.psychic ? ' (PSYCHIC)' : ''}`); if (process.env.V) console.log(`   phase -> ${g.phase}`); }
  if (g.phase === PHASE.FINAL) { console.log('FINAL', g.score); break; }
}
console.log('end', { phase: g.phase, score: g.score, poss: g.poss, los: g.los.toFixed(1), down: g.down, plays: g.stats.plays, hits: g.stats.hits, fire: g.fire, streak: g.streak });
