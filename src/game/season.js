// Season mode: an 8-week schedule against random teams, the rest of the league simulated each week,
// then a 4-team playoff. Saved per door in localStorage; nothing leaves the browser.
export const WEEKS = 8;
const rnd = n => Math.floor(Math.random() * n);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export class Season {
  constructor(code, teams) {
    this.key = `${code}.season`; this.n = teams.length; this.s = null;
    try { this.s = JSON.parse(localStorage.getItem(this.key)); } catch { this.s = null; }
    if (this.s && !Array.isArray(this.s.games)) this.s = null;
  }
  get active() { return !!this.s; }
  save() { try { localStorage.setItem(this.key, JSON.stringify(this.s)); } catch { /* storage denied: season lives for this visit only */ } }
  clear() { this.s = null; try { localStorage.removeItem(this.key); } catch { /* ignore */ } }

  start(team) {
    const opps = shuffle([...Array(this.n).keys()].filter(i => i !== team)).slice(0, WEEKS);
    this.s = { team, week: 0, games: opps.map((opp, i) => ({ opp, home: i % 2 === 0, result: null })), w: Array(this.n).fill(0), l: Array(this.n).fill(0), playoffs: null, champion: null };
    this.save();
  }
  recordOf(id) { return { w: this.s.w[id], l: this.s.l[id] }; }
  standings() { return [...Array(this.n).keys()].map(id => ({ id, w: this.s.w[id], l: this.s.l[id] })).sort((a, b) => b.w - a.w || a.l - b.l || a.id - b.id); }

  // The next game the player is in: { ids: [home, away], human: [bool, bool], label, kind }, or null when the season is over.
  next() {
    const s = this.s; if (!s) return null;
    if (s.week < s.games.length) {
      const g = s.games[s.week]; const ids = g.home ? [s.team, g.opp] : [g.opp, s.team];
      return { ids, human: [g.home, !g.home], label: `WEEK ${s.week + 1}`, kind: 'week' };
    }
    if (!s.playoffs) this.makePlayoffs();
    const p = s.playoffs;
    const mine = m => m && m[2] == null && (m[0] === s.team || m[1] === s.team);
    for (let i = 0; i < 2; i++) if (mine(p.semis[i])) return { ids: [p.semis[i][0], p.semis[i][1]], human: [p.semis[i][0] === s.team, p.semis[i][1] === s.team], label: 'SEMIFINAL', kind: 'semi', i };
    if (mine(p.final)) return { ids: [p.final[0], p.final[1]], human: [p.final[0] === s.team, p.final[1] === s.team], label: 'CHAMPIONSHIP', kind: 'final' };
    return null;
  }
  makePlayoffs() {
    const s = this.s; const seeds = this.standings().slice(0, 4).map(r => r.id);
    s.playoffs = { seeds, semis: [[seeds[0], seeds[3], null], [seeds[1], seeds[2], null]], final: null };
    if (!seeds.includes(s.team)) this.simPlayoffs();   // eliminated: the bracket resolves without you
    this.save();
  }
  simMatch(m) { if (m[2] == null) m[2] = Math.random() < 0.5 ? m[0] : m[1]; return m[2]; }
  simPlayoffs() {
    const p = this.s.playoffs;
    for (const m of p.semis) this.simMatch(m);
    if (!p.final) p.final = [p.semis[0][2], p.semis[1][2], null];
    this.simMatch(p.final); this.s.champion = p.final[2];
  }

  // Record a finished game. ids = [home, away], score = [home, away]. A tie goes down as a loss for both sides.
  record(ids, score) {
    const s = this.s; if (!s) return;
    const nx = this.next(); if (!nx || nx.ids[0] !== ids[0] || nx.ids[1] !== ids[1]) return;
    const [h, a] = ids; const win = score[0] === score[1] ? null : score[0] > score[1] ? h : a;
    for (const id of ids) { if (id === win) s.w[id]++; else s.l[id]++; }
    const other = ids[1 - ids.indexOf(s.team)];
    if (nx.kind === 'week') {
      const g = s.games[s.week]; const me = ids.indexOf(s.team); g.result = [score[me], score[1 - me]]; s.week++;
      const rest = shuffle([...Array(this.n).keys()].filter(i => i !== h && i !== a));   // the rest of the league plays too
      for (let i = 0; i + 1 < rest.length; i += 2) { const w = Math.random() < 0.5 ? rest[i] : rest[i + 1]; s.w[w]++; s.l[w === rest[i] ? rest[i + 1] : rest[i]]++; }
    } else if (nx.kind === 'semi') {
      const p = s.playoffs; p.semis[nx.i][2] = win ?? other;
      for (const m of p.semis) this.simMatch(m);
      p.final = [p.semis[0][2], p.semis[1][2], null];
      if (!p.final.includes(s.team)) this.simPlayoffs();
    } else if (nx.kind === 'final') {
      s.playoffs.final[2] = win ?? other; s.champion = s.playoffs.final[2];
    }
    this.save();
  }
}
