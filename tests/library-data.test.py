import json,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def read(path):return json.loads((ROOT/path).read_text())
class PlayerLibraryTests(unittest.TestCase):
 def test_directory_has_unique_real_ids_and_no_retired_current_team(self):
  index=read('data/player-index.json');rows=index['rows'];self.assertGreater(len(rows),5000);self.assertEqual(len(rows),len({p['id'] for p in rows}))
  for p in rows:
   self.assertGreater(p['id'],0);self.assertTrue(p['name'])
   if not p['active']:self.assertIsNone(p['teamId'])
   if p.get('directoryMissing'):self.assertFalse(p['active'])
 def test_known_bios_have_provenance_and_birthplace_is_not_a_guessed_country(self):
  profiles=read('data/player-profiles.json')['profiles'];self.assertGreater(len(profiles),600)
  lebron=profiles['2544'];self.assertEqual(lebron['birthDate'],'1984-12-30');self.assertEqual(lebron['draftYear'],2003)
  jordan=profiles['893'];self.assertEqual(jordan['birthPlace'],'Brooklyn');self.assertIn('nba.com',jordan['fieldSources']['birthPlace']['url'])
  for p in profiles.values():
   if p.get('birthPlace'):self.assertTrue(p['fieldSources']['birthPlace']['url'].startswith('https://'))
   if p.get('heightCm') is not None:self.assertGreater(p['heightCm'],100);self.assertLess(p['heightCm'],260)
 def test_archives_preserve_old_names_and_pergame_units(self):
  index=read('data/archive/index.json');self.assertGreaterEqual(len(index['seasons']),34)
  for entry in index['seasons']:
   data=read('data/archive/season-'+entry['season']+'.json')
   for resource,key in [('players','PLAYER_ID'),('teams','TEAM_ID')]:
    rows=data[resource]['rows'];self.assertEqual(len(rows),len({r[key] for r in rows}))
    for r in rows:
     self.assertGreater(r['GP'],0);self.assertGreaterEqual(r['PTS'],0);self.assertLess(r['PTS'],200)
     if r.get('FGA') is not None:self.assertLess(r['FGA'],100 if resource=='players' else 200);self.assertLessEqual(r['FGM'],r['FGA']+.001)
  kobe=next(r for r in read('data/archive/season-2005-06.json')['players']['rows'] if r['PLAYER_ID']==977);self.assertAlmostEqual(kobe['PTS'],35.4,delta=.05)
  teams=read('data/archive/season-1997-98.json')['teams']['rows'];sea=next(r for r in teams if r['TEAM_ID']==1610612760);self.assertNotIn('Thunder',sea['TEAM_NAME'])
 def test_zones_preserve_zero_missing_and_actual_counts(self):
  for path in (ROOT/'data/archive').glob('season-*.json'):
   data=json.loads(path.read_text())
   for r in data['shots']['rows']:
    self.assertEqual(len(r['zones']),len({z['key'] for z in r['zones']}))
    for z in r['zones']:
     if z['FGA'] is None:self.assertIsNone(z['FGM']);self.assertIsNone(z['FG_PCT']);continue
     self.assertGreaterEqual(z['FGA'],0);self.assertLessEqual(z['FGM'],z['FGA'])
     if z['FGA']==0:self.assertIsNone(z['FG_PCT'])
     else:self.assertAlmostEqual(z['FG_PCT'],z['FGM']/z['FGA'],delta=.001)
  self.assertFalse(read('data/archive/season-1983-84.json')['shots']['rows'])
 def test_career_source_totals_and_pergame_values_agree(self):
  career=read('data/careers/893.json');self.assertEqual(len(career['rows']),15)
  for row in career['rows']:
   self.assertAlmostEqual(row['PTS'],row['totals']['PTS']/row['GP'],delta=.001)
  wilt=read('data/careers/76375.json');season=next(r for r in wilt['rows'] if r['SEASON_ID']=='1961-62');self.assertAlmostEqual(season['PTS'],50.4,delta=.05)
 def test_classic_clips_are_official_user_started_embeds_with_fallback_links(self):
  moments=read('data/classic-moments.json');self.assertGreaterEqual(len(moments),6)
  kawhi=next(m for m in moments if m['id']=='kawhi-2019');self.assertEqual(kawhi['date'],'2019-05-12');self.assertEqual((kawhi['score']['home'],kawhi['score']['away']),(92,90))
  for m in moments:
   self.assertIn('www.youtube-nocookie.com/embed/',m['embedUrl']);self.assertNotIn('autoplay=',m['embedUrl']);self.assertTrue(m['sourceUrl'].startswith('https://www.nba.com/'));self.assertIn(m['videoPublisher'],['NBA','Golden State Warriors'])
   self.assertTrue((ROOT/'public'/m['poster']).exists());self.assertEqual(m['verification']['embedHttpStatus'],200)
if __name__=='__main__':unittest.main()
