import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {requireIsolatedDatabase} from './isolatedDatabaseGuard.ts';
const enabled=!!process.env.SUBSCRIPTION_TEST_DATABASE_URL;
let db:any,remove:any,reapply:any,hash:any,access:any;
after(async()=>{await db?.$disconnect();});
async function setup(){if(!db){process.env.DATABASE_URL=requireIsolatedDatabase(process.env.SUBSCRIPTION_TEST_DATABASE_URL);db=(await import('../dist/lib/prisma.js')).prisma;({deleteOwnAccount:remove,reapplyDeletionLedger:reapply}=await import('../dist/services/accountDeletion.js'));hash=(await import('../dist/utils/password.js')).hashPassword;access=(await import('../dist/services/accessSession.js')).currentAccessSession;}return db;}
const password='Synthetic password for local tests 123';
const input={currentPassword:password,confirmation:'DELETE MY ACCOUNT'};
async function account(){await setup();return db.user.create({data:{email:randomUUID()+'@fixture.invalid',fullName:'Private fixture',phone:'5550000000',passwordHash:await hash(password)}});}
test('deletion confirmation/password/unknown fields fail without mutation',{skip:!enabled},async()=>{
 const u=await account();for(const bad of [{...input,confirmation:'DELETE'},{...input,currentPassword:'wrong'},{...input,userId:'someone-else'}])await assert.rejects(remove(db,u.id,bad));
 assert.equal((await db.user.findUnique({where:{id:u.id}})).email,u.email);assert.equal((await db.$queryRaw`SELECT * FROM "AccountDeletionTombstone" WHERE "userId"=${u.id}`).length,0);
});
test('deletion atomically revokes sessions and erases personal records while retaining financial/fleet/safety data; duplicates idempotent',{skip:!enabled},async()=>{
 const u=await account(),userId=u.id;
 const session=await db.refreshToken.create({data:{userId,tokenHash:randomUUID(),expiresAt:new Date(Date.now()+60000)}});
 await db.passwordResetToken.create({data:{userId,tokenHash:randomUUID(),expiresAt:new Date(Date.now()+60000)}});
 await db.navigationSettings.create({data:{userId,settingsJson:{private:'address'}}});await db.favorite.create({data:{userId,name:'Home',latitude:1,longitude:2,address:'private'}});
 const truck=await db.truck.create({data:{userId,name:'Retained equipment',heightFt:13.5,widthFt:8.5,lengthFt:53,weightLbs:80000,hazardousGoods:[]}});
 const trip=await db.trip.create({data:{userId,truckId:truck.id,name:'Retained trip',originName:'Synthetic A',destinationName:'Synthetic B',originLat:1,originLng:2,destinationLat:3,destinationLng:4}});
 const personal=await db.document.create({data:{userId,type:'GENERAL',fileName:'Personal',fileUrl:''}});
 const retained=await db.document.create({data:{userId,type:'CDL',fileName:'Compliance',fileUrl:''}});
 const file=await db.document.create({data:{userId,type:'GENERAL',fileName:'Held file',fileUrl:'private-storage-reference'}});
 const payment=await db.paymentTransaction.create({data:{userId,provider:'fixture',providerEventId:randomUUID(),type:'PAYMENT',status:'PAID',amountCents:100,occurredAt:new Date()}});
 const fleet=await db.fleetBillingAccount.create({data:{name:'Fixture company'}});
 const member=await db.fleetMembership.create({data:{userId,fleetBillingAccountId:fleet.id}});
 const report=await db.communityDataReport.create({data:{userId,type:'ROAD_CONDITION',entityId:randomUUID(),value:'SYNTHETIC',expiresAt:new Date(Date.now()+60000)}});
 await db.eldConnection.create({data:{userId,provider:'SAMSARA',encryptedAccessToken:'synthetic',encryptedRefreshToken:'synthetic',providerAccountId:'private',scopes:['test'],status:'CONNECTED',metadataJson:{private:'data'}}});
 assert.ok(await access(db,{userId,sessionId:session.id}));
 const results=await Promise.all([remove(db,userId,input),remove(db,userId,input)]);assert(results.every((r:any)=>r.deleted));
 const after=await db.user.findUnique({where:{id:userId}});assert.equal(after.fullName,'Deleted account');assert.equal(after.phone,null);assert.notEqual(after.email,u.email);assert.equal(after.passwordHash,'!ACCOUNT_DELETED!');assert(after.disabledAt);
 assert.equal(await access(db,{userId,sessionId:session.id}),null);assert.equal(await db.refreshToken.count({where:{userId,revokedAt:null}}),0);assert.equal(await db.passwordResetToken.count({where:{userId,usedAt:null}}),0);
 assert.equal(await db.favorite.count({where:{userId}}),0);assert.equal(await db.navigationSettings.count({where:{userId}}),0);assert.equal(await db.document.findUnique({where:{id:personal.id}}),null);
 assert.deepEqual(await db.truck.findUnique({where:{id:truck.id}}),truck);assert.deepEqual(await db.trip.findUnique({where:{id:trip.id}}),trip);
 for(const d of [retained,file])assert.deepEqual(await db.document.findUnique({where:{id:d.id}}),d);
 assert.deepEqual(await db.paymentTransaction.findUnique({where:{id:payment.id}}),payment);assert.deepEqual(await db.fleetBillingAccount.findUnique({where:{id:fleet.id}}),fleet);assert.deepEqual(await db.fleetMembership.findUnique({where:{id:member.id}}),member);assert.deepEqual(await db.communityDataReport.findUnique({where:{id:report.id}}),report);
 const eld=await db.eldConnection.findUnique({where:{userId_provider:{userId,provider:'SAMSARA'}}});assert.equal(eld.encryptedAccessToken,null);assert.equal(eld.encryptedRefreshToken,null);assert.equal(eld.metadataJson,null);assert.equal(eld.status,'DISCONNECTED');
 await db.user.update({where:{id:userId},data:{disabledAt:null,email:u.email,fullName:u.fullName,passwordHash:u.passwordHash}});assert.equal((await db.user.findUnique({where:{id:userId}})).fullName,'Deleted account');
 await assert.rejects(db.favorite.create({data:{userId,name:'late write',latitude:1,longitude:2}}));
 await assert.rejects(db.navigationSettings.create({data:{userId}}));
 await db.eldConnection.update({where:{id:eld.id},data:{encryptedAccessToken:'late token',status:'CONNECTED',metadataJson:{private:'late'}}});assert.equal((await db.eldConnection.findUnique({where:{id:eld.id}})).encryptedAccessToken,null);
 assert.equal((await db.$queryRaw`SELECT * FROM "AccountDeletionTombstone" WHERE "userId"=${userId}`).length,1);
});
test('failed deletion transaction rolls back profile, ledger and session revocation',{skip:!enabled},async()=>{
 const u=await account();const session=await db.refreshToken.create({data:{userId:u.id,tokenHash:randomUUID(),expiresAt:new Date(Date.now()+60000)}});
 const failing={$transaction:(fn:any)=>db.$transaction((tx:any)=>fn(new Proxy(tx,{get(target,key){if(key==='document')return{deleteMany:async()=>{throw Error('injected database failure');}};return target[key];}})))};
 await assert.rejects(remove(failing,u.id,input));assert.deepEqual(await db.user.findUnique({where:{id:u.id}}),u);assert.equal((await db.refreshToken.findUnique({where:{id:session.id}})).revokedAt,null);assert.equal((await db.$queryRaw`SELECT * FROM "AccountDeletionTombstone" WHERE "userId"=${u.id}`).length,0);
});
test('restore ledger reapplication anonymizes restored active data without rewriting immutable backup; replay safe',{skip:!enabled},async()=>{
 const u=await account(),immutableBackup=JSON.stringify(u);await db.navigationSettings.create({data:{userId:u.id}});
 const ledger=[{userId:u.id,deletedAt:new Date().toISOString()}];await reapply(db,ledger);await reapply(db,ledger);
 const restored=await db.user.findUnique({where:{id:u.id}});assert(restored.disabledAt);assert.equal(restored.fullName,'Deleted account');assert.equal(await db.navigationSettings.count({where:{userId:u.id}}),0);assert.equal(JSON.stringify(u),immutableBackup);
 await assert.rejects(reapply(db,[{userId:u.id,deletedAt:new Date(Date.now()+100000).toISOString()}]));
});
test('retention durations are unconfigured and cannot be partially/negatively approved',{skip:!enabled},async()=>{
 await setup();const rows=await db.$queryRaw`SELECT * FROM "AccountRetentionPolicy"`;assert.equal(rows.length,6);assert(rows.every((r:any)=>r.retentionDays===null&&r.approvedReference===null&&r.approvedAt===null));
 await assert.rejects(db.$executeRaw`UPDATE "AccountRetentionPolicy" SET "approvedReference"='x',"approvedAt"=NOW() WHERE category='backups'`);
 await assert.rejects(db.$executeRaw`UPDATE "AccountRetentionPolicy" SET "retentionDays"=-1,"approvedReference"='x',"approvedAt"=NOW() WHERE category='backups'`);
});
test('fleet owners require ownership review; deletion never silently orphans company control',{skip:!enabled},async()=>{
 const u=await account();const fleet=await db.fleetBillingAccount.create({data:{name:'Owner fixture'}});await db.fleetMembership.create({data:{userId:u.id,fleetBillingAccountId:fleet.id,role:'OWNER'}});
 await assert.rejects(remove(db,u.id,input),(e:any)=>e.safeCode==='ACCOUNT_DELETION_REVIEW_REQUIRED');assert.equal((await db.user.findUnique({where:{id:u.id}})).disabledAt,null);
});


test('in-flight personal writes cannot recreate favorites after deletion commits',{skip:!enabled},async()=>{
 const u=await account();let reached!:()=>void,release!:()=>void;
 const atErase=new Promise<void>(resolve=>{reached=resolve;}),continueErase=new Promise<void>(resolve=>{release=resolve;});
 const delayed={$transaction:(fn:any)=>db.$transaction((tx:any)=>fn(new Proxy(tx,{get(target,key){if(key==='favorite')return{deleteMany:async(args:any)=>{reached();await continueErase;return target.favorite.deleteMany(args);}};return target[key];}})))};
 const deletion=remove(delayed,u.id,input);await atErase;
 const late=db.favorite.create({data:{userId:u.id,name:'late',latitude:1,longitude:2}});
 const rejected=assert.rejects(late);release();await Promise.all([deletion,rejected]);assert.equal(await db.favorite.count({where:{userId:u.id}}),0);
});

