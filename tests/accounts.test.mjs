import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createAccountHandler,passwordMatches,normalizedUsername,verifyArchiveToken,ARCHIVE_AUDIENCE} from '../lib/account-server.ts';
const password='Courtside-test-2026!';
function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');sqlite.exec(readFileSync(new URL('../drizzle/0000_ambiguous_random.sql',import.meta.url),'utf8'));
 const db={prepare(sql){return {bind(...values){return {async first(){return sqlite.prepare(sql).get(...values)||null},async all(){return {results:sqlite.prepare(sql).all(...values)}},async run(){const r=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:r.changes}}}}}}},async batch(statements){sqlite.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sqlite.exec('COMMIT');return result}catch(e){sqlite.exec('ROLLBACK');throw e}}};
 let time=Date.parse('2090-10-20T00:00:00Z');
 const game={gameId:'0029000001',gameStatus:1,gameStatusText:'7:00 pm ET',gameTimeUTC:'2090-10-21T00:00:00Z',homeTeam:{teamId:1610612747,score:0,teamTricode:'LAL'},awayTeam:{teamId:1610612744,score:0,teamTricode:'GSW'}};
 let schedule=async()=>[game];
 const handler=createAccountHandler(db,{now:()=>time,schedule:(fresh)=>schedule(fresh),verifyArchive:async(token)=>{assert.equal(token,'workflow-token')}});
 async function call(path,options={}){const {token,body,origin='https://cx300-fh.github.io',ip='192.0.2.1',method}=options;const response=await handler(new Request('https://courtside-nba-cx300.pastelsong512.chatgpt.site/api/account/'+path,{method:method||(body===undefined?'GET':'POST'),headers:{Origin:origin,'CF-Connecting-IP':ip,...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}));return {status:response.status,headers:response.headers,data:response.status===204?null:await response.json()}}
 const register=async(username,ip='192.0.2.1')=>{const r=await call('register',{body:{username,password},ip});assert.equal(r.status,201,JSON.stringify(r.data));return r.data};
 return {sqlite,db,game,call,register,setTime:v=>time=v,setSchedule:v=>schedule=v};
}
test('accounts use salted scrypt hashes and opaque revocable sessions, never plaintext passwords',async()=>{
 const f=fixture();const account=await f.register('Basti');assert.equal(account.user.username,'Basti');assert.equal(account.token.length,43);assert.equal(account.user.password_hash,undefined);
 const row=f.sqlite.prepare('SELECT * FROM accounts').get();assert.notEqual(row.password_hash,password);assert.ok(await passwordMatches(password,row.password_hash));assert.equal(await passwordMatches('not-the-password',row.password_hash),false);
 const session=f.sqlite.prepare('SELECT * FROM account_sessions').get();assert.notEqual(session.token_hash,account.token);assert.equal(session.token_hash.length,64);
 assert.equal((await f.call('session',{token:account.token})).status,200);assert.equal((await f.call('logout',{token:account.token,body:{}})).status,200);assert.equal((await f.call('session',{token:account.token})).status,401);
});
test('registration normalizes duplicate names and rejects weak, malformed and conflicting credentials',async()=>{
 const f=fixture();await f.register('Kobe');assert.deepEqual(normalizedUsername('ＫＯＢＥ'),{username:'KOBE',key:'kobe'});
 assert.equal((await f.call('register',{body:{username:'ＫＯＢＥ',password}})).status,409);
 assert.equal((await f.call('register',{body:{username:'<script>',password}})).status,400);
 assert.equal((await f.call('register',{body:{username:'newplayer',password:'123'}})).status,400);
 const unknown=await f.call('login',{body:{username:'Unknown',password}});const wrong=await f.call('login',{body:{username:'Kobe',password:'wrong-password'}});assert.equal(unknown.status,401);assert.equal(wrong.status,401);assert.equal(unknown.data.error,wrong.data.error);
 assert.equal((await f.call('login',{body:{username:'kObE',password}})).status,200);
});
test('each account sees only its own month and cannot select another account through query or JSON',async()=>{
 const f=fixture();const a=await f.register('Player_A');const b=await f.register('Player_B','192.0.2.2');
 const saved=await f.call('predictions',{token:a.token,body:{gameId:f.game.gameId,pickedTeamId:f.game.homeTeam.teamId,userId:b.user.id}});assert.equal(saved.status,200);assert.equal(saved.data.file.predictions.length,1);
 const other=await f.call('predictions?month=2090-10&userId='+a.user.id,{token:b.token});assert.equal(other.status,200);assert.equal(other.data.file.predictions.length,0);
 assert.equal((await f.call('predictions?month=2090-10')).status,401);
 const archive=await f.call('archive?month=2090-10',{token:'workflow-token'});assert.equal(archive.data.predictions[0].participantId,a.user.id);assert.equal(archive.data.predictions[0].username,undefined);assert.ok(!JSON.stringify(archive.data).includes('Player_A'));assert.ok(!JSON.stringify(archive.data).includes('password'));
});
test('server schedule and server time lock picks, including a clock crossing tipoff during the schedule read',async()=>{
 const f=fixture();const a=await f.register('Player_A');
 assert.equal((await f.call('predictions',{token:a.token,body:{gameId:f.game.gameId,pickedTeamId:1610612750,gameStatus:1}})).status,400);
 f.setSchedule(async()=>{f.setTime(Date.parse(f.game.gameTimeUTC));return [f.game]});
 const locked=await f.call('predictions',{token:a.token,body:{gameId:f.game.gameId,pickedTeamId:f.game.homeTeam.teamId,gameTimeUTC:'2099-01-01T00:00:00Z'}});assert.equal(locked.status,409);assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM account_predictions').get().n,0);
});
test('updating a pick preserves creation time; final scores settle only a matching official game',async()=>{
 const f=fixture();const a=await f.register('Player_A');const submit=team=>f.call('predictions',{token:a.token,body:{gameId:f.game.gameId,pickedTeamId:team}});
 const first=await submit(f.game.homeTeam.teamId);const original=first.data.file.predictions[0].createdAt;f.setTime(Date.parse('2090-10-20T01:00:00Z'));
 const changed=await submit(f.game.awayTeam.teamId);assert.equal(changed.data.file.predictions[0].createdAt,original);assert.notEqual(changed.data.file.predictions[0].updatedAt,original);
 f.game.gameStatus=3;f.game.homeTeam.score=103;f.game.awayTeam.score=110;f.setTime(Date.parse('2090-10-21T03:00:00Z'));
 const ended=await f.call('predictions?month=2090-10',{token:a.token});assert.equal(ended.data.file.predictions[0].result.winnerTeamId,f.game.awayTeam.teamId);assert.equal((await submit(f.game.homeTeam.teamId)).status,409);
});
test('password changes revoke all older sessions and validate the old password first',async()=>{
 const f=fixture();const a=await f.register('Player_A');const b=await f.call('login',{body:{username:'Player_A',password}});
 assert.equal((await f.call('password',{token:a.token,body:{oldPassword:'wrong-password',password:'Replacement-2026'}})).status,400);
 const changed=await f.call('password',{token:a.token,body:{oldPassword:password,password:'Replacement-2026'}});assert.equal(changed.status,200);
 assert.equal((await f.call('session',{token:a.token})).status,401);assert.equal((await f.call('session',{token:b.data.token})).status,401);assert.equal((await f.call('session',{token:changed.data.token})).status,200);
 assert.equal((await f.call('login',{body:{username:'Player_A',password}})).status,401);assert.equal((await f.call('login',{body:{username:'Player_A',password:'Replacement-2026'}})).status,200);
});
test('expired sessions, foreign origins and brute force attempts are rejected',async()=>{
 const f=fixture();const a=await f.register('Player_A');assert.equal((await f.call('session',{token:a.token,origin:'https://evil.example'})).status,403);
 f.setTime(Date.parse('2090-12-01T00:00:00Z'));assert.equal((await f.call('session',{token:a.token})).status,401);
 for(let i=0;i<12;i++)await f.call('login',{body:{username:'zz',password},ip:'192.0.2.9'});
 // The IP limit also covers malformed login requests before any expensive hash.
 for(let i=0;i<19;i++)await f.call('login',{body:{username:'zz',password},ip:'192.0.2.9'});
 assert.equal((await f.call('login',{body:{username:'zz',password},ip:'192.0.2.9'})).status,429);
});
test('archive OIDC verifies issuer, exact workflow, branch, audience, expiry and signature',async()=>{
 const pair=generateKeyPairSync('rsa',{modulusLength:2048});const jwk=pair.publicKey.export({format:'jwk'});jwk.kid='account-test-key';const now=Date.now(),seconds=Math.floor(now/1000);
 const base={iss:'https://token.actions.githubusercontent.com',aud:ARCHIVE_AUDIENCE,repository:'Cx300-fh/NBA',ref:'refs/heads/main',workflow_ref:'Cx300-fh/NBA/.github/workflows/archive-account-picks.yml@refs/heads/main',sub:'repo:Cx300-fh/NBA:ref:refs/heads/main',event_name:'schedule',iat:seconds,nbf:seconds-5,exp:seconds+300};
 const token=(claims=base)=>{const h=Buffer.from(JSON.stringify({alg:'RS256',kid:jwk.kid})).toString('base64url');const b=Buffer.from(JSON.stringify(claims)).toString('base64url');const signature=sign('RSA-SHA256',Buffer.from(h+'.'+b),pair.privateKey).toString('base64url');return h+'.'+b+'.'+signature};
 const fetcher=async()=>Response.json({keys:[jwk]});await verifyArchiveToken(token(),now,fetcher);
 for(const change of [{repository:'attacker/NBA'},{ref:'refs/heads/feature'},{aud:'other'},{workflow_ref:'Cx300-fh/NBA/.github/workflows/other.yml@refs/heads/main'},{exp:seconds-1},{event_name:'pull_request'}])await assert.rejects(verifyArchiveToken(token({...base,...change}),now,fetcher));
 const parts=token().split('.');parts[2]='A'.repeat(parts[2].length);await assert.rejects(verifyArchiveToken(parts.join('.'),now,fetcher));
});
