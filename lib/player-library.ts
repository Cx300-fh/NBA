import { assetPath } from './site-mode.ts';
import { SEASONS, type Envelope, type StatRow } from './basketball.ts';
import { fetchDataset } from './data-client.ts';
export type FieldSource = { source: string; url: string; updatedAt?: string };
export type PlayerProfile = {
 id:number; name:string; slug:string; active:boolean; directoryMissing?:boolean; teamId:number|null; teamCode:string|null;
 listedTeamId?:number|null; listedTeamCode?:string|null; listedTeamName?:string|null;
 position:string|null; jersey:string|null; height:string|null; heightCm:number|null; weightLb:number|null; weightKg:number|null;
 college:string|null; country:string|null; draftYear:number|null; draftRound:number|null; draftNumber:number|null; undrafted:boolean;
 fromYear:number|null; toYear:number|null; birthDate:string|null; birthPlace:string|null; hometown?:string|null;
 careerPts?:number|null; careerReb?:number|null; careerAst?:number|null;
 sourceUrl?:string; profileUrl?:string; updatedAt?:string; detailUpdatedAt?:string; fieldSources?:Record<string,FieldSource>;
};
export type PlayerIndex = {rows:PlayerProfile[];updatedAt:string;source:string;coverage?:Record<string,number>};
export type ShotZone = {key:string;label:string;FGM:number|null;FGA:number|null;FG_PCT:number|null;aggregated?:boolean;available?:boolean};
export type ShotRow = {PLAYER_ID:number;PLAYER_NAME:string;TEAM_ID:number;zones:ShotZone[]};
export type ShotEnvelope = Omit<Envelope,'rows'> & {rows:ShotRow[]};
export type ArchiveSeason = {season:string;players:Envelope;teams:Envelope;standings:Envelope;bpm:Envelope;shots:ShotEnvelope};
export type Career = {rows:StatRow[];playoffs?:StatRow[];totals?:StatRow;source?:string;url?:string;updatedAt?:string|null;stale?:boolean;warning?:string};
export type ClassicMoment = {id:string;title:string;date:string;season:string;playerId:number;playerName:string;teamIds:number[];competition:string;round:string;score:{awayTeamId:number;homeTeamId:number;away:number;home:number};sourceUrl:string;sourceName:string;videoUrl:string|null;embedUrl:string;watchUrl:string;videoPublisher:string;poster:string;interaction:{question:string;options:string[];answerIndex?:number;explanation:string}};
export const LEGEND_IDS=[893,977,406,1495,77142,1449,165,1717,2548,947,708,959,76375,78049,76003,78497,304];
export const CHINESE_NAMES:Record<number,string>={2544:'勒布朗 詹姆斯',201939:'斯蒂芬 库里',1628983:'谢伊 亚历山大 SGA',1641705:'维克托 文班亚马',1628369:'杰森 塔图姆',1629029:'卢卡 东契奇',203999:'尼古拉 约基奇',203507:'扬尼斯 阿德托昆博 字母哥',1630162:'安东尼 爱德华兹 华子',1628973:'杰伦 布伦森',893:'迈克尔 乔丹',977:'科比 布莱恩特',406:'沙奎尔 奥尼尔',1495:'蒂姆 邓肯',77142:'魔术师 约翰逊',1449:'拉里 伯德',165:'哈基姆 奥拉朱旺',1717:'德克 诺维茨基',2548:'德维恩 韦德',947:'阿伦 艾弗森',708:'凯文 加内特',959:'史蒂夫 纳什',76375:'威尔特 张伯伦',78049:'比尔 拉塞尔',76003:'卡里姆 贾巴尔',78497:'杰里 韦斯特',304:'约翰 斯托克顿',202695:'科怀 伦纳德',201142:'凯文 杜兰特',201935:'詹姆斯 哈登',201566:'拉塞尔 威斯布鲁克',203954:'乔尔 恩比德',1718:'保罗 皮尔斯',951:'雷 阿伦',1503:'特雷西 麦克格雷迪 麦迪',1630595:'凯德 康宁汉姆'};
export const SPOTLIGHT_IDS=[1628983,201939,2544,1641705,1628369,1629029,203999,203507,1630162,1628973,201142,201935,202695,201566,203954,1630595];
export function playerMatches(p:PlayerProfile,q:string){const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[\s'-]/g,'');return normalize(`${p.name} ${CHINESE_NAMES[p.id]||''} ${p.teamCode||''} ${p.country||''}`).includes(normalize(q));}
export function draftLabel(p:PlayerProfile){if(p.undrafted)return '落选秀';if(!p.draftYear)return '未提供';return [p.draftYear,p.draftRound?`第 ${p.draftRound} 轮`:null,p.draftNumber?`第 ${p.draftNumber} 顺位`:null].filter(Boolean).join(' · ');}
export function playerYears(p:PlayerProfile){return p.fromYear?`${p.fromYear}—${p.active?'至今':p.toYear?Number(p.toYear)+1:'—'}`:'未提供';}
export function playerUrl(p:PlayerProfile){return `https://www.nba.com/player/${p.id}/${p.slug||''}`;}
export function shardFor(id:number){if(!Number.isSafeInteger(id)||id<=0)throw Error('无效的球员 ID');return String(id%64).padStart(2,'0');}
const cache=new Map<string,Promise<any>>();
export function loadLibrary<T>(path:string,reload=false):Promise<T>{
 if(!/^(?:player-index\.json|(?:profiles|careers)\/\d{2}\.json|archive\/season-\d{4}-\d{2}\.json)$/.test(path))return Promise.reject(Error('无效的资料请求'));
 const key=assetPath('explore/'+path);if(reload)cache.delete(key);
 let pending=cache.get(key);if(!pending){pending=fetch(key,{cache:'no-cache',signal:AbortSignal.timeout(16000)}).then(async r=>{if(!r.ok)throw Error('资料暂时无法读取，请稍后重试');return r.json()}).catch(e=>{cache.delete(key);throw e});cache.set(key,pending)}
 return pending;
}
export async function loadPlayerProfile(id:number):Promise<PlayerProfile|undefined>{const value=await loadLibrary<{profiles:Record<string,PlayerProfile>}>(`profiles/${shardFor(id)}.json`);return value.profiles?.[id]}
export function mergeCurrentCareer(career:Career|undefined,id:number,current:Envelope,season=SEASONS[0]):Career|undefined{
 const row=current.rows?.find(r=>Number(r.PLAYER_ID)===id&&Number(r.GP)>0);
 // An unavailable live source must not erase a season already present in the archive.
 if(!row&&current.stale)return career?{...career,stale:true,warning:current.warning}:undefined;
 if(!career&&!row)return undefined;
 const rows=(career?.rows||[]).filter(r=>r.SEASON_ID!==season);
 if(row)rows.push({...row,SEASON_ID:season});
 return {...career,rows,source:current.source||career?.source,url:career?.url||`https://www.nba.com/stats/player/${id}/traditional`,updatedAt:current.updatedAt||career?.updatedAt,stale:current.stale,warning:current.warning};
}
export async function loadPlayerCareer(id:number,active=false):Promise<Career|undefined>{
 const file=loadLibrary<{careers:Record<string,Career>}>(`careers/${shardFor(id)}.json`);
 if(!active)return (await file).careers?.[id];
 const [saved,current]=await Promise.allSettled([file,fetchDataset('players',SEASONS[0])]);
 const career=saved.status==='fulfilled'?saved.value.careers?.[id]:undefined;
 if(current.status==='fulfilled')return mergeCurrentCareer(career,id,current.value);
 if(saved.status==='rejected')throw Error('生涯数据暂时无法读取');
 return career?{...career,stale:true,warning:'本赛季数据暂时无法更新'}:undefined;
}
export async function loadArchive(season:string):Promise<ArchiveSeason>{
 const file=loadLibrary<ArchiveSeason>(`archive/season-${season}.json`);
 if(season!==SEASONS[0])return file;
 // Current-season requests always revisit the live service; only historical files stay memoized.
 const [saved,players,shots]=await Promise.allSettled([file,fetchDataset('players',season),fetchDataset('shots',season)]);
 if(saved.status==='rejected'&&players.status==='rejected'&&shots.status==='rejected')throw Error('本赛季数据暂时无法读取');
 const empty:Envelope={rows:[],season,source:'NBA.com',updatedAt:null,stale:true};
 const archive:ArchiveSeason=saved.status==='fulfilled'?saved.value:{season,players:empty,teams:empty,standings:empty,bpm:empty,shots:{...empty,rows:[]}};
 return {...archive,players:players.status==='fulfilled'?players.value:{...archive.players,stale:true,warning:'本赛季数据暂时无法更新'},shots:shots.status==='fulfilled'?shots.value as ShotEnvelope:{...archive.shots,stale:true,warning:'投篮热区暂时无法更新'}};
}
export function playerDefaultSeason(player:Pick<PlayerProfile,'active'|'fromYear'|'toYear'>,seasons=SEASONS){
 if(player.active)return seasons[0];
 return seasons.find(s=>Number(s.slice(0,4))>=(player.fromYear||0)&&Number(s.slice(0,4))<=(player.toYear||0))||(player.toYear?`${player.toYear}-${String(player.toYear+1).slice(-2)}`:seasons[0]);
}
export function challengeEligible(row:StatRow,season:string,metric:string){
 return Number(row.GP)>=(season===SEASONS[0]?1:20)&&Number(row.PTS)>=12&&row[metric]!=null&&Number.isFinite(Number(row[metric]))&&(metric!=='FG3_PCT'||Number(row.FG3A)>0);
}
export function leagueZonePercent(rows:ShotRow[],key:string){let made=0,attempted=0;for(const row of rows){const z=row.zones?.find(z=>z.key===key);if(z?.FGM!=null&&z.FGA!=null&&z.FGA>0){made+=z.FGM;attempted+=z.FGA}}return attempted?made/attempted:null;}
export function zoneDifference(zone:ShotZone,league:number|null){return zone.FGA!=null&&zone.FGA>=10&&zone.FG_PCT!=null&&league!=null?zone.FG_PCT-league:null;}
export function visibleZones(row?:ShotRow){return row?.zones?.filter(z=>!z.aggregated)||[];}
export function makeGuessQuestion(players:PlayerProfile[],random= Math.random){
 const pool=players.filter(p=>(SPOTLIGHT_IDS.includes(p.id)||LEGEND_IDS.includes(p.id))&&p.heightCm&&p.draftYear);
 if(pool.length<4)return null;const answer=pool[Math.min(pool.length-1,Math.floor(random()*pool.length))];const remaining=pool.filter(p=>p.id!==answer.id);
 const options=[answer];while(options.length<4&&remaining.length){const index=Math.min(remaining.length-1,Math.floor(random()*remaining.length));options.push(remaining.splice(index,1)[0]);}
 for(let i=options.length-1;i>0;i--){const j=Math.min(i,Math.floor(random()*(i+1)));[options[i],options[j]]=[options[j],options[i]]}
 return {answer,options};
}
