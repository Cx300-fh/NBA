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
source=source.replace("from '@/lib/boxscore'",`from ${JSON.stringify(pathToFileURL(resolve('lib/boxscore.ts')).href)}`);
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const path=join(dir,'api.mjs');await writeFile(path,compiled);const {GET,OPTIONS}=await import(pathToFileURL(path).href);
const realFetch=globalThis.fetch;let calls=0;
const payload=(headers,rowSet)=>Response.json({resultSets:[{headers,rowSet}]});
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
 globalThis.fetch=async url=>String(url).includes('MeasureType=Advanced')?new Response('Unavailable',{status:503}):payload(['TEAM_ID','TEAM_NAME','GP','PTS','FGM'],[[1610612737,'Atlanta Hawks',1,132,44]]);
 const response=await GET(new Request('https://test.invalid/api/nba?resource=teams&season=2026-27'));const data=await response.json();
 assert.equal(data.season,'2026-27');assert.equal(data.stale,false);assert.equal(data.rows[0].PTS,132);assert.equal(data.rows[0].FGM,44);assert.equal(data.rows[0].OFF_RATING,undefined);assert.ok(data.warning);
});
test('official shooting zones preserve missing values, zero attempts and overlapping corner totals',async()=>{
 const groups=['Restricted Area','Mid-Range','Left Corner 3','Right Corner 3','Corner 3'];
 globalThis.fetch=async url=>{assert.ok(String(url).includes('Season=2026-27'));assert.ok(String(url).includes('leaguedashplayershotlocations'));return Response.json({resultSets:{headers:[{columnNames:groups,columnsToSkip:4,columnSpan:3},{columnNames:['PLAYER_ID','PLAYER_NAME','TEAM_ID','TEAM_ABBREVIATION']}],rowSet:[[1,'One',1610612737,'ATL',2,4,.5,0,0,0,null,null,null,1,2,.5,1,2,.5]]}})};
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
  const first=await(await GET(request())).json();clock+=14999;await GET(request());assert.equal(requests,1);
  clock+=2;globalThis.fetch=async()=>{requests++;throw Error('offline')};const stale=await(await GET(request())).json();
  assert.equal(requests,2);assert.equal(stale.stale,true);assert.equal(stale.updatedAt,first.updatedAt);assert.ok(stale.attemptedAt);assert.deepEqual(stale.games,[]);
 }finally{Date.now=originalNow}
});
test('an unexpectedly empty official table cannot erase an already verified season',async()=>{
 globalThis.fetch=async()=>payload(['PLAYER_ID','PLAYER_NAME','GP','PTS'],[]);
 const data=await(await GET(new Request('https://test.invalid/api/nba?resource=players&season=2024-25'))).json();
 assert.equal(data.stale,true);assert.equal(data.rows.length,569);assert.ok(data.updatedAt);assert.ok(data.warning);
});
test.after(async()=>{globalThis.fetch=realFetch;await rm(dir,{recursive:true,force:true})});
