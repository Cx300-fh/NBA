# Player directory and personal bios

`player-index.json` is the searchable NBA directory. `player-profiles.json` stores enriched personal information by NBA player ID. Both contain genuine fetched data; unknown information remains `null`. The index is suitable for loading once, while the detailed profiles can be split into static ID/hash buckets at build time.

## Coverage of the retained snapshot

Use each file's `updatedAt` and `coverage` fields for the actual snapshot time and counts. The completed collection contains:

| Field | All directory records | Current directory members |
| --- | ---: | ---: |
| Players | 5,234 | 603 |
| Height | 5,151 | 567 |
| Weight | 5,145 | 566 |
| Draft year | 3,815 | — |
| Birth date | 626 | 603 |
| Birthplace | 491 | 488 |
| Explicitly sourced hometown / place grown up | 2 | 0 |

There are 626 detailed bios: all 603 currently listed NBA players in the final successful roster response plus 23 selected historical players. The 23 historical bios include Michael Jordan, Kobe Bryant, Shaquille O'Neal, Tim Duncan, Magic Johnson, Larry Bird, Hakeem Olajuwon, Dirk Nowitzki, Dwyane Wade, Allen Iverson, Kevin Garnett, Steve Nash, Wilt Chamberlain, Bill Russell, Kareem Abdul-Jabbar and Jerry West.

Some training-camp/new-player records have empty height or weight in NBA's own endpoints. Six otherwise missing weights were supplemented from ESPN after matching full name and date of birth; missing values that could not be verified remain empty. There were no network collection warnings in the retained snapshot.

## Field meanings

- `id` is the NBA person ID, shared by season statistics and official NBA headshots.
- `active`, `teamId` and `teamCode` follow the latest successful NBA `commonallplayers` roster. `active: false` means not currently listed in that roster, not proof that a person has formally retired.
- `listedTeamId`, `listedTeamCode` and `listedTeamName` reproduce NBA `playerindex`'s team association. For historical players this may be a representative team, **not the last team**: Jordan is listed with Chicago and Shaquille O'Neal with the Lakers. Inactive records have no claimed current `teamId`.
- `height` keeps NBA's feet–inches format; `heightCm` converts inches × 2.54. `weightLb` keeps pounds and `weightKg` converts pounds × 0.45359237; converted values use one decimal place. A missing measurement is never converted to zero.
- `draftYear`, `draftRound` and `draftNumber` are numeric when supplied. `undrafted: true` is set only when the official source says Undrafted. A missing draft year is not enough to infer undrafted status.
- `birthDate` uses NBA's date, in `YYYY-MM-DD` form. Age is left to the UI to calculate, avoiding stale stored ages.
- `birthPlace` and `birthPlaceDetails` are reported birthplace. They are **not hometown**. ESPN supplementation requires a unique normalized full-name match and the same birthday as NBA's personal bio. No birthplace is inferred from country, school or the current team.
- `hometown` is used only where a primary source explicitly states where the player grew up; the UI should label it 成长地. Currently this is Lansing, Michigan for Magic Johnson and Cheylan, West Virginia for Jerry West.
- `country` is the country value supplied by NBA; it is not a substitute for a birthplace or proof of legal citizenship.
- `careerPts`, `careerReb`, `careerAst` are NBA playerindex's career values with `statsTimeframe: "Career"`. They are not the latest regular-season averages.
- `directoryMissing` marks a previously verified ID no longer returned by the latest directory. The collector retains its known biography, withdraws the current-roster claim and does not delete history. This flag is cleared if the ID is officially listed again. The last successful directory changed during collection; the final retained response listed 603 current players, so counts must be read from metadata instead of hardcoded.

## Provenance

Directory metadata retains original NBA `headers`, `rosterHeaders`, source URLs and update time. Detailed bios retain `nbaInfoHeaders`, raw `nbaInfo`, and a `fieldSources` map with the source, exact URL and time for each enriched field.

Primary endpoints:

- [NBA Player Index](https://stats.nba.com/stats/playerindex?LeagueID=00&Season=2026-27&Historical=1)
- [NBA all players](https://stats.nba.com/stats/commonallplayers?LeagueID=00&Season=2026-27&IsOnlyCurrentSeason=0)
- NBA `commonplayerinfo?PlayerID={id}&LeagueID=00`
- [ESPN team list](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams?limit=100) and `teams/{teamId}/roster`

`player-profile-overrides.json` contains a small set of manually checked primary-source supplements, with their verification time and exact NBA biography link. For example, Jordan's NBA biography explicitly states he was born in Brooklyn; an ESPN value corresponding to Wilmington is deliberately not used as his birthplace. Bird's biography's figurative phrase that his “legend was born” is not treated as a birthplace.

## Refresh

```bash
python scripts/update-player-profiles.py
```

The script uses the Python standard library. It refreshes the directory, retains successful historical records, refreshes current/pinned historical personal bios when due, and joins ESPN's 30 team rosters. Current bios are cached for seven days, selected historical bios for 365 days. `--force` refreshes them, `--max-details N` limits per-run personal-bio requests, and `--skip-espn` preserves cached ESPN supplements while updating NBA metadata. A failed request retains prior data and records a warning. Existing files are atomically replaced only after JSON serialization succeeds.

Do not repeatedly re-request the directory simply to chase roster count changes during one deployment. The retained snapshot represents the final successful directory call in this collection.
