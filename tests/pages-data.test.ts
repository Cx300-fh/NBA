import test from 'node:test';
import assert from 'node:assert/strict';
import { staticDataPath, normalizeScheduledGame, fetchStaticDataset } from '../lib/data-client.ts';
const realFetch = globalThis.fetch;
test('static data files are scoped by resource, season and verified game id', () => {
  assert.equal(staticDataPath('players', '2025-26'), '/data/players-2025-26.json');
  assert.equal(staticDataPath('boxscore', '2026-27', '0012600008'), '/data/boxscore-0012600008.json');
  for (const args of [['../secrets','2025-26',''], ['players','2027-28',''], ['boxscore','2026-27','../../../etc/passwd']]) assert.throws(() => staticDataPath(...args as [string,string,string]));
});
test('scheduled games preserve actual UTC time and both teams', () => {
  const team = { teamId:1610612747,teamName:'Lakers',teamCity:'Los Angeles',teamTricode:'LAL',score:110 };
  const g = normalizeScheduledGame({gameId:'0022600001',gameStatus:1,gameStatusText:'7:30 pm ET',gameDateTimeUTC:'2026-10-21T02:30:00Z',homeTeam:team,awayTeam:{...team,teamId:1610612744,teamTricode:'GSW'}});
  assert.equal(g.gameTimeUTC,'2026-10-21T02:30:00Z');assert.equal(g.homeTeam.teamTricode,'LAL');assert.equal(g.awayTeam.teamTricode,'GSW');
});
test('statistics on Pages read a static feed instead of a nonexistent server API', async () => {
  const calls:string[]=[];globalThis.fetch=async input=>{calls.push(String(input));return Response.json({rows:[{PLAYER_ID:2544,PTS:24.4}],updatedAt:'2026-10-20T08:00:00Z',source:'NBA.com'})};
  const d=await fetchStaticDataset('players','2025-26');assert.equal(d.rows?.[0].PTS,24.4);assert.deepEqual(calls,['/data/players-2025-26.json']);
});
test('CORS/upstream failure falls back without faking a fresh timestamp', async () => {
  const timestamp='2026-10-20T06:00:00Z';globalThis.fetch=async input=>{if(String(input).startsWith('https://cdn.nba.com/'))throw new TypeError('Failed to fetch');return Response.json({games:[],updatedAt:timestamp,source:'NBA.com',stale:false})};
  const d=await fetchStaticDataset('scoreboard','2026-27');assert.equal(d.stale,true);assert.equal(d.updatedAt,timestamp);assert.ok(d.warning?.includes('快照'));
});
test('successful official boxscore access stays live and verifies game id', async () => {
  globalThis.fetch=async()=>Response.json({game:{gameId:'0012600008',homeTeam:{score:111},awayTeam:{score:108}}});
  const d=await fetchStaticDataset('boxscore','2026-27','0012600008');assert.equal(d.game?.gameId,'0012600008');assert.equal(d.stale,false);assert.equal(d.source,'NBA.com');assert.ok(d.updatedAt);
});
test('invalid static JSON fails instead of displaying malformed rows', async () => {
  globalThis.fetch=async()=>Response.json({html:'not a stats feed'});await assert.rejects(()=>fetchStaticDataset('teams','2025-26'));
});
test.after(()=>{globalThis.fetch=realFetch});
