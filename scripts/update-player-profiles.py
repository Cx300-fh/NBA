#!/usr/bin/env python3
"""Refresh NBA player directory and personal bios; provenance is kept per field.

No credentials. NBA names/IDs and roster status remain authoritative. ESPN's
birthplace is joined only by unique normalized full name AND matching birthday.
Birthplace is not labelled hometown; unavailable fields remain null.
"""
from __future__ import annotations
import argparse
import concurrent.futures
import datetime as dt
import json
import re
import time
import unicodedata
import urllib.request
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
HEADERS = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.nba.com/', 'Origin': 'https://www.nba.com'}
LEGENDS = [893, 977, 406, 1495, 77142, 1449, 165, 1717, 2548, 947, 708, 959, 76375, 78049, 76003, 78497, 305, 504, 787, 121, 1713, 304, 173, 600014]
# Primary NBA IDs only. These historical players are fetched by the official ID,
# not inferred from a similarly named ESPN entry.
BIO_FIELDS = ['name','slug','position','jersey','height','heightCm','weightLb','weightKg','college','country','draftYear','draftRound','draftNumber','undrafted','fromYear','toYear','birthDate','hometown','experience','rosterStatus']

def now(): return dt.datetime.now(dt.timezone.utc).isoformat()
def get(url, retries=1):
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=18) as response:
                return json.load(response)
        except Exception:
            if attempt >= retries: raise
            time.sleep(.2)

def result_sets(data):
    sets = data.get('resultSets', data.get('resultSet', []))
    return [sets] if isinstance(sets, dict) else sets

def unpack(data, index=0):
    table = result_sets(data)[index]
    return [dict(zip(table['headers'], row)) for row in table['rowSet']], table['headers']

def integer(value):
    if value is None or str(value).strip() in ['', 'None', 'nan', 'Undrafted', 'Undrafted Player']: return None
    try:
        f = float(value)
        return int(f) if f.is_integer() else None
    except (ValueError, TypeError): return None

def undrafted(value):
    if isinstance(value, str) and 'undrafted' in value.lower(): return True
    return False if integer(value) else None

def word(value):
    return str(value).strip() if value is not None and str(value).strip() not in ['', 'None', 'nan', 'N/A'] else None

def height_cm(value):
    match = re.fullmatch(r'(\d+)-(\d+)', value or '')
    return round((int(match[1]) * 12 + int(match[2])) * 2.54, 1) if match and int(match[1]) > 0 else None

def name_key(value):
    return ''.join(c for c in unicodedata.normalize('NFKD', str(value)).casefold() if c.isalnum())

def source(name, url, stamp): return {'source': name, 'url': url, 'updatedAt': stamp}
def load(path, default):
    try: return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError): return default

def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n')
    temporary.replace(path)

def basic_row(raw, common, stamp, index_url):
    player_id = integer(raw.get('PERSON_ID', common.get('PERSON_ID')))
    active = integer(common.get('ROSTERSTATUS')) == 1
    # playerindex may list a representative historical team, not a final team.
    # Only currently rostered players get teamId.
    tid = integer(common.get('TEAM_ID')) if active else None
    draft_year = raw.get('DRAFT_YEAR')
    height, weight = word(raw.get('HEIGHT')), (integer(raw.get('WEIGHT')) or None)
    name = (' '.join(str(raw.get(key) or '').strip() for key in ['PLAYER_FIRST_NAME', 'PLAYER_LAST_NAME'])).strip() or common.get('DISPLAY_FIRST_LAST')
    return {'id': player_id, 'name': name, 'slug': word(raw.get('PLAYER_SLUG')) or word(common.get('PLAYER_SLUG')), 'active': active,
            'teamId': tid if tid and tid > 0 else None, 'teamCode': word(common.get('TEAM_ABBREVIATION')) if active else None,
            'listedTeamId': integer(raw.get('TEAM_ID')) or None, 'listedTeamCode': word(raw.get('TEAM_ABBREVIATION')),
            'listedTeamName': ' '.join(str(raw.get(key) or '').strip() for key in ['TEAM_CITY', 'TEAM_NAME']).strip() or None,
            'position': word(raw.get('POSITION')), 'jersey': word(raw.get('JERSEY_NUMBER')), 'height': height, 'heightCm': height_cm(height),
            'weightLb': weight, 'weightKg': round(weight * .45359237, 1) if weight is not None else None,
            'college': word(raw.get('COLLEGE')), 'country': word(raw.get('COUNTRY')), 'draftYear': (integer(draft_year) or None),
            'draftRound': (integer(raw.get('DRAFT_ROUND')) or None), 'draftNumber': (integer(raw.get('DRAFT_NUMBER')) or None),
            'undrafted': undrafted(draft_year),
            'fromYear': integer(raw.get('FROM_YEAR', common.get('FROM_YEAR'))), 'toYear': integer(raw.get('TO_YEAR', common.get('TO_YEAR'))),
            'birthDate': None, 'birthPlace': None, 'hometown': None, 'birthPlaceDetails': None, 'rosterStatus': 'Active' if active else None, 'experience': None,
            'careerPts': raw.get('PTS'), 'careerReb': raw.get('REB'), 'careerAst': raw.get('AST'), 'statsTimeframe': raw.get('STATS_TIMEFRAME'),
            'source': 'NBA.com', 'sourceUrl': index_url, 'updatedAt': stamp}

def detail_row(base, raw, stamp, url):
    result = dict(base)
    height, weight = word(raw.get('HEIGHT')), (integer(raw.get('WEIGHT')) or None)
    year = raw.get('DRAFT_YEAR')
    values = {'name': word(raw.get('DISPLAY_FIRST_LAST')), 'slug': word(raw.get('PLAYER_SLUG')), 'position': word(raw.get('POSITION')), 'jersey': word(raw.get('JERSEY')),
              'height': height, 'heightCm': height_cm(height), 'weightLb': weight, 'weightKg': round(weight * .45359237, 1) if weight is not None else None,
              'college': word(raw.get('SCHOOL')), 'country': word(raw.get('COUNTRY')), 'draftYear': (integer(year) or None), 'draftRound': (integer(raw.get('DRAFT_ROUND')) or None),
              'draftNumber': (integer(raw.get('DRAFT_NUMBER')) or None), 'undrafted': undrafted(year),
              'fromYear': integer(raw.get('FROM_YEAR')), 'toYear': integer(raw.get('TO_YEAR')), 'birthDate': str(raw['BIRTHDATE'])[:10] if raw.get('BIRTHDATE') else None,
              'rosterStatus': word(raw.get('ROSTERSTATUS')), 'experience': integer(raw.get('SEASON_EXP'))}
    provenance = {key:source('NBA.com', base['sourceUrl'], base['updatedAt']) for key in BIO_FIELDS if base.get(key) is not None}
    provenance.update(base.get('fieldSources', {}))
    for key, value in values.items():
        if value is not None:
            result[key] = value
            provenance[key] = source('NBA.com', url, stamp)
    result.update({'fieldSources': provenance, 'detailUpdatedAt': stamp, 'profileUrl': f'https://www.nba.com/player/{base["id"]}/{result.get("slug") or ""}', 'nbaInfo': raw})
    return result

def refresh(args):
    stamp = now()
    index_path, profile_path = ROOT / 'data/player-index.json', ROOT / 'data/player-profiles.json'
    previous_index = load(index_path, {'rows': []})
    previous_profiles = load(profile_path, {'profiles': {}})
    profiles = previous_profiles.get('profiles', {})
    warnings = []
    index_url = 'https://stats.nba.com/stats/playerindex?' + urlencode({'LeagueID':'00','Season':args.season,'Historical':'1'})
    all_url = 'https://stats.nba.com/stats/commonallplayers?' + urlencode({'LeagueID':'00','Season':args.season,'IsOnlyCurrentSeason':'0'})
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            ix_future, all_future = pool.submit(get, index_url), pool.submit(get, all_url)
            raw_rows, headers = unpack(ix_future.result())
            common_rows, roster_headers = unpack(all_future.result())
        if len(raw_rows) < 4000 or len(common_rows) < 4000: raise ValueError('Incomplete NBA historical directory')
        common_by_id = {int(r['PERSON_ID']): r for r in common_rows}
        by_id = {int(r['PERSON_ID']): basic_row(r, common_by_id.get(int(r['PERSON_ID']), {}), stamp, index_url) for r in raw_rows}
        for raw in common_rows:
            pid = int(raw['PERSON_ID'])
            if pid not in by_id: by_id[pid] = basic_row({}, raw, stamp, all_url)
        # Preserve previously verified IDs when an upstream directory shrinks,
        # while explicitly withdrawing any current-roster claim for a missing ID.
        retained = {str(row['id']): row for row in previous_index.get('rows', [])}
        retained.update(profiles)
        for old in retained.values():
            pid = int(old['id'])
            if pid not in by_id:
                row = {k:v for k,v in old.items() if k not in ['nbaInfo','fieldSources','lastTeamId','lastTeamCode','lastTeamName']}
                row.update({'active':False,'teamId':None,'teamCode':None,'directoryMissing':True,'directoryCheckedAt':stamp})
                by_id[pid] = row
        for pid, row in by_id.items():
            old = profiles.get(str(pid))
            if old:
                recovered = old
                if old.get('nbaInfo', {}).get('PERSON_ID') == pid:
                    info_url = 'https://stats.nba.com/stats/commonplayerinfo?' + urlencode({'PlayerID':pid,'LeagueID':'00'})
                    recovered = detail_row({**old, **row}, old['nbaInfo'], old.get('detailUpdatedAt') or stamp, info_url)
                for key in BIO_FIELDS:
                    if row.get(key) is None and recovered.get(key) is not None: row[key] = recovered[key]
                    elif row.get(key) is None and old.get(key) is not None: row[key] = old[key]
                for key in ['birthDate','birthPlace','birthPlaceDetails','hometown','profileUrl','detailUpdatedAt','espnId']:
                    if key in old: row[key] = old[key]
        index = {'version':1,'season':args.season,'source':'NBA.com','url':'https://www.nba.com/players','sourceUrls':[index_url,all_url],
                 'updatedAt':stamp,'stale':False,'headers':headers,'rosterHeaders':roster_headers,'rows':sorted(by_id.values(), key=lambda x:name_key(x['name']))}
    except Exception as error:
        if not previous_index.get('rows'): raise
        index = {**previous_index, 'stale': True, 'warning': str(error), 'attemptedAt': stamp}
        by_id = {int(r['id']):r for r in index['rows']}
        warnings.append({'source':'NBA directory','error':str(error)})
    save(index_path, index)
    print(f'Directory saved: {len(by_id)} players; {sum(p["active"] for p in by_id.values())} rostered', flush=True)
    targets = [p for p in by_id.values() if p['active'] or p['id'] in LEGENDS]
    targets.sort(key=lambda p:(p['id'] not in LEGENDS, not p['active'], name_key(p['name'])))
    def due(row):
        old = profiles.get(str(row['id']))
        if args.force or not old or not old.get('detailUpdatedAt'): return True
        try: return (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(old['detailUpdatedAt'])).days >= (args.refresh_days if row['active'] else 365)
        except (ValueError, TypeError): return True
    todo = [p for p in targets if due(p)][:args.max_details]
    def fetch_detail(row):
        url = 'https://stats.nba.com/stats/commonplayerinfo?' + urlencode({'PlayerID':row['id'],'LeagueID':'00'})
        raw, info_headers = unpack(get(url))
        if not raw or int(raw[0]['PERSON_ID']) != row['id']: raise ValueError('Player ID mismatch')
        merged = detail_row({**profiles.get(str(row['id']), {}), **row}, raw[0], now(), url)
        return row['id'], merged, info_headers
    info_headers = previous_profiles.get('nbaInfoHeaders', [])
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(fetch_detail, row):row['id'] for row in todo}
        for number, future in enumerate(concurrent.futures.as_completed(futures), 1):
            try:
                pid, profile, info_headers = future.result()
                profiles[str(pid)] = profile
                by_id[pid] = {k:v for k,v in profile.items() if k not in ['nbaInfo','fieldSources']}
            except Exception as error:
                warnings.append({'source':'NBA commonplayerinfo','playerId':futures[future],'error':str(error)})
            if number % 50 == 0 or number == len(futures):
                save(profile_path, {'version':1,'season':args.season,'source':'NBA.com + ESPN','updatedAt':now(),'nbaInfoHeaders':info_headers,'profiles':profiles,'warnings':warnings})
                print(f'NBA bio: {number}/{len(futures)}; detailed profiles: {len(profiles)}', flush=True)
    # Refresh basic data for existing profiles even when their slower personal bio is cached.
    for pid, row in by_id.items():
        old = profiles.get(str(pid))
        if old:
            merged = {**old, **{k:v for k,v in row.items() if k not in ['birthDate','birthPlace','birthPlaceDetails','hometown','detailUpdatedAt','fieldSources','nbaInfo']}}
            for key in BIO_FIELDS:
                if key not in ['birthDate','hometown','experience','rosterStatus'] and row.get(key) is not None and row.get(key) != old.get(key):
                    merged.setdefault('fieldSources', {})[key] = source('NBA.com', row['sourceUrl'], row['updatedAt'])
            for key in ['active','teamId','teamCode']:
                merged.setdefault('fieldSources', {})[key] = source('NBA.com', all_url, stamp)
            profiles[str(pid)] = merged
    # ESPN's roster is an efficient authoritative batch for exact birthplace.
    espn_count, espn_seen = 0, set()
    try:
        team_url = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams?limit=100'
        teams = [] if args.skip_espn else get(team_url)['sports'][0]['leagues'][0]['teams']
        names = {}
        for row in by_id.values(): names.setdefault(name_key(row['name']), []).append(row)
        def fetch_roster(item):
            url = f'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{item["team"]["id"]}/roster'
            return url, get(url).get('athletes', [])
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(args.workers, 8)) as pool:
            futures = [pool.submit(fetch_roster, item) for item in teams]
            for future in concurrent.futures.as_completed(futures):
                try:
                    url, athletes = future.result()
                    for athlete in athletes:
                        key = name_key(athlete.get('displayName') or athlete.get('fullName'))
                        candidates = names.get(key, [])
                        if len(candidates) != 1: continue
                        row = candidates[0]
                        profile = profiles.get(str(row['id']))
                        birthday = str(athlete.get('dateOfBirth') or '')[:10]
                        if not profile or not profile.get('birthDate') or profile['birthDate'] != birthday: continue
                        # Supplement genuinely missing NBA bio fields only; NBA values keep priority.
                        extras = {}
                        inches = athlete.get('height')
                        if isinstance(inches, (int,float)) and inches > 0 and not profile.get('heightCm'):
                            extras['heightCm'] = round(inches * 2.54, 1)
                            extras['height'] = f'{int(inches // 12)}-{inches % 12:g}'
                        pounds = athlete.get('weight')
                        if isinstance(pounds, (int,float)) and pounds > 0 and not profile.get('weightLb'):
                            extras['weightLb'] = pounds
                            extras['weightKg'] = round(pounds * .45359237, 1)
                        school = (athlete.get('college') or {}).get('name')
                        if school and not profile.get('college'): extras['college'] = school
                        for field, value in extras.items():
                            profile[field] = value
                            row[field] = value
                            profile.setdefault('fieldSources', {})[field] = source('ESPN', url, now())
                        place = athlete.get('birthPlace')
                        if not isinstance(place, dict) or not place.get('city'): continue
                        if row['id'] in espn_seen: continue
                        espn_seen.add(row['id'])
                        text = ', '.join(str(place[k]) for k in ['city','state','country'] if place.get(k))
                        profile['birthPlace'] = text
                        profile['birthPlaceDetails'] = {k:place.get(k) for k in ['city','state','country']}
                        profile['espnId'] = str(athlete['id'])
                        for field in ['birthPlace','birthPlaceDetails']: profile.setdefault('fieldSources', {})[field] = source('ESPN', url, now())
                        row.update({'birthPlace':text,'birthPlaceDetails':profile['birthPlaceDetails'],'espnId':profile['espnId']})
                        espn_count += 1
                except Exception as error: warnings.append({'source':'ESPN roster','error':str(error)})
    except Exception as error: warnings.append({'source':'ESPN teams','error':str(error)})
    # Carefully reviewed primary-source corrections supplement missing fields.
    overrides = load(ROOT / 'data/player-profile-overrides.json', {'profiles': {}})
    for pid, correction in overrides.get('profiles', {}).items():
        if pid not in profiles or int(pid) not in by_id: continue
        for key in ['birthPlace','birthPlaceDetails','hometown']:
            if key in correction:
                profiles[pid][key] = correction[key]
                profiles[pid].setdefault('fieldSources', {})[key] = source(correction['source'], correction['url'], correction['verifiedAt'])
    # Current/inactive status comes from the current official directory, never
    # the last team on a historical profile page.
    for pid, row in by_id.items():
        if str(pid) in profiles:
            profile = profiles[str(pid)]
            for key in ['active','teamId','teamCode','listedTeamId','listedTeamCode','listedTeamName']: profile[key] = row.get(key)
            profile['directoryMissing'] = bool(row.get('directoryMissing'))
            for key in ['birthDate','birthPlace','birthPlaceDetails','hometown','profileUrl','detailUpdatedAt','experience','rosterStatus']:
                if profile.get(key) is not None: row[key] = profile[key]
    for profile in profiles.values():
        profile.setdefault('hometown', None)
        for key in ['lastTeamId','lastTeamCode','lastTeamName']: profile.pop(key, None)
    index['source'] = 'NBA.com + ESPN'
    index['supplementalSourceUrl'] = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{teamId}/roster'
    index['bioSourceUrlTemplate'] = 'https://stats.nba.com/stats/commonplayerinfo?PlayerID={id}&LeagueID=00'
    index['rows'] = [{k:v for k,v in row.items() if k not in ['nbaInfo','fieldSources','lastTeamId','lastTeamCode','lastTeamName']} for row in sorted(by_id.values(), key=lambda x:name_key(x['name']))]
    index['coverage'] = {
        'total': len(by_id), 'active': sum(p['active'] for p in by_id.values()),
        'height': sum(p.get('heightCm') is not None for p in by_id.values()),
        'weight': sum(p.get('weightKg') is not None for p in by_id.values()),
        'draftYear': sum(p.get('draftYear') is not None for p in by_id.values()),
        'birthDate': sum(bool(p.get('birthDate')) for p in by_id.values()),
        'birthPlace': sum(bool(p.get('birthPlace')) for p in by_id.values()),
        'hometown': sum(bool(p.get('hometown')) for p in by_id.values()),
        'activeHeight': sum(p['active'] and p.get('heightCm') is not None for p in by_id.values()),
        'activeWeight': sum(p['active'] and p.get('weightKg') is not None for p in by_id.values()),
        'activeBirthDate': sum(p['active'] and bool(p.get('birthDate')) for p in by_id.values()),
        'activeBirthPlace': sum(p['active'] and bool(p.get('birthPlace')) for p in by_id.values()),
        'retainedFromPriorDirectory': sum(bool(p.get('directoryMissing')) for p in by_id.values())}
    save(index_path, index)
    save(profile_path, {'version':1,'season':args.season,'source':'NBA.com + ESPN','updatedAt':now(),'nbaInfoHeaders':info_headers,
                        'coverage':{'detailed':len(profiles),'activeDetailed':sum(str(p['id']) in profiles for p in by_id.values() if p['active']),'birthPlace':sum(bool(p.get('birthPlace')) for p in profiles.values())},
                        'profiles':profiles,'warnings':warnings})
    print('Completed', json.dumps(index['coverage']), 'ESPN matches', espn_count, 'warnings',len(warnings),flush=True)
    return index

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--season', default='2026-27')
    parser.add_argument('--workers', type=int, default=12)
    parser.add_argument('--max-details', type=int, default=700)
    parser.add_argument('--refresh-days', type=int, default=7)
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--skip-espn', action='store_true', help='Keep cached birthplace while refreshing only NBA metadata')
    refresh(parser.parse_args())
