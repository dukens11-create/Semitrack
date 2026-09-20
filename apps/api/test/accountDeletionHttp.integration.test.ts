import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {requireIsolatedDatabase} from './isolatedDatabaseGuard.ts';
test('real DELETE /me requires auth and current password; revokes both existing access sessions and denies repeat credentials',{skip:!process.env.SUBSCRIPTION_TEST_DATABASE_URL,timeout:30000},async()=>{
 const database=requireIsolatedDatabase(process.env.SUBSCRIPTION_TEST_DATABASE_URL);
 process.env.DATABASE_URL=database;
 const {prisma:db,disconnectDatabase}=await import('../dist/lib/prisma.js');
 const port=await new Promise<number>(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=(s.address() as net.AddressInfo).port;s.close(()=>resolve(p));});});
 const child=spawn(process.execPath,['dist/server.js'],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:database,PORT:String(port),NODE_ENV:'test',BILLING_MODE:'disabled'},windowsHide:true,stdio:'ignore'}),done=once(child,'exit');
 async function request(method:string,path:string,body?:unknown,token?:string){const r=await fetch('http://127.0.0.1:'+port+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(3000)});return{status:r.status,body:await r.json() as any};}
 try{
 let ready=false;for(let i=0;i<80;i++){try{ready=(await request('GET','/health')).status===200;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready);
 const password='Local fixture password 12345',email=randomUUID()+'@fixture.invalid';
 assert.equal((await request('DELETE','/me',{currentPassword:password,confirmation:'DELETE MY ACCOUNT'})).status,401);
 const a=await request('POST','/auth/register',{email,password,fullName:'Local deletion fixture'});assert.equal(a.status,201);
 const second=await request('POST','/auth/login',{email,password});assert.equal(second.status,200);
 assert.equal((await request('DELETE','/me',{currentPassword:'wrong',confirmation:'DELETE MY ACCOUNT'},a.body.accessToken)).status,400);
 assert.equal((await request('GET','/me',undefined,a.body.accessToken)).status,200);
 const removed=await request('DELETE','/me',{currentPassword:password,confirmation:'DELETE MY ACCOUNT'},a.body.accessToken);assert.equal(removed.status,200);assert.equal(removed.body.deleted,true);
 for(const token of [a.body.accessToken,second.body.accessToken])assert.equal((await request('GET','/me',undefined,token)).status,401);
 assert.equal((await request('DELETE','/me',{currentPassword:password,confirmation:'DELETE MY ACCOUNT'},a.body.accessToken)).status,401);
 assert.equal((await request('POST','/auth/refresh',{refreshToken:a.body.refreshToken})).status,401);
 assert.equal((await request('POST','/auth/login',{email,password})).status,401);
 const staffEmail=randomUUID()+'@fixture.invalid';
 const staff=await request('POST','/auth/register',{email:staffEmail,password,fullName:'Review fixture'});
 await db.user.update({where:{id:staff.body.user.id},data:{role:'ADMIN'}});
 const staffLogin=await request('POST','/auth/login',{email:staffEmail,password});
 const review=await request('DELETE','/me',{currentPassword:password,confirmation:'DELETE MY ACCOUNT'},staffLogin.body.accessToken);
 assert.equal(review.status,409);assert.equal(review.body.error.code,'ACCOUNT_DELETION_REVIEW_REQUIRED');
 assert.equal((await request('GET','/me',undefined,staffLogin.body.accessToken)).status,200);
 }finally{child.kill();await done;await disconnectDatabase();}
});
