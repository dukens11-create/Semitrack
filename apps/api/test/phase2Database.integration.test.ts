import test, { after } from "node:test";
let closeDatabase: (() => Promise<void>) | undefined;
after(async () => { await closeDatabase?.(); });
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { requireIsolatedDatabase } from "./isolatedDatabaseGuard.ts";
test(
  "Phase2 real PostgreSQL 511 geometry upsert and snapshot retirement preserve feed isolation",
  { skip: !process.env.SUBSCRIPTION_TEST_DATABASE_URL },
  async (t) => {
    process.env.DATABASE_URL = requireIsolatedDatabase(
      process.env.SUBSCRIPTION_TEST_DATABASE_URL
    );
    const { prisma, disconnectDatabase } = await import(
      "../dist/lib/prisma.js"
    );
    closeDatabase = disconnectDatabase;
    const { env } = await import("../dist/config/env.js");
    const original = env.dotProviderConfigJson;
    t.after(() => {
      env.dotProviderConfigJson = original;
    });
    const provider = "phase2-" + crypto.randomUUID(),
      other = "other-" + crypto.randomUUID();
    const timestamp = new Date().toISOString();
    env.dotProviderConfigJson = JSON.stringify([
      {
        id: provider,
        jurisdiction: "NV",
        endpointUrl: "https://fixture.example.invalid/feed",
        format: "GEOJSON",
        dataType: "ROAD_EVENTS",
        completeSnapshot: true,
      },
    ]);
    let features = [
      {
        properties: {
          id: "closure",
          title: "Synthetic closure",
          type: "ROAD_CLOSURE",
          lastUpdated: timestamp,
        },
        geometry: { type: "Point", coordinates: [-120, 40] },
      },
    ];
    t.mock.method(globalThis, "fetch", async () => ({
      ok: true,
      json: async () => ({ features }),
    }));
    await prisma.dotRoadEvent.create({
      data: {
        provider: other,
        providerEventId: "unrelated",
        title: "Other isolated feed",
        type: "OTHER",
        latitude: 41,
        longitude: -121,
        lastUpdated: new Date(),
      },
    });
    const { refreshDotProviders } = await import(
      "../dist/services/dotFeedService.js"
    );
    let results = await refreshDotProviders(true);
    assert.equal(results[0]?.status, "fulfilled");
    const record = await prisma.dotRoadEvent.findUniqueOrThrow({
      where: {
        provider_providerEventId: { provider, providerEventId: "closure" },
      },
    });
    assert.deepEqual(record.geometryJson, {
      type: "Point",
      coordinates: [-120, 40],
    });
    assert.equal(record.active, true);
    features = [];
    results = await refreshDotProviders(true);
    assert.equal(results[0]?.status, "fulfilled");
    assert.equal(
      (
        await prisma.dotRoadEvent.findUniqueOrThrow({
          where: { id: record.id },
        })
      ).active,
      false
    );
    assert.equal(
      (
        await prisma.dotRoadEvent.findUniqueOrThrow({
          where: {
            provider_providerEventId: {
              provider: other,
              providerEventId: "unrelated",
            },
          },
        })
      ).active,
      true
    );
  }
);

test('malformed/mixed/partial/failed 511 snapshots cannot retire closures or cameras or become HEALTHY', {skip:!process.env.SUBSCRIPTION_TEST_DATABASE_URL}, async t=>{
 process.env.DATABASE_URL=requireIsolatedDatabase(process.env.SUBSCRIPTION_TEST_DATABASE_URL);
 const {prisma,disconnectDatabase}=await import('../dist/lib/prisma.js');closeDatabase = disconnectDatabase;
 const {env}=await import('../dist/config/env.js');const old=env.dotProviderConfigJson;t.after(()=>{env.dotProviderConfigJson=old;});
 const {refreshDotProviders}=await import('../dist/services/dotFeedService.js');
 let body:any,networkFailure=false;
 t.mock.method(globalThis,'fetch',async()=>{if(networkFailure)throw Error('Synthetic network failure');return {ok:true,json:async()=>body};});
 for(const dataType of ['ROAD_EVENTS','CAMERAS']){
  const provider='review-'+crypto.randomUUID();const config={id:provider,jurisdiction:'NV',endpointUrl:'https://fixture.invalid/feed',format:'GEOJSON',dataType,completeSnapshot:true};
  env.dotProviderConfigJson=JSON.stringify([config]);
  const feature=()=>({properties:{id:'retained',title:'Synthetic safety record',lastUpdated:new Date().toISOString(),imageUrl:'https://fixture.invalid/camera'},geometry:{type:'Point',coordinates:[-120,40]}});
  const table=dataType==='ROAD_EVENTS'?prisma.dotRoadEvent:prisma.trafficCamera;
  body={features:[feature()]};await refreshDotProviders(true);
  const original=await table.findFirstOrThrow({where:{provider}});
  for(const malformed of [()=>{const f=feature();delete f.properties.lastUpdated;return f;},()=>{const f=feature();f.geometry.coordinates=[null,''];return f;},()=>{const f=feature();f.properties.lastUpdated=new Date(Date.now()+60000).toISOString();return f;},()=>{const f=feature();delete f.properties.id;return f;}]){
   body={features:[{...feature(),properties:{...feature().properties,id:'valid-new'}},malformed()]};
   assert.equal((await refreshDotProviders(true))[0].status,'rejected');
   assert.equal((await table.findFirstOrThrow({where:{id:original.id}})).active,true);
   assert.equal(await table.count({where:{provider}}),1);
   assert.equal((await prisma.providerSyncState.findFirstOrThrow({where:{provider}})).status,'DEGRADED');
  }
  if(dataType==='CAMERAS'){
   const f=feature();delete f.properties.imageUrl;body={features:[f]};
   assert.equal((await refreshDotProviders(true))[0].status,'rejected');
   assert.equal((await table.findFirstOrThrow({where:{id:original.id}})).active,true);
  }
  networkFailure=true;assert.equal((await refreshDotProviders(true))[0].status,'rejected');networkFailure=false;
  assert.equal((await table.findFirstOrThrow({where:{id:original.id}})).active,true);
  body={features:[feature()]};await refreshDotProviders(true);
  assert.equal((await table.findFirstOrThrow({where:{id:original.id}})).active,true);
  assert.equal((await prisma.providerSyncState.findFirstOrThrow({where:{provider}})).status,'HEALTHY');
  env.dotProviderConfigJson=JSON.stringify([{...config,completeSnapshot:false}]);body={features:[]};await refreshDotProviders(true);
  assert.equal((await table.findFirstOrThrow({where:{id:original.id}})).active,true);
  assert.equal((await prisma.providerSyncState.findFirstOrThrow({where:{provider}})).status,'DEGRADED');
  env.dotProviderConfigJson=JSON.stringify([config]);body={features:[]};await refreshDotProviders(true);
  assert.equal((await table.findFirstOrThrow({where:{id:original.id}})).active,false);
  assert.equal((await prisma.providerSyncState.findFirstOrThrow({where:{provider}})).status,'HEALTHY');
 }
});

import {spawn} from 'node:child_process';
import net from 'node:net';
test('authenticated safety corridor HTTP errors differ from valid zero records on isolated PostgreSQL', {skip:!process.env.SUBSCRIPTION_TEST_DATABASE_URL,timeout:30000},async t=>{
 process.env.DATABASE_URL=requireIsolatedDatabase(process.env.SUBSCRIPTION_TEST_DATABASE_URL);
 const {prisma,disconnectDatabase}=await import('../dist/lib/prisma.js');closeDatabase = disconnectDatabase;
 const user=await prisma.user.create({data:{email:crypto.randomUUID()+'@example.invalid',fullName:'Isolated corridor fixture',passwordHash:'synthetic-not-a-password'}});
 const session=await prisma.refreshToken.create({data:{userId:user.id,tokenHash:crypto.randomBytes(32).toString('hex'),expiresAt:new Date(Date.now()+60000)}});
 const {signAccessToken}=await import('../dist/utils/jwt.js');const token=signAccessToken({userId:user.id,email:user.email,role:user.role,sessionId:session.id});
 const port=await new Promise<number>((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=(s.address() as net.AddressInfo).port;s.close(()=>resolve(p));});});
 const child=spawn(process.execPath,['dist/server.js'],{env:{...process.env,NODE_ENV:'test',PORT:String(port),DOT_PROVIDER_CONFIG_JSON:'[]'},stdio:'ignore',windowsHide:true});
 t.after(async()=>{if(child.exitCode===null){child.kill();await new Promise<void>(resolve=>{child.once('exit',()=>resolve());setTimeout(resolve,3000).unref();});}});
 const base='http://127.0.0.1:'+port;
 let ready=false;for(let i=0;i<40;i++){try{if((await fetch(base+'/health',{signal:AbortSignal.timeout(500)})).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert.equal(ready,true,'Isolated API startup');
 const route=[{lat:0,lng:0},{lat:0,lng:0.1}];
 const fix=()=>({...route[0],accuracy:4,timestamp:Date.now()});
 for(const kind of ['restrictions','road-events','cameras','parking','fuel','weigh-stations']){
  for(const [patch,code] of [[{},null],[{currentLocation:{...fix(),timestamp:Date.now()-16000}},'CORRIDOR_LOCATION_STALE'],[{currentLocation:{...fix(),lat:1}},'CORRIDOR_LOCATION_OFF_ROUTE'],[{currentLocation:{...fix(),accuracy:-1}},'CORRIDOR_LOCATION_INVALID'],[{currentLocation:null},'CORRIDOR_LOCATION_REQUIRED'],[{route:[]},'CORRIDOR_ROUTE_REQUIRED'],[{route:[...route,route[0]]},'CORRIDOR_LOCATION_AMBIGUOUS']]){
   const response=await fetch(base+'/safety/'+kind+'/corridor',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({route,currentLocation:fix(),...patch}),signal:AbortSignal.timeout(3000)});
   const result=await response.json();assert.equal(response.status,code?422:200);
   if(code){assert.equal(result.error.code,code);assert.equal(result.items,undefined);}else assert.deepEqual(result,{items:[]});
  }
 }
});
