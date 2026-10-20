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
 for(const p of ['images/hero.jpg','images/curry.jpg','images/lebron.jpg','images/wembanyama.jpg','images/tatum.jpg','images/doncic.jpg','images/jokic.jpg','images/giannis.jpg','images/edwards.jpg','images/brunson.jpg','fonts/display-800.ttf','favicon.svg','.nojekyll','404.html'])await access(root+'/'+p);
 const cssFiles=(await readdir(root+'/assets')).filter(x=>x.endsWith('.css'));
 for(const file of cssFiles){const css=await readFile(root+'/assets/'+file,'utf8');assert.ok(!css.includes('url(/fonts/'));assert.ok(!css.includes('url("/fonts/'));assert.ok(css.includes('/NBA/fonts/'))}
});
test('all complete-season statistics and recent boxscores are included as independent static resources',async()=>{
 const s=JSON.parse(await readFile('data/snapshot.json','utf8'));
 for(const [season,data] of Object.entries(s.seasons))for(const key of ['players','teams','standings','bpm']){const actual=JSON.parse(await readFile(`${root}/data/${key}-${season}.json`,'utf8'));assert.deepEqual(actual,data[key])}
 for(const key of ['roster','schedule','scoreboard'])assert.deepEqual(JSON.parse(await readFile(`${root}/data/${key}.json`,'utf8')),s[key]);
 for(const id of Object.keys(s.boxes))await access(`${root}/data/boxscore-${id}.json`);
});

test('player library is split into per-season and 64 profile/career shards with no broken references',async()=>{
 const index=JSON.parse(await readFile(root+'/explore/player-index.json','utf8'));assert.ok(index.rows.length>5000);
 const lebron=index.rows.find(p=>p.id===2544);assert.equal(lebron.draftYear,2003);
 const profile=JSON.parse(await readFile(root+'/explore/profiles/48.json','utf8'));assert.equal(profile.profiles['2544'].birthDate,'1984-12-30');
 const career=JSON.parse(await readFile(root+'/explore/careers/61.json','utf8'));assert.equal(career.careers['893'].rows.length,15);
 const archive=JSON.parse(await readFile(root+'/explore/archive/season-2015-16.json','utf8'));assert.ok(archive.shots.rows.length>400);
 for(const file of ['kawhi-2019','lebron-2016','ray-allen-2013','jordan-1998','curry-2016','mcgrady-2004'])await access(root+'/images/moments/'+file+'.jpg');
});
test('every generated profile and season remains present when the library is packaged',async()=>{
 const index=JSON.parse(await readFile(root+'/explore/player-index.json','utf8'));const ids=new Set();let careers=0;
 for(let n=0;n<64;n++){
  const part=String(n).padStart(2,'0');const profiles=JSON.parse(await readFile(root+'/explore/profiles/'+part+'.json','utf8')).profiles;
  for(const [id,profile] of Object.entries(profiles)){assert.equal(Number(id)%64,n);assert.equal(profile.id,Number(id));assert.ok(!ids.has(id));ids.add(id)}
  const rows=JSON.parse(await readFile(root+'/explore/careers/'+part+'.json','utf8')).careers;careers+=Object.keys(rows).length;
 }
 assert.equal(ids.size,index.rows.length);assert.ok(careers>3000);
 const archive=JSON.parse(await readFile('data/archive/index.json','utf8'));
 for(const entry of archive.seasons){const file=JSON.parse(await readFile(root+'/explore/archive/season-'+entry.season+'.json','utf8'));assert.equal(file.season,entry.season);for(const resource of entry.availableResources)assert.ok(file[resource].rows.length>0,entry.season+' '+resource)}
});
