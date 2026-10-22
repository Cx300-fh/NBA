import test from 'node:test';
import assert from 'node:assert/strict';
import {challengeEligible,draftLabel,leagueZonePercent,loadArchive,loadLibrary,mergeCurrentCareer,playerDefaultSeason,makeGuessQuestion,playerMatches,playerYears,shardFor,visibleZones,zoneDifference,type PlayerProfile,type ShotRow} from '../lib/player-library.ts';
const player={id:1629029,name:'Luka Dončić',slug:'luka-doncic',active:true,teamId:1610612747,teamCode:'LAL',position:'Guard',jersey:'77',height:'6-8',heightCm:203.2,weightLb:230,weightKg:104.3,college:null,country:'Slovenia',draftYear:2018,draftRound:1,draftNumber:3,undrafted:false,fromYear:2018,toYear:2026,birthDate:'1999-02-28',birthPlace:null} satisfies PlayerProfile;
test('Chinese and accent-free searches find the same official player without replacing source names',()=>{
 for(const q of ['东契奇','Doncic','Dončić','Luka Doncic','LAL','Slovenia'])assert.ok(playerMatches(player,q),q);
 assert.ok(!playerMatches(player,'Jordan'));assert.equal(player.name,'Luka Dončić');
});
test('draft and career labels keep undrafted, unknown and completed season years separate',()=>{
 assert.equal(draftLabel(player),'2018 · 第 1 轮 · 第 3 顺位');assert.equal(draftLabel({...player,undrafted:true,draftYear:null}),'落选秀');assert.equal(draftLabel({...player,draftYear:null,draftRound:null,draftNumber:null}),'未提供');
 assert.equal(playerYears({...player,active:false,fromYear:1984,toYear:2002}),'1984—2003');assert.equal(playerYears(player),'2018—至今');
});
test('shot areas use weighted league rates; corner aggregates do not count as extra regions',()=>{
 const zone=(made:number,attempted:number)=>({key:'restricted',label:'篮下',FGM:made,FGA:attempted,FG_PCT:attempted?made/attempted:null});
 const rows:ShotRow[]=[{PLAYER_ID:1,PLAYER_NAME:'A',TEAM_ID:1,zones:[zone(1,1)]},{PLAYER_ID:2,PLAYER_NAME:'B',TEAM_ID:1,zones:[zone(20,100)]}];
 assert.equal(leagueZonePercent(rows,'restricted'),21/101);assert.equal(leagueZonePercent(rows,'missing'),null);
 assert.equal(zoneDifference(zone(1,1),.5),null);assert.equal(zoneDifference(zone(6,10),.5),.6-.5);
 assert.equal(visibleZones({...rows[0],zones:[zone(1,1),{...zone(1,1),key:'corner-total',aggregated:true}]}).length,1);
 assert.equal(zoneDifference({...zone(0,0),FGM:null,FGA:null},.5),null);
});
test('profile and career shards reject malformed IDs and resource traversal',async()=>{
 assert.equal(shardFor(2544),'48');assert.equal(shardFor(893),'61');
 for(const id of [0,-1,1.5,Infinity,NaN])assert.throws(()=>shardFor(id));
 for(const path of ['../secret','https://evil.test/data','profiles/../../key','archive/season-2025-26.json?url=evil'])await assert.rejects(()=>loadLibrary(path));
});
test('guess questions use four distinct verified profiles and include their real answer',()=>{
 const players=[1629029,2544,893,201939].map((id,i)=>({...player,id,name:'Player '+i}));
 const q=makeGuessQuestion(players,()=>0)!;assert.ok(q);assert.equal(new Set(q.options.map(p=>p.id)).size,4);assert.ok(q.options.some(p=>p.id===q.answer.id));assert.equal(makeGuessQuestion(players.slice(0,3)),null);
});

test('active player pages open the current season while retired players keep their own last season',()=>{
 assert.equal(playerDefaultSeason(player),'2026-27');
 assert.equal(playerDefaultSeason({...player,active:false,fromYear:1984,toYear:2002}),'2002-03');
 assert.equal(playerDefaultSeason({...player,active:false,fromYear:1959,toYear:1972}),'1972-73');
});
test('career live rows replace only their actual season and unavailable data preserve archived results',()=>{
 const old={rows:[{SEASON_ID:'2025-26',PLAYER_ID:player.id,GP:70,PTS:28},{SEASON_ID:'2026-27',PLAYER_ID:player.id,GP:1,PTS:20}],source:'NBA.com',updatedAt:'2026-10-21T00:00:00Z'};
 const fresh={rows:[{PLAYER_ID:player.id,GP:2,PTS:30}],season:'2026-27',updatedAt:'2026-10-22T00:00:00Z',stale:false};
 const result=mergeCurrentCareer(old,player.id,fresh)!;
 assert.deepEqual(result.rows.map(r=>[r.SEASON_ID,r.PTS]),[['2025-26',28],['2026-27',30]]);
 assert.equal(old.rows[1].PTS,20);assert.equal(result.updatedAt,fresh.updatedAt);
 assert.deepEqual(mergeCurrentCareer(old,player.id,{rows:[],stale:true})!.rows,old.rows);
 assert.equal(mergeCurrentCareer(undefined,player.id,{rows:[],stale:false}),undefined);
 assert.equal(mergeCurrentCareer(old,player.id,{rows:[],stale:false})!.rows.length,1);
});
test('new-season challenges include real one-game samples without inventing values or unattempted threes',()=>{
 const row={GP:1,PTS:25,FG3A:0,FG3_PCT:0};
 assert.equal(challengeEligible(row,'2026-27','PTS'),true);
 assert.equal(challengeEligible(row,'2025-26','PTS'),false);
 assert.equal(challengeEligible({...row,GP:0},'2026-27','PTS'),false);
 assert.equal(challengeEligible(row,'2026-27','FG3_PCT'),false);
 assert.equal(challengeEligible({...row,FG3A:5,FG3_PCT:.4},'2026-27','FG3_PCT'),true);
 assert.equal(challengeEligible({...row,PTS:null},'2026-27','PTS'),false);
});

test('current player archives revalidate live rows and zones without changing the saved season',async()=>{
 const realFetch=globalThis.fetch;let revision=0;let fileReads=0;
 const empty={rows:[],season:'2026-27',source:'NBA.com',updatedAt:'2026-10-20T00:00:00Z',stale:false};
 globalThis.fetch=async input=>{
  const path=String(input);
  if(path.startsWith('/explore/')){fileReads++;return Response.json({season:'2026-27',players:empty,teams:empty,standings:empty,bpm:empty,shots:empty})}
  const resource=new URL(path,'https://example.test').searchParams.get('resource');
  if(resource==='players'){revision++;return Response.json({...empty,rows:[{PLAYER_ID:player.id,GP:revision,PTS:25}],updatedAt:'2026-10-22T00:00:00Z'})}
  return Response.json({...empty,rows:[{PLAYER_ID:player.id,zones:[{key:'restricted',FGM:revision,FGA:revision*2,FG_PCT:.5}]}],updatedAt:'2026-10-22T00:00:00Z'});
 };
 try{
  const first=await loadArchive('2026-27');const second=await loadArchive('2026-27');
  assert.equal(fileReads,1);assert.equal(first.players.rows?.[0].GP,1);assert.equal(second.players.rows?.[0].GP,2);
  assert.equal(first.season,'2026-27');assert.equal(second.shots.rows[0].zones[0].FGM,2);assert.equal(second.shots.updatedAt,'2026-10-22T00:00:00Z');
 }finally{globalThis.fetch=realFetch}
});
