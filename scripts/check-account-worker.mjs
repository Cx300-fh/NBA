// Exercise the complete production build, including Vinext's module loading.
import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);const fromWrangler=createRequire(require.resolve('wrangler/package.json'));const {Miniflare}=fromWrangler('miniflare');
const root=resolve('dist/server');
const modulePaths=(await readdir(root,{recursive:true})).filter(path=>/\.m?js$/.test(path)&&path!=='index.js');
const modules=[{type:'ESModule',path:resolve(root,'index.js')},...modulePaths.map(path=>({type:'ESModule',path:resolve(root,path)}))];
const worker=new Miniflare({modules,modulesRoot:root,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'account-production-build-check'},cf:false});
try{
 const database=await worker.getD1Database('DB');const sql=await readFile('drizzle/0000_ambiguous_random.sql','utf8');for(const statement of sql.split('--> statement-breakpoint').map(v=>v.trim()).filter(Boolean))await database.prepare(statement).run();
 const base='https://courtside-nba-cx300.pastelsong512.chatgpt.site';
 for(const [path,expected] of [['/api/account/health',200],['/api/account/predictions?month=2026-10',401]]){
  const response=await worker.dispatchFetch(base+path,{headers:{Origin:'https://cx300-fh.github.io'}});const body=await response.text();assert.equal(response.status,expected,path+': '+body.slice(0,300));assert.equal(response.headers.get('access-control-allow-origin'),'https://cx300-fh.github.io');console.log(path+': '+response.status);
 }
 const rootResponse=await worker.dispatchFetch(base+'/');assert.equal(rootResponse.status,200,'Server-rendered root failed: '+(await rootResponse.text()).slice(0,300));console.log('Server-rendered home: 200');
}finally{await worker.dispose()}
