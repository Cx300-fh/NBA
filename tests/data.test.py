import json,unittest
from pathlib import Path
DATA=json.loads((Path(__file__).resolve().parents[1]/'data/snapshot.json').read_text())
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
if __name__=='__main__':unittest.main()
