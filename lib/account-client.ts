import config from '@/data/account-service.json';
import {STATIC_PAGES} from './site-mode';
export type AccountUser={id:string;username:string;createdAt:string};
export type AccountSession={user:AccountUser;token:string;expiresAt:number};
const STORAGE='courtside.account.v1';
const base=STATIC_PAGES?config.apiBase:'/api/account';
export class AccountError extends Error{status:number;constructor(status:number,message:string){super(message);this.status=status}}
export async function accountRequest<T>(path:string,token='',data?:unknown):Promise<T>{
 let response:Response;
 try{response=await fetch(base+'/'+path,{method:data===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)}),cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(20000)})}catch{throw new AccountError(0,'暂时无法连接账号服务，请稍后重试')}
 let value:any;try{value=await response.json()}catch{throw new AccountError(0,'账号服务暂时不可用')}
 if(!response.ok)throw new AccountError(response.status,value.error||'请求未完成');return value;
}
export function readSession():AccountSession|null{
 try{for(const storage of [sessionStorage,localStorage]){const value=storage.getItem(STORAGE);if(!value)continue;const s=JSON.parse(value);if(typeof s.token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(s.token)&&typeof s.user?.id==='string'&&typeof s.user?.username==='string'&&Number.isFinite(s.expiresAt)&&s.expiresAt>Date.now())return s;storage.removeItem(STORAGE)}}catch{}return null;
}
export function persistSession(session:AccountSession|null,remember=false){
 try{localStorage.removeItem(STORAGE);sessionStorage.removeItem(STORAGE);if(session)(remember?localStorage:sessionStorage).setItem(STORAGE,JSON.stringify(session))}catch{throw new AccountError(0,'浏览器无法保存登录状态，请允许此网站使用存储')}
}
export function sessionIsRemembered(){try{return Boolean(localStorage.getItem(STORAGE))}catch{return false}}
