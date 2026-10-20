#!/usr/bin/env python3
"""Settle the shared monthly picks using verified final NBA snapshot scores."""
from __future__ import annotations
import datetime as dt
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def final_games(snapshot):
    candidates = [*snapshot.get('schedule', {}).get('games', []), *snapshot.get('scoreboard', {}).get('games', [])]
    candidates.extend(box.get('game', {}) for box in snapshot.get('boxes', {}).values())
    out = {}
    for game in candidates:
        home, away = game.get('homeTeam', {}), game.get('awayTeam', {})
        hs, aws = home.get('score'), away.get('score')
        if game.get('gameStatus') == 3 and isinstance(hs, int) and not isinstance(hs, bool) and isinstance(aws, int) and not isinstance(aws, bool) and hs >= 0 and aws >= 0 and hs != aws:
            out[game['gameId']] = game
    return out

def settle_month(file, games, timestamp):
    if file.get('version') != 1 or not isinstance(file.get('predictions'), list):
        raise ValueError('Unsupported prediction file')
    changed = False
    predictions = []
    for pick in file['predictions']:
        game = games.get(pick.get('gameId'))
        next_pick = dict(pick)
        if game:
            home, away = game['homeTeam'], game['awayTeam']
            if pick.get('homeTeamId') == home.get('teamId') and pick.get('awayTeamId') == away.get('teamId') and pick.get('pickedTeamId') in [home.get('teamId'), away.get('teamId')]:
                result = {'winnerTeamId': home['teamId'] if home['score'] > away['score'] else away['teamId'], 'homeScore': home['score'], 'awayScore': away['score']}
                if any(pick.get('result', {}).get(k) != v for k, v in result.items()):
                    next_pick['result'] = {**result, 'settledAt': timestamp}
                    changed = True
        predictions.append(next_pick)
    return ({**file, 'updatedAt': timestamp, 'predictions': predictions} if changed else file), changed

def main():
    snapshot = json.loads((ROOT / 'data/snapshot.json').read_text())
    games = final_games(snapshot)
    timestamp = dt.datetime.now(dt.timezone.utc).isoformat()
    count = 0
    for path in sorted((ROOT / 'predictions').glob('20??-??.json')):
        file = json.loads(path.read_text())
        if file.get('month') != path.stem:
            raise ValueError(f'Month mismatch: {path.name}')
        result, changed = settle_month(file, games, timestamp)
        if changed:
            path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
            count += 1
    print(f'Settled prediction files: {count}')

if __name__ == '__main__':
    main()
