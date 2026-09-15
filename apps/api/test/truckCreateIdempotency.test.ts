
import test from 'node:test';
import assert from 'node:assert/strict';
import {saveTruck} from '../dist/modules/trucks/profileRevision.js';
const profile={name:'Synthetic',heightFt:13.5,widthFt:8.5,lengthFt:53,weightLbs:80000,currentWeightLbs:null,weightPerAxleLbs:null,axleCount:5,trailerCount:1,trailerType:'Dry Van',hazmatEnabled:false,hazardousGoods:[],avoidResidential:false,avoidDirtRoads:false};
function database(){
 const trucks=new Map(),audits=new Map();let count=0;
 const tx={truck:{findFirst:async({where})=>[...trucks.values()].find(t=>t.id===where.id&&t.userId===where.userId)??null,
 create:async({data})=>{const t={...data,id:'synthetic-'+ ++count,revision:1,createdAt:new Date(),updatedAt:new Date()};trucks.set(t.id,t);return t;}},
 adminAuditLog:{findUnique:async({where})=>audits.get(where.id)??null,create:async({data})=>{if(audits.has(data.id))throw {code:'P2002'};audits.set(data.id,data);return data;}}};
 return {trucks,audits,db:{$transaction:async fn=>fn(tx)}};
}
test('committed POST response loss replays one original profile; new operation creates another',async()=>{
 const {db,trucks,audits}=database();const body={...profile,createOperationId:'11111111-1111-4111-8111-111111111111'};
 const first=await saveTruck(db,'owner','owner',body); // client never receives this response
 const retry=await saveTruck(db,'owner','owner',body);
 assert.equal(first.id,retry.id);assert.equal(trucks.size,1);assert.equal(audits.size,1);
 assert.equal(retry.heightFt,13.5);assert.equal(retry.widthFt,8.5);assert.equal(retry.lengthFt,53);assert.equal(retry.axleCount,5);assert.equal(retry.trailerCount,1);
 await saveTruck(db,'owner','owner',{...body,createOperationId:'22222222-2222-4222-8222-222222222222'});assert.equal(trucks.size,2);
});
test('key reuse cannot change values or cross account ownership',async()=>{
 const {db,trucks}=database(),body={...profile,createOperationId:'11111111-1111-4111-8111-111111111111'};
 const first=await saveTruck(db,'owner','owner',body);
 await assert.rejects(()=>saveTruck(db,'owner','owner',{...body,lengthFt:48}),e=>e.safeCode==='TRUCK_CREATE_OPERATION_CONFLICT');
 const other=await saveTruck(db,'other','other',body);assert.notEqual(other.id,first.id);assert.equal(other.userId,'other');assert.equal(trucks.size,2);
});

// Exercise the actual RN serializer/HTTP client and backend save boundary together.
// Transport and storage are isolated doubles; PostgreSQL concurrency is covered separately.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
function mobileModuleLoader(){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../mobile-react-native');
 const require=createRequire(path.join(root,'package.json')),cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const localRequire=name=>name==='react-native'?{TurboModuleRegistry:{get:()=>null}}:name.startsWith('.')?load(path.resolve(path.dirname(file),name+'.ts')):require(name);
  vm.runInThisContext('(function(require,module,exports){'+source+'\n})',{filename:file})(localRequire,module,module.exports);
  return module.exports;
 }
 return name=>load(path.join(root,'src',name+'.ts'));
}
test('RN save through serialized HTTP boundary retries committed response loss with one durable operation',async()=>{
 const load=mobileModuleLoader(),{TruckProfileStore}=load('features/truckProfile/TruckProfileStore'),{ApiClient}=load('services/api/ApiClient');
 const {db,trucks}=database();let lose=true;const posted=[];
 const api=new ApiClient('https://isolated.example.test',{read:async()=>null},async(url,init)=>{
  assert.equal(url,'https://isolated.example.test/trucks');assert.equal(init.method,'POST');
  const body=JSON.parse(init.body);posted.push(body);
  const saved=await saveTruck(db,'synthetic-owner','synthetic-owner',body);
  if(lose){lose=false;throw new TypeError('Synthetic response loss after commit');}
  return new Response(JSON.stringify(saved),{status:201});
 });
 const store=new TruckProfileStore(api,()=>{},async()=>crypto.randomUUID());
 const draft={...profile,id:'',tractorType:'Sleeper Cab',isDefault:false,avoidTolls:false,avoidFerries:false,avoidHighways:false};
 await assert.rejects(()=>store.save(draft),e=>e.code==='NETWORK_UNAVAILABLE');assert.equal(trucks.size,1);
 const recovered=await store.save(draft);
 assert.equal(trucks.size,1);assert.equal(posted.length,2);assert.equal(posted[0].createOperationId,posted[1].createOperationId);
 assert.equal(recovered.id,[...trucks.keys()][0]);
 assert.deepEqual([posted[1].heightFt,posted[1].widthFt,posted[1].lengthFt,posted[1].weightLbs,posted[1].axleCount,posted[1].trailerCount,posted[1].hazmatEnabled],[13.5,8.5,53,80000,5,1,false]);
 const second=await store.save(draft);assert.equal(trucks.size,2);assert.notEqual(second.id,recovered.id);assert.notEqual(posted[2].createOperationId,posted[1].createOperationId);
});
