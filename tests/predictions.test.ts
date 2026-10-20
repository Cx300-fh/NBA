import test from 'node:test';
import assert from 'node:assert/strict';
import { connectPredictionGitHub, emptyMonth, gamePhase, loadPredictionMonth, mergePrediction, parsePredictionMonth, predictionMonth, predictionOutcome, predictionPath, savePrediction } from '../lib/predictions.ts';
import { playerSummary, minuteLabel } from '../lib/postgame.ts';
import { validateBoxscore } from '../lib/boxscore.ts';
import type { Game } from '../lib/basketball.ts';
const realFetch = globalThis.fetch;
const game: Game = { gameId: '0022600001', gameStatus: 1, gameStatusText: '7:00 pm ET', gameTimeUTC: '2090-01-22T00:00:00Z', awayTeam: { teamId: 1610612744, teamName: 'Warriors', teamCity: 'Golden State', teamTricode: 'GSW', score: null }, homeTeam: { teamId: 1610612747, teamName: 'Lakers', teamCity: 'Los Angeles', teamTricode: 'LAL', score: null } };
const cutoff = Date.parse(game.gameTimeUTC);
const getFile = (file: unknown, sha = 'a'.repeat(40)) => Response.json({ type: 'file', encoding: 'base64', size: 500, content: Buffer.from(JSON.stringify(file)).toString('base64'), sha });
test('monthly files use Beijing game date, with no arbitrary paths', () => {
  assert.equal(predictionMonth({ gameTimeUTC: '2026-10-31T23:30:00Z' }), '2026-11');
  assert.equal(predictionPath('2026-11'), 'predictions/2026-11.json');
  for (const value of ['../secret', '2026-13', '2026-00', '2026-1']) assert.throws(() => predictionPath(value));
});
test('scheduled picks close at tipoff even if a cached status still says upcoming', () => {
  assert.equal(gamePhase(game, cutoff - 1), 'upcoming'); assert.equal(gamePhase(game, cutoff), 'locked');
  assert.equal(gamePhase({ ...game, gameStatus: 2 }, cutoff - 1000), 'live'); assert.equal(gamePhase({ ...game, gameStatus: 3 }, cutoff), 'final');
  for (const status of ['Postponed', 'Cancelled', 'Suspended', 'TBD']) assert.equal(gamePhase({ ...game, gameStatusText: status }, cutoff - 1), 'locked');
  assert.equal(gamePhase({ ...game, gameTimeUTC: '' }), 'locked');
});
test('changing the same pick preserves createdAt and every other game in one monthly file', () => {
  const other = { ...game, gameId: '0022600002' }; let file = mergePrediction(emptyMonth('2090-01'), other, other.awayTeam.teamId, cutoff - 2000);
  file = mergePrediction(file, game, game.homeTeam.teamId, cutoff - 1500);
  const original = file.predictions.find(p => p.gameId === game.gameId)!;
  const next = mergePrediction(file, game, game.awayTeam.teamId, cutoff - 1000);
  assert.equal(next.predictions.length, 2); assert.equal(next.predictions.find(p => p.gameId === game.gameId)?.createdAt, original.createdAt);
  assert.equal(next.predictions.find(p => p.gameId === other.gameId)?.pickedTeamId, other.awayTeam.teamId);
  assert.throws(() => mergePrediction(next, game, 123, cutoff - 1)); assert.throws(() => mergePrediction(next, game, game.homeTeam.teamId, cutoff));
  assert.deepEqual(parsePredictionMonth(next, '2090-01'), next);
});
test('malformed records, duplicates and picks made after tipoff never replace a GitHub file', () => {
  const file = mergePrediction(emptyMonth('2090-01'), game, game.homeTeam.teamId, cutoff - 1000);
  for (const p of [{ ...file.predictions[0], pickedTeamId: 123 }, { ...file.predictions[0], updatedAt: game.gameTimeUTC }, { ...file.predictions[0], homeTeamId: game.awayTeam.teamId }]) assert.throws(() => parsePredictionMonth({ ...file, predictions: [p] }, '2090-01'));
  assert.throws(() => parsePredictionMonth({ ...file, predictions: [...file.predictions, ...file.predictions] }, '2090-01'));
  assert.throws(() => parsePredictionMonth({ ...file, version: 99 }, '2090-01'));
});
test('outcomes require a matching final score, and pending is never counted as a loss', () => {
  const p = mergePrediction(emptyMonth('2090-01'), game, game.homeTeam.teamId, cutoff - 1).predictions[0];
  const final = { ...game, gameStatus: 3, homeTeam: { ...game.homeTeam, score: 110 }, awayTeam: { ...game.awayTeam, score: 100 } };
  assert.equal(predictionOutcome(p, game), 'pending'); assert.equal(predictionOutcome(p, final), 'won');
  assert.equal(predictionOutcome({ ...p, pickedTeamId: game.awayTeam.teamId }, final), 'lost');
  assert.equal(predictionOutcome(p, { ...final, gameId: '0022600002' }), 'pending');
  assert.equal(predictionOutcome(p, { ...final, homeTeam: { ...final.homeTeam, score: 100 } }), 'pending');
});
test('a missing month starts empty; an existing malformed file fails closed', async () => {
  globalThis.fetch = async () => new Response('', { status: 404 });
  assert.deepEqual((await loadPredictionMonth('2090-01')).file, emptyMonth('2090-01'));
  globalThis.fetch = async () => getFile({ invalid: true }); await assert.rejects(() => loadPredictionMonth('2090-01'));
  globalThis.fetch = async () => new Response('', { status: 403 }); await assert.rejects(() => loadPredictionMonth('2090-01'));
});
test('save retries SHA conflicts by re-reading and merging, sending credentials only to GitHub', async () => {
  let reads = 0, writes = 0; let final: any; const calls: string[] = [];
  const other = { ...game, gameId: '0022600002' };
  const parallel = mergePrediction(emptyMonth('2090-01'), other, other.awayTeam.teamId, Date.now() - 10000);
  globalThis.fetch = async (input, init) => {
    calls.push(String(input)); assert.ok(String(input).startsWith('https://api.github.com/repos/Cx300-fh/NBA/contents/predictions/2090-01.json'));
    assert.equal((init?.headers as any).Authorization, 'Bearer github_pat_test');
    if (init?.method !== 'PUT') { reads++; return getFile(reads === 1 ? emptyMonth('2090-01') : parallel, (reads === 1 ? 'a' : 'b').repeat(40)); }
    writes++; if (writes === 1) return new Response('', { status: 409 });
    const body = JSON.parse(init.body as string); assert.equal(body.sha, 'b'.repeat(40)); assert.equal(body.branch, 'main');
    final = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')); return Response.json({ commit: { html_url: 'https://github.com/Cx300-fh/NBA/commit/test' } });
  };
  const result = await savePrediction(game, game.homeTeam.teamId, 'github_pat_test', async () => game);
  assert.equal(reads, 2); assert.equal(writes, 2); assert.equal(final.predictions.length, 2); assert.ok(final.predictions.some((p: any) => p.gameId === other.gameId)); assert.equal(result.file.predictions.length, 2); assert.equal(calls.length, 4);
});
test('a game starting during the save operation prevents a PUT, with no false success', async () => {
  let writes = 0;
  globalThis.fetch = async (_input, init) => { if (init?.method === 'PUT') writes++; return getFile(emptyMonth('2090-01')); };
  await assert.rejects(() => savePrediction(game, game.homeTeam.teamId, 'github_pat_test', async () => ({ ...game, gameStatus: 2 })), /封盘/); assert.equal(writes, 0);
});
test('new monthly file uses create semantics and reports write permission errors', async () => {
  let body: any;
  globalThis.fetch = async (_input, init) => { if (init?.method !== 'PUT') return new Response('', { status: 404 }); body = JSON.parse(init.body as string); return Response.json({ commit: { html_url: 'https://github.com/Cx300-fh/NBA/commit/new' } }); };
  await savePrediction(game, game.awayTeam.teamId, 'github_pat_test', async () => game); assert.equal(body.sha, undefined); assert.ok(body.content);
  globalThis.fetch = async (_input, init) => init?.method === 'PUT' ? new Response('', { status: 403 }) : getFile(emptyMonth('2090-01'));
  await assert.rejects(() => savePrediction(game, game.awayTeam.teamId, 'github_pat_test', async () => game), /Contents/);
});
test('connection accepts only the intended owner and fine-grained credential type', async () => {
  await assert.rejects(() => connectPredictionGitHub('classic_token'), /Fine-grained/);
  globalThis.fetch = async () => Response.json({ login: 'another-account' }); await assert.rejects(() => connectPredictionGitHub('github_pat_test'), /Cx300-fh/);
  globalThis.fetch = async input => Response.json(String(input).endsWith('/user') ? { login: 'Cx300-fh' } : { full_name: 'Cx300-fh/NBA' }); assert.equal(await connectPredictionGitHub('github_pat_test'), 'Cx300-fh');
});
test('postgame scoring reconciles to actual points; zero attempts and DNP stay distinct', () => {
  const player = { played: '1', statistics: { minutes: 'PT29M48.00S', points: 26, fieldGoalsMade: 8, fieldGoalsAttempted: 20, threePointersMade: 2, threePointersAttempted: 6, freeThrowsMade: 8, freeThrowsAttempted: 9 } };
  const result = playerSummary(player); assert.deepEqual(result.shots.map(s => s.points), [12, 6, 8]); assert.equal(result.shots.reduce((n, s) => n + (s.points || 0), 0), 26); assert.equal(result.efg, .45); assert.ok(Math.abs(result.ts! - 26 / (2 * (20 + .44 * 9))) < 1e-10);
  assert.equal(minuteLabel(player.statistics.minutes), '29:48'); assert.equal(playerSummary({ played: '0' }).played, false);
  assert.equal(playerSummary({ statistics: { points: 0, fieldGoalsAttempted: 0, freeThrowsAttempted: 0 } }).ts, null);
  assert.equal(playerSummary({}).points, null); assert.equal(minuteLabel(undefined), '—');
});
test('inconsistent official final scores do not produce a misleading player recap', () => {
  const team = { score: 10, statistics: { points: 10 }, players: Array.from({length:5}, () => ({ statistics: { points: 2 } })) };
  const box = { gameId: game.gameId, gameStatus: 3, homeTeam: team, awayTeam: team };
  assert.equal(validateBoxscore(box, game.gameId), box);
  assert.throws(() => validateBoxscore({ ...box, homeTeam: { ...team, score: 9 } }, game.gameId), /核对/);
  assert.throws(() => validateBoxscore(box, '0022600002'), /匹配/);
});
test.after(() => { globalThis.fetch = realFetch; });
