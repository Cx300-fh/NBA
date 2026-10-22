import datetime as dt,importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
DATA=json.loads((Path(__file__).resolve().parents[1]/'data/snapshot.json').read_text())
spec=importlib.util.spec_from_file_location('nba_collector',Path(__file__).resolve().parents[1]/'scripts/update-data.py')
collector=importlib.util.module_from_spec(spec);spec.loader.exec_module(collector)
live_spec=importlib.util.spec_from_file_location('nba_live_collector',Path(__file__).resolve().parents[1]/'scripts/update-live-data.py')
live=importlib.util.module_from_spec(live_spec);live_spec.loader.exec_module(live)
class SnapshotTests(unittest.TestCase):
 def test_all_conferences_have_15_unique_teams(self):
  for season,s in DATA['seasons'].items():
   standings=s['standings']['rows'];self.assertEqual(len({r['TeamID'] for r in standings}),30)
   for conf in ['East','West']:self.assertEqual(len([r for r in standings if r['Conference']==conf]),15)
 def test_complete_season_stats_are_real_and_consistent(self):
  for season in ['2024-25','2025-26']:
   s=DATA['seasons'][season];self.assertGreater(len(s['players']['rows']),450);self.assertEqual(len(s['teams']['rows']),30)
   for p in s['players']['rows']:
    self.assertGreater(p['PLAYER_ID'],0);self.assertLessEqual(p['FG3_PCT'],1);self.assertGreaterEqual(p['PTS'],0)
 def test_no_duplicate_games_and_all_dates_are_utc(self):
  games=DATA['schedule']['games'];self.assertGreater(len(games),1000);self.assertEqual(len({g['gameId'] for g in games}),len(games))
  for g in games:self.assertTrue(g['gameTimeUTC'].endswith('Z'))
 def test_missing_bpm_is_explicit_and_not_fabricated(self):
  for season,s in DATA['seasons'].items():
   d=s['bpm'];self.assertEqual(d['source'],'Basketball Reference')
   if not d['rows']:self.assertTrue(d['stale']);self.assertTrue(d['warning']);self.assertIsNone(d['updatedAt'])
 def test_boxscores_have_verified_rosters(self):
  for gid,box in DATA['boxes'].items():
   if 'game' not in box:continue
   g=box['game'];self.assertEqual(g['gameId'],gid)
   for t in ['homeTeam','awayTeam']:
    self.assertGreater(len(g[t]['players']),5);self.assertEqual(sum(p['statistics']['points'] for p in g[t]['players']),g[t]['score'])
class CollectorSafetyTests(unittest.TestCase):
 def test_verified_bpm_archive_survives_a_source_outage_with_original_timestamp(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);(root/'data/archive').mkdir(parents=True)
   table={'rows':[{'PLAYER_ID':1,'BPM':5.4}],'source':'Basketball Reference','season':'2025-26','updatedAt':'2026-10-20T12:00:00Z'}
   (root/'data/archive/season-2025-26.json').write_text(json.dumps({'bpm':table}))
   def denied():raise OSError('HTTP Error 403: Forbidden')
   with patch.object(collector,'ROOT',root):fallback=collector.bpm_fallback('2025-26',{'rows':[],'updatedAt':None})
   result=collector.refresh_resource('bpm 2025-26',denied,fallback,[])
   self.assertEqual(result['rows'],table['rows']);self.assertEqual(result['updatedAt'],table['updatedAt']);self.assertTrue(result['stale']);self.assertIn('403',result['warning'])
   with patch.object(collector,'ROOT',root):self.assertIsNone(collector.bpm_fallback('2026-27',None))
 def test_empty_upstream_cannot_erase_verified_statistics(self):
  previous={'rows':[{'PLAYER_ID':1,'PTS':22}],'updatedAt':'2026-10-21T12:00:00Z','stale':False};errors=[]
  result=collector.refresh_resource('players 2026-27',lambda:{'rows':[],'updatedAt':'2026-10-22T12:00:00Z'},previous,errors)
  self.assertEqual(result['rows'],previous['rows']);self.assertEqual(result['updatedAt'],previous['updatedAt']);self.assertTrue(result['stale']);self.assertEqual(len(errors),1)
 def test_new_season_can_legitimately_be_empty_before_official_statistics_exist(self):
  result=collector.refresh_resource('players 2026-27',lambda:{'rows':[],'updatedAt':'2026-10-01T12:00:00Z','stale':False},None,[])
  self.assertEqual(result['rows'],[]);self.assertFalse(result['stale'])
 def test_a_new_nba_day_without_games_does_not_keep_yesterdays_scoreboard(self):
  result=collector.refresh_resource('scoreboard',lambda:{'games':[],'gameDate':'2026-10-23','stale':False},{'games':[{'gameId':'0022600001'}],'gameDate':'2026-10-22'},[])
  self.assertEqual(result['games'],[]);self.assertEqual(result['gameDate'],'2026-10-23');self.assertFalse(result['stale'])
 def test_targeted_refresh_preserves_other_seasons_and_uses_latest_season_for_roster(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);(root/'data').mkdir();target=root/'data/snapshot.json'
   old={'seasons':{'2023-24':{'players':{'rows':[{'PLAYER_ID':1,'PTS':20}]}}},'boxes':{}}
   target.write_text(json.dumps(old));rosters=[]
   def stats(endpoint,params):
    rosters.append(params['Season']);return [{'PERSON_ID':7}]
   def get(url):
    return json.dumps({'leagueSchedule':{'gameDates':[],'seasonYear':'2026-27'}} if 'scheduleLeague' in url else {'scoreboard':{'games':[]}})
   with patch.object(collector,'ROOT',root),patch.object(collector,'table',lambda kind,season:{'rows':[{'PLAYER_ID':2}]}),patch.object(collector,'standings',lambda season:{'rows':[{'TeamID':1}]}),patch.object(collector,'bpm',lambda season,players:{'rows':[]}),patch.object(collector,'stats',stats),patch.object(collector,'get',get):
    collector.refresh(['2026-27','2024-25'])
   result=json.loads(target.read_text());self.assertEqual(result['seasons']['2023-24'],old['seasons']['2023-24']);self.assertEqual(rosters,['2026-27']);self.assertEqual(result['roster']['season'],'2026-27');self.assertFalse(target.with_suffix('.json.tmp').exists())
class LiveFeedTests(unittest.TestCase):
 def test_feed_rejects_another_season_and_incomplete_advanced_statistics(self):
  for resource,data in [('players',{'season':'2025-26','rows':[]}),('players',{'season':'2026-27','rows':[{'PLAYER_ID':1,'PTS':20}]}),('schedule',{'season':'2026-27','games':[{'gameId':'0022500001'}]})]:
   with self.assertRaises(ValueError):live.verify(resource,data,'2026-27')
 def test_feed_failures_preserve_source_time_and_skip_verified_final_boxscores(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);output=root/'data/live';output.mkdir(parents=True);clock=dt.datetime(2026,10,22,12,tzinfo=dt.timezone.utc)
   previous={'rows':[{'PLAYER_ID':1,'PTS':24,'OFF_RATING':112,'TS_PCT':.6}],'season':'2026-27','source':'NBA.com','updatedAt':'2026-10-22T11:50:00Z','stale':False}
   live.write(output/'players-2026-27.json',previous)
   game={'gameId':'0022600001','gameStatus':3,'gameStatusText':'Final','gameTimeUTC':'2026-10-22T10:00:00Z','homeTeam':{'teamId':1},'awayTeam':{'teamId':2}}
   def table(kind,season):
    if kind=='players':raise OSError('NBA unavailable')
    return {'rows':[{'TEAM_ID':2,'PTS':110,'OFF_RATING':112,'TS_PCT':.6}],'season':season,'updatedAt':'2026-10-22T12:00:00Z','stale':False}
   def get(url):return json.dumps({'leagueSchedule':{'gameDates':[{'games':[game]}],'seasonYear':'2026-27'}} if 'scheduleLeague' in url else {'scoreboard':{'games':[game],'gameDate':'2026-10-22'}})
   def box(game_id):
    team={'score':5,'statistics':{'points':5},'players':[{'statistics':{'points':1}} for _ in range(5)]}
    return {'game':{'gameId':game_id,'gameStatus':3,'homeTeam':team,'awayTeam':team},'updatedAt':'2026-10-22T12:00:00Z','stale':False,'source':'NBA.com'}
   def pack(rows):return {'rows':rows,'season':'2026-27','updatedAt':'2026-10-22T12:00:00Z','stale':False,'source':'NBA.com'}
   with patch.object(live,'ROOT',root),patch.object(live.nba,'table',table),patch.object(live.nba,'standings',lambda season:pack([{'TeamID':i} for i in range(30)])),patch.object(live.archive,'shooting_zones',lambda season:pack([{'PLAYER_ID':1,'zones':[]}])) as shots,patch.object(live.nba,'stats',lambda endpoint,params:[{'PERSON_ID':1}]),patch.object(live.nba,'get',get),patch.object(live.nba,'now',lambda:'2026-10-22T12:00:00Z'),patch.object(live.nba,'boxscore',side_effect=box) as boxes:
    live.refresh('2026-27',output,clock=clock)
    with patch.object(live.archive,'shooting_zones',side_effect=AssertionError('shots refreshed before 15 minutes')),patch.object(live.nba,'stats',side_effect=AssertionError('roster refreshed before one hour')):
     live.refresh('2026-27',output,clock=clock+dt.timedelta(minutes=5))
    self.assertEqual(boxes.call_count,1)
   retained=live.read(output/'players-2026-27.json');self.assertEqual(retained['rows'],previous['rows']);self.assertEqual(retained['updatedAt'],previous['updatedAt']);self.assertTrue(retained['stale']);self.assertEqual(retained['refreshIntervalSeconds'],300)
   self.assertEqual(live.read(output/'schedule.json')['games'][0]['gameId'],'0022600001');self.assertFalse(live.read(output/'schedule.json')['stale']);self.assertTrue((output/'scoreboard.json').exists());self.assertTrue((output/'shots-2026-27.json').exists());self.assertFalse((output/'players-2025-26.json').exists())
if __name__=='__main__':unittest.main()
