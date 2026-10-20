#!/usr/bin/env python3
"""Fetch NBA historical season tables, real shooting zones and selected player careers.

Successful historical resources are immutable cache hits by default. Current shooting
resources refresh with --refresh-current. No scraped/simulated shot coordinates.
"""
from __future__ import annotations
import argparse, concurrent.futures, datetime as dt, importlib.util, json, math, re
from pathlib import Path
from urllib.parse import urlencode

ROOT=Path(__file__).resolve().parents[1]
_spec=importlib.util.spec_from_file_location('nba_snapshot_collector',ROOT/'scripts/update-data.py')
nba=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(nba)
ARCHIVE=ROOT/'data/archive';CAREERS=ROOT/'data/careers'
DEFAULT_SEASONS=['1983-84','1987-88','1990-91']+[f'{year}-{str(year+1)[-2:]}' for year in range(1996,2027)]
DEFAULT_PLAYERS=[1628983,201939,2544,1641705,1628369,1629029,203999,203507,1630162,1628973,893,977,406,1495,77142,1449,165,1717,2548,947,708,959,76375,78049,76003,78497]
COUNT_KEYS={'MIN','FGM','FGA','FG3M','FG3A','FTM','FTA','OREB','DREB','REB','AST','TOV','STL','BLK','PF','PTS','PLUS_MINUS'}
ADVANCED={'OFF_RATING','DEF_RATING','NET_RATING','AST_PCT','AST_TO','OREB_PCT','DREB_PCT','REB_PCT','TM_TOV_PCT','EFG_PCT','TS_PCT','USG_PCT','PACE','PIE'}
ZONES={
 'Restricted Area':('restricted','篮下限制区'),
 'In The Paint (Non-RA)':('paint','禁区（非限制区）'),
 'Mid-Range':('midrange','中距离'),
 'Left Corner 3':('left-corner','左底角三分'),
 'Right Corner 3':('right-corner','右底角三分'),
 'Above the Break 3':('above-break','弧顶及两翼三分'),
 'Backcourt':('backcourt','后场'),
 'Corner 3':('corner-total','底角三分合计'),
}

def now():return dt.datetime.now(dt.timezone.utc).isoformat()
def envelope(rows,url,season=None,**more):return {'rows':rows,'source':'NBA.com','url':url,'season':season,'updatedAt':now(),'stale':False,**more}
def read(path,fallback):
 try:return json.loads(path.read_text())
 except (FileNotFoundError,json.JSONDecodeError):return fallback

def stats(endpoint,params):
 data=json.loads(nba.get('https://stats.nba.com/stats/'+endpoint+'?'+urlencode(params)))
 sets=data.get('resultSets',data.get('resultSet',[]));sets=[sets] if isinstance(sets,dict) else sets
 if not sets or not isinstance(sets[0].get('headers'),list):raise ValueError('NBA table format changed')
 return [dict(zip(sets[0]['headers'],row)) for row in sets[0]['rowSet']]

def per_game(row):
 result=dict(row);games=row.get('GP')
 if isinstance(games,(int,float)) and games>0:
  for key in COUNT_KEYS:
   value=row.get(key)
   if isinstance(value,(int,float)) and math.isfinite(value):result[key]=round(value/games,3)
 return result

def ensure_legacy_teams(workers=8,force=False):
 path=ARCHIVE/'team-history.json';cache=read(path,{'teams':{},'source':'NBA.com'})
 ids=set(range(1610612737,1610612767))
 missing=[team_id for team_id in ids if force or not cache['teams'].get(str(team_id))]
 if not missing:return
 with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
  jobs={pool.submit(stats,'teamyearbyyearstats',{'LeagueID':'00','TeamID':team_id,'PerMode':'Totals','SeasonType':'Regular Season'}):team_id for team_id in missing}
  for future in concurrent.futures.as_completed(jobs):
   team_id=jobs[future]
   try:
    rows=future.result()
    if not rows:raise ValueError('No team history')
    cache['teams'][str(team_id)]=rows;print('team history',team_id,len(rows),flush=True)
   except Exception as error:print('WARNING team history',team_id,str(error),flush=True)
 cache['updatedAt']=now();cache['url']='https://www.nba.com/stats/teams/traditional'
 path.write_text(json.dumps(cache,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n')

def legacy_teams(season):
 cache=read(ARCHIVE/'team-history.json',{'teams':{}})
 saved=read(ARCHIVE/f'season-{season}.json',{})
 expected={row['TeamID'] for row in saved.get('standings',{}).get('rows',[])}
 team_codes={row.get('TEAM_ID'):row.get('TEAM_ABBREVIATION') for row in saved.get('players',{}).get('rows',[])}
 out=[]
 for history in cache.get('teams',{}).values():
  for raw in history:
   if raw.get('YEAR')!=season or (expected and raw.get('TEAM_ID') not in expected):continue
   row={**per_game(raw),'TEAM_NAME':(raw.get('TEAM_CITY','')+' '+raw.get('TEAM_NAME','')).strip(),'TEAM_ABBREVIATION':team_codes.get(raw['TEAM_ID']),'W':raw.get('WINS'),'L':raw.get('LOSSES'),'W_PCT':raw.get('WIN_PCT')}
   out.append({k:v for k,v in row.items() if k in nba.KEEP})
 if not out:raise ValueError('No verified old team table')
 if expected and len(out)!=len(expected):raise ValueError(f'Incomplete old team coverage {len(out)}/{len(expected)}')
 return envelope(out,f'https://www.nba.com/stats/teams/traditional?Season={season}&PerMode=PerGame',season,perMode='PerGame',advancedAvailable=False,countConversion='Official TeamYearByYearStats totals divided by GP')

def league_table(kind,season):
 endpoint='leaguedashplayerstats' if kind=='players' else 'leaguedashteamstats'
 params=nba.params(season);params['PerMode']='Totals'
 base=stats(endpoint,params)
 if not base and int(season[:4])<1996 and kind=='players':
  legacy=stats('leagueleaders',{'LeagueID':'00','PerMode':'Totals','Scope':'S','Season':season,'SeasonType':'Regular Season','StatCategory':'PTS'})
  if not legacy:raise ValueError('NBA returned no historical table')
  rows=[{k:v for k,v in {**per_game(row),'PLAYER_NAME':row.get('PLAYER'),'TEAM_ABBREVIATION':row.get('TEAM')}.items() if k in nba.KEEP} for row in legacy]
  return envelope(rows,f'https://www.nba.com/stats/players/traditional?Season={season}&PerMode=PerGame',season,perMode='PerGame',advancedAvailable=False,scope='NBA LeagueLeaders Totals Scope=S, including all played players; divided by GP')
 if not base and int(season[:4])<1996 and kind=='teams':return legacy_teams(season)
 if not base and int(season[:4])<2026:raise ValueError('NBA returned no historical table')
 params=nba.params(season,'Advanced')
 try:advanced=stats(endpoint,params)
 except Exception:advanced=[]
 key='PLAYER_ID' if kind=='players' else 'TEAM_ID';index={row[key]:row for row in advanced}
 rows=[]
 for raw in base:
  row={k:v for k,v in per_game(raw).items() if k in nba.KEEP}
  row.update({k:v for k,v in index.get(raw[key],{}).items() if k in ADVANCED})
  rows.append(row)
 return envelope(rows,f'https://www.nba.com/stats/{kind}/traditional?Season={season}&PerMode=PerGame',season,perMode='PerGame',countConversion='NBA Totals divided by GP; percentage fields kept from source',advancedAvailable=bool(advanced))

def shooting_zones(season):
 if int(season[:4])<1996:return {'rows':[],'source':'NBA.com','season':season,'updatedAt':None,'stale':False,'unavailable':True,'warning':'NBA shooting-area archive starts with 1996-97; no earlier locations are invented.'}
 params=nba.params(season);params.update({'DistanceRange':'By Zone','PerMode':'Totals','MeasureType':'Base'})
 data=json.loads(nba.get('https://stats.nba.com/stats/leaguedashplayershotlocations?'+urlencode(params)))
 sets=data.get('resultSets',data.get('resultSet',{}));table=sets[0] if isinstance(sets,list) else sets
 headers=table.get('headers',[])
 if len(headers)<2 or 'columnNames' not in headers[0]:raise ValueError('NBA shot-zone header changed')
 skip=headers[0]['columnsToSkip'];span=headers[0]['columnSpan'];zone_names=headers[0]['columnNames'];basic=headers[1]['columnNames'][:skip]
 rows=[]
 for values in table.get('rowSet',[]):
  identity=dict(zip(basic,values[:skip]));zones=[]
  for index,label in enumerate(zone_names):
   if label not in ZONES:continue
   start=skip+index*span;made,attempted,pct=values[start:start+3]
   key,translated=ZONES[label]
   valid=isinstance(made,(int,float)) and isinstance(attempted,(int,float)) and made>=0 and attempted>=made
   zone={'key':key,'label':translated,'FGM':made if valid else None,'FGA':attempted if valid else None,'FG_PCT':pct if valid and attempted else None}
   if not valid:zone['available']=False
   if key=='corner-total':zone['aggregated']=True
   zones.append(zone)
  if any(zone.get('available',True) for zone in zones):rows.append({k:identity[k] for k in ['PLAYER_ID','PLAYER_NAME','TEAM_ID','TEAM_ABBREVIATION'] if k in identity}|{'zones':zones})
 if not rows and int(season[:4])<2026:raise ValueError('No verified shot-zone table for this season')
 return envelope(rows,f'https://www.nba.com/stats/players/shooting?Season={season}&DistanceRange=By+Zone&PerMode=Totals',season,perMode='Totals',definition='NBA official shooting areas; Corner 3 is the overlapping sum of both corners, not an additional area',zoneDefinitions=[{'key':key,'label':translated,'sourceLabel':label} for label,(key,translated) in ZONES.items()])

def standings(season):
 return envelope(stats('leaguestandingsv3',{'LeagueID':'00','Season':season,'SeasonType':'Regular Season'}),f'https://www.nba.com/standings?Season={season}',season)

def career(player_id):
 params={'PlayerID':player_id,'PerMode':'Totals','LeagueID':'00'}
 data=json.loads(nba.get('https://stats.nba.com/stats/playercareerstats?'+urlencode(params)))
 tables={table['name']:[dict(zip(table['headers'],row)) for row in table['rowSet']] for table in data.get('resultSets',[])}
 rows=tables.get('SeasonTotalsRegularSeason',[])
 if not rows:raise ValueError('No NBA career table')
 def convert(row):
  out=per_game(row)
  # Exact source totals are retained for validation and cumulative statistics.
  out['totals']={k:v for k,v in row.items() if k in COUNT_KEYS}
  return out
 return {'playerId':player_id,'rows':[convert(row) for row in rows], 'totals':(tables.get('CareerTotalsRegularSeason') or [None])[0], 'playoffs':[convert(row) for row in tables.get('SeasonTotalsPostSeason',[])], 'playoffTotals':(tables.get('CareerTotalsPostSeason') or [None])[0], 'source':'NBA.com','url':f'https://www.nba.com/stats/player/{player_id}/traditional','updatedAt':now(),'stale':False,'perMode':'PerGame','countConversion':'Source Totals divided by GP; source totals retained under totals'}

def normalize_recent_snapshot(table,resource):
 result={**table,'rows':[dict(row) for row in table.get('rows',[])]}
 if resource not in ['players','teams']:return result
 # Recover snapshots made by the former unrestricted Base/Advanced merge.
 # Normal NBA per-game attempts cannot reach these season-total magnitudes.
 threshold=100 if resource=='players' else 1000
 if max((row.get('FGA') or 0 for row in result['rows']),default=0)>threshold:
  for row in result['rows']:
   gp=row.get('GP') or 0
   if gp:
    for key in ['FGM','FGA']:
     if isinstance(row.get(key),(int,float)):row[key]=round(row[key]/gp,3)
  result['perMode']='PerGame';result['countConversion']='FGM/FGA restored from source Advanced totals divided by GP; other base fields remain NBA PerGame values'
 return result

def refresh(seasons,players,workers=8,force=False,refresh_current=False):
 ARCHIVE.mkdir(parents=True,exist_ok=True);CAREERS.mkdir(parents=True,exist_ok=True)
 if any(int(season[:4])<1996 for season in seasons):ensure_legacy_teams(workers,force)
 snapshot=read(ROOT/'data/snapshot.json',{'seasons':{}});files={};jobs={};warnings=[]
 current_year=dt.datetime.now(dt.timezone.utc).year
 if dt.datetime.now(dt.timezone.utc).month<7:current_year-=1
 with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
  for season in seasons:
   if not re.fullmatch(r'\d{4}-\d{2}',season):raise ValueError('Invalid season')
   file=read(ARCHIVE/f'season-{season}.json',{'season':season})
   if season in snapshot.get('seasons',{}):
    # Reuse already verified recent tables rather than downloading them twice.
    for resource in ['players','teams','standings','bpm']:
     if resource in snapshot['seasons'][season]:file[resource]=normalize_recent_snapshot(snapshot['seasons'][season][resource],resource)
   file.setdefault('bpm',{'rows':[],'source':'Basketball Reference','url':f'https://www.basketball-reference.com/leagues/NBA_{int(season[:4])+1}_advanced.html','season':season,'updatedAt':None,'stale':True,'warning':'No verified BPM archive; NBA impact metrics are not substituted for BPM.'})
   files[season]=file
   for resource,loader in [('players',lambda s=season:league_table('players',s)),('teams',lambda s=season:league_table('teams',s)),('standings',lambda s=season:standings(s)),('shots',lambda s=season:shooting_zones(s))]:
    previous=file.get(resource)
    good=bool(previous and (previous.get('rows') or previous.get('unavailable')) and not previous.get('stale'))
    if good and not force and not (refresh_current and int(season[:4])>=current_year and resource=='shots'):continue
    if not force and resource in ['players','teams','standings'] and season in snapshot.get('seasons',{}):continue
    jobs[pool.submit(loader)]=(season,resource)
  for future in concurrent.futures.as_completed(jobs):
   season,resource=jobs[future]
   try:
    result=future.result();files[season][resource]=result;print(season,resource,len(result.get('rows',[])),flush=True)
   except Exception as error:
    previous=files[season].get(resource);warning=str(error);warnings.append({'season':season,'resource':resource,'warning':warning})
    files[season][resource]={**(previous or {'rows':[],'source':'NBA.com','updatedAt':None}),'season':season,'stale':True,'attemptedAt':now(),'warning':warning}
    print('WARNING',season,resource,warning,flush=True)
  for season,file in files.items():
   if file==read(ARCHIVE/f'season-{season}.json',{}):continue
   file['updatedAt']=now();(ARCHIVE/f'season-{season}.json').write_text(json.dumps(file,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n')
  for player_id in players:
   path=CAREERS/f'{player_id}.json';previous=read(path,None)
   if previous and previous.get('rows') and not previous.get('stale') and not force:continue
   jobs[pool.submit(career,player_id)]=player_id
  # Only newly submitted career futures are processed here.
  for future in concurrent.futures.as_completed([f for f,value in jobs.items() if isinstance(value,int)]):
   player_id=jobs[future];path=CAREERS/f'{player_id}.json'
   try:
    result=future.result();path.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n');print('career',player_id,len(result['rows']),flush=True)
   except Exception as error:
    warnings.append({'playerId':player_id,'warning':str(error)});print('WARNING career',player_id,str(error),flush=True)
 index=[]
 for path in sorted(ARCHIVE.glob('season-*.json'),reverse=True):
  file=read(path,{})
  if not file:continue
  resources=[name for name in ['players','teams','standings','shots','bpm'] if file.get(name,{}).get('rows')]
  index.append({'season':file['season'],'availableResources':resources,'updatedAt':file.get('updatedAt'),'rowCounts':{name:len(file.get(name,{}).get('rows',[])) for name in resources}})
 (ARCHIVE/'index.json').write_text(json.dumps({'seasons':index,'updatedAt':now(),'source':'NBA.com','warnings':warnings},ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n')
 print('Archive:',len(index),'seasons;',len(list(CAREERS.glob('*.json'))),'career files;',len(warnings),'warnings',flush=True)

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--seasons',nargs='+',default=DEFAULT_SEASONS);parser.add_argument('--players',nargs='*',type=int,default=DEFAULT_PLAYERS);parser.add_argument('--workers',type=int,default=8);parser.add_argument('--force',action='store_true');parser.add_argument('--refresh-current',action='store_true');args=parser.parse_args()
 refresh(args.seasons,args.players,max(1,min(args.workers,8)),args.force,args.refresh_current)
