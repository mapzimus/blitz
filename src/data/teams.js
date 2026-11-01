// 31 NFL clubs of the 2001 season (the Blitz 2002 roster of teams). Colors approximate.
// Player names are generated, not real people.
export const TEAMS = [
  ['ARI','Arizona','Cardinals','#97233f','#ffffff'],['ATL','Atlanta','Falcons','#000000','#a71930'],
  ['BAL','Baltimore','Ravens','#241773','#9e7c0c'],['BUF','Buffalo','Bills','#00338d','#c60c30'],
  ['CAR','Carolina','Panthers','#0085ca','#101820'],['CHI','Chicago','Bears','#0b162a','#c83803'],
  ['CIN','Cincinnati','Bengals','#fb4f14','#000000'],['CLE','Cleveland','Browns','#311d00','#ff3c00'],
  ['DAL','Dallas','Cowboys','#003594','#869397'],['DEN','Denver','Broncos','#fb4f14','#002244'],
  ['DET','Detroit','Lions','#0076b6','#b0b7bc'],['GB','Green Bay','Packers','#203731','#ffb612'],
  ['IND','Indianapolis','Colts','#002c5f','#ffffff'],['JAX','Jacksonville','Jaguars','#006778','#d7a22a'],
  ['KC','Kansas City','Chiefs','#e31837','#ffb81c'],['MIA','Miami','Dolphins','#008e97','#fc4c02'],
  ['MIN','Minnesota','Vikings','#4f2683','#ffc62f'],['NE','New England','Patriots','#002244','#c60c30'],
  ['NO','New Orleans','Saints','#d3bc8d','#101820'],['NYG','New York','Giants','#0b2265','#a71930'],
  ['NYJ','New York','Jets','#125740','#ffffff'],['OAK','Oakland','Raiders','#000000','#a5acaf'],
  ['PHI','Philadelphia','Eagles','#004c54','#a5acaf'],['PIT','Pittsburgh','Steelers','#101820','#ffb612'],
  ['SD','San Diego','Chargers','#0080c6','#ffc20e'],['SF','San Francisco','49ers','#aa0000','#b3995d'],
  ['SEA','Seattle','Seahawks','#002244','#69be28'],['STL','St. Louis','Rams','#003594','#ffd100'],
  ['TB','Tampa Bay','Buccaneers','#d50a0a','#ff7900'],['TEN','Tennessee','Titans','#0c2340','#4b92db'],
  ['WAS','Washington','Redskins','#5a1414','#ffb612'],
].map(([abbr, city, name, primary, secondary], i) => ({ id: i, abbr, city, name, primary, secondary }));

const FIRST = ['Marcus','Deion','Troy','Jerome','Antonio','Darnell','Kordell','Tyrone','Rashad','Lamar','Cortez','Dwayne','Jamal','Terrell','Reggie','Brock','Donovan','Keyshawn','Marshall','Cris'];
const LAST = ['Stone','Rivers','Banks','Hawkins','Steele','Walker','Carter','Jackson','Freeman','Bolt','Mack','Reyes','Odom','Price','Knox','Vick','Boone','Dunn','Sharpe','Ward'];
// Deterministic pseudo-random so host and client build identical rosters.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export function roster(teamId) {
  const r = rng(teamId * 7919 + 17);
  const mk = (pos, num) => ({ pos, num, name: FIRST[(r() * FIRST.length) | 0] + ' ' + LAST[(r() * LAST.length) | 0],
    spd: 0.9 + r() * 0.2, pow: 0.9 + r() * 0.2, hands: 0.9 + r() * 0.2 });
  return {
    offense: [mk('QB', 7 + ((r() * 9) | 0)), mk('RB', 20 + ((r() * 15) | 0)), mk('OL', 60 + ((r() * 19) | 0)), mk('OL', 60 + ((r() * 19) | 0)),
      mk('WR', 80 + ((r() * 9) | 0)), mk('WR', 80 + ((r() * 9) | 0)), mk('WR', 80 + ((r() * 9) | 0))],
    defense: [mk('DL', 90 + ((r() * 9) | 0)), mk('DL', 90 + ((r() * 9) | 0)), mk('LB', 50 + ((r() * 9) | 0)), mk('LB', 50 + ((r() * 9) | 0)),
      mk('CB', 20 + ((r() * 15) | 0)), mk('CB', 20 + ((r() * 15) | 0)), mk('S', 40 + ((r() * 9) | 0))],
  };
}
