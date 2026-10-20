#!/usr/bin/env python3
"""Refresh public NBA snapshots. Standard library only; no API keys or invented rows."""
from __future__ import annotations
import argparse, concurrent.futures, datetime as dt, html, json, re, time, unicodedata, urllib.request
from pathlib import Path
from urllib.parse import urlencode
ROOT=Path(__file__).resolve().parents[1]
HEADERS={'User-Agent':'Mozilla/5.0','Referer':'https://www.nba.com/','Origin':'https://www.nba.com'}
KEEP={'PLAYER_ID','PLAYER_NAME','TEAM_ID','TEAM_ABBREVIATION','TEAM_NAME','GP','W','L','W_PCT','MIN','FGM','FGA','FG_PCT','FG3M','FG3A','FG3_PCT','FTM','FTA','FT_PCT','OREB','DREB','REB','AST','TOV','STL','BLK','PF','PTS','PLUS_MINUS','OFF_RATING','DEF_RATING','NET_RATING','AST_PCT','AST_TO','OREB_PCT','DREB_PCT','REB_PCT','TM_TOV_PCT','EFG_PCT','TS_PCT','USG_PCT','PACE','PIE'}
def now():return dt.datetime.now(dt.timezone.utc).isoformat()
def get(url):
 for attempt in range(2):
  try:
   with urllib.request.urlopen(urllib.request.Request(url,headers=HEADERS),timeout=22) as r:return r.read().decode('utf-8')
  except Exception:
   if attempt:raise
   time.sleep(.3)
def rows(text):
 data=json.loads(text);sets=data.get('resultSets',data.get('resultSet',[]));sets=[sets] if isinstance(sets,dict) else sets
 return [dict(zip(sets[0]['headers'],r)) for r in sets[0]['rowSet']]
def params(season,measure='Base'):
 return dict(College='',Conference='',Country='',DateFrom='',DateTo='',Division='',DraftPick='',DraftYear='',GameScope='',GameSegment='',Height='',LastNGames=0,LeagueID='00',Location='',MeasureType=measure,Month=0,OpponentTeamID=0,Outcome='',PORound=0,PaceAdjust='N',PerMode='PerGame',Period=0,PlayerExperience='',PlayerPosition='',PlusMinus='N',Rank='N',Season=season,SeasonSegment='',SeasonType='Regular Season',ShotClockRange='',StarterBench='',TeamID=0,VsConference='',VsDivision='',Weight='')
def stats(endpoint,p):return rows(get('https://stats.nba.com/stats/'+endpoint+'?'+urlencode(p)))
def pack(data,source,url,season=None):return {'rows':data,'source':source,'url':url,'season':season,'updatedAt':now(),'stale':False}
ADVANCED_KEYS={'OFF_RATING','DEF_RATING','NET_RATING','AST_PCT','AST_TO','OREB_PCT','DREB_PCT','REB_PCT','TM_TOV_PCT','EFG_PCT','TS_PCT','USG_PCT','PACE','PIE'}
def table(kind,season):
 endpoint='leaguedashplayerstats' if kind=='players' else 'leaguedashteamstats'
 base=stats(endpoint,params(season));advanced=stats(endpoint,params(season,'Advanced'));key='PLAYER_ID' if kind=='players' else 'TEAM_ID';ad={r[key]:{k:v for k,v in r.items() if k in ADVANCED_KEYS} for r in advanced}
 merged=[{k:v for k,v in {**r,**ad.get(r[key],{})}.items() if k in KEEP} for r in base]
 return pack(merged,'NBA.com',f'https://www.nba.com/stats/{kind}/traditional?Season={season}',season)
def standings(season):return pack(stats('leaguestandingsv3',{'LeagueID':'00','Season':season,'SeasonType':'Regular Season'}),'NBA.com',f'https://www.nba.com/standings?Season={season}',season)
def norm(s):return ''.join(c for c in unicodedata.normalize('NFKD',s).lower() if c.isalnum())
def bpm(season,players):
 url=f'https://www.basketball-reference.com/leagues/NBA_{int(season[:4])+1}_advanced.html';text=get(url);out=[];index={norm(p['PLAYER_NAME']):p for p in players}
 for tr in re.findall(r'<tr\b.*?</tr>',text,re.S):
  cells={k:html.unescape(re.sub('<[^>]+>','',v)).strip() for k,v in re.findall(r'<t[dh][^>]*data-stat="([^"]+)"[^>]*>(.*?)</t[dh]>',tr,re.S)}
  name=cells.get('name_display',cells.get('player','')).replace('*','');p=index.get(norm(name))
  if not p or not cells.get('bpm'):continue
  try:out.append({'PLAYER_ID':p['PLAYER_ID'],'PLAYER_NAME':p['PLAYER_NAME'],'TEAM_ID':p['TEAM_ID'],'TEAM_ABBREVIATION':p['TEAM_ABBREVIATION'],**{k.upper():float(cells[k]) for k in ['bpm','obpm','dbpm','vorp','per','ws'] if cells.get(k)}})
  except ValueError:continue
 if not out:raise ValueError('No verified BPM table found')
 return pack(list({p['PLAYER_ID']:p for p in reversed(out)}.values()),'Basketball Reference',url,season)
def boxscore(gid):
 game=json.loads(get(f'https://cdn.nba.com/static/json/liveData/boxscore/boxscore_{gid}.json'))['game']
 if game.get('gameId')!=gid:raise ValueError('Boxscore game mismatch')
 if game.get('gameStatus')==3:
  for side in ['homeTeam','awayTeam']:
   team=game.get(side,{})
   if len(team.get('players',[]))<5 or sum(p.get('statistics',{}).get('points',0) for p in team['players'])!=team.get('score') or team.get('statistics',{}).get('points')!=team.get('score'):raise ValueError('Official final score and player totals are not yet consistent')
 return {'game':game,'source':'NBA.com','url':f'https://www.nba.com/game/{gid}/box-score','updatedAt':now(),'stale':False}
def normalize_game(g):
 def t(x):return {k:x.get(k) for k in ['teamId','teamName','teamCity','teamTricode','score','wins','losses']}
 return {'gameId':g['gameId'],'gameStatus':g['gameStatus'],'gameStatusText':g['gameStatusText'],'gameTimeUTC':g.get('gameDateTimeUTC',g.get('gameTimeUTC')),'homeTeam':t(g['homeTeam']),'awayTeam':t(g['awayTeam']),'arenaName':g.get('arenaName',''),'gameLabel':g.get('gameLabel','')}
def refresh(seasons):
 target=ROOT/'data/snapshot.json';old=json.loads(target.read_text()) if target.exists() else {'seasons':{},'boxes':{}};errors=[]
 def keep(key,job,fallback):
  try:
   r=job();print(key,len(r.get('rows',r.get('games',[]))),flush=True);return r
  except Exception as e:
   errors.append({'dataset':key,'error':str(e),'attemptedAt':now()});print(key,str(e),flush=True)
   return {**fallback,'stale':True,'warning':str(e),'attemptedAt':now()} if fallback else {'rows':[],'stale':True,'warning':str(e),'updatedAt':None,'attemptedAt':now()}
 out={'updatedAt':now(),'seasons':{},'boxes':old.get('boxes',{})}
 jobs={}
 with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
  for season in seasons:
   out['seasons'][season]={}
   for kind in ['players','teams','standings']:
    job=(lambda s=season:standings(s)) if kind=='standings' else (lambda k=kind,s=season:table(k,s))
    jobs[ex.submit(keep,kind+' '+season,job,old.get('seasons',{}).get(season,{}).get(kind))]=(season,kind)
  for f in concurrent.futures.as_completed(jobs):s,k=jobs[f];out['seasons'][s][k]=f.result()
 for season in seasons:
  prev=old.get('seasons',{}).get(season,{}).get('bpm')
  out['seasons'][season]['bpm']=keep('bpm '+season,lambda s=season:bpm(s,out['seasons'][s]['players']['rows']),prev)
  out['seasons'][season]['bpm'].update({'source':'Basketball Reference','url':f'https://www.basketball-reference.com/leagues/NBA_{int(season[:4])+1}_advanced.html','season':season})
 def schedule():
  raw=json.loads(get('https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json'))['leagueSchedule']
  return {'games':[normalize_game(g) for day in raw['gameDates'] for g in day['games']],'season':raw['seasonYear'],'source':'NBA.com','url':'https://www.nba.com/schedule','updatedAt':now(),'stale':False}
 out['schedule']=keep('schedule',schedule,old.get('schedule'))
 out['scoreboard']=keep('scoreboard',lambda:{**json.loads(get('https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json'))['scoreboard'],'source':'NBA.com','updatedAt':now(),'stale':False},old.get('scoreboard'))
 out['roster']=keep('roster',lambda:pack(stats('commonallplayers',{'LeagueID':'00','Season':seasons[-1],'IsOnlyCurrentSeason':1}),'NBA.com','https://www.nba.com/players',seasons[-1]),old.get('roster'))
 cutoff=dt.datetime.now(dt.timezone.utc)-dt.timedelta(days=14)
 recent=[g for g in out['schedule'].get('games',[]) if g['gameStatus'] in [2,3] and g['gameTimeUTC'] and dt.datetime.fromisoformat(g['gameTimeUTC'].replace('Z','+00:00'))>cutoff]
 # Keep completed boxes; revisit live, failed or missing games across the whole recent window.
 recent=[g for g in recent if g['gameStatus']==2 or out['boxes'].get(g['gameId'],{}).get('game',{}).get('gameStatus')!=3 or out['boxes'].get(g['gameId'],{}).get('stale')]
 with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
  futures={ex.submit(keep,'box '+g['gameId'],lambda gid=g['gameId']:boxscore(gid),out['boxes'].get(g['gameId'])):g['gameId'] for g in recent}
  for f,gid in futures.items():out['boxes'][gid]=f.result()
 out['errors']=errors;target.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n');print('Saved',target.stat().st_size,'bytes;',len(errors),'source warnings')
 if not any(x['players']['rows'] for x in out['seasons'].values()):raise SystemExit('No valid player data; refusing a silent empty snapshot')
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--seasons',nargs='+',default=['2024-25','2025-26','2026-27']);args=parser.parse_args();refresh(args.seasons)
