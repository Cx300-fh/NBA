import { DIMENSIONS, type Observation } from './basketball.ts';
export const STORAGE_KEY='courtside.notebook.v1';
export type Notebook={observations:Record<string,Observation>;watchedGames:Record<string,boolean>};
export function parseNotebook(raw:unknown):Notebook{
 const value=raw as any;if(!value||value.format!=='courtside-notebook'||value.version!==1||!Array.isArray(value.observations)||value.observations.length>5000)throw Error('请选择 COURTSIDE 导出的有效观赛手记文件。');
 const observations:Record<string,Observation>={};
 for(const row of value.observations){
  if(!row||!/^00\d{8}$/.test(row.gameId)||!Number.isSafeInteger(row.playerId)||row.playerId<=0||typeof row.playerName!=='string'||typeof row.notes!=='string'||row.notes.length>20000||!Array.isArray(row.moments)||row.moments.length>200||!Array.isArray(row.focus)||!row.ratings||typeof row.ratings!=='object'||!Number.isFinite(Date.parse(row.updatedAt)))throw Error('文件中的球员记录格式不正确。');
  const ratings:Record<string,number>={};for(const d of DIMENSIONS){const n=row.ratings[d.key];if(n!==undefined&&(!Number.isInteger(n)||n<1||n>10))throw Error('评分必须是 1–10 的整数。');if(n!==undefined)ratings[d.key]=n;}
  const moments=row.moments.map((m:any)=>{if(!m||typeof m.text!=='string'||m.text.length>2000||!['Q1','Q2','Q3','Q4','OT','OT2','OT3'].includes(m.period)||!/^([0-9]|1[0-2]):[0-5]\d$/.test(m.clock))throw Error('回合记录格式不正确。');return {id:String(m.id).slice(0,100),period:m.period,clock:m.clock,text:m.text};});
  observations[`${row.gameId}:${row.playerId}`]={gameId:row.gameId,playerId:row.playerId,playerName:row.playerName.slice(0,100),teamId:Number(row.teamId)||0,date:String(row.date||'').slice(0,10),matchup:String(row.matchup||'').slice(0,100),ratings,focus:row.focus.filter((f:unknown)=>typeof f==='string'&&DIMENSIONS.some(d=>d.key===f)),notes:row.notes,moments,updatedAt:row.updatedAt,watched:!!row.watched};
 }
 const watchedGames:Record<string,boolean>={};for(const [id,v] of Object.entries(value.watchedGames||{}))if(/^00\d{8}$/.test(id)&&v===true)watchedGames[id]=true;
 return {observations,watchedGames};
}
export function exportNotebook(n:Notebook){return {format:'courtside-notebook',version:1,exportedAt:new Date().toISOString(),observations:Object.values(n.observations),watchedGames:n.watchedGames}}
