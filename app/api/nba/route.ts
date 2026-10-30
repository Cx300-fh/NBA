import snapshot from '@/data/snapshot.json';
import currentArchive from '@/data/archive/season-2026-27.json';
import { TEAMS, type Envelope, type Game, type StatRow } from '@/lib/basketball';
import { validateBoxscore } from '@/lib/boxscore';
const seed=snapshot as any;
const memo=new Map<string,{value:Envelope;until:number}>();
const inflight=new Map<string,Promise<Envelope>>();
const PAGES_ORIGIN='https://cx300-fh.github.io';
const MIRROR='https://raw.githubusercontent.com/Cx300-fh/NBA/main/data/live/';
const ESPN_SCOREBOARD='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const SERVICE_ORIGIN='https://courtside-nba-cx300.pastelsong512.chatgpt.site';
const LIVE_RESOURCES=new Set(['scoreboard','boxscore']);
const RESOURCES=new Set(['scoreboard','schedule','boxscore','roster','players','teams','standings','bpm','shots']);
const SEASONS=new Set(['2024-25','2025-26','2026-27']);
const cacheTime=(resource:string)=>LIVE_RESOURCES.has(resource)?15000:resource==='schedule'?120000:300000;
const ZONES:Record<string,[string,string]>={
 'Restricted Area':['restricted','篮下限制区'],'In The Paint (Non-RA)':['paint','禁区（非限制区）'],
 'Mid-Range':['midrange','中距离'],'Left Corner 3':['left-corner','左底角三分'],
 'Right Corner 3':['right-corner','右底角三分'],'Above the Break 3':['above-break','弧顶及两翼三分'],
 Backcourt:['backcourt','后场'],'Corner 3':['corner-total','底角三分合计']
};
function cors(request:Request){
 const origin=request.headers.get('Origin');
 if(origin&&![PAGES_ORIGIN,SERVICE_ORIGIN,new URL(request.url).origin].includes(origin))return null;
 return {'Vary':'Origin','X-Content-Type-Options':'nosniff',...(origin?{'Access-Control-Allow-Origin':origin}:{})} as Record<string,string>;
}

const base={College:'',Conference:'',Country:'',DateFrom:'',DateTo:'',Division:'',DraftPick:'',DraftYear:'',GameScope:'',GameSegment:'',Height:'',LastNGames:'0',LeagueID:'00',Location:'',Month:'0',OpponentTeamID:'0',Outcome:'',PORound:'0',PaceAdjust:'N',PerMode:'PerGame',Period:'0',PlayerExperience:'',PlayerPosition:'',PlusMinus:'N',Rank:'N',SeasonSegment:'',SeasonType:'Regular Season',ShotClockRange:'',StarterBench:'',TeamID:'0',VsConference:'',VsDivision:'',Weight:''};
const KEEP=new Set(['PLAYER_ID','PLAYER_NAME','TEAM_ID','TEAM_ABBREVIATION','TEAM_NAME','GP','W','L','W_PCT','MIN','FGM','FGA','FG_PCT','FG3M','FG3A','FG3_PCT','FTM','FTA','FT_PCT','OREB','DREB','REB','AST','TOV','STL','BLK','PF','PTS','PLUS_MINUS','OFF_RATING','DEF_RATING','NET_RATING','AST_PCT','AST_TO','OREB_PCT','DREB_PCT','REB_PCT','TM_TOV_PCT','EFG_PCT','TS_PCT','USG_PCT','PACE','PIE']);
const ADVANCED_KEYS=new Set(['OFF_RATING','DEF_RATING','NET_RATING','AST_PCT','AST_TO','OREB_PCT','DREB_PCT','REB_PCT','TM_TOV_PCT','EFG_PCT','TS_PCT','USG_PCT','PACE','PIE']);
async function remote(url:string,text=false):Promise<any>{
 const officialStats=/^https:\/\/stats\.(?:nba\.com|wnba\.com|gleague\.nba\.com)\//.test(url);
 const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0',...(officialStats?{'Referer':'https://www.nba.com/','Origin':'https://www.nba.com','Accept':'application/json, text/plain, */*'}:{})},cache:'no-store',signal:AbortSignal.timeout(5000)});
 if(!r.ok)throw Error(`数据源返回 ${r.status}`);return text?r.text():r.json();
}
async function officialStats(endpoint:string,p:Record<string,string>){
 if(p.LeagueID!=='00'||!SEASONS.has(p.Season))throw Error('仅允许受支持赛季的 NBA 数据');
 const path='/stats/'+endpoint+'?'+new URLSearchParams(p);
 const read=async(host:string)=>{
  const data=await remote(host+path),parameters=data?.parameters;
  if(parameters?.LeagueID!=='00'||(parameters.Season??parameters.SeasonYear)!==p.Season)throw Error('官方统计返回了其他联盟或赛季');
  const sets=data.resultSets??data.resultSet,table=Array.isArray(sets)?sets[0]:sets;
  if(!Array.isArray(table?.headers)||!Array.isArray(table?.rowSet))throw Error('官方统计格式发生变化');
  return data;
 };
 try{return await read('https://stats.nba.com')}catch{}
 // These are the league's own Stats services. LeagueID and season are checked before accepting either response.
 return Promise.any(['https://stats.wnba.com','https://stats.gleague.nba.com'].map(read));
}

function toRows(data:any){const s=Array.isArray(data.resultSets)?data.resultSets[0]:data.resultSet;if(!s?.headers||!Array.isArray(s.rowSet))throw Error('数据源格式发生变化');return s.rowSet.map((r:any[])=>Object.fromEntries(s.headers.map((h:string,i:number)=>[h,r[i]])));}
async function stats(endpoint:string,p:Record<string,string>){return toRows(await officialStats(endpoint,p));}
function envelope(rows:StatRow[],url:string,season:string,source='NBA.com'):Envelope{return {rows,source,url,season,updatedAt:new Date().toISOString(),stale:false}}
function norm(s:string){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'')}
function mirrorName(resource:string,season:string,id:string){return ['schedule','scoreboard'].includes(resource)?`${resource}.json`:resource==='boxscore'?`boxscore-${id}.json`:`${resource}-${season}.json`;}
async function mirrored(resource:string,season:string,id:string):Promise<Envelope>{
 const value=await remote(MIRROR+mirrorName(resource,season,id));
 if(!value||typeof value!=='object'||typeof value.updatedAt!=='string'||!Number.isFinite(Date.parse(value.updatedAt))||Date.parse(value.updatedAt)>Date.now()+60000)throw Error('镜像更新时间无效');
 if(value.source!==(resource==='bpm'?'Basketball Reference':'NBA.com'))throw Error('镜像来源不可信');
 if(['schedule','scoreboard'].includes(resource)){
  if(!Array.isArray(value.games))throw Error('镜像赛程格式无效');
  // NBA Cup, All-Star and TBD fixtures can have placeholder teams; retain the real NBA fixtures.
  const games=value.games.filter((g:any)=>/^00\d{8}$/.test(g?.gameId)&&[1,2,3].includes(g.gameStatus)&&Number.isInteger(g.homeTeam?.teamId)&&Number.isInteger(g.awayTeam?.teamId)&&TEAMS[g.homeTeam.teamId]&&TEAMS[g.awayTeam.teamId]&&g.homeTeam.teamId!==g.awayTeam.teamId&&typeof g.gameTimeUTC==='string'&&Number.isFinite(Date.parse(g.gameTimeUTC)));
  if(value.games.length&&!games.length)throw Error('镜像未包含有效 NBA 比赛');
  value.games=games;
 }else if(resource==='boxscore')validateBoxscore(value.game,id);
 else if(!Array.isArray(value.rows)||value.season!==season)throw Error('镜像统计与赛季不匹配');
 const gameResource=LIVE_RESOURCES.has(resource)||resource==='schedule';
 const maxAge=resource==='shots'?2700000:resource==='roster'?7200000:1200000;
 const stale=gameResource||Boolean(value.stale)||Date.now()-Date.parse(value.updatedAt)>maxAge;
 return {...value,stale,...(gameResource?{warning:'官方比赛快照；计划每 5 分钟尝试更新，实际采集时间见 updatedAt。',refreshIntervalSeconds:300}:stale?{warning:value.warning||'官方数据镜像等待更新。'}:{})};
}
async function espnScoreboard(season:string):Promise<Envelope>{
 const [data,schedule]=await Promise.all([remote(ESPN_SCOREBOARD),getCached('schedule',season,'')]);
 if(!Array.isArray(data.events)||!/^\d{4}-\d{2}-\d{2}$/.test(data.day?.date))throw Error('ESPN 比分格式发生变化');
 const aliases:Record<string,string>={GS:'GSW',NY:'NYK',NO:'NOP',SA:'SAS',UTAH:'UTA',WSH:'WAS',PHO:'PHX'};
 const teamIds=new Map(Object.entries(TEAMS).map(([id,team])=>[team.code,Number(id)]));
 const games:Game[]=[];
 for(const event of data.events){
  const competition=event.competitions?.[0],competitors=competition?.competitors;
  if(!Array.isArray(competitors))continue;
  const home=competitors.find((t:any)=>t.homeAway==='home'),away=competitors.find((t:any)=>t.homeAway==='away');
  const idFor=(t:any)=>{const code=String(t?.team?.abbreviation||'').toUpperCase();return teamIds.get(aliases[code]||code)};
  const homeId=idFor(home),awayId=idFor(away),time=Date.parse(competition.date||event.date);
  if(!homeId||!awayId||!Number.isFinite(time))continue;
  const matches=(schedule.games||[]).filter(g=>/^00\d{8}$/.test(g.gameId)&&g.homeTeam.teamId===homeId&&g.awayTeam.teamId===awayId&&Math.abs(Date.parse(g.gameTimeUTC)-time)<=6*3600000);
  // ESPN event ids and NBA game ids are unrelated. Only a unique official fixture may be updated.
  if(matches.length!==1)continue;
  const official=matches[0],status=competition.status||event.status,state=status?.type?.state;
  const gameStatus=status?.type?.completed?3:state==='in'?2:state==='pre'?1:0;
  if(!gameStatus||official.gameStatus===3&&gameStatus!==3)continue;
  const score=(team:any)=>gameStatus===1?null:typeof team?.score==='string'&&/^\d+$/.test(team.score)?Number(team.score):Number.isInteger(team?.score)&&team.score>=0?team.score:null;
  const homeScore=score(home),awayScore=score(away);
  if(gameStatus>1&&(homeScore===null||awayScore===null)||gameStatus===3&&homeScore===awayScore)continue;
  const sourceUrl=(event.links||[]).find((link:any)=>typeof link.href==='string'&&link.href.startsWith('https://www.espn.com/')&&link.rel?.includes('summary'))?.href||`https://www.espn.com/nba/game/_/gameId/${encodeURIComponent(String(event.id))}`;
  games.push({...official,gameStatus,gameStatusText:status.type.shortDetail||status.type.description||'',homeTeam:{...official.homeTeam,score:homeScore},awayTeam:{...official.awayTeam,score:awayScore},source:'ESPN',url:sourceUrl} as Game);
 }
 if(data.events.length&&!games.length)throw Error('ESPN 比赛暂未与 NBA 官方赛程匹配');
 return {games,gameDate:data.day.date,source:'ESPN',url:games.length===1?(games[0] as any).url:'https://www.espn.com/nba/scoreboard',updatedAt:new Date().toISOString(),stale:false};
}
async function load(resource:string,season:string,id:string):Promise<Envelope>{
 if(resource==='scoreboard'){
  try{return await espnScoreboard(season)}catch{}
  const d=await remote('https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json');
  if(!Array.isArray(d.scoreboard?.games)||!/^\d{4}-\d{2}-\d{2}$/.test(d.scoreboard.gameDate))throw Error('实时比分格式发生变化');
  return {...d.scoreboard,source:'NBA.com',url:'https://www.nba.com/games',updatedAt:new Date().toISOString(),stale:false};
 }
 if(resource==='schedule'){const d=(await remote('https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json')).leagueSchedule;if(!Array.isArray(d?.gameDates)||!d.gameDates.length)throw Error('赛程格式发生变化');return {games:d.gameDates.flatMap((day:any)=>day.games.map((g:any)=>({gameId:g.gameId,gameStatus:g.gameStatus,gameStatusText:g.gameStatusText,gameTimeUTC:g.gameDateTimeUTC,homeTeam:g.homeTeam,awayTeam:g.awayTeam,arenaName:g.arenaName,gameLabel:g.gameLabel}))),season:d.seasonYear,updatedAt:new Date().toISOString(),source:'NBA.com',url:'https://www.nba.com/schedule',stale:false};}
 if(resource==='boxscore'){const d=await remote(`https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${id}.json`);return {game:validateBoxscore(d.game,id),source:'NBA.com',url:`https://www.nba.com/game/${id}/box-score`,updatedAt:new Date().toISOString(),stale:false};}
 if(resource==='roster')return envelope(await stats('commonallplayers',{LeagueID:'00',Season:season,IsOnlyCurrentSeason:'1'}),'https://www.nba.com/players',season);
 if(resource==='standings')return envelope(await stats('leaguestandingsv3',{LeagueID:'00',Season:season,SeasonType:'Regular Season'}),`https://www.nba.com/standings?Season=${season}`,season);
 if(resource==='players'||resource==='teams'){
  const endpoint=resource==='players'?'leaguedashplayerstats':'leaguedashteamstats';
  const [basic,advanced]=await Promise.allSettled([
   stats(endpoint,{...base,Season:season,MeasureType:'Base'}),
   stats(endpoint,{...base,Season:season,MeasureType:'Advanced'})
  ]);
  if(basic.status==='rejected')throw basic.reason;
  const b=basic.value,a=advanced.status==='fulfilled'?advanced.value:[];
  const key=resource==='players'?'PLAYER_ID':'TEAM_ID';
  const index=new Map(a.map((r:StatRow)=>[r[key],Object.fromEntries(Object.entries(r).filter(([k])=>ADVANCED_KEYS.has(k)))]));
  const value=envelope(b.map((r:StatRow)=>Object.fromEntries(Object.entries({...r,...(index.get(r[key]) as object||{})}).filter(([k])=>KEEP.has(k)))),`https://www.nba.com/stats/${resource}/traditional?Season=${season}`,season);
  return {...value,...(advanced.status==='rejected'||b.length>0&&a.length===0?{warning:'高阶统计暂不可用，基础数据已更新。'}:{})};

 }
 if(resource==='shots'){
  const data=await officialStats('leaguedashplayershotlocations',{...base,Season:season,DistanceRange:'By Zone',PerMode:'Totals',MeasureType:'Base'});
  const sets=data.resultSets??data.resultSet,table=Array.isArray(sets)?sets[0]:sets;
  const groups=table?.headers?.[0],columns=table?.headers?.[1];
  if(!Array.isArray(groups?.columnNames)||!Array.isArray(columns?.columnNames)||!Number.isInteger(groups.columnsToSkip)||!Number.isInteger(groups.columnSpan)||groups.columnSpan<3||!Array.isArray(table.rowSet))throw Error('官方投篮区域格式发生变化');
  const skip=groups.columnsToSkip,span=groups.columnSpan;
  const rows=table.rowSet.map((values:any[])=>{
   const identity=Object.fromEntries(columns.columnNames.slice(0,skip).map((key:string,index:number)=>[key,values[index]]));
   const zones=groups.columnNames.flatMap((label:string,index:number)=>{
    const definition=ZONES[label];if(!definition)return [];
    const [key,translated]=definition,[made,attempted,pct]=values.slice(skip+index*span,skip+index*span+3);
    const valid=Number.isFinite(made)&&Number.isFinite(attempted)&&made>=0&&attempted>=made;
    return [{key,label:translated,FGM:valid?made:null,FGA:valid?attempted:null,FG_PCT:valid&&attempted>0&&Number.isFinite(pct)?pct:null,...(!valid?{available:false}:{}),...(key==='corner-total'?{aggregated:true}:{})}];
   });
   return {...Object.fromEntries(Object.entries(identity).filter(([k])=>['PLAYER_ID','PLAYER_NAME','TEAM_ID','TEAM_ABBREVIATION'].includes(k))),zones};
  }).filter((r:any)=>Number.isFinite(r.PLAYER_ID)&&r.zones.some((z:any)=>z.available!==false));
  return envelope(rows,`https://www.nba.com/stats/players/shooting?Season=${season}&DistanceRange=By+Zone&PerMode=Totals`,season);
 }
 if(resource==='bpm'){
  const url=`https://www.basketball-reference.com/leagues/NBA_${Number(season.slice(0,4))+1}_advanced.html`;const html=await remote(url,true) as string;const players=await getCached('players',season,'');const index=new Map((players.rows||[]).map(r=>[norm(r.PLAYER_NAME),r]));const rows:StatRow[]=[];
  for(const tr of html.match(/<tr\b[\s\S]*?<\/tr>/g)||[]){const cells:Record<string,string>={};for(const m of tr.matchAll(/<t[dh][^>]*data-stat="([^"]+)"[^>]*>([\s\S]*?)<\/t[dh]>/g))cells[m[1]]=m[2].replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').trim();const p=index.get(norm(cells.name_display||cells.player||''));if(p&&cells.bpm&&Number.isFinite(Number(cells.bpm))){const row:StatRow={PLAYER_ID:p.PLAYER_ID,PLAYER_NAME:p.PLAYER_NAME,TEAM_ID:p.TEAM_ID,TEAM_ABBREVIATION:p.TEAM_ABBREVIATION};for(const k of ['bpm','obpm','dbpm','vorp','per','ws'])if(cells[k])row[k.toUpperCase()]=Number(cells[k]);rows.push(row);}}
  if(!rows.length)throw Error('BPM 数据暂不可读取');return envelope([...new Map(rows.reverse().map(r=>[r.PLAYER_ID,r])).values()],url,season,'Basketball Reference');
 }
 throw Error('未知数据集');
}
function fallback(resource:string,season:string,id:string):Envelope|undefined{if(resource==='shots'&&season==='2026-27')return currentArchive.shots;return resource==='boxscore'?seed.boxes[id]:['players','teams','standings','bpm'].includes(resource)?seed.seasons[season]?.[resource]:seed[resource];}
async function getCached(resource:string,season:string,id:string):Promise<Envelope>{
 // Scores and the current schedule do not vary with the statistics season selector.
 const key=[resource,['scoreboard','schedule','boxscore'].includes(resource)?'':season,id].join(':');
 const hit=memo.get(key);if(hit&&hit.until>Date.now())return hit.value;const pending=inflight.get(key);if(pending)return pending;
 const backup=fallback(resource,season,id);
 const timestamp=(value:Envelope|undefined)=>value?.updatedAt&&Number.isFinite(Date.parse(value.updatedAt))?Date.parse(value.updatedAt):-Infinity;
 const retained=timestamp(hit?.value)>=timestamp(backup)?hit?.value||backup:backup;
 const remember=(value:Envelope,ttl:number)=>{
  if(memo.size>=96&&!memo.has(key))memo.delete(memo.keys().next().value!);
  memo.set(key,{value,until:Date.now()+ttl});return value;
 };
 const promise=(async()=>{
  try{
   const value=await load(resource,season,id),previous=retained;
   if(Array.isArray(value.rows)&&value.rows.length===0&&previous?.rows?.length)throw Error('官方统计暂未完整返回，保留上次核对的数据。');
   return remember(value,cacheTime(resource));
  }
  catch(error){
   try{
    const value=await mirrored(resource,season,id);
    const previous=retained;
    if(timestamp(value)<timestamp(previous))throw Error('保留更新时间更近的已核对数据');
    if(Array.isArray(value.rows)&&!value.rows.length&&previous?.rows?.length)throw Error('镜像统计暂未完整返回');
    return remember(value,LIVE_RESOURCES.has(resource)?15000:30000);
   }catch{}
   const previous=retained;
   // Preserve the verified snapshot's timestamp. A failed attempt is never a fresh update.
   const value={...(previous||{rows:[],source:resource==='bpm'?'Basketball Reference':'NBA.com',season,updatedAt:null}),stale:true,warning:resource==='bpm'?'Basketball Reference 暂时拒绝自动请求。':String(error instanceof Error?error.message:error),attemptedAt:new Date().toISOString()};
   return remember(value,LIVE_RESOURCES.has(resource)?15000:30000);
  }finally{inflight.delete(key)}
 })();inflight.set(key,promise);return promise;
}
export async function OPTIONS(request:Request){
 const headers=cors(request);if(!headers)return Response.json({error:'来源不被允许'},{status:403});
 const method=request.headers.get('Access-Control-Request-Method');
 const requestedHeaders=(request.headers.get('Access-Control-Request-Headers')||'').toLowerCase().split(',').map(v=>v.trim()).filter(Boolean);
 if(method&&method!=='GET'||requestedHeaders.some(v=>!['accept','content-type'].includes(v)))return Response.json({error:'不支持此请求'},{status:403,headers});
 return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Accept, Content-Type','Access-Control-Max-Age':'86400'}});
}
export async function GET(request:Request){
 const headers=cors(request);if(!headers)return Response.json({error:'来源不被允许'},{status:403});
 const u=new URL(request.url),resource=u.searchParams.get('resource')||'scoreboard',season=u.searchParams.get('season')||'2026-27',id=u.searchParams.get('id')||'';
 if(!RESOURCES.has(resource)||!SEASONS.has(season)||(resource==='boxscore'?!/^00\d{8}$/.test(id):Boolean(id)))return Response.json({error:'无效的请求参数'},{status:400,headers});
 const data=await getCached(resource,season,id);
 return Response.json(data,{headers:{...headers,'Cache-Control':'public, max-age=0, must-revalidate'}});
}
