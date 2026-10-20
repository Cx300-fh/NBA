import { STATIC_PAGES, assetPath } from './site-mode.ts';
import type { Envelope, Game } from './basketball.ts';
const RESOURCES = ['players', 'teams', 'standings', 'bpm', 'roster', 'schedule', 'scoreboard', 'boxscore'];
const SEASONS = ['2024-25', '2025-26', '2026-27'];
export function staticDataPath(resource: string, season: string, id = '') {
  if (!RESOURCES.includes(resource) || !SEASONS.includes(season) || (resource === 'boxscore' && !/^00\d{8}$/.test(id))) throw Error('无效的数据请求');
  if (['players', 'teams', 'standings', 'bpm'].includes(resource)) return assetPath(`data/${resource}-${season}.json`);
  return assetPath(resource === 'boxscore' ? `data/boxscore-${id}.json` : `data/${resource}.json`);
}
export function normalizeScheduledGame(g: any): Game {
  const team = (t: any) => ({ teamId: t.teamId, teamName: t.teamName, teamCity: t.teamCity, teamTricode: t.teamTricode, score: t.score, wins: t.wins, losses: t.losses });
  return { gameId: g.gameId, gameStatus: g.gameStatus, gameStatusText: g.gameStatusText, gameTimeUTC: g.gameDateTimeUTC || g.gameTimeUTC, homeTeam: team(g.homeTeam), awayTeam: team(g.awayTeam), arenaName: g.arenaName || '', gameLabel: g.gameLabel || '' };
}
async function json(url: string, live = false) {
  const response = await fetch(url, { cache: live ? 'no-store' : 'no-cache', signal: AbortSignal.timeout(live ? 5000 : 12000) });
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
  if (d.game?.gameId !== id) throw Error('技术统计与比赛不匹配');
  return { game: d.game, ...source, url: `https://www.nba.com/game/${id}/box-score` };
}
export async function fetchStaticDataset(resource: string, season: string, id = ''): Promise<Envelope> {
  const path = staticDataPath(resource, season, id);
  const live = ['scoreboard', 'schedule', 'boxscore'].includes(resource);
  if (live) {
    try { return await liveDataset(resource, id); } catch { /* Browser CORS and upstream restrictions must not break the static app. */ }
  }
  const result = await json(path);
  if (!result || typeof result !== 'object' || (!Array.isArray(result.rows) && !Array.isArray(result.games) && !result.game)) throw Error('数据快照格式异常');
  return live ? { ...result, stale: true, warning: '未能直连 NBA 官方数据，正在显示最近一次定时快照。' } : result;
}
export async function fetchDataset(resource: string, season: string, id = ''): Promise<Envelope> {
  if (STATIC_PAGES) return fetchStaticDataset(resource, season, id);
  const q = new URLSearchParams({ resource, season, ...(id ? { id } : {}) });
  return json('/api/nba?' + q);
}
