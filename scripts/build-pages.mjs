import { readFile, mkdir, writeFile, rm, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import {spawnSync} from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const snapshot = JSON.parse(await readFile(root + 'data/snapshot.json', 'utf8'));
// Generated only at build time. Each resource can refresh independently without downloading the full snapshot.
const target = root + 'public/data';
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
let count = 0;
const save = async (name, value) => { await writeFile(`${target}/${name}.json`, JSON.stringify(value) + '\n'); count++; };
for (const [season, value] of Object.entries(snapshot.seasons)) {
  for (const resource of ['players', 'teams', 'standings', 'bpm']) await save(`${resource}-${season}`, value[resource]);
}
for (const resource of ['schedule', 'scoreboard', 'roster']) await save(resource, snapshot[resource]);
for (const [id, value] of Object.entries(snapshot.boxes)) await save(`boxscore-${id}`, value);
await save('status', { generatedAt: new Date().toISOString(), snapshotUpdatedAt: snapshot.updatedAt, updateIntervalHours: 1 });
// Only a few recent boxes bootstrap the UI; the full growing archive is fetched per game.
const recentBoxes = Object.entries(snapshot.boxes).sort((a,b) => String(b[1].game?.gameTimeUTC || '').localeCompare(String(a[1].game?.gameTimeUTC || ''))).slice(0,6);
await writeFile(root + 'pages/.seed.json', JSON.stringify({...snapshot, boxes: Object.fromEntries(recentBoxes)}));
const prepared=spawnSync(process.execPath,[root+'scripts/prepare-explore.mjs'],{cwd:root,stdio:'inherit'});
if(prepared.status!==0)throw Error('Player library preparation failed');
await build({ root: root + 'pages', configFile: root + 'vite.pages.config.ts' });
await writeFile(root + 'dist-pages/.nojekyll', '');
// Hash navigation keeps all normal application links on index.html; fallback also covers accidental deep links.
await copyFile(root + 'dist-pages/index.html', root + 'dist-pages/404.html');
console.log(`GitHub Pages artifact ready: dist-pages (${count} data resources)`);
