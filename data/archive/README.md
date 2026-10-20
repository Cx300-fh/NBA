# NBA season archive

Each `season-YYYY-YY.json` is a separate NBA.com snapshot, with `players`, `teams`, `standings`, `shots` and `bpm` envelopes. `index.json` lists only resources that actually have rows, with counts and source dates. The current regular season can legitimately have standings but no player, team or shooting statistics before opening night.

- Shooting locations are the NBA's recorded shooting **areas**, not invented shot coordinates. The seven disjoint areas are retained alongside the source's overlapping `corner-total` aggregate. Exclude `aggregated: true` when summing areas.
- `FGM`/`FGA` are season **totals** in the shooting-area resource. `FG_PCT` is a ratio. Real 0 attempts have null `FG_PCT`; a source-null/missing area keeps all three values null and `available: false`.
- A high raw FG% is not automatically a hot zone relative to the league. For that comparison, compute the same season's weighted area baseline using `sum(FGM) / sum(FGA)`.
- NBA shot-area coverage begins in 1996-97. Earlier areas are explicitly unavailable. Advanced metrics may be unavailable for early seasons; they are not filled with zeros. No verified BPM table is substituted with NBA PIE or plus/minus.
- Player/team count statistics are per game. Historical source totals are divided by GP; percentage fields stay as supplied by the source. Only advanced metric keys are merged, avoiding NBA Advanced response FGM/FGA totals overwriting per-game base values.
- The three earlier classic seasons use NBA LeagueLeaders **Totals** followed by GP conversion, including players with one appearance; the per-game leader endpoint would omit unqualified players. Their team data come from official TeamYearByYearStats totals. Historical team names and codes are preserved.

Regenerate with `python scripts/update-archive.py`. Successful historical resources are cache hits by default; `--force` refreshes them. `--refresh-current` revisits current shooting resources. Every failed request preserves any previous successful data and records a warning.

`team-history.json` is the official franchise-history source cache used to reconstruct the older team tables. Selected complete career tables are under `../careers/`; season rows are per game and each row's `totals` preserves exact source totals.
