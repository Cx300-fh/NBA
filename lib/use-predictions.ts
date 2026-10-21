'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {beijingDate,type Game} from './basketball';
import {emptyMonth,predictionMonth,type PredictionMonth} from './predictions';
import {accountRequest,AccountError,readSession,persistSession,sessionIsRemembered,type AccountSession,type AccountUser} from './account-client';
export function usePredictions(){
 const session=useRef<AccountSession|null>(null);const alive=useRef(true);const writes=useRef(false);const generation=useRef(0);
 const tasks=useRef(new Map<string,Promise<void>>());const revisions=useRef<Record<string,number>>({});const filesRef=useRef<Record<string,PredictionMonth>>({});
 const [files,setFiles]=useState<Record<string,PredictionMonth>>({});const [errors,setErrors]=useState<Record<string,string>>({});const [loading,setLoading]=useState<Record<string,boolean>>({});
 const [user,setUser]=useState<AccountUser|null>(null);const [authLoading,setAuthLoading]=useState(true);const [authError,setAuthError]=useState('');const [showConnect,setShowConnect]=useState(false);const [saving,setSaving]=useState('');
 const reset=useCallback(()=>{generation.current++;filesRef.current={};tasks.current.clear();if(alive.current){setFiles({});setErrors({});setLoading({});setSaving('')}},[]);
 const clearSession=useCallback(()=>{session.current=null;try{persistSession(null)}catch{}reset();if(alive.current)setUser(null)},[reset]);
 const assign=useCallback((month:string,file:PredictionMonth)=>{filesRef.current={...filesRef.current,[month]:file};if(alive.current)setFiles(filesRef.current)},[]);
 const reloadMonth=useCallback((month:string,force=true):Promise<void>=>{
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))return Promise.resolve();
  const current=session.current;if(!current){assign(month,emptyMonth(month));return Promise.resolve()}
  if(!force&&filesRef.current[month])return Promise.resolve();const pending=tasks.current.get(month);if(pending)return pending;
  const revision=generation.current;const readRevision=(revisions.current[month]||0)+1;revisions.current[month]=readRevision;setLoading(v=>({...v,[month]:true}));
  const task=(async()=>{try{const result=await accountRequest<{file:PredictionMonth}>('predictions?month='+month,current.token);if(alive.current&&generation.current===revision&&revisions.current[month]===readRevision){assign(month,result.file);setErrors(v=>({...v,[month]:''}))}}catch(e){if(alive.current&&generation.current===revision){if(e instanceof AccountError&&e.status===401){clearSession();setAuthError(e.message)}else setErrors(v=>({...v,[month]:e instanceof Error?e.message:'竞猜暂时无法读取'}))}}finally{if(generation.current===revision){tasks.current.delete(month);if(alive.current)setLoading(v=>({...v,[month]:false}))}}})();
  tasks.current.set(month,task);return task;
 },[assign,clearSession]);
 useEffect(()=>{alive.current=true;const existing=readSession();const revision=generation.current;
  if(existing){session.current=existing;accountRequest<{user:AccountUser}>('session',existing.token).then(result=>{if(alive.current&&generation.current===revision){setUser(result.user);setAuthError('');void reloadMonth(beijingDate().slice(0,7))}}).catch(e=>{if(alive.current&&generation.current===revision){if(e instanceof AccountError&&e.status===401)clearSession();setAuthError(e instanceof Error?e.message:'登录状态无法读取')}}).finally(()=>{if(alive.current)setAuthLoading(false)})}else setAuthLoading(false);
  return()=>{alive.current=false;generation.current++;tasks.current.clear()};
 },[clearSession,reloadMonth]);
 const accept=async(next:AccountSession,remember:boolean)=>{
  persistSession(next,remember);reset();session.current=next;setUser(next.user);setAuthError('');setShowConnect(false);void reloadMonth(beijingDate().slice(0,7));
 };
 const authenticate=async(mode:'login'|'register',username:string,password:string,remember:boolean)=>{const result=await accountRequest<AccountSession>(mode,'',{username,password});await accept(result,remember)};
 const disconnect=async()=>{const current=session.current;try{if(current)await accountRequest('logout',current.token,{})}finally{clearSession()}};
 const changePassword=async(oldPassword:string,password:string)=>{if(!session.current)throw Error('请先登录');const result=await accountRequest<AccountSession>('password',session.current.token,{oldPassword,password});await accept(result,sessionIsRemembered())};
 const submit=async(game:Game,pickedTeamId:number,_refresh:()=>Promise<Game>)=>{
  const current=session.current;if(!current||!user){setShowConnect(true);throw Error('登录后即可保存竞猜')}
  if(writes.current)throw Error('上一条竞猜仍在保存，请稍候');writes.current=true;setSaving(game.gameId);const revision=generation.current;const month=predictionMonth(game);revisions.current[month]=(revisions.current[month]||0)+1;
  try{const result=await accountRequest<{file:PredictionMonth}>('predictions',current.token,{gameId:game.gameId,pickedTeamId});if(generation.current===revision){assign(predictionMonth(game),result.file);setErrors(v=>({...v,[predictionMonth(game)]:''}))}}
  catch(e){if(e instanceof AccountError&&e.status===401&&generation.current===revision){clearSession();setShowConnect(true)}throw e}
  finally{writes.current=false;if(alive.current)setSaving('')}
 };
 return {files,errors,loading,user,login:user?.username||'',authLoading,authError,saving,showConnect,setShowConnect,reloadMonth,authenticate,disconnect,changePassword,submit};
}
export type PredictionStore=ReturnType<typeof usePredictions>;
