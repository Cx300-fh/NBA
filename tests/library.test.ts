import test from 'node:test';
import assert from 'node:assert/strict';
import {draftLabel,leagueZonePercent,loadLibrary,makeGuessQuestion,playerMatches,playerYears,shardFor,visibleZones,zoneDifference,type PlayerProfile,type ShotRow} from '../lib/player-library.ts';
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
