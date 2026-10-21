import {env} from 'cloudflare:workers';
import {createAccountHandler} from '@/lib/account-server';
const handle=(request:Request)=>createAccountHandler(env.DB)(request);
export const GET=handle;
export const POST=handle;
export const OPTIONS=handle;
