// Arcade League: preset matches with medal targets. Progress lives in this browser only.
// Each match: arena pack, mode, bots, skill, limit, time (s), and the medal rule.
export const LEAGUE = [
  { id: 'amateur', name: 'Amateur League', matches: [
    { id: 'a1', name: 'Siberian Standoff', level: 'l_10_ar.pak', mode: 'dm', bots: 2, skill: 0.6, limit: 5, time: 180, medal: { kind: 'time', gold: 60, silver: 100, bronze: 180 } },
    { id: 'a2', name: 'Chinese Takeaway', level: 'l_21_ar.pak', mode: 'dm', bots: 3, skill: 0.6, limit: 10, time: 240, medal: { kind: 'time', gold: 90, silver: 150, bronze: 240 } },
    { id: 'a3', name: 'Bag of Tricks', level: 'l_35_ar.pak', mode: 'bag', bots: 3, skill: 0.8, limit: 10, time: 240, medal: { kind: 'win', gold: 1, silver: 1, bronze: 1 } },
    { id: 'a4', name: 'Last Clown Standing', level: 'l_47_ar.pak', mode: 'elim', bots: 4, skill: 0.8, limit: 9, time: 300, medal: { kind: 'win', gold: 1, silver: 1, bronze: 1 } },
  ] },
  { id: 'honorary', name: 'Honorary League', matches: [
    { id: 'h1', name: 'Scrapyard Dogs', level: 'l_46_ar.pak', mode: 'dm', bots: 4, skill: 1, limit: 10, time: 240, medal: { kind: 'time', gold: 80, silver: 130, bronze: 240 } },
    { id: 'h2', name: 'Hospital Pass', level: 'l_45_ar.pak', mode: 'dm', bots: 5, skill: 1, limit: 15, time: 300, medal: { kind: 'time', gold: 120, silver: 200, bronze: 300 } },
    { id: 'h3', name: 'Mission Impossible', level: 'l_42_ar.pak', mode: 'bag', bots: 4, skill: 1, limit: 10, time: 300, medal: { kind: 'win', gold: 1, silver: 1, bronze: 1 } },
    { id: 'h4', name: 'Space Race', level: 'l_36_ar.pak', mode: 'elim', bots: 6, skill: 1, limit: 6, time: 300, medal: { kind: 'win', gold: 1, silver: 1, bronze: 1 } },
  ] },
  { id: 'elite', name: 'Elite League', matches: [
    { id: 'e1', name: 'Ufopia Unleashed', level: 'l_50_ar.pak', mode: 'dm', bots: 6, skill: 1.4, limit: 15, time: 300, medal: { kind: 'time', gold: 120, silver: 200, bronze: 300 } },
    { id: 'e2', name: 'Robot Riot', level: 'l_64_ar.pak', mode: 'dm', bots: 8, skill: 1.4, limit: 20, time: 360, medal: { kind: 'time', gold: 160, silver: 260, bronze: 360 } },
    { id: 'e3', name: 'Cathedral Tag', level: 'l_34_ar.pak', mode: 'bag', bots: 6, skill: 1.4, limit: 15, time: 300, medal: { kind: 'win', gold: 1, silver: 1, bronze: 1 } },
    { id: 'e4', name: 'Atom Smasher Showdown', level: 'l_33_ar.pak', mode: 'elim', bots: 8, skill: 1.4, limit: 6, time: 360, medal: { kind: 'win', gold: 1, silver: 1, bronze: 1 } },
  ] },
];
const KEY = 'sundial.league';
export function loadProgress() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
export function saveProgress(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* private window */ } }
// Medal for a finished match: won, and how long it took (seconds).
export function medalFor(m, won, seconds) {
  if (!won) return null;
  const r = m.medal;
  if (r.kind === 'win') return 'gold';
  if (seconds <= r.gold) return 'gold';
  if (seconds <= r.silver) return 'silver';
  if (seconds <= r.bronze) return 'bronze';
  return null;
}
const RANK = { gold: 3, silver: 2, bronze: 1 };
export function record(progress, matchId, medal) {
  if (!medal) return progress;
  if (!progress[matchId] || RANK[medal] > RANK[progress[matchId]]) progress[matchId] = medal;
  saveProgress(progress);
  return progress;
}
export function unlocked(progress, leagueIdx) {
  if (leagueIdx === 0) return true;
  const prev = LEAGUE[leagueIdx - 1];
  return prev.matches.every(m => progress[m.id]);
}
export function findMatch(id) { for (const l of LEAGUE) for (const m of l.matches) if (m.id === id) return m; return null; }
