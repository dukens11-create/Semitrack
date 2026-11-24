import assert from 'node:assert/strict';
import test from 'node:test';
import { can, operationalDriverScope, requireDriver, operationalActor } from '../dist/modules/admin/operationalPolicy.js';
import { isVerifiedTruck } from '../dist/modules/trucks/profileRevision.js';
import { requireIsolatedDatabase } from './isolatedDatabaseGuard.ts';
const actor=(role,globalScope=false)=>({userId:'staff',role,globalScope,fleetIds:['fleet-a']});
test('all seven staff roles have least-privilege mutation boundaries',()=>{
 for(const role of ['SUPER_ADMIN','OPERATIONS','DISPATCH','SAFETY','SUPPORT','BILLING','READ_ONLY']) {
  const a=actor(role);assert.equal(can(a,'roles.manage'),role==='SUPER_ADMIN');assert.equal(can(a,'equipment.manage'),['SUPER_ADMIN','OPERATIONS'].includes(role));assert.equal(can(a,'trucks.edit'),['SUPER_ADMIN','OPERATIONS','SAFETY'].includes(role));
 }
});
test('fleet scope cannot become global when membership is empty',()=>{assert.deepEqual(operationalDriverScope({...actor('OPERATIONS'),fleetIds:[]}).operationalMemberships.some.fleetId.in,[]);});
test('fleet-scoped driver lookup rejects records outside scope and staff accounts',async()=>{let where;await assert.rejects(()=>requireDriver({user:{findFirst:async args=>{where=args.where;return null;}}},actor('SUPPORT'),'other'),e=>e.safeStatus===404);assert.equal(where.AND[0].id,'other');assert.deepEqual(where.AND[1].operationalMemberships.some.fleetId.in,['fleet-a']);await assert.rejects(()=>requireDriver({user:{findFirst:async()=>({id:'staff',staffAccess:{id:'grant'}})}},actor('OPERATIONS'),'staff'));});
test('legacy fleet-admin role cannot grant operational write permission',async()=>{await assert.rejects(()=>operationalActor({staffAccess:{findUnique:async()=>null}},{userId:'old',role:'FLEET_ADMIN'}));});
test('server verification requires matching revision and owner confirmation',()=>{const t={revision:2,verifiedRevision:2,verificationState:'VERIFIED',verifiedByUserId:'driver',userId:'driver'};assert.equal(isVerifiedTruck(t),true);for(const change of [{revision:3},{verifiedRevision:null},{verifiedByUserId:'admin'},{verificationState:'ADMIN_UPDATED'}])assert.equal(isVerifiedTruck({...t,...change}),false);});
test('test database guard rejects production, Neon, Render, default postgres and unmatched marker',()=>{for(const u of ['postgresql://u:p@db.neon.tech/db','postgresql://u:p@db.render.com/db','postgresql://u:p@127.0.0.1:5432/postgres','postgresql://u:p@127.0.0.1:54000/semitrax_test_1234567890abcdef'])assert.throws(()=>requireIsolatedDatabase(u));});
