import {readFile,writeFile,mkdir,readdir,rm,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=async path=>JSON.parse(await readFile(root+path,'utf8'));
const target=root+'public/explore';
await rm(target,{recursive:true,force:true});
for(const dir of ['','profiles','careers','archive'])await mkdir(target+(dir?'/'+dir:''),{recursive:true});
const index=await read('data/player-index.json');const details=await read('data/player-profiles.json');const archiveIndex=await read('data/archive/index.json');const snapshot=await read('data/snapshot.json');
const fields=['id','name','slug','active','directoryMissing','teamId','teamCode','listedTeamId','listedTeamCode','listedTeamName','position','jersey','height','heightCm','weightLb','weightKg','college','country','draftYear','draftRound','draftNumber','undrafted','fromYear','toYear','birthDate','birthPlace','hometown','careerPts','careerReb','careerAst','profileUrl','sourceUrl','updatedAt','detailUpdatedAt','fieldSources'];
const slim=(p,full=false)=>Object.fromEntries(fields.filter(key=>(full||!['fieldSources','sourceUrl'].includes(key))&&p[key]!==undefined).map(key=>[key,p[key]]));
const combined=index.rows.map(p=>({...p,...details.profiles?.[p.id]}));
await writeFile(target+'/player-index.json',JSON.stringify({rows:combined.map(p=>slim(p)),source:index.source,updatedAt:details.updatedAt||index.updatedAt,coverage:details.coverage}));
const profiles=Array.from({length:64},()=>({profiles:{},source:'NBA.com / ESPN',updatedAt:details.updatedAt||index.updatedAt}));
for(const p of combined)profiles[p.id%64].profiles[p.id]=slim(p,true);
const careers=new Map();
const statKeys=['SEASON_ID','PLAYER_ID','PLAYER_NAME','TEAM_ID','TEAM_ABBREVIATION','TEAM_NAME','GP','MIN','PTS','REB','AST','STL','BLK','TOV','FG_PCT','FG3_PCT','FT_PCT','TS_PCT','OFF_RATING','DEF_RATING','NET_RATING'];
for(const entry of archiveIndex.seasons){
 const path=`data/archive/season-${entry.season}.json`;let season;
 try{season=await read(path)}catch{continue}
 if(snapshot.seasons[entry.season])season={...season,...snapshot.seasons[entry.season]};
 const codes=new Map((season.players?.rows||[]).filter(r=>r.TEAM_ID&&r.TEAM_ABBREVIATION).map(r=>[r.TEAM_ID,r.TEAM_ABBREVIATION]));
 season.teams={...season.teams,rows:(season.teams?.rows||[]).map(r=>({...r,TEAM_ABBREVIATION:r.TEAM_ABBREVIATION||codes.get(r.TEAM_ID)||''}))};
 season.standings={...season.standings,rows:(season.standings?.rows||[]).map(r=>({...r,TeamAbbreviation:r.TeamAbbreviation||codes.get(r.TeamID)||''}))};
 await writeFile(target+`/archive/season-${entry.season}.json`,JSON.stringify(season));
 for(const row of season.players?.rows||[]){if(!Number.isSafeInteger(row.PLAYER_ID)||row.GP<=0)continue;const value={...row,SEASON_ID:entry.season};const normalized=Object.fromEntries(statKeys.filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));const hit=careers.get(row.PLAYER_ID)||{rows:[],source:'NBA.com',url:`https://www.nba.com/stats/player/${row.PLAYER_ID}/traditional`,updatedAt:season.players.updatedAt};hit.rows.push(normalized);careers.set(row.PLAYER_ID,hit)}
}
for(const file of await readdir(root+'data/careers')){
 if(!/^\d+\.json$/.test(file))continue;const id=Number(file.split('.')[0]);const full=await read('data/careers/'+file);if(Array.isArray(full.rows)&&full.rows.length)careers.set(id,full);
}
const careerShards=Array.from({length:64},()=>({careers:{}}));
for(const [id,career] of careers){career.rows.sort((a,b)=>String(a.SEASON_ID).localeCompare(String(b.SEASON_ID)));careerShards[id%64].careers[id]=career}
for(let n=0;n<64;n++){const key=String(n).padStart(2,'0');await writeFile(target+`/profiles/${key}.json`,JSON.stringify(profiles[n]));await writeFile(target+`/careers/${key}.json`,JSON.stringify(careerShards[n]))}
console.log(`Player library: ${combined.length} profiles, ${careers.size} career paths, ${archiveIndex.seasons.length} archive seasons.`);
