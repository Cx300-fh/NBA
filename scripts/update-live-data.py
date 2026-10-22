#!/usr/bin/env python3
"""Publish small, current-season NBA feeds without rebuilding the website.

GitHub Actions supplies an independent NBA egress path when the web runtime is
blocked by the official endpoints. A failed request never refreshes source time.
"""
from __future__ import annotations
import argparse, concurrent.futures, datetime as dt, importlib.util, json, re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
def module(name,filename):
 spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/filename)
 value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
nba=module('nba_live_snapshot','update-data.py')
archive=module('nba_live_archive','update-archive.py')
UTC=dt.timezone.utc
INTERVALS={'players':300,'teams':300,'standings':300,'shots':900,'roster':3600,'scoreboard':300,'schedule':300,'boxscore':300}

def read(path):
 try:return json.loads(path.read_text())
 except (OSError,json.JSONDecodeError):return None
def write(path,data):
 path.parent.mkdir(parents=True,exist_ok=True)
 temporary=path.with_suffix('.json.tmp');temporary.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n');temporary.replace(path)
def timestamp(value):
 try:return dt.datetime.fromisoformat(value.replace('Z','+00:00')).astimezone(UTC)
 except (AttributeError,TypeError,ValueError):return None
def valid_season(value):return bool(re.fullmatch(r'\d{4}-\d{2}',value) and int(value[-2:])==(int(value[:4])+1)%100)
def same_game_season(game,season):return bool(re.fullmatch(r'00\d{8}',str(game.get('gameId',''))) and game['gameId'][3:5]==season[2:4])
def verify(resource,data,season,game_id=''):
 if not isinstance(data,dict):raise ValueError('NBA response is not an object')
 if resource=='boxscore':
  game=data.get('game',{})
  if game.get('gameId')!=game_id or not same_game_season(game,season):raise ValueError('NBA boxscore season/game mismatch')
 elif resource in ['schedule','scoreboard']:
  if not isinstance(data.get('games'),list):raise ValueError('NBA games table changed')
  if resource=='schedule' and data.get('season')!=season:raise ValueError('NBA schedule belongs to another season')
  if any(not same_game_season(game,season) for game in data['games']):raise ValueError('NBA games belong to another season')
  if len({game['gameId'] for game in data['games']})!=len(data['games']):raise ValueError('NBA returned duplicate games')
 else:
  if data.get('season')!=season or not isinstance(data.get('rows'),list):raise ValueError('NBA statistics season/table mismatch')
  if resource in ['players','teams'] and any('OFF_RATING' not in row or 'TS_PCT' not in row for row in data['rows']):raise ValueError('NBA advanced statistics are incomplete')
  if resource=='standings' and len(data['rows'])!=30:raise ValueError('NBA standings do not contain 30 teams')
 return data
def usable_fallback(resource,data,season,game_id=''):
 try:return verify(resource,data,season,game_id)
 except (ValueError,TypeError,KeyError):return None
def due(resource,data,clock):
 updated=timestamp((data or {}).get('updatedAt'))
 return not updated or (data or {}).get('stale',False) or (clock-updated).total_seconds()>=INTERVALS[resource]
def verified_final(data,game_id):
 game=(data or {}).get('game',{})
 if game.get('gameId')!=game_id or game.get('gameStatus')!=3:return False
 for side in ['homeTeam','awayTeam']:
  team=game.get(side,{})
  if len(team.get('players',[]))<5 or team.get('statistics',{}).get('points')!=team.get('score') or sum(player.get('statistics',{}).get('points',0) for player in team.get('players',[]))!=team.get('score'):return False
 return not data.get('stale',False)
def box_candidates(schedule,scoreboard,clock):
 # The official scoreboard defines the NBA day, which crosses UTC midnight.
 # A bounded recent schedule window also recovers games missing from that board.
 games={game['gameId']:game for game in (scoreboard or {}).get('games',[])}
 for game in (schedule or {}).get('games',[]):
  start=timestamp(game.get('gameTimeUTC'))
  if start and dt.timedelta(0)<=(clock-start)<=dt.timedelta(hours=36):
   previous=games.get(game['gameId'])
   if not previous or game.get('gameStatus',0)>previous.get('gameStatus',0):games[game['gameId']]=game
 return [game for game in games.values() if game.get('gameStatus') in [2,3] or ((start:=timestamp(game.get('gameTimeUTC'))) and start<=clock)]
def ensure_current_statistics(values):
 fresh=[resource for resource in ['players','teams','standings'] if values.get(resource,{}).get('rows') and not values[resource].get('stale',False)]
 if not fresh:raise RuntimeError('No current NBA player, team or standings request succeeded; retained feeds are stale, not a successful live refresh')
 return fresh

def refresh(season,output=None,workers=5,clock=None):
 if not valid_season(season):raise ValueError('Invalid NBA season')
 clock=clock or dt.datetime.now(UTC);output=Path(output) if output else ROOT/'data/live'
 snapshot=read(ROOT/'data/snapshot.json') or {};saved_archive=read(ROOT/f'data/archive/season-{season}.json') or {};errors=[]
 def filename(resource,game_id=''):
  return f'boxscore-{game_id}.json' if resource=='boxscore' else f'{resource}.json' if resource in ['schedule','scoreboard'] else f'{resource}-{season}.json'
 def previous(resource,game_id=''):
  path=output/filename(resource,game_id)
  existing=usable_fallback(resource,read(path),season,game_id)
  if existing:return existing
  fallback=snapshot.get('boxes',{}).get(game_id) if resource=='boxscore' else snapshot.get(resource) if resource in ['schedule','scoreboard','roster'] else snapshot.get('seasons',{}).get(season,{}).get(resource) or saved_archive.get(resource)
  return usable_fallback(resource,fallback,season,game_id)
 def collect(resource,loader,game_id=''):
  path=output/filename(resource,game_id);old=previous(resource,game_id)
  if resource in ['shots','roster'] and path.exists() and not due(resource,old,clock):return old
  if resource=='boxscore' and verified_final(old,game_id):
   if not path.exists():write(path,old)
   return old
  result=nba.refresh_resource(resource,lambda:verify(resource,loader(),season,game_id),old,errors)
  # Availability metadata belongs to this transport, never to a fictitious fetch.
  result={**result,'season':season,'refreshIntervalSeconds':INTERVALS[resource],'transport':'GitHub Actions'}
  if not result.get('source'):result['source']='NBA.com'
  write(path,result);return result
 def schedule():
  try:raw=json.loads(nba.get('https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json'))['leagueSchedule']
  except Exception:raw=json.loads(nba.get('https://stats.nba.com/stats/scheduleleaguev2?LeagueID=00&Season='+season))['leagueSchedule']
  return {'games':[nba.normalize_game(game) for day in raw['gameDates'] for game in day['games']],'season':raw['seasonYear'],'source':'NBA.com','url':'https://www.nba.com/schedule','updatedAt':nba.now(),'stale':False}
 def scoreboard():return {**json.loads(nba.get('https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json'))['scoreboard'],'source':'NBA.com','url':'https://www.nba.com/games','updatedAt':nba.now(),'stale':False}
 loaders={
  'players':lambda:nba.table('players',season),'teams':lambda:nba.table('teams',season),'standings':lambda:nba.standings(season),
  'shots':lambda:archive.shooting_zones(season),'roster':lambda:nba.pack(nba.stats('commonallplayers',{'LeagueID':'00','Season':season,'IsOnlyCurrentSeason':1}),'NBA.com','https://www.nba.com/players',season),
  'schedule':schedule,'scoreboard':scoreboard,
 }
 values={}
 with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
  jobs={pool.submit(collect,resource,loader):resource for resource,loader in loaders.items()}
  for future in concurrent.futures.as_completed(jobs):values[jobs[future]]=future.result()
  games=box_candidates(values.get('schedule'),values.get('scoreboard'),clock)
  boxes={pool.submit(collect,'boxscore',lambda gid=game['gameId']:nba.boxscore(gid),game['gameId']):game['gameId'] for game in games}
  for future in concurrent.futures.as_completed(boxes):future.result()
 print('Live feeds:',season,';',len(games),'recent games;',len(errors),'source warnings',flush=True)
 ensure_current_statistics(values)
 return values,errors

if __name__=='__main__':
 clock=dt.datetime.now(UTC);year=clock.year if clock.month>=7 else clock.year-1
 parser=argparse.ArgumentParser();parser.add_argument('--season',default=f'{year}-{(year+1)%100:02d}');parser.add_argument('--output-dir',type=Path);parser.add_argument('--workers',type=int,default=5);args=parser.parse_args()
 refresh(args.season,args.output_dir,max(1,min(args.workers,6)),clock)
