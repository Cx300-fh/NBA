import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);const fromWrangler=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare}=fromWrangler('miniflare');const {build}=fromWrangler('esbuild');
test('real Worker runtime registers, logs in and reads private records with D1 and scrypt',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'courtside-accounts-'));let worker;
 try{
  const outfile=join(directory,'worker.mjs');
  await build({stdin:{contents:"import {createAccountHandler} from './lib/account-server.ts';export default {fetch(request,env){return createAccountHandler(env.DB)(request)}}",resolveDir:process.cwd(),sourcefile:'account-runtime-entry.ts'},outfile,bundle:true,format:'esm',platform:'node',target:'es2022',external:['node:crypto'],logLevel:'silent'});
  worker=new Miniflare({rootPath:directory,modulesRoot:directory,modules:true,scriptPath:outfile,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'accounts-runtime-test'},cf:false});
  const database=await worker.getD1Database('DB');const migration=await readFile(new URL('../drizzle/0000_ambiguous_random.sql',import.meta.url),'utf8');for(const sql of migration.split('--> statement-breakpoint').map(v=>v.trim()).filter(Boolean))await database.prepare(sql).run();
  const call=(path,body,token)=>worker.dispatchFetch('https://courtside-nba-cx300.pastelsong512.chatgpt.site/api/account/'+path,{method:body?'POST':'GET',headers:{Origin:'https://cx300-fh.github.io','CF-Connecting-IP':'192.0.2.20',...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const health=await call('health');assert.equal(health.status,200);assert.equal((await health.json()).ready,true);
  const registered=await call('register',{username:'WorkerTest',password:'Worker-password-2026!'});const account=await registered.json();assert.equal(registered.status,201,JSON.stringify(account));
  const logged=await call('login',{username:'workertest',password:'Worker-password-2026!'});assert.equal(logged.status,200,await logged.text());
  const mine=await call('predictions?month=2026-10',undefined,account.token);assert.equal(mine.status,200);assert.deepEqual((await mine.json()).file.predictions,[]);
  const unauthenticated=await call('predictions?month=2026-10');assert.equal(unauthenticated.status,401);
 }finally{if(worker)await worker.dispose();await rm(directory,{recursive:true,force:true})}
});
