import { STATIC_PAGES, assetPath } from './site-mode.ts';
import type { Envelope, Game } from './basketball.ts';
import { validateBoxscore } from './boxscore.ts';
import archiveIndex from '../data/archive/index.json' with {type:'json'};
import service from '../data/nba-service.json' with {type:'json'};
const CURRENT_SEASONS=['2024-25','2025-26','2026-27'];
const RESOURCES = ['players', 'teams', 'standings', 'bpm', 'shots', 'roster', 'schedule', 'scoreboard', 'boxscore'];
const SEASONS = [...CURRENT_SEASONS,...archiveIndex.seasons.map(s=>s.season)];
export function staticDataPath(resource: string, season: string, id = '') {
  if (!RESOURCES.includes(resource) || !SEASONS.includes(season) || (resource === 'boxscore' && !/^00\d{8}$/.test(id))) throw Error('无效的数据请求');
  if (resource==='shots'||(!CURRENT_SEASONS.includes(season)&&['players','teams','standings','bpm'].includes(resource))) return assetPath(`explore/archive/season-${season}.json`);
  if (['players', 'teams', 'standings', 'bpm'].includes(resource)) return assetPath(`data/${resource}-${season}.json`);
  return assetPath(resource === 'boxscore' ? `data/boxscore-${id}.json` : `data/${resource}.json`);
}
export function normalizeScheduledGame(g: any): Game {
  const team = (t: any) => ({ teamId: t.teamId, teamName: t.teamName, teamCity: t.teamCity, teamTricode: t.teamTricode, score: t.score, wins: t.wins, losses: t.losses });
  return { gameId: g.gameId, gameStatus: g.gameStatus, gameStatusText: g.gameStatusText, gameTimeUTC: g.gameDateTimeUTC || g.gameTimeUTC, homeTeam: team(g.homeTeam), awayTeam: team(g.awayTeam), arenaName: g.arenaName || '', gameLabel: g.gameLabel || '' };
}
async function json(url: string, live = false, timeout = live ? 5000 : 12000) {
  const response = await fetch(url, { cache: live ? 'no-store' : 'no-cache', signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw Error(`数据请求失败 (${response.status})`);
  return response.json() as Promise<any>;
}
async function liveDataset(resource: string, id: string): Promise<Envelope> {
  const root = 'https://cdn.nba.com/static/json/';
  const source = { source: 'NBA.com', updatedAt: new Date().toISOString(), stale: false };
  if (resource === 'scoreboard') {
    const d = await json(root + 'liveData/scoreboard/todaysScoreboard_00.json', true);
    if (!Array.isArray(d.scoreboard?.games)) throw Error('比分数据格式异常');
    return { ...d.scoreboard, ...source, url: 'https://www.nba.com/games' };
  }
  if (resource === 'schedule') {
    const d = (await json(root + 'staticData/scheduleLeagueV2_1.json', true)).leagueSchedule;
    if (!Array.isArray(d?.gameDates)) throw Error('赛程数据格式异常');
    return { games: d.gameDates.flatMap((day: any) => day.games.map(normalizeScheduledGame)), season: d.seasonYear, ...source, url: 'https://www.nba.com/schedule' };
  }
  const d = await json(root + `liveData/boxscore/boxscore_${id}.json`, true);
  validateBoxscore(d.game, id);
  return { game: d.game, ...source, url: `https://www.nba.com/game/${id}/box-score` };
}
export async function fetchStaticDataset(resource: string, season: string, id = ''): Promise<Envelope> {
  const path = staticDataPath(resource, season, id);
  const live = ['scoreboard', 'schedule', 'boxscore'].includes(resource);
  if (live) {
    try { return await liveDataset(resource, id); } catch { /* Browser CORS and upstream restrictions must not break the static app. */ }
  }
  const raw = await json(path);
  const result = resource==='shots'||(!CURRENT_SEASONS.includes(season)&&['players','teams','standings','bpm'].includes(resource))?raw[resource]:raw;
  if (!result || typeof result !== 'object' || (!Array.isArray(result.rows) && !Array.isArray(result.games) && !result.game)) throw Error('数据快照格式异常');
  return live ? { ...result, stale: true, warning: '未能直连 NBA 官方数据，正在显示最近一次定时快照。' } : result;
}
export async function fetchDataset(resource: string, season: string, id = ''): Promise<Envelope> {
  // Validate before contacting either service. Historical seasons remain immutable files.
  staticDataPath(resource, season, id);
  if (!CURRENT_SEASONS.includes(season)) return fetchStaticDataset(resource, season, id);
  const q = new URLSearchParams({ resource, season, ...(id ? { id } : {}) });
  const endpoint = STATIC_PAGES ? service.apiBase : '/api/nba';
  let primary:Envelope|undefined;
  try {
    const value=await json(endpoint+'?'+q,false,20000);
    if (!value||typeof value!=='object'||(!Array.isArray(value.rows)&&!Array.isArray(value.games)&&!value.game)) throw Error('实时数据格式异常');
    if (['players','teams','standings','bpm','shots','roster'].includes(resource)&&value.season&&value.season!==season) throw Error('实时数据赛季不匹配');
    if(resource==='boxscore')validateBoxscore(value.game,id);
    primary=value;
    if (!value.stale) return value;
  } catch { /* A service outage must not prevent access to the verified offline backup. */ }
  try {
    const backup=await fetchStaticDataset(resource,season,id);
    if (primary&&(Date.parse(primary.updatedAt||'')||0)>=(Date.parse(backup.updatedAt||'')||0)) return primary;
    // CDN access is itself live; files retain their original collection time.
    if (['scoreboard','schedule','boxscore'].includes(resource)&&!backup.stale) return backup;
    return {...backup,stale:true,warning:'实时服务暂不可用，正在显示最近一次定时快照。'};
  } catch {
    if(primary)return primary;
    throw Error('实时服务与数据备份暂不可用');
  }
}
