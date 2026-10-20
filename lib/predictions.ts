import { beijingDate, type Game } from './basketball.ts';

export const PREDICTION_REPO = 'Cx300-fh/NBA';
export const PREDICTION_BRANCH = 'main';
export type PredictionResult = { winnerTeamId: number; homeScore: number; awayScore: number; settledAt: string };
export type Prediction = {
  gameId: string; gameTimeUTC: string; homeTeamId: number; awayTeamId: number;
  pickedTeamId: number; createdAt: string; updatedAt: string; result?: PredictionResult;
};
export type PredictionMonth = { version: 1; month: string; updatedAt: string | null; predictions: Prediction[] };
export type GamePhase = 'upcoming' | 'locked' | 'live' | 'final';
const iso = (s: unknown): s is string => typeof s === 'string' && Number.isFinite(Date.parse(s));
const teamId = (n: unknown): n is number => Number.isInteger(n) && Number(n) >= 1610612737 && Number(n) <= 1610612766;
export function predictionMonth(game: Pick<Game, 'gameTimeUTC'>) {
  if (!iso(game.gameTimeUTC)) throw Error('比赛时间尚未确定');
  return beijingDate(game.gameTimeUTC).slice(0, 7);
}
export function predictionPath(month: string) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw Error('无效的竞猜月份');
  return `predictions/${month}.json`;
}
export function emptyMonth(month: string): PredictionMonth { predictionPath(month); return { version: 1, month, updatedAt: null, predictions: [] }; }
export function gamePhase(game: Game, now = Date.now()): GamePhase {
  if (game.gameStatus === 3) return 'final';
  if (game.gameStatus === 2) return 'live';
  if (game.gameStatus !== 1 || /postpon|cancel|suspend|tbd|\bppd\b/i.test(game.gameStatusText) || !iso(game.gameTimeUTC) || Date.parse(game.gameTimeUTC) <= now) return 'locked';
  return 'upcoming';
}
export function parsePredictionMonth(raw: unknown, month: string): PredictionMonth {
  const value = raw as PredictionMonth;
  if (!value || value.version !== 1 || value.month !== month || !Array.isArray(value.predictions) || value.predictions.length > 2000 || (value.updatedAt !== null && !iso(value.updatedAt))) throw Error('GitHub 竞猜文件格式不正确，已停止写入');
  const seen = new Set<string>();
  const predictions = value.predictions.map((p): Prediction => {
    if (!p || !/^00\d{8}$/.test(p.gameId) || seen.has(p.gameId) || !iso(p.gameTimeUTC) || predictionMonth(p) !== month || !teamId(p.homeTeamId) || !teamId(p.awayTeamId) || p.homeTeamId === p.awayTeamId || ![p.homeTeamId, p.awayTeamId].includes(p.pickedTeamId) || !iso(p.createdAt) || !iso(p.updatedAt) || Date.parse(p.createdAt) > Date.parse(p.updatedAt) || Date.parse(p.updatedAt) >= Date.parse(p.gameTimeUTC)) throw Error('GitHub 竞猜记录校验失败，已保留原文件');
    seen.add(p.gameId);
    const next: Prediction = { gameId: p.gameId, gameTimeUTC: p.gameTimeUTC, homeTeamId: p.homeTeamId, awayTeamId: p.awayTeamId, pickedTeamId: p.pickedTeamId, createdAt: p.createdAt, updatedAt: p.updatedAt };
    if (p.result) {
      const r = p.result;
      if (![p.homeTeamId, p.awayTeamId].includes(r.winnerTeamId) || !Number.isInteger(r.homeScore) || !Number.isInteger(r.awayScore) || r.homeScore < 0 || r.awayScore < 0 || r.homeScore === r.awayScore || r.winnerTeamId !== (r.homeScore > r.awayScore ? p.homeTeamId : p.awayTeamId) || !iso(r.settledAt)) throw Error('GitHub 竞猜结果校验失败');
      next.result = { winnerTeamId: r.winnerTeamId, homeScore: r.homeScore, awayScore: r.awayScore, settledAt: r.settledAt };
    }
    return next;
  });
  return { version: 1, month, updatedAt: value.updatedAt, predictions };
}
export function mergePrediction(file: PredictionMonth, game: Game, pickedTeamId: number, now = Date.now()): PredictionMonth {
  if (gamePhase(game, now) !== 'upcoming') throw Error('比赛已封盘，不能新增或更改竞猜');
  if (!/^00\d{8}$/.test(game.gameId) || !teamId(game.homeTeam.teamId) || !teamId(game.awayTeam.teamId) || game.homeTeam.teamId === game.awayTeam.teamId || ![game.homeTeam.teamId, game.awayTeam.teamId].includes(pickedTeamId)) throw Error('只能选择本场比赛的胜方');
  if (file.month !== predictionMonth(game)) throw Error('比赛月份与竞猜文件不一致');
  const previous = file.predictions.find(p => p.gameId === game.gameId);
  if (previous?.result) throw Error('这场竞猜已结算');
  const timestamp = new Date(now).toISOString();
  const next: Prediction = { gameId: game.gameId, gameTimeUTC: game.gameTimeUTC, homeTeamId: game.homeTeam.teamId, awayTeamId: game.awayTeam.teamId, pickedTeamId, createdAt: previous?.createdAt || timestamp, updatedAt: timestamp };
  return { ...file, updatedAt: timestamp, predictions: [...file.predictions.filter(p => p.gameId !== game.gameId), next].sort((a, b) => a.gameTimeUTC.localeCompare(b.gameTimeUTC) || a.gameId.localeCompare(b.gameId)) };
}
export function predictionOutcome(p: Prediction, game?: Game): 'won' | 'lost' | 'pending' {
  if (p.result) return p.result.winnerTeamId === p.pickedTeamId ? 'won' : 'lost';
  if (!game || game.gameId !== p.gameId || game.gameStatus !== 3 || game.homeTeam.teamId !== p.homeTeamId || game.awayTeam.teamId !== p.awayTeamId || game.homeTeam.score == null || game.awayTeam.score == null || game.homeTeam.score === game.awayTeam.score) return 'pending';
  return (game.homeTeam.score > game.awayTeam.score ? game.homeTeam.teamId : game.awayTeam.teamId) === p.pickedTeamId ? 'won' : 'lost';
}

class GitHubError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
async function github(path: string, token = '', init: RequestInit = {}): Promise<any> {
  let response: Response;
  try {
    response = await fetch(`https://api.github.com${path}`, { ...init, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000), headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  } catch { throw Error('无法连接 GitHub，请检查网络后重试'); }
  if (!response.ok) {
    const message = response.status === 401 ? 'GitHub 令牌无效或已过期，请重新连接' : response.status === 403 ? 'GitHub 拒绝访问：请检查 NBA 仓库的 Contents 读写权限或 API 额度' : response.status === 409 || response.status === 422 ? '文件已被其他页面更新，正在重新合并' : `GitHub 请求失败 (${response.status})`;
    throw new GitHubError(response.status, message);
  }
  return response.json();
}
const fileEndpoint = (month: string) => `/repos/${PREDICTION_REPO}/contents/${predictionPath(month)}`;
function encode(text: string) { return btoa(Array.from(new TextEncoder().encode(text), byte => String.fromCharCode(byte)).join('')); }
function decode(content: string) { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(content.replace(/\s/g, '')), c => c.charCodeAt(0))); }
export async function connectPredictionGitHub(token: string): Promise<string> {
  if (!/^github_pat_[A-Za-z0-9_]+$/.test(token)) throw Error('请使用仅授权 NBA 仓库的 Fine-grained token');
  const user = await github('/user', token);
  if (user.login?.toLowerCase() !== 'cx300-fh') throw Error('请使用 Cx300-fh 账号为 NBA 仓库创建的令牌');
  await github(`/repos/${PREDICTION_REPO}`, token);
  return user.login;
}
export async function loadPredictionMonth(month: string, token = ''): Promise<{ file: PredictionMonth; sha?: string }> {
  try {
    const result = await github(`${fileEndpoint(month)}?ref=${PREDICTION_BRANCH}`, token);
    if (result.type !== 'file' || result.encoding !== 'base64' || typeof result.content !== 'string' || result.size > 1500000 || !/^[a-f0-9]{40}$/.test(result.sha)) throw Error('GitHub 竞猜文件无法读取');
    return { file: parsePredictionMonth(JSON.parse(decode(result.content)), month), sha: result.sha };
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return { file: emptyMonth(month) };
    throw error;
  }
}
export async function savePrediction(game: Game, pickedTeamId: number, token: string, refreshGame: () => Promise<Game>): Promise<{ file: PredictionMonth; commitUrl: string }> {
  if (!token) throw Error('请先连接 GitHub，再保存竞猜');
  const month = predictionMonth(game);
  // A fresh read plus the file SHA preserves other games and rejects simultaneous overwrites.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { file, sha } = await loadPredictionMonth(month, token);
    const current = await refreshGame();
    if (current.gameId !== game.gameId || current.homeTeam.teamId !== game.homeTeam.teamId || current.awayTeam.teamId !== game.awayTeam.teamId || predictionMonth(current) !== month) throw Error('赛程已发生变化，请刷新比赛后重试');
    const merged = mergePrediction(file, current, pickedTeamId);
    try {
      const result = await github(fileEndpoint(month), token, { method: 'PUT', body: JSON.stringify({ message: `picks: ${current.gameId} → ${pickedTeamId}`, content: encode(JSON.stringify(merged, null, 2) + '\n'), branch: PREDICTION_BRANCH, ...(sha ? { sha } : {}) }) });
      if (!result.commit?.html_url) throw Error('GitHub 未确认保存，请刷新记录核对后重试');
      return { file: merged, commitUrl: result.commit.html_url };
    } catch (error) {
      if (error instanceof GitHubError && [409, 422].includes(error.status) && attempt < 2) continue;
      throw error;
    }
  }
  throw Error('多次发生保存冲突，请刷新竞猜记录后重试');
}
