import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { isCurrentAdminProvider, trimbleRoutingHealth } from '../dist/modules/analytics/providerHealth.js';

const now = new Date('2026-09-15T06:00:00Z');
const healthy = {provider:'Trimble', dataType:'ROUTING', status:'HEALTHY', lastSuccessAt:new Date(now.getTime()-60_000), lastAttemptAt:new Date(now.getTime()-61_000), lastErrorCode:null};

test('Trimble configuration alone never reports operational', () => {
  assert.equal(trimbleRoutingHealth(false, [healthy], now).status, 'NOT_CONFIGURED');
  assert.equal(trimbleRoutingHealth(true, [], now).status, 'DEGRADED');
});
test('only recent successful Trimble routing evidence reports operational', () => {
  const result=trimbleRoutingHealth(true, [healthy], now);
  assert.equal(result.status,'OPERATIONAL');
  assert.equal(result.validUntil,'2026-09-15T06:04:00.000Z');
  for(const patch of [{provider:'HERE'}, {provider:'TomTom'}, {provider:'Trimble POI'}, {dataType:'POI'}]) {
    assert.equal(trimbleRoutingHealth(true,[{...healthy,...patch}],now).status,'DEGRADED');
  }
});
test('stale, missing, future, unknown or contradicted success stays degraded', () => {
  for(const patch of [
    {lastSuccessAt:null}, {lastSuccessAt:new Date(now.getTime()-300_000)},
    {lastSuccessAt:new Date(now.getTime()+1)}, {lastSuccessAt:new Date(NaN)},
    {status:'NEVER_SYNCED'}, {status:'DEGRADED'}, {status:'UNKNOWN'},
    {lastErrorCode:'FETCH_FAILED'}, {lastAttemptAt:now},
  ]) assert.equal(trimbleRoutingHealth(true,[{...healthy,...patch}],now).status,'DEGRADED');
});
test('failed or disabled routing overrides other successful routing records', () => {
  for(const status of ['ERROR','DISABLED']) assert.equal(trimbleRoutingHealth(true,[healthy,{...healthy,status}],now).status,'UNAVAILABLE');
  assert.equal(trimbleRoutingHealth(true,[healthy,{...healthy,status:'DEGRADED'}],now).status,'DEGRADED');
});
test('Admin ignores retired provider identities without hiding unrelated feeds', () => {
  for(const provider of ['HERE',' here ','HERE_ROUTING','HERE service','HERE-POI','TomTom','tomtom:routing']) assert.equal(isCurrentAdminProvider({provider}),false);
  for(const provider of ['Trimble','Mapbox','NY511','Somewhere DOT','Herefordshire']) assert.equal(isCurrentAdminProvider({provider}),true);
});

function evaluate(source: string, bindings: Record<string, unknown>) {
  const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module,exports:module.exports,...bindings});
  return module.exports as any;
}
test('actual dashboard response replaces HERE and reads real selected health fields', async () => {
  const rows=[healthy,{...healthy,provider:'HERE',status:'ERROR'},{...healthy,provider:'TomTom'}];
  const env={trimbleApiKey:'',hereApiKey:'legacy-key-must-not-count',analyticsPresenceMinutes:5,analyticsNavigationStaleMinutes:2,analyticsDrivingThresholdMinutes:660};
  const prisma={user:{count:async()=>0},subscription:{count:async()=>0,groupBy:async()=>[]},$queryRawUnsafe:async()=>[],
    providerSyncState:{findMany:async args=>{assert.equal(args.select.lastAttemptAt,true);return rows;}}};
  const service=evaluate(fs.readFileSync(new URL('../src/modules/analytics/adminAnalytics.service.ts',import.meta.url),'utf8'),{
    require(name:string){if(name.endsWith('/prisma.js'))return {prisma};if(name.endsWith('/env.js'))return {env};
      if(name==='./providerHealth.js')return {isCurrentAdminProvider,trimbleRoutingHealth};if(name==='./analyticsRange.js')return {};throw Error(name);},
  });
  const range={preset:'today',from:now,to:now,bucket:'day'};
  let result=await service.getAdminDashboard(range,false);
  assert.equal(result.liveOperations.trimbleRouting.status,'NOT_CONFIGURED');
  assert(!('hereService' in result.liveOperations));
  assert.deepEqual(Array.from(result.liveOperations.providerStates,(r:any)=>r.provider),['Trimble']);
  env.trimbleApiKey='synthetic-trimble-key'; rows.length=0;
  result=await service.getAdminDashboard(range,false);
  assert.equal(result.liveOperations.trimbleRouting.status,'DEGRADED');
  rows.push({...healthy,lastSuccessAt:new Date(),lastAttemptAt:new Date(Date.now()-1000)});
  result=await service.getAdminDashboard(range,false);
  assert.equal(result.liveOperations.trimbleRouting.status,'OPERATIONAL');
});

test('actual Admin overview, application, provider-health and public health handlers exclude obsolete provider claims', async () => {
  const source=fs.readFileSync(new URL('../src/server.ts',import.meta.url),'utf8');
  const tree=ts.createSourceFile('server.ts',source,ts.ScriptTarget.Latest,true);
  const paths=new Set(['/admin/overview','/admin/application','/admin/provider-health','/health']);
  const handlers=new Map<string,Function>();
  const rows=[{provider:'HERE',status:'ERROR'},{provider:'TomTom',status:'DEGRADED'},{provider:'NY511',status:'ERROR'}];
  const bindings={app:{get(path:string,...middleware:Function[]){handlers.set(path,middleware.at(-1)!);}},
    asyncRoute:(fn:Function)=>fn,requireAuth:()=>{},requireRole:()=>()=>{},globalAnalyticsRoles:['ADMIN'],adminRoles:['ADMIN'],
    isCurrentAdminProvider,configuredRoutingProviderName:()=> 'Trimble',
    env:{trimbleApiKey:'test-key',hereApiKey:'obsolete-key',eldEncryptionKey:'',billingMode:'disabled'},
    prisma:{user:{count:async()=>0},subscription:{count:async()=>0},communityReport:{count:async()=>0},providerSyncState:{findMany:async()=>rows},$queryRawUnsafe:async()=>[]},
  };
  for(const node of tree.statements){
    if(!ts.isExpressionStatement(node)||!ts.isCallExpression(node.expression))continue;
    const call=node.expression, first=call.arguments[0];
    if(call.expression.getText(tree)==='app.get'&&first&&ts.isStringLiteral(first)&&paths.has(first.text))evaluate(node.getText(tree),bindings);
  }
  assert.equal(handlers.size,4);
  const results=new Map<string,any>();
  for(const [path,handler] of handlers){const res={status(){return res;},json(value:any){results.set(path,value);}};await handler({},res);}
  assert.equal(results.get('/admin/overview').providerIssues,1);
  assert.deepEqual(Array.from(results.get('/admin/provider-health').items,(r:any)=>r.provider),['NY511']);
  for(const path of ['/admin/application','/health']){
    assert.equal(results.get(path).providers.trimbleRoutingConfigured,true);
    assert(!('hereRoutingConfigured' in results.get(path).providers));
  }
});
