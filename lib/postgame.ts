import type { StatRow } from './basketball.ts';
export function playerSummary(player: StatRow) {
  const s = player.statistics || {};
  const number = (k: string) => s[k] == null || !Number.isFinite(Number(s[k])) ? null : Number(s[k]);
  const points = number('points'), fgm = number('fieldGoalsMade'), fga = number('fieldGoalsAttempted'), threes = number('threePointersMade'), threeAttempts = number('threePointersAttempted'), ftm = number('freeThrowsMade'), fta = number('freeThrowsAttempted');
  const twoMade = fgm != null && threes != null ? fgm - threes : null;
  const twoAttempted = fga != null && threeAttempts != null ? fga - threeAttempts : null;
  const denominator = fga != null && fta != null ? 2 * (fga + .44 * fta) : 0;
  return { played: player.played !== '0' && Boolean(s.minutes), points, ts: points != null && denominator > 0 ? points / denominator : null,
    efg: fga != null && fga > 0 && fgm != null && threes != null ? (fgm + .5 * threes) / fga : null,
    shots: [{ key: 'two', label: '两分', made: twoMade, attempted: twoAttempted, points: twoMade == null ? null : twoMade * 2 }, { key: 'three', label: '三分', made: threes, attempted: threeAttempts, points: threes == null ? null : threes * 3 }, { key: 'free', label: '罚球', made: ftm, attempted: fta, points: ftm }],
  };
}
export function minuteLabel(value: unknown) {
  if (typeof value !== 'string') return '—';
  const m = value.match(/^PT(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  return m ? `${m[1] || '0'}:${String(Math.floor(Number(m[2] || 0))).padStart(2, '0')}` : '—';
}
