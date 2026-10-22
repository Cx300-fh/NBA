import test from 'node:test';
import assert from 'node:assert/strict';
import {formatStat,beijingDate,shiftDate,noteKey,hasObservation,type Observation} from '../lib/basketball.ts';
import {parseNotebook,exportNotebook} from '../lib/notebook.ts';
import {mergeGameFeeds,gameSeason} from '../lib/game-updates.ts';
import type {Game} from '../lib/basketball.ts';
const note:Observation={gameId:'0022600001',playerId:2544,playerName:'LeBron James',teamId:1610612747,date:'2026-10-21',matchup:'GSW @ LAL',ratings:{defense:8},focus:['defense'],notes:'换防后提前回位。',moments:[{id:'x',period:'Q3',clock:'8:32',text:'弱侧提前轮转。'}],updatedAt:'2026-10-20T08:00:00Z',watched:false};
test('missing data stays missing; zero and percentage are preserved',()=>{assert.equal(formatStat(null,'PTS'),'—');assert.equal(formatStat(undefined,'PTS'),'—');assert.equal(formatStat('','PTS'),'—');assert.equal(formatStat(0,'PTS'),'0.0');assert.equal(formatStat(.432,'FG3_PCT'),'43.2%');assert.equal(formatStat(-3.2,'NET_RATING'),'-3.2')});
test('games use Beijing dates across midnight and summer time',()=>{assert.equal(beijingDate('2026-10-20T23:30:00Z'),'2026-10-21');assert.equal(beijingDate('2026-10-20T15:59:00Z'),'2026-10-20');assert.equal(beijingDate('2026-01-01T16:00:00Z'),'2026-01-02');assert.equal(shiftDate('2026-12-31',1),'2027-01-01');assert.equal(shiftDate('2024-03-01',-1),'2024-02-29')});
test('observations are scoped to a player and a game',()=>{assert.notEqual(noteKey('0022600001',2544),noteKey('0022600002',2544));assert.notEqual(noteKey('0022600001',2544),noteKey('0022600001',201939))});
test('notes survive export/import without changing scores, Chinese text or moments',()=>{const n={observations:{[noteKey(note.gameId,note.playerId)]:note},watchedGames:{'0022600001':true}};assert.deepEqual(parseNotebook(JSON.parse(JSON.stringify(exportNotebook(n)))),n)});
test('unset ratings stay unset and empty drafts are not observations',()=>{assert.equal(hasObservation({...note,ratings:{},focus:[],notes:'',moments:[],watched:false}),false);assert.equal(hasObservation({...note,ratings:{},focus:[],notes:'只有文字',moments:[],watched:false}),true)});
test('invalid import cannot inject wrong ratings or malformed game ids',()=>{for(const patch of [{ratings:{defense:11}},{ratings:{defense:-1}},{gameId:'__proto__'},{playerId:0},{moments:[{id:'x',period:'Q3',clock:'13:62',text:'x'}]}]){assert.throws(()=>parseNotebook({format:'courtside-notebook',version:1,observations:[{...note,...patch}]}))}assert.throws(()=>parseNotebook({observations:[]}))});
test('live games absent from a cached schedule are included without regressing completed results',()=>{
 const team={teamId:1610612747,teamName:'Lakers',teamCity:'Los Angeles',teamTricode:'LAL',score:112};
 const game:Game={gameId:'0022600001',gameStatus:3,gameStatusText:'Final',gameTimeUTC:'2026-10-22T02:00:00Z',homeTeam:team,awayTeam:{...team,teamId:1610612744,teamTricode:'GSW',score:108},arenaName:'Arena'};
 const result=mergeGameFeeds({games:[game],updatedAt:'2026-10-22T05:00:00Z'},{games:[{...game,gameStatus:1,gameStatusText:'7:00 pm ET'},{...game,gameId:'0022600002'}],updatedAt:'2026-10-22T04:00:00Z',stale:true});
 assert.equal(result.length,2);assert.equal(result[0].gameStatus,3);assert.equal(result[0].homeTeam.score,112);
 const live=mergeGameFeeds({games:[{...game,gameStatus:1}]},{games:[{...game,gameStatus:2,arenaName:undefined,gameTimeUTC:''}]});
 assert.equal(live[0].gameStatus,2);assert.equal(live[0].gameTimeUTC,game.gameTimeUTC);assert.equal(live[0].arenaName,'Arena');
});
test('game details request the season encoded by the actual game rather than the app default',()=>{
 assert.equal(gameSeason('0022500001','2026-27'),'2025-26');assert.equal(gameSeason('0012600001','2025-26'),'2026-27');assert.equal(gameSeason('0029900001','2026-27'),'1999-00');assert.equal(gameSeason('bad','2026-27'),'2026-27');
});
