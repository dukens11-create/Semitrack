import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {requireIsolatedDatabase} from './isolatedDatabaseGuard.ts';
const enabled=Boolean(process.env.SUBSCRIPTION_TEST_DATABASE_URL);
let module:any;
async function db(){process.env.DATABASE_URL=requireIsolatedDatabase(process.env.SUBSCRIPTION_TEST_DATABASE_URL);module??=await import('../dist/lib/prisma.js');return module.prisma;}
after(async()=>{await module?.disconnectDatabase();});
const profile={name:'Rollback fixture',heightFt:13.5,widthFt:8.5,lengthFt:53,weightLbs:80000,axleCount:5,trailerCount:1,hazmatEnabled:false,hazardousGoods:[]};
async function owner(p:any){return p.user.create({data:{email:crypto.randomUUID()+'@example.invalid',passwordHash:'synthetic-only',fullName:'Rollback fixture'}});}
function abortAfterWork(p:any){return {$transaction:(fn:any,options:any)=>p.$transaction(async(tx:any)=>{await fn(tx);throw Error('Synthetic transaction abort after work');},options)};}
test('database rollback restores previous verified/default truck and its audit records',{skip:!enabled},async()=>{
 const p=await db();const {saveTruck,verifyTruck}=await import('../dist/modules/trucks/profileRevision.js');
 const u=await owner(p);const a=await saveTruck(p,u.id,u.id,profile),b=await saveTruck(p,u.id,u.id,{...profile,name:'Second'});
 await verifyTruck(p,u.id,a.id,1);
 const before=await p.truck.findMany({where:{userId:u.id},orderBy:{id:'asc'}});
 const auditBefore=await p.adminAuditLog.count({where:{actorUserId:u.id}});
 await assert.rejects(()=>verifyTruck(abortAfterWork(p),u.id,b.id,1),/Synthetic transaction abort/);
 assert.deepEqual(await p.truck.findMany({where:{userId:u.id},orderBy:{id:'asc'}}),before);
 assert.equal(await p.adminAuditLog.count({where:{actorUserId:u.id}}),auditBefore);
});
test('database concurrent verification of different trucks retains one default',{skip:!enabled},async()=>{
 const p=await db();const {saveTruck,verifyTruck}=await import('../dist/modules/trucks/profileRevision.js');
 const u=await owner(p);const a=await saveTruck(p,u.id,u.id,profile),b=await saveTruck(p,u.id,u.id,{...profile,name:'Second'});
 const results=await Promise.allSettled([verifyTruck(p,u.id,a.id,1),verifyTruck(p,u.id,b.id,1)]);
 assert(results.some(r=>r.status==='fulfilled'));
 const trucks=await p.truck.findMany({where:{userId:u.id}});
 assert.equal(trucks.filter((t:any)=>t.isDefault).length,1);
 for(const t of trucks.filter((t:any)=>t.verificationState==='VERIFIED'))assert.equal(t.verifiedRevision,t.revision);
});
test('database rollback keeps password and usable session/reset state together',{skip:!enabled},async()=>{
 const p=await db();const {hashPassword}=await import('../dist/utils/password.js');const {changeUserPassword}=await import('../dist/services/passwordRecovery.js');
 const u=await owner(p);await p.user.update({where:{id:u.id},data:{passwordHash:await hashPassword('Synthetic old password')}});
 await p.refreshToken.create({data:{userId:u.id,tokenHash:crypto.randomBytes(32).toString('hex'),expiresAt:new Date(Date.now()+600000)}});
 await p.passwordResetToken.create({data:{userId:u.id,tokenHash:crypto.randomBytes(32).toString('hex'),expiresAt:new Date(Date.now()+600000)}});
 const before=await p.user.findUniqueOrThrow({where:{id:u.id}});
 await assert.rejects(()=>changeUserPassword(abortAfterWork(p),u.id,'Synthetic old password','Synthetic replacement password'),/Synthetic transaction abort/);
 assert.deepEqual(await p.user.findUniqueOrThrow({where:{id:u.id}}),before);
 assert.equal(await p.refreshToken.count({where:{userId:u.id,revokedAt:null}}),1);
 assert.equal(await p.passwordResetToken.count({where:{userId:u.id,usedAt:null}}),1);
});
test('database rollback restores trip revision, ordered stop progress and audit together',{skip:!enabled},async()=>{
 const p=await db();const {saveTruck,verifyTruck}=await import('../dist/modules/trucks/profileRevision.js');
 const {createTrip,transitionTrip}=await import('../dist/modules/trips/trip-status.routes.js');
 const u=await owner(p),t=await saveTruck(p,u.id,u.id,profile);await verifyTruck(p,u.id,t.id,1);
 const trip=await p.$transaction((tx:any)=>createTrip(tx,u.id,{createOperationId:crypto.randomUUID(),name:'Rollback trip',origin:{id:'o',name:'Origin',lat:40,lng:-120},destination:{id:'d',name:'Destination',lat:40.2,lng:-120},stops:[{id:'a',name:'Stop',lat:40.1,lng:-120}],truckId:t.id,expectedTruckRevision:1}));
 const started=await transitionTrip(p,u.id,trip.id,{expectedRevision:1,status:'STARTED'});
 const audits=await p.adminAuditLog.count({where:{targetId:trip.id}});
 await assert.rejects(()=>transitionTrip(abortAfterWork(p),u.id,trip.id,{expectedRevision:started.revision,status:'IN_PROGRESS',completedStopId:'a'}),/Synthetic transaction abort/);
 assert.deepEqual(await p.trip.findUniqueOrThrow({where:{id:trip.id}}),started);
 assert.equal(await p.adminAuditLog.count({where:{targetId:trip.id}}),audits);
});
