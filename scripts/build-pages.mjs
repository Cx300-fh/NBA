import { readFile, mkdir, writeFile, rm, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
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
await save('status', { generatedAt: new Date().toISOString(), snapshotUpdatedAt: snapshot.updatedAt, updateIntervalHours: 6 });
await build({ root: root + 'pages', configFile: root + 'vite.pages.config.ts' });
await writeFile(root + 'dist-pages/.nojekyll', '');
// Hash navigation keeps all normal application links on index.html; fallback also covers accidental deep links.
await copyFile(root + 'dist-pages/index.html', root + 'dist-pages/404.html');
console.log(`GitHub Pages artifact ready: dist-pages (${count} data resources)`);
