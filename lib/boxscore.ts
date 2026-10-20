export function validateBoxscore(game: any, id: string) {
  if (game?.gameId !== id) throw Error('技术统计与比赛不匹配');
  if (game.gameStatus === 3) {
    for (const team of [game.homeTeam, game.awayTeam]) {
      if (!Array.isArray(team?.players) || team.players.length < 5 || !Number.isFinite(team.score) || team.score < 0 || team.players.some((p: any) => !Number.isFinite(p.statistics?.points)) || team.players.reduce((total: number, p: any) => total + p.statistics.points, 0) !== team.score || team.statistics?.points !== team.score) throw Error('官方赛后统计尚未核对一致，请稍后刷新');
    }
  }
  return game;
}
