import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { emptyMonth, gamePhase, predictionMonth, type Prediction, type PredictionMonth } from './predictions.ts';
import { beijingDate, SEASONS, type Game } from './basketball.ts';
export const ACCOUNT_ORIGIN='https://courtside-nba-cx300.pastelsong512.chatgpt.site';
export const PAGES_ORIGIN='https://cx300-fh.github.io';
export const ARCHIVE_AUDIENCE='courtside-prediction-archive';
const GITHUB_ISSUER='https://token.actions.githubusercontent.com';
const ARCHIVE_SUBJECT='repo:Cx300-fh@193564111/NBA@1426730723:ref:refs/heads/main';
const ARCHIVE_WORKFLOW='Cx300-fh/NBA/.github/workflows/archive-account-picks.yml@refs/heads/main';
const SESSION_DAYS=30;
const SCRYPT={N:32768,r:8,p:3,maxmem:48*1024*1024};
class ApiError extends Error {status:number;constructor(status:number,message:string){super(message);this.status=status}}
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
export function normalizedUsername(value:unknown){
 if(typeof value!=='string')throw new ApiError(400,'请输入用户名');
 const username=value.normalize('NFKC').trim();
 if(!/^[\p{L}\p{N}_-]{3,24}$/u.test(username))throw new ApiError(400,'用户名为 3–24 位，可用中文、字母、数字、下划线');
 return {username,key:username.toLowerCase()};
}
function validPassword(value:unknown):asserts value is string{
 if(typeof value!=='string'||value.length<10||value.length>128)throw new ApiError(400,'密码需要 10–128 位');
}
let hashQueue:Promise<unknown>=Promise.resolve();let queuedHashes=0;
function derive(password:string,salt:string):Promise<Buffer>{
 if(queuedHashes>=8)return Promise.reject(new ApiError(503,'登录繁忙，请稍后重试'));
 queuedHashes++;
 const task=hashQueue.then(()=>new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,32,SCRYPT,(e,key)=>e?reject(e):resolve(key))));
 hashQueue=task.catch(()=>{}).finally(()=>{queuedHashes--});return task;
}
export async function passwordHash(password:string){const salt=randomBytes(16).toString('hex');return `scrypt:32768:8:3:${salt}:${(await derive(password,salt)).toString('hex')}`;}
export async function passwordMatches(password:string,encoded:string){
 const parts=encoded.split(':');
 if(parts.length!==6||parts.slice(0,4).join(':')!=='scrypt:32768:8:3'||!/^[a-f0-9]{32}$/.test(parts[4])||!/^[a-f0-9]{64}$/.test(parts[5]))return false;
 return timingSafeEqual(await derive(password,parts[4]),Buffer.from(parts[5],'hex'));
}
type AccountRow={id:string;username:string;created_at:string;password_hash:string};
type PickRow={user_id:string;game_id:string;month:string;game_time_utc:string;home_team_id:number;away_team_id:number;picked_team_id:number;created_at:string;updated_at:string;result_json:string|null};
function publicUser(row:AccountRow){return {id:row.id,username:row.username,createdAt:row.created_at};}
function toPick(row:PickRow):Prediction{return {gameId:row.game_id,gameTimeUTC:row.game_time_utc,homeTeamId:row.home_team_id,awayTeamId:row.away_team_id,pickedTeamId:row.picked_team_id,createdAt:row.created_at,updatedAt:row.updated_at,...(row.result_json?{result:JSON.parse(row.result_json)}:{})};}
function monthParam(url:URL){const month=url.searchParams.get('month')||'';if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw new ApiError(400,'无效的月份');return month;}
async function body(request:Request){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new ApiError(415,'请使用 JSON 请求');
 if(Number(request.headers.get('content-length')||0)>8192)throw new ApiError(413,'请求过大');
 const reader=request.body?.getReader();if(!reader)throw new ApiError(400,'请求不能为空');
 let total=0;const chunks:Uint8Array[]=[];
 while(true){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>8192){await reader.cancel();throw new ApiError(413,'请求过大')}chunks.push(value);}
 const bytes=new Uint8Array(total);let i=0;for(const c of chunks){bytes.set(c,i);i+=c.length}
 try{const v=JSON.parse(new TextDecoder().decode(bytes));if(!v||typeof v!=='object'||Array.isArray(v))throw Error();return v as Record<string,unknown>}catch{throw new ApiError(400,'无效的请求内容')}
}
let scheduleMemo:{games:Game[];until:number}|undefined;
const SCHEDULE_MIRROR='https://raw.githubusercontent.com/Cx300-fh/NBA/main/data/live/schedule.json';
const SCHEDULE_MAX_AGE=15*60000;
function seasonAt(time:string){const date=new Date(time);if(!Number.isFinite(date.getTime()))return '';const year=date.getUTCFullYear()-(date.getUTCMonth()<6?1:0);return `${year}-${String((year+1)%100).padStart(2,'0')}`;}
function verifiedSchedule(games:unknown,season:string):Game[]{
 if(!Array.isArray(games)||!games.length||season!==SEASONS[0])throw Error('赛程格式不正确');
 const ids=new Set<string>();const verified:Game[]=[];
 for(const raw of games){
  if(!raw||typeof raw!=='object'||typeof raw.gameId!=='string'||!/^00\d{8}$/.test(raw.gameId)||raw.gameId.slice(3,5)!==season.slice(2,4)||ids.has(raw.gameId))throw Error('赛程比赛标识不正确');
  ids.add(raw.gameId);
  // NBA Cup placeholders have no teams or fixed start time yet and cannot accept picks.
  const team=(value:any)=>value&&Number.isInteger(value.teamId)&&value.teamId>=1610612737&&value.teamId<=1610612766;
  if(!team(raw.homeTeam)||!team(raw.awayTeam))continue;
  const time=raw.gameDateTimeUTC||raw.gameTimeUTC;
  if(typeof time!=='string'||!Number.isFinite(Date.parse(time)))continue;
  if(raw.homeTeam.teamId===raw.awayTeam.teamId||![1,2,3].includes(raw.gameStatus)||seasonAt(time)!==season)throw Error('赛程时间或球队不正确');
  for(const value of [raw.homeTeam.score,raw.awayTeam.score])if(value!=null&&(!Number.isInteger(value)||value<0||value>500))throw Error('比分格式不正确');
  verified.push({gameId:raw.gameId,gameStatus:raw.gameStatus,gameStatusText:typeof raw.gameStatusText==='string'?raw.gameStatusText:'',gameTimeUTC:time,homeTeam:raw.homeTeam,awayTeam:raw.awayTeam});
 }
 if(!verified.length)throw Error('赛程没有可核对的比赛');return verified;
}
export async function officialSchedule(fresh=false,options:{now?:()=>number;fetcher?:typeof fetch}={}):Promise<Game[]>{
 const now=options.now||Date.now,fetcher=options.fetcher||fetch;
 if(!fresh&&!options.fetcher&&scheduleMemo&&scheduleMemo.until>now())return scheduleMemo.games;
 let games:Game[];let verifiedUntil=now()+60000;
 try{
  const r=await fetcher('https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json',{signal:AbortSignal.timeout(5000),cache:'no-store',redirect:'error'});
  if(!r.ok)throw Error('NBA赛程暂不可用');
  const data=await r.json() as any;if(!Array.isArray(data.leagueSchedule?.gameDates))throw Error('NBA赛程格式不正确');
  games=verifiedSchedule(data.leagueSchedule.gameDates.flatMap((day:any)=>Array.isArray(day.games)?day.games:[]),data.leagueSchedule.seasonYear);
 }catch{
  try{
   const r=await fetcher(SCHEDULE_MIRROR,{signal:AbortSignal.timeout(5000),cache:'no-store',redirect:'error'});
   if(!r.ok)throw Error('赛程备份暂不可用');
   const data=await r.json() as any,updated=Date.parse(data.updatedAt||'');
   if(data.source!=='NBA.com'||data.stale!==false||!Number.isFinite(updated)||updated>now()+60000||now()-updated>SCHEDULE_MAX_AGE)throw Error('赛程备份已过期');
   games=verifiedSchedule(data.games,data.season);verifiedUntil=Math.min(verifiedUntil,updated+SCHEDULE_MAX_AGE);
  }catch{throw new ApiError(503,'赛程核对暂不可用，请稍后重试')}
 }
 if(!options.fetcher)scheduleMemo={games,until:Math.min(verifiedUntil,now()+60000)};return games;
}
let githubKeys:{keys:JsonWebKey[];until:number}|undefined;
export async function verifyArchiveToken(token:string,now=Date.now(),fetcher:typeof fetch=fetch){
 try{
  if(token.length>16000)throw Error();const parts=token.split('.');if(parts.length!==3)throw Error();
  const header=JSON.parse(Buffer.from(parts[0],'base64url').toString());const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString());const seconds=Math.floor(now/1000);
  if(header.alg!=='RS256'||typeof header.kid!=='string'||claims.iss!==GITHUB_ISSUER||claims.aud!==ARCHIVE_AUDIENCE||claims.repository!=='Cx300-fh/NBA'||claims.ref!=='refs/heads/main'||claims.workflow_ref!==ARCHIVE_WORKFLOW||claims.sub!==ARCHIVE_SUBJECT||String(claims.repository_id)!=='1426730723'||String(claims.repository_owner_id)!=='193564111'||!['schedule','workflow_dispatch','push'].includes(claims.event_name)||!Number.isFinite(claims.exp)||claims.exp<=seconds||claims.exp>seconds+900||!Number.isFinite(claims.iat)||claims.iat>seconds+30||claims.iat<seconds-900||!Number.isFinite(claims.nbf)||claims.nbf>seconds+30)throw Error();
  const keys=async(force=false)=>{if(force||!githubKeys||githubKeys.until<now){const r=await fetcher(GITHUB_ISSUER+'/.well-known/jwks',{signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error();const v=await r.json() as any;if(!Array.isArray(v.keys))throw Error();githubKeys={keys:v.keys,until:now+3600000}}return githubKeys.keys};
  let key=(await keys()).find((k:any)=>k.kid===header.kid);if(!key)key=(await keys(true)).find((k:any)=>k.kid===header.kid);if(!key)throw Error();
  const cryptoKey=await crypto.subtle.importKey('jwk',key,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',cryptoKey,Buffer.from(parts[2],'base64url'),new TextEncoder().encode(parts[0]+'.'+parts[1])))throw Error();
 }catch{throw new ApiError(401,'归档授权无效')}
}
export function createAccountHandler(db:D1Database|undefined,options:{now?:()=>number;schedule?:(fresh:boolean)=>Promise<Game[]>;verifyArchive?:(token:string,now:number)=>Promise<void>;origins?:string[]}={}){
 const now=options.now||Date.now;const schedule=options.schedule||officialSchedule;
 const query=(sql:string,...params:any[])=>{if(!db)throw new ApiError(503,'账号服务正在准备，请稍后重试');return db.prepare(sql).bind(...params)};
 const rate=async(key:string,limit:number,windowMs:number)=>{
  const start=Math.floor(now()/windowMs)*windowMs;
  const row=await query('INSERT INTO account_rate_limits (key,window_start,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start=excluded.window_start THEN count+1 ELSE 1 END,window_start=excluded.window_start RETURNING count',key,start).first<{count:number}>();
  if(row&&row.count>limit)throw new ApiError(429,'尝试过于频繁，请稍后再试');
 };
 const session=async(request:Request)=>{
  const token=request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if(!token)throw new ApiError(401,'请先登录');
  const hash=sha(token);const row=await query('SELECT a.id,a.username,a.created_at,a.password_hash FROM account_sessions s JOIN accounts a ON a.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',hash,now()).first<AccountRow>();
  if(!row)throw new ApiError(401,'登录已过期，请重新登录');return {row,hash};
 };
 const newSession=async(row:AccountRow)=>{
  const token=randomBytes(32).toString('base64url');const expiresAt=now()+SESSION_DAYS*86400000;
  await query('INSERT INTO account_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)',sha(token),row.id,expiresAt,now()).run();
  return {user:publicUser(row),token,expiresAt};
 };
 const settle=async(rows:PickRow[])=>{
  const pending=rows.filter(r=>!r.result_json&&Date.parse(r.game_time_utc)<now());if(!pending.length)return rows;
  let games:Game[];try{games=await schedule(false)}catch{return rows}
  const byId=new Map(games.map(g=>[g.gameId,g]));
  const statements:D1PreparedStatement[]=[];
  for(const row of pending){const game=byId.get(row.game_id);if(!game||game.gameStatus!==3||game.homeTeam.teamId!==row.home_team_id||game.awayTeam.teamId!==row.away_team_id||!Number.isFinite(Date.parse(game.gameTimeUTC))||Date.parse(game.gameTimeUTC)>=now()||seasonAt(game.gameTimeUTC)!==seasonAt(row.game_time_utc)||beijingDate(game.gameTimeUTC)!==beijingDate(row.game_time_utc)||game.homeTeam.score==null||game.awayTeam.score==null||!Number.isInteger(game.homeTeam.score)||!Number.isInteger(game.awayTeam.score)||game.homeTeam.score===game.awayTeam.score||game.homeTeam.score<0||game.awayTeam.score<0)continue;
   row.result_json=JSON.stringify({winnerTeamId:game.homeTeam.score>game.awayTeam.score?row.home_team_id:row.away_team_id,homeScore:game.homeTeam.score,awayScore:game.awayTeam.score,settledAt:new Date(now()).toISOString()});
   statements.push(query('UPDATE account_predictions SET result_json=? WHERE user_id=? AND game_id=? AND result_json IS NULL',row.result_json,row.user_id,row.game_id));
  }
  for(let i=0;i<statements.length;i+=80)await db!.batch(statements.slice(i,i+80));return rows;
 };
 const monthFile=async(userId:string,month:string):Promise<PredictionMonth>=>{
  const result=await query('SELECT * FROM account_predictions WHERE user_id=? AND month=? ORDER BY game_time_utc,game_id',userId,month).all<PickRow>();const rows=await settle(result.results||[]);
  return {...emptyMonth(month),updatedAt:rows.length?rows.map(r=>r.updated_at).sort().at(-1)!:null,predictions:rows.map(toPick)};
 };
 return async(request:Request):Promise<Response>=>{
  const origin=request.headers.get('Origin');const url=new URL(request.url);const allowed=options.origins||[PAGES_ORIGIN,ACCOUNT_ORIGIN];
  const headers:Record<string,string>={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Origin'};
  if(origin&&(allowed.includes(origin)||origin===url.origin)){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Methods']='GET, POST, OPTIONS';headers['Access-Control-Allow-Headers']='Authorization, Content-Type';headers['Access-Control-Max-Age']='600'}
  const json=(v:unknown,status=200)=>Response.json(v,{status,headers});
  try{
   if(origin&&!headers['Access-Control-Allow-Origin'])throw new ApiError(403,'不允许的来源');
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
   const path=url.pathname.split('/api/account/')[1]?.replace(/\/$/,'')||'';
   if(path==='health'&&request.method==='GET'){if(!db)return json({ready:false,version:1},503);await query('SELECT id FROM accounts LIMIT 1').all();return json({ready:true,version:1})}
   const ip=sha(request.headers.get('CF-Connecting-IP')||'unknown');
   if(['register','login'].includes(path)&&request.method==='POST'){
    await rate('auth-ip:'+ip,30,15*60000);const b=await body(request);const {username,key}=normalizedUsername(b.username);
    await rate('auth-name:'+sha(key),12,15*60000);validPassword(b.password);
    if(path==='register'){
     await rate('signup:'+ip,5,3600000);
     if(await query('SELECT id FROM accounts WHERE username_key=?',key).first())throw new ApiError(409,'这个用户名已被使用');
     const row:AccountRow={id:randomUUID(),username,created_at:new Date(now()).toISOString(),password_hash:await passwordHash(b.password)};
     try{await query('INSERT INTO accounts(id,username,username_key,password_hash,created_at) VALUES(?,?,?,?,?)',row.id,row.username,key,row.password_hash,row.created_at).run()}catch(e){if(String(e).includes('UNIQUE'))throw new ApiError(409,'这个用户名已被使用');throw e}
     return json(await newSession(row),201);
    }
    const row=await query('SELECT id,username,password_hash,created_at FROM accounts WHERE username_key=?',key).first<AccountRow>();
    // Unknown accounts do the same expensive work as a password mismatch.
    const hash=row?.password_hash||'scrypt:32768:8:3:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000';
    if(!await passwordMatches(b.password,hash)||!row)throw new ApiError(401,'用户名或密码不正确');
    await query('DELETE FROM account_sessions WHERE user_id=? AND expires_at<?',row.id,now()).run();
    return json(await newSession(row));
   }
   if(['archive','archive-months'].includes(path)&&request.method==='GET'){
    const token=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';await (options.verifyArchive||verifyArchiveToken)(token,now());
    if(path==='archive-months'){const found=await query('SELECT DISTINCT month FROM account_predictions ORDER BY month').all<{month:string}>();return json({months:found.results.map(row=>row.month)})}
    const month=monthParam(url);const data=await query('SELECT * FROM account_predictions WHERE month=? ORDER BY user_id,game_time_utc,game_id',month).all<PickRow>();const rows=await settle(data.results||[]);
    return json({version:2,month,updatedAt:rows.length?rows.flatMap(r=>[r.updated_at,...(r.result_json?[JSON.parse(r.result_json).settledAt]:[])]).sort().at(-1):null,predictions:rows.map(row=>({participantId:row.user_id,...toPick(row)}))});
   }
   const auth=await session(request);
   if(path==='session'&&request.method==='GET')return json({user:publicUser(auth.row)});
   if(path==='logout'&&request.method==='POST'){await query('DELETE FROM account_sessions WHERE token_hash=?',auth.hash).run();return json({ok:true})}
   if(path==='password'&&request.method==='POST'){
    await rate('password:'+auth.row.id,8,15*60000);const b=await body(request);validPassword(b.password);validPassword(b.oldPassword);
    if(!await passwordMatches(b.oldPassword,auth.row.password_hash))throw new ApiError(400,'当前密码不正确');
    const hash=await passwordHash(b.password);await db!.batch([query('UPDATE accounts SET password_hash=? WHERE id=?',hash,auth.row.id),query('DELETE FROM account_sessions WHERE user_id=?',auth.row.id)]);return json(await newSession(auth.row));
   }
   if(path==='predictions'&&request.method==='GET')return json({file:await monthFile(auth.row.id,monthParam(url))});
   if(path==='predictions'&&request.method==='POST'){
    await rate('picks:'+auth.row.id,90,60000);const b=await body(request);
    if(typeof b.gameId!=='string'||!/^00\d{8}$/.test(b.gameId)||!Number.isInteger(b.pickedTeamId))throw new ApiError(400,'无效的竞猜');
    const game=(await schedule(true)).find(g=>g.gameId===b.gameId);
    if(!game)throw new ApiError(400,'未找到这场比赛');
    if(gamePhase(game,now())!=='upcoming')throw new ApiError(409,'比赛已封盘，不能新增或更改竞猜');
    if(![game.homeTeam.teamId,game.awayTeam.teamId].includes(Number(b.pickedTeamId)))throw new ApiError(400,'只能选择本场比赛的胜方');
    const month=predictionMonth(game);const timestamp=new Date(now()).toISOString();
    const saved=await query(`INSERT INTO account_predictions(user_id,game_id,month,game_time_utc,home_team_id,away_team_id,picked_team_id,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ? < ? AND CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) < ? ON CONFLICT(user_id,game_id) DO UPDATE SET picked_team_id=excluded.picked_team_id,game_time_utc=excluded.game_time_utc,updated_at=excluded.updated_at WHERE account_predictions.result_json IS NULL AND account_predictions.home_team_id=excluded.home_team_id AND account_predictions.away_team_id=excluded.away_team_id AND ? < ? AND CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) < ?`,auth.row.id,game.gameId,month,game.gameTimeUTC,game.homeTeam.teamId,game.awayTeam.teamId,b.pickedTeamId,timestamp,timestamp,now(),Date.parse(game.gameTimeUTC),Date.parse(game.gameTimeUTC),now(),Date.parse(game.gameTimeUTC),Date.parse(game.gameTimeUTC)).run();
    if(!saved.meta.changes)throw new ApiError(409,'竞猜已封盘或赛程已发生变化');
    return json({file:await monthFile(auth.row.id,month)});
   }
   throw new ApiError(404,'接口不存在');
  }catch(error){return json({error:error instanceof ApiError?error.message:'服务暂时不可用，请稍后重试'},error instanceof ApiError?error.status:503)}
 };
}
