import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {requireIsolatedDatabase} from './isolatedDatabaseGuard.ts';
let closeDatabase:(()=>Promise<void>)|undefined;after(async()=>{await closeDatabase?.();});
test('Admin price/access HTTP workflow enforces roles, grace, version conflicts and audited restoration', {skip:!process.env.SUBSCRIPTION_TEST_DATABASE_URL},async()=>{
 process.env.DATABASE_URL=requireIsolatedDatabase(process.env.SUBSCRIPTION_TEST_DATABASE_URL);
 const {prisma,disconnectDatabase}=await import('../dist/lib/prisma.js');closeDatabase=disconnectDatabase;
 const {subscriptionControlsRouter}=await import('../dist/modules/billing/subscriptionControls.routes.js');
 const {subscriptionOffersRouter}=await import('../dist/modules/subscriptions/subscriptionOffers.routes.js');
 const {signAccessToken}=await import('../dist/utils/jwt.js');
 const {getEffectiveEntitlementForUser}=await import('../dist/modules/billing/entitlement.service.js');
 const {applyVerifiedSubscriptionUpdate}=await import('../dist/modules/billing/subscriptionFoundation.service.js');
 const {readPricing,updatePricing,setSubscriptionHold}=await import('../dist/modules/billing/subscriptionControls.js');
 const app=express();app.use(express.json());app.use('/admin/subscription-controls',subscriptionControlsRouter);app.use('/subscription-offers',subscriptionOffersRouter);
 app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.httpStatus??(error.name==='ZodError'?400:500)).json({code:error.code??error.name}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();assert(address&&typeof address!=='string');const base='http://127.0.0.1:'+address.port;
 const ids:string[]=[],events:string[]=[];let original:any,admin:any;
 const createUser=async(role:'ADMIN'|'DRIVER'|'FLEET_ADMIN')=>{const user=await prisma.user.create({data:{email:randomUUID()+'@example.invalid',fullName:'Admin controls fixture',passwordHash:'fixture-not-login',role}});ids.push(user.id);const session=await prisma.refreshToken.create({data:{userId:user.id,tokenHash:randomUUID(),expiresAt:new Date(Date.now()+3600000)}});return {...user,token:signAccessToken({userId:user.id,email:user.email,role:user.role,sessionId:session.id})};};
 const request=(path:string,token?:string,body?:unknown)=>fetch(base+path,{method:body?'PATCH':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 try {
 admin=await createUser('ADMIN');const driver=await createUser('DRIVER'),fleet=await createUser('FLEET_ADMIN');const root='/admin/subscription-controls';
 assert.equal((await request(root+'/pricing')).status,401);
 original=await readPricing();const priceInput={expectedVersion:original.version,prices:{...original.prices,monthlyRegular:2499},reason:'Approved local test',confirmation:'UPDATE DISPLAY PRICES'};
 for(const user of [driver,fleet])for(const path of ['/pricing','/subscriptions'])assert.equal((await request(root+path,user.token)).status,403);
 for(const user of [driver,fleet])assert.equal((await request(root+'/pricing',user.token,priceInput)).status,403);
 let response=await request(root+'/pricing',admin.token,{...priceInput,prices:{...priceInput.prices,annual:-1}});assert.equal(response.status,400);
 response=await request(root+'/pricing',admin.token,priceInput);assert.equal(response.status,200);const changed=await response.json() as any;assert.equal(changed.version,original.version+1);
 assert.equal((await request(root+'/pricing',admin.token,priceInput)).status,409);
 const publicPrice=await (await request('/subscription-offers')).json() as any;assert.equal(publicPrice.prices.monthlyRegular,2499);assert.equal(publicPrice.purchaseAvailable,false);
 // A verified provider fixture is processed locally; this never calls a provider.
 const now=Date.now(),providerSubscriptionId=randomUUID();
 const update=async(status:'PAST_DUE'|'ACTIVE',offset:number,gracePeriodEnd:Date|null)=>{const providerEventId=randomUUID();events.push(providerEventId);return applyVerifiedSubscriptionUpdate({provider:'GOOGLE_PLAY',providerEventId,eventType:'LOCAL_TEST',rawPayload:'{}',eventCreatedAt:new Date(now+offset),userId:driver.id,providerSubscriptionId,productId:'fixture',plan:'GOLD',status,environment:'TEST',currentPeriodStart:new Date(now-86400000),currentPeriodEnd:new Date(now+86400000),gracePeriodEnd,priceAmountCents:999,priceCurrency:'USD'});};
 await update('PAST_DUE',0,new Date(now+60000));
 let subscription=await prisma.subscription.findFirstOrThrow({where:{userId:driver.id}});const accessPath=root+'/subscriptions/'+subscription.id+'/access';
 const hold={expectedVersion:0,suspended:true,confirmation:'SUSPEND',reason:'Provider grace expired'};
 assert.equal((await request(accessPath,driver.token,hold)).status,403);
 assert.equal((await request(accessPath,admin.token,hold)).status,409,'live grace must prevent admin suspension');
 let entitlement=await getEffectiveEntitlementForUser(driver.id,'PREMIUM_NAVIGATION',new Date(now+30000));assert.equal(entitlement.status,'ACTIVE');assert.equal(entitlement.cacheValidUntil.getTime(),now+60000);
 entitlement=await getEffectiveEntitlementForUser(driver.id,'PREMIUM_NAVIGATION',new Date(now+60000));assert.equal(entitlement.status,'INACTIVE','expiry applies without a new provider event');
 await update('PAST_DUE',1000,new Date(now-1000));
 await assert.rejects(setSubscriptionHold('missing-audit-actor',subscription.id,{...hold,confirmation:'SUSPEND'}));
 assert.equal((await prisma.$queryRawUnsafe<any[]>('SELECT * FROM "SubscriptionAccessHold" WHERE "subscriptionId"=$1',subscription.id)).length,0,'audit failure rolls back access hold');
 response=await request(accessPath,admin.token,hold);assert.equal(response.status,200);assert.equal((await response.json() as any).entitlementStatus,'INACTIVE');
 assert.equal((await request(accessPath,admin.token,hold)).status,409,'stale double click rejected');
 const restore={expectedVersion:1,suspended:false,confirmation:'RESTORE',reason:'Verified payment recovered'};
 assert.equal((await request(accessPath,admin.token,restore)).status,409,'unpaid restore refused');
 await update('ACTIVE',2000,null);
 assert.equal((await getEffectiveEntitlementForUser(driver.id)).status,'INACTIVE','provider update cannot silently clear manual hold');
 const independent=await prisma.entitlementSource.create({data:{userId:driver.id,provider:'ADMIN_GRANT',sourceType:'ADMIN_GRANT',sourceReference:randomUUID(),status:'ACTIVE',startsAt:new Date(now-1000),accessEndsAt:new Date(now+86400000),lastVerifiedAt:new Date(now)}});
 assert.equal((await getEffectiveEntitlementForUser(driver.id)).status,'ACTIVE','one subscription hold must not erase another legitimate access source');
 await prisma.entitlementSource.delete({where:{id:independent.id}});
 assert.equal((await getEffectiveEntitlementForUser(driver.id)).status,'INACTIVE');
 response=await request(root+'/subscriptions?filter=suspended',admin.token);assert.equal(response.status,200);const listing=await response.json() as any;assert(listing.items.some((s:any)=>s.id===subscription.id&&s.canRestore));assert.equal(response.headers.get('cache-control'),'private, no-store');
 response=await request(accessPath,admin.token,restore);assert.equal(response.status,200);assert.equal((await response.json() as any).entitlementStatus,'ACTIVE');
 subscription=await prisma.subscription.findUniqueOrThrow({where:{id:subscription.id}});assert.equal(subscription.status,'ACTIVE');assert.equal(subscription.priceAmountCents,999,'catalog edit never reprices existing subscription');
 const audit=await prisma.adminAuditLog.findMany({where:{actorUserId:admin.id}});assert.deepEqual(audit.map(a=>a.action).sort(),['SUBSCRIPTION_ACCESS_RESTORED','SUBSCRIPTION_ACCESS_SUSPENDED','SUBSCRIPTION_DISPLAY_PRICES_UPDATED'].sort());
 // An audit insertion failure must roll back a price update too.
 const beforeFailure=await readPricing();await assert.rejects(updatePricing('missing-actor',{...priceInput,expectedVersion:beforeFailure.version}));assert.equal((await readPricing()).version,beforeFailure.version);
 }finally{
 if(original&&admin){const current=await readPricing();await updatePricing(admin.id,{expectedVersion:current.version,prices:original.prices,reason:'Restore isolated test defaults',confirmation:'UPDATE DISPLAY PRICES'});}
 await new Promise<void>(resolve=>server.close(()=>resolve()));await prisma.adminAuditLog.deleteMany({where:{actorUserId:{in:ids}}});await prisma.user.deleteMany({where:{id:{in:ids}}});await prisma.providerEvent.deleteMany({where:{providerEventId:{in:events}}});
 }
});
