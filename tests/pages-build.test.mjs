import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,access} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve('dist-pages');
const html=await readFile(root+'/index.html','utf8');
test('Pages HTML uses the /NBA/ project prefix for scripts, styles and favicon',async()=>{
 const refs=[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m=>m[1]).filter(s=>!s.startsWith('http'));
 assert.ok(refs.some(s=>s.endsWith('.js')));assert.ok(refs.some(s=>s.endsWith('.css')));
 for(const ref of refs){assert.ok(ref.startsWith('/NBA/'),ref);await access(root+'/'+ref.slice('/NBA/'.length))}
});
test('poster assets and locally hosted fonts are published',async()=>{
 for(const p of ['images/hero.jpg','images/curry.jpg','images/lebron.jpg','fonts/display-800.ttf','favicon.svg','.nojekyll','404.html'])await access(root+'/'+p);
 const cssFiles=(await readdir(root+'/assets')).filter(x=>x.endsWith('.css'));
 for(const file of cssFiles){const css=await readFile(root+'/assets/'+file,'utf8');assert.ok(!css.includes('url(/fonts/'));assert.ok(!css.includes('url("/fonts/'));assert.ok(css.includes('/NBA/fonts/'))}
});
test('all complete-season statistics and recent boxscores are included as independent static resources',async()=>{
 const s=JSON.parse(await readFile('data/snapshot.json','utf8'));
 for(const [season,data] of Object.entries(s.seasons))for(const key of ['players','teams','standings','bpm']){const actual=JSON.parse(await readFile(`${root}/data/${key}-${season}.json`,'utf8'));assert.deepEqual(actual,data[key])}
 for(const key of ['roster','schedule','scoreboard'])assert.deepEqual(JSON.parse(await readFile(`${root}/data/${key}.json`,'utf8')),s[key]);
 for(const id of Object.keys(s.boxes))await access(`${root}/data/boxscore-${id}.json`);
});
