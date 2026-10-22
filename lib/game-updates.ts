import type { Envelope, Game } from './basketball.ts';

/** Keep games added by the live feed, and never turn a completed game back into a preview. */
export function mergeGameFeeds(schedule:Envelope,scoreboard:Envelope):Game[]{
  const games=new Map((schedule.games||[]).map(game=>[game.gameId,game]));
  const boardIsNewer=!scoreboard.stale&&Boolean(schedule.stale)||Date.parse(scoreboard.updatedAt||'')>=Date.parse(schedule.updatedAt||'');
  for(const incoming of scoreboard.games||[]){
    const scheduled=games.get(incoming.gameId);
    if(!scheduled){games.set(incoming.gameId,incoming);continue;}
    const useBoard=incoming.gameStatus>scheduled.gameStatus||(incoming.gameStatus===scheduled.gameStatus&&boardIsNewer);
    if(useBoard)games.set(incoming.gameId,{...scheduled,...incoming,gameTimeUTC:incoming.gameTimeUTC||scheduled.gameTimeUTC,arenaName:incoming.arenaName||scheduled.arenaName,gameLabel:incoming.gameLabel||scheduled.gameLabel,homeTeam:{...scheduled.homeTeam,...incoming.homeTeam},awayTeam:{...scheduled.awayTeam,...incoming.awayTeam}});
  }
  return [...games.values()].sort((a,b)=>(a.gameTimeUTC||'').localeCompare(b.gameTimeUTC||'')||a.gameId.localeCompare(b.gameId));
}

export function gameSeason(gameId:string,fallback:string){
  if(!/^00\d{8}$/.test(gameId))return fallback;
  const shortYear=Number(gameId.slice(3,5));
  const year=(shortYear>=70?1900:2000)+shortYear;
  return `${year}-${String((year+1)%100).padStart(2,'0')}`;
}
