import test from 'node:test';
import assert from 'node:assert/strict';
import { staticDataPath, normalizeScheduledGame, fetchStaticDataset, fetchDataset, retainLatestDataset } from '../lib/data-client.ts';
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
test('current season statistics use the live service and retain its source timestamp',async()=>{
 const calls:string[]=[];globalThis.fetch=async input=>{calls.push(String(input));return Response.json({season:'2026-27',rows:[{PLAYER_ID:1,PTS:31}],source:'NBA.com',updatedAt:'2026-10-22T06:02:00Z',stale:false})};
 const result=await fetchDataset('players','2026-27');assert.equal(result.rows?.[0].PTS,31);assert.equal(result.updatedAt,'2026-10-22T06:02:00Z');assert.equal(result.stale,false);assert.ok(calls.some(url=>url==='/api/nba?resource=players&season=2026-27'));
});
test('a live service outage falls back to newer published statistics without changing their timestamp',async()=>{
 globalThis.fetch=async input=>String(input).startsWith('/api/nba')?Response.json({season:'2026-27',rows:[],stale:true,updatedAt:'2026-10-21T06:00:00Z'}):Response.json({season:'2026-27',rows:[{PLAYER_ID:1,PTS:31}],source:'NBA.com',updatedAt:'2026-10-22T06:00:00Z'});
 const result=await fetchDataset('players','2026-27');assert.equal(result.rows?.[0].PTS,31);assert.equal(result.updatedAt,'2026-10-22T06:00:00Z');assert.equal(result.stale,true);
});
test('a wrong season live response cannot be displayed as current season data',async()=>{
 globalThis.fetch=async input=>String(input).startsWith('/api/nba')?Response.json({season:'2025-26',rows:[{PLAYER_ID:1,PTS:99}],stale:false}):Response.json({season:'2026-27',rows:[{PLAYER_ID:1,PTS:31}],updatedAt:'2026-10-22T06:00:00Z'});
 const result=await fetchDataset('players','2026-27');assert.equal(result.rows?.[0].PTS,31);assert.equal(result.season,'2026-27');assert.equal(result.stale,true);
});
test('historical seasons stay local and current shooting areas have a validated archive fallback',async()=>{
 const calls:string[]=[];globalThis.fetch=async input=>{calls.push(String(input));return Response.json({players:{rows:[{PLAYER_ID:23,PTS:30}],season:'1990-91'}})};
 const result=await fetchDataset('players','1990-91');assert.equal(result.season,'1990-91');assert.deepEqual(calls,['/explore/archive/season-1990-91.json']);assert.equal(staticDataPath('shots','2026-27'),'/explore/archive/season-2026-27.json');
});
test('a current official scheduled feed bypasses a blocked server without changing the collection time',async()=>{
 const timestamp=new Date().toISOString();const calls:string[]=[];
 globalThis.fetch=async input=>{calls.push(String(input));if(!String(input).startsWith('https://raw.githubusercontent.com/Cx300-fh/NBA/main/data/live/'))throw Error('blocked server must not be required');return Response.json({season:'2026-27',rows:[{PLAYER_ID:1,PTS:31}],source:'NBA.com',updatedAt:timestamp,stale:false})};
 const result=await fetchDataset('players','2026-27');assert.equal(result.stale,false);assert.equal(result.updatedAt,timestamp);assert.equal(calls.length,1);
});
test('official browser live data can win before an unavailable server completes',async()=>{
 let finish:((response:Response)=>void)|undefined;
 globalThis.fetch=async input=>String(input).startsWith('https://cdn.nba.com/')?Response.json({scoreboard:{games:[],gameDate:'2026-10-22'}}):new Promise<Response>(resolve=>{finish=resolve});
 const result=await fetchDataset('scoreboard','2026-27');assert.equal(result.stale,false);assert.equal(result.source,'NBA.com');finish?.(Response.json({games:[],stale:true}));
});
test('CDN failure still uses the existing live Worker without waiting for Actions',async()=>{
 const updatedAt=new Date().toISOString();
 globalThis.fetch=async input=>{
  if(String(input).startsWith('https://cdn.nba.com/'))throw Error('CDN unavailable');
  assert.ok(String(input).startsWith('/api/nba?'));
  return Response.json({games:[],source:'ESPN',updatedAt,stale:false});
 };
 const result=await fetchDataset('scoreboard','2026-27');
 assert.equal(result.source,'ESPN');assert.equal(result.stale,false);assert.equal(result.updatedAt,updatedAt);
});
test('both live transports down select the newest fallback and preserve its actual age',async()=>{
 for(const newer of ['mirror','pages']){
  const timestamp='2026-10-29T00:58:28.669164+00:00';
  globalThis.fetch=async input=>{
   const url=String(input);
   if(url.startsWith('https://cdn.nba.com/')||url.startsWith('/api/nba?'))throw Error('offline');
   const origin=url.startsWith('https://raw.githubusercontent.com/')?'mirror':'pages';
   return Response.json({games:[],source:'NBA.com',updatedAt:origin===newer?timestamp:'2026-10-29T00:48:48.427881+00:00',stale:false});
  };
  const result=await fetchDataset('scoreboard','2026-27');
  assert.equal(result.updatedAt,timestamp);assert.equal(result.stale,true);
 }
});
test('an aged statistics mirror cannot bypass a healthy Worker even when its saved stale flag is false',async()=>{
 const old=new Date(Date.now()-7*3600000).toISOString(),fresh=new Date().toISOString();
 globalThis.fetch=async input=>Response.json({season:'2026-27',rows:[{TeamID:1}],source:'NBA.com',updatedAt:String(input).startsWith('https://raw.')?old:fresh,stale:false});
 const result=await fetchDataset('standings','2026-27');
 assert.equal(result.updatedAt,fresh);assert.equal(result.stale,false);
});
test('a successful fallback response cannot overwrite a newer visible score during an outage',()=>{
 const previous={game:{gameId:'0022600132',gameStatus:3,homeTeam:{score:117},awayTeam:{score:129}},source:'ESPN',updatedAt:'2026-10-29T02:16:06.255Z',stale:false};
 const incoming={game:{gameId:'0022600132',gameStatus:2,homeTeam:{score:85},awayTeam:{score:97}},source:'NBA.com',updatedAt:'2026-10-29T00:58:28.669Z',stale:true};
 const result=retainLatestDataset(previous,incoming);
 assert.equal(result.game?.gameStatus,3);assert.equal(result.game?.homeTeam.score,117);
 assert.equal(result.source,'ESPN');assert.equal(result.updatedAt,previous.updatedAt);assert.equal(result.stale,true);
 assert.equal(previous.stale,false);
 assert.equal(retainLatestDataset(result,{...previous,updatedAt:'2026-10-29T02:17:00Z'}).stale,false);
 assert.equal(retainLatestDataset(previous,{...incoming,updatedAt:null}).updatedAt,previous.updatedAt);
 assert.equal(retainLatestDataset({stale:true},incoming),incoming);
 const newer={...incoming,updatedAt:'2026-10-29T02:18:00Z'};
 assert.equal(retainLatestDataset(previous,newer),newer);
});
test.after(()=>{globalThis.fetch=realFetch});
