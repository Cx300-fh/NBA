import importlib.util
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('settle', Path(__file__).resolve().parents[1] / 'scripts/settle-predictions.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class SettlementTest(unittest.TestCase):
    def setUp(self):
        self.game = {'gameId': '0022600001', 'gameStatus': 3, 'homeTeam': {'teamId': 1610612747, 'score': 115}, 'awayTeam': {'teamId': 1610612744, 'score': 110}}
        self.pick = {'gameId': '0022600001', 'homeTeamId': 1610612747, 'awayTeamId': 1610612744, 'pickedTeamId': 1610612747, 'createdAt': '2026-10-20T00:00:00Z'}
        self.file = {'version': 1, 'month': '2026-10', 'updatedAt': None, 'predictions': [self.pick]}
    def test_only_finals_with_real_scores_settle(self):
        self.assertEqual(module.final_games({'schedule': {'games': [{**self.game, 'gameStatus': 2}]}}), {})
        self.assertEqual(module.final_games({'schedule': {'games': [{**self.game, 'homeTeam': {'score': None}}]}}), {})
        self.assertEqual(module.final_games({'schedule': {'games': [self.game]}})['0022600001'], self.game)
    def test_updates_result_once_preserving_prediction_time(self):
        result, changed = module.settle_month(self.file, {'0022600001': self.game}, '2026-10-22T10:00:00Z')
        self.assertTrue(changed)
        self.assertEqual(result['predictions'][0]['result']['winnerTeamId'], self.pick['homeTeamId'])
        self.assertEqual(result['predictions'][0]['createdAt'], self.pick['createdAt'])
        repeated, changed = module.settle_month(result, {'0022600001': self.game}, '2026-10-23T10:00:00Z')
        self.assertFalse(changed)
        self.assertEqual(repeated, result)
    def test_wrong_teams_and_missing_games_remain_pending(self):
        result, changed = module.settle_month(self.file, {}, 'now')
        self.assertFalse(changed)
        wrong = {**self.game, 'homeTeam': {**self.game['homeTeam'], 'teamId': 123}}
        result, changed = module.settle_month(self.file, {'0022600001': wrong}, 'now')
        self.assertFalse(changed)
        self.assertNotIn('result', result['predictions'][0])
    def test_score_corrections_update_the_result(self):
        result, _ = module.settle_month(self.file, {'0022600001': self.game}, 'first')
        correction = {**self.game, 'awayTeam': {**self.game['awayTeam'], 'score': 120}}
        result, changed = module.settle_month(result, {'0022600001': correction}, 'corrected')
        self.assertTrue(changed)
        self.assertEqual(result['predictions'][0]['result']['winnerTeamId'], self.pick['awayTeamId'])

if __name__ == '__main__':
    unittest.main()
