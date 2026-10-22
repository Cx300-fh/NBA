import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const dir=await mkdtemp(join(tmpdir(),'courtside-api-test-'));
let source=await readFile(new URL('../app/api/nba/route.ts',import.meta.url),'utf8');
source=source.replace("import snapshot from '@/data/snapshot.json';",`import snapshot from ${JSON.stringify(pathToFileURL(resolve('data/snapshot.json')).href)} with {type:'json'};`);
source=source.replace("import currentArchive from '@/data/archive/season-2026-27.json';",`import currentArchive from ${JSON.stringify(pathToFileURL(resolve('data/archive/season-2026-27.json')).href)} with {type:'json'};`);
source=source.replace("from '@/lib/basketball'",`from ${JSON.stringify(pathToFileURL(resolve('lib/basketball.ts')).href)}`);
source=source.replace("from '@/lib/boxscore'",`from ${JSON.stringify(pathToFileURL(resolve('lib/boxscore.ts')).href)}`);
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const path=join(dir,'api.mjs');await writeFile(path,compiled);const {GET,OPTIONS}=await import(pathToFileURL(path).href);
const realFetch=globalThis.fetch;let calls=0;
const payload=(headers,rowSet,season='2025-26')=>Response.json({parameters:{LeagueID:'00',Season:season},resultSets:[{headers,rowSet}]});
test('API rejects unknown endpoints, unsupported seasons and malformed ids before making requests',async()=>{globalThis.fetch=async()=>{throw Error('must not fetch')};for(const q of ['resource=https://evil.test','resource=players&season=2030-31','resource=boxscore&id=../../../etc/passwd'])assert.equal((await GET(new Request('https://test.invalid/api/nba?'+q))).status,400)});
test('official base and advanced metrics merge by player id, with cache preventing repeated upstream work',async()=>{globalThis.fetch=async url=>{calls++;if(String(url).includes('MeasureType=Advanced'))return payload(['PLAYER_ID','TS_PCT','OFF_RATING','FGM','FGA'],[[2,.63,118,500,1000],[1,.58,111,600,1200]]);return payload(['PLAYER_ID','PLAYER_NAME','TEAM_ID','PTS','GP','FGM','FGA'],[[1,'One',1610612747,21,40,8,16],[2,'Two',1610612744,29,42,11,20]])};const req=()=>new Request('https://test.invalid/api/nba?resource=players&season=2025-26');const data=await(await GET(req())).json();assert.equal(data.stale,false);assert.equal(data.rows[0].PTS,21);assert.equal(data.rows[0].FGM,8);assert.equal(data.rows[0].FGA,16);assert.equal(data.rows[0].TS_PCT,.58);assert.equal(data.rows[1].TS_PCT,.63);assert.equal(data.source,'NBA.com');const n=calls;await GET(req());assert.equal(calls,n)});
test('NBA outages retain verified snapshots and label them stale',async()=>{globalThis.fetch=async()=>{throw Error('upstream offline')};const data=await(await GET(new Request('https://test.invalid/api/nba?resource=standings&season=2024-25'))).json();assert.equal(data.stale,true);assert.equal(data.rows.length,30);assert.ok(data.updatedAt);assert.ok(data.warning)});
test('BPM denied by its source never becomes fabricated zeroes',async()=>{globalThis.fetch=async()=>new Response('Forbidden',{status:403});const data=await(await GET(new Request('https://test.invalid/api/nba?resource=bpm&season=2026-27'))).json();assert.equal(data.stale,true);assert.deepEqual(data.rows,[]);assert.equal(data.updatedAt,null);assert.equal(data.source,'Basketball Reference')});
test('Pages can read the data service while unrelated origins and write preflights are rejected',async()=>{
 globalThis.fetch=async()=>{throw Error('must not fetch')};
 const url='https://courtside-nba-cx300.pastelsong512.chatgpt.site/api/nba';
 const allowed=await OPTIONS(new Request(url,{method:'OPTIONS',headers:{Origin:'https://cx300-fh.github.io','Access-Control-Request-Method':'GET'}}));
 assert.equal(allowed.status,204);assert.equal(allowed.headers.get('Access-Control-Allow-Origin'),'https://cx300-fh.github.io');assert.equal(allowed.headers.get('Vary'),'Origin');
 assert.equal((await OPTIONS(new Request(url,{method:'OPTIONS',headers:{Origin:'https://cx300-fh.github.io','Access-Control-Request-Method':'POST'}}))).status,403);
 const denied=await GET(new Request(url,{headers:{Origin:'https://attacker.example'}}));assert.equal(denied.status,403);assert.equal(denied.headers.get('Access-Control-Allow-Origin'),null);
 const invalid=await GET(new Request(url+'?resource=unknown',{headers:{Origin:'https://cx300-fh.github.io'}}));assert.equal(invalid.status,400);assert.equal(invalid.headers.get('Access-Control-Allow-Origin'),'https://cx300-fh.github.io');
});
test('26–27 official basic statistics remain usable if the advanced feed is temporarily unavailable',async()=>{
 globalThis.fetch=async url=>String(url).includes('MeasureType=Advanced')?new Response('Unavailable',{status:503}):payload(['TEAM_ID','TEAM_NAME','GP','PTS','FGM'],[[1610612737,'Atlanta Hawks',1,132,44]],'2026-27');
 const response=await GET(new Request('https://test.invalid/api/nba?resource=teams&season=2026-27'));const data=await response.json();
 assert.equal(data.season,'2026-27');assert.equal(data.stale,false);assert.equal(data.rows[0].PTS,132);assert.equal(data.rows[0].FGM,44);assert.equal(data.rows[0].OFF_RATING,undefined);assert.ok(data.warning);
});
test('official shooting zones preserve missing values, zero attempts and overlapping corner totals',async()=>{
 const groups=['Restricted Area','Mid-Range','Left Corner 3','Right Corner 3','Corner 3'];
 globalThis.fetch=async url=>{assert.ok(String(url).includes('Season=2026-27'));assert.ok(String(url).includes('leaguedashplayershotlocations'));return Response.json({parameters:{LeagueID:'00',Season:'2026-27'},resultSets:{headers:[{columnNames:groups,columnsToSkip:4,columnSpan:3},{columnNames:['PLAYER_ID','PLAYER_NAME','TEAM_ID','TEAM_ABBREVIATION']}],rowSet:[[1,'One',1610612737,'ATL',2,4,.5,0,0,0,null,null,null,1,2,.5,1,2,.5]]}})};
 const data=await(await GET(new Request('https://test.invalid/api/nba?resource=shots&season=2026-27'))).json();
 assert.equal(data.stale,false);assert.equal(data.season,'2026-27');assert.equal(data.rows[0].zones[0].FG_PCT,.5);
 assert.deepEqual(data.rows[0].zones[1],{key:'midrange',label:'中距离',FGM:0,FGA:0,FG_PCT:null});
 assert.equal(data.rows[0].zones[2].FGA,null);assert.equal(data.rows[0].zones[2].available,false);assert.equal(data.rows[0].zones[4].aggregated,true);
});
test('live scores expire after 15 seconds and an outage keeps the last verified update time',async()=>{
 const originalNow=Date.now;let clock=originalNow(),requests=0;
 Date.now=()=>clock;
 try{
  globalThis.fetch=async()=>{requests++;return Response.json({scoreboard:{gameDate:'2026-10-21',games:[]}})};
  const request=()=>new Request('https://test.invalid/api/nba?resource=scoreboard&season=2026-27');
  const first=await(await GET(request())).json(),cachedRequests=requests;clock+=14999;await GET(request());assert.equal(requests,cachedRequests);
  clock+=2;globalThis.fetch=async()=>{requests++;throw Error('offline')};const stale=await(await GET(request())).json();
  assert.ok(requests>cachedRequests);assert.equal(stale.stale,true);assert.equal(stale.updatedAt,first.updatedAt);assert.ok(stale.attemptedAt);assert.deepEqual(stale.games,[]);
 }finally{Date.now=originalNow}
});
test('an unexpectedly empty official table cannot erase an already verified season',async()=>{
 globalThis.fetch=async()=>payload(['PLAYER_ID','PLAYER_NAME','GP','PTS'],[],'2024-25');
 const data=await(await GET(new Request('https://test.invalid/api/nba?resource=players&season=2024-25'))).json();
 assert.equal(data.stale,true);assert.equal(data.rows.length,569);assert.ok(data.updatedAt);assert.ok(data.warning);
});
test('ESPN scores use uniquely matched official NBA ids and NBA team codes, never provider ids',async()=>{
 const originalNow=Date.now;Date.now=()=>originalNow()+3600000;
 try{
  const time='2026-10-22T23:00:00Z';
  const fixture=(gameId,home,away)=>({gameId,gameStatus:1,gameStatusText:'Scheduled',gameDateTimeUTC:time,homeTeam:{teamId:home,teamTricode:'HOME',teamName:'Home',teamCity:'Home',score:null},awayTeam:{teamId:away,teamTricode:'AWAY',teamName:'Away',teamCity:'Away',score:null}});
  const fixtures=[fixture('0022601001',1610612744,1610612752),fixture('0022601002',1610612740,1610612759),fixture('0022601003',1610612762,1610612756)];
  const event=(id,home,away,date=time)=>({id,date,competitions:[{date,competitors:[{homeAway:'home',team:{id:'espn-home',abbreviation:home},score:'98'},{homeAway:'away',team:{id:'espn-away',abbreviation:away},score:'90'}],status:{type:{state:'in',completed:false,shortDetail:'4:20 - 4th'}}}]});
  const events=[event('401000001','GS','NY'),event('401000002','NO','SA'),event('401000003','UTAH','PHO'),event('401000004','NY','GS'),event('401000005','GS','NY','2026-10-24T23:00:00Z'),event('401000006','XXX','NY')];
  globalThis.fetch=async url=>String(url).includes('site.api.espn.com')?Response.json({day:{date:'2026-10-22'},events}):String(url).includes('scheduleLeagueV2_1')?Response.json({leagueSchedule:{seasonYear:'2026-27',gameDates:[{games:fixtures}]}}):new Response('Forbidden',{status:403});
  const data=await(await GET(new Request('https://test.invalid/api/nba?resource=scoreboard&season=2026-27'))).json();
  assert.equal(data.source,'ESPN');assert.equal(data.stale,false);assert.equal(data.gameDate,'2026-10-22');assert.equal(data.games.length,3);
  assert.deepEqual(data.games.map(g=>g.gameId),fixtures.map(g=>g.gameId));assert.equal(data.games[0].homeTeam.teamId,1610612744);assert.equal(data.games[0].homeTeam.score,98);assert.equal(data.games[0].gameStatus,2);assert.ok(data.games[0].url.includes('401000001'));
 }finally{Date.now=originalNow}
});
test('remote NBA mirrors keep their collection time and clearly label game snapshots',async()=>{
 const originalNow=Date.now;Date.now=()=>originalNow()+7200000;
 try{
  const updatedAt=new Date(Date.now()-120000).toISOString();
  const fixture={gameId:'0022601010',gameStatus:1,gameStatusText:'Scheduled',gameTimeUTC:'2026-10-22T23:00:00Z',homeTeam:{teamId:1610612744},awayTeam:{teamId:1610612752}};
  const games=[fixture,{...fixture,gameId:'0032600001',homeTeam:{teamId:0}},{...fixture,gameStatus:0},{...fixture,awayTeam:fixture.homeTeam},{...fixture,gameTimeUTC:'TBD'}];
  globalThis.fetch=async url=>String(url).endsWith('/schedule.json')?Response.json({games,source:'NBA.com',season:'2026',updatedAt,stale:false}):new Response('Forbidden',{status:403});
  const data=await(await GET(new Request('https://test.invalid/api/nba?resource=schedule&season=2026-27'))).json();
  assert.equal(data.stale,true);assert.equal(data.updatedAt,updatedAt);assert.equal(data.refreshIntervalSeconds,300);assert.ok(data.warning.includes('5 分钟'));assert.equal(data.games[0].gameId,'0022601010');assert.equal(data.games.length,1);
 }finally{Date.now=originalNow}
});
test('mirrors reject future timestamps, untrusted sources and all-placeholder schedules',async()=>{
 const originalNow=Date.now;let clock=originalNow()+10800000;Date.now=()=>clock;
 try{
  const fixture={gameId:'0022601100',gameStatus:1,gameTimeUTC:'2026-10-22T23:00:00Z',homeTeam:{teamId:1610612744},awayTeam:{teamId:1610612752}};
  for(const patch of [{updatedAt:new Date(clock+120000).toISOString()},{source:'Unverified feed'},{games:[{...fixture,homeTeam:{teamId:0}}]}]){
   clock+=3600000;
   const mirrored={games:[fixture],source:'NBA.com',updatedAt:new Date(clock).toISOString(),stale:false,...patch};
   // Keep the future-date case ahead of the updated test clock.
   if('updatedAt' in patch)mirrored.updatedAt=new Date(clock+120000).toISOString();
   globalThis.fetch=async url=>String(url).endsWith('/schedule.json')?Response.json(mirrored):new Response('Forbidden',{status:403});
   const data=await(await GET(new Request('https://test.invalid/api/nba?resource=schedule&season=2026-27'))).json();
   assert.equal(data.stale,true);assert.notEqual(data.updatedAt,mirrored.updatedAt);assert.equal(data.games.some(g=>g.gameId===fixture.gameId),false);
  }
 }finally{Date.now=originalNow}
});
test('official alternate Stats hosts must return the requested NBA league and season',async()=>{
 const seen=[];
 globalThis.fetch=async url=>{
  seen.push(String(url));const parsed=new URL(url);
  if(parsed.hostname==='stats.nba.com')return new Response('Forbidden',{status:403});
  if(parsed.hostname==='stats.gleague.nba.com')return Response.json({parameters:{LeagueID:'20',Season:'2026-27'},resultSets:[{headers:['PERSON_ID'],rowSet:[[999]]}]});
  if(parsed.hostname==='stats.wnba.com')return Response.json({parameters:{LeagueID:'00',Season:'2026-27'},resultSets:[{headers:['PERSON_ID','DISPLAY_FIRST_LAST'],rowSet:[[1631260,'AJ Green']]}]});
  return new Response('Not found',{status:404});
 };
 const data=await(await GET(new Request('https://test.invalid/api/nba?resource=roster&season=2026-27'))).json();
 assert.equal(data.stale,false);assert.equal(data.rows[0].PERSON_ID,1631260);assert.ok(seen.some(u=>u.startsWith('https://stats.wnba.com/')));assert.ok(seen.some(u=>u.startsWith('https://stats.gleague.nba.com/')));
});
test('wrong-season alternate data and older mirrors cannot replace newer verified statistics',async()=>{
 const isolatedPath=join(dir,'freshness.mjs');await writeFile(isolatedPath,compiled);const {GET:isolatedGet}=await import(pathToFileURL(isolatedPath).href);
 const snapshot=JSON.parse(await readFile(resolve('data/snapshot.json'),'utf8'));const expected=snapshot.seasons['2026-27'].standings;
 globalThis.fetch=async url=>String(url).startsWith('https://raw.githubusercontent.com/')?Response.json({rows:[{TeamID:1610612737,WINS:0}],source:'NBA.com',season:'2026-27',updatedAt:'2026-10-20T08:50:00Z',stale:true}):Response.json({parameters:{LeagueID:'00',Season:'2025-26'},resultSets:[{headers:['TeamID','WINS'],rowSet:[[1610612737,999]]}]});
 const data=await(await isolatedGet(new Request('https://test.invalid/api/nba?resource=standings&season=2026-27'))).json();
 assert.equal(data.stale,true);assert.equal(data.updatedAt,expected.updatedAt);assert.deepEqual(data.rows,expected.rows);
});
test('current shooting-zone archive survives empty remote datasets without a refreshed timestamp',async()=>{
 const archive={rows:[{PLAYER_ID:1,PLAYER_NAME:'Verified player',TEAM_ID:1610612737,zones:[{key:'restricted',label:'篮下限制区',FGM:3,FGA:4,FG_PCT:.75}]}],source:'NBA.com',season:'2026-27',updatedAt:'2026-10-22T12:00:00Z',stale:false};
 // Keep this regression independent of whether a new season has archived shots in the checkout.
 const fixtureSource=source.replace(/import currentArchive from [^;]+;/,`const currentArchive=${JSON.stringify({season:'2026-27',shots:archive})};`);
 assert.notEqual(fixtureSource,source,'The isolated archive fixture must replace the production import');
 const fixtureCompiled=ts.transpileModule(fixtureSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const isolatedPath=join(dir,'shots-archive.mjs');await writeFile(isolatedPath,fixtureCompiled);const {GET:isolatedGet}=await import(pathToFileURL(isolatedPath).href);
 globalThis.fetch=async url=>String(url).startsWith('https://raw.githubusercontent.com/')?Response.json({rows:[],source:'NBA.com',season:'2026-27',updatedAt:new Date().toISOString(),stale:false}):Response.json({parameters:{LeagueID:'00',Season:'2026-27'},resultSets:{headers:[{columnsToSkip:4,columnSpan:3,columnNames:['Restricted Area']},{columnNames:['PLAYER_ID','PLAYER_NAME','TEAM_ID','TEAM_ABBREVIATION']}],rowSet:[]}});
 const data=await(await isolatedGet(new Request('https://test.invalid/api/nba?resource=shots&season=2026-27'))).json();
 assert.equal(data.stale,true);assert.deepEqual(data.rows,archive.rows);assert.equal(data.updatedAt,archive.updatedAt);
});
test.after(async()=>{globalThis.fetch=realFetch;await rm(dir,{recursive:true,force:true})});
