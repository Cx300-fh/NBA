import {readFile,mkdir,writeFile} from 'node:fs/promises';
const {apiBase}=JSON.parse(await readFile(new URL('../data/account-service.json',import.meta.url),'utf8'));
const expected='https://courtside-nba-cx300.pastelsong512.chatgpt.site/api/account';
if(apiBase!==expected)throw Error('Archive origin does not match the configured account service');
const endpoint=process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
const requestToken=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
if(!endpoint||!requestToken)throw Error('GitHub OIDC identity is required');
const tokenURL=new URL(endpoint);if(tokenURL.protocol!=='https:'||!tokenURL.hostname.endsWith('.actions.githubusercontent.com'))throw Error('Unexpected GitHub identity origin');
tokenURL.searchParams.set('audience','courtside-prediction-archive');
const identity=await fetch(tokenURL,{headers:{Authorization:'Bearer '+requestToken},redirect:'error',signal:AbortSignal.timeout(15000)});
if(!identity.ok)throw Error('GitHub identity request failed: '+identity.status);
const {value:token}=await identity.json();if(typeof token!=='string')throw Error('GitHub did not return an identity');
// Non-secret identity metadata helps diagnose a repository or workflow mismatch.
const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
console.log('Archive identity: '+JSON.stringify({issuer:claims.iss,audience:claims.aud,repository:claims.repository,ref:claims.ref,workflow:claims.workflow_ref,subject:claims.sub,event:claims.event_name,ttl:claims.exp-claims.iat,issuedSecondsAgo:Math.floor(Date.now()/1000)-claims.iat,notBeforeSecondsAgo:Math.floor(Date.now()/1000)-claims.nbf}));
async function read(path){const r=await fetch(apiBase+'/'+path,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Account archive request failed: '+r.status);return r.json()}
const {months}=await read('archive-months');if(!Array.isArray(months)||months.some(m=>!/^20\d{2}-(0[1-9]|1[0-2])$/.test(m)))throw Error('Invalid archive month list');
const directory=new URL('../predictions/community/',import.meta.url);await mkdir(directory,{recursive:true});
for(const month of months){
 const file=await read('archive?month='+month);
 if(file.version!==2||file.month!==month||!Array.isArray(file.predictions)||file.predictions.some(p=>typeof p.participantId!=='string'||!/^00\d{8}$/.test(p.gameId)))throw Error('Invalid archive response');
 // Explicit allowlist: no account fields, passwords, email or sessions enter GitHub.
 const safe={version:2,month,updatedAt:file.updatedAt,predictions:file.predictions.map(p=>({participantId:p.participantId,gameId:p.gameId,gameTimeUTC:p.gameTimeUTC,homeTeamId:p.homeTeamId,awayTeamId:p.awayTeamId,pickedTeamId:p.pickedTeamId,createdAt:p.createdAt,updatedAt:p.updatedAt,...(p.result?{result:{winnerTeamId:p.result.winnerTeamId,homeScore:p.result.homeScore,awayScore:p.result.awayScore,settledAt:p.result.settledAt}}:{})}))};
 await writeFile(new URL(month+'.json',directory),JSON.stringify(safe,null,2)+'\n');
 console.log(month+': '+safe.predictions.length+' predictions archived');
}
console.log('Archive complete: '+months.length+' month(s).');
