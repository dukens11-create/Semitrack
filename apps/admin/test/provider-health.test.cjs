const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
function compile(file,extra='',resolve=require){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src',file),'utf8')+extra,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:resolve});return exports;}
const health=compile('providerHealth.ts');
const {LiveOperations}=compile('App.tsx','\nexport {LiveOperations};',name=>{
 if(name==='./providerHealth')return health;
 if(['./Operations','./truckDetails','./api'].includes(name))return {};
 return require(name);
});
const good={configured:true,status:'OPERATIONAL',validUntil:new Date(Date.now()+240_000).toISOString()};
function render(status,unavailable=false){return renderToStaticMarkup(React.createElement(LiveOperations,{data:{liveOperations:{trimbleRouting:status,driversOnline:0,driversNavigating:null,activeTrips:null,routesOverDrivingThreshold:null,apiErrors24Hours:0,paymentProblems:null}},healthUnavailable:unavailable}));}
for(const [status,tone] of [['OPERATIONAL','ok'],['DEGRADED','warn'],['UNAVAILABLE','danger'],['NOT_CONFIGURED','muted']])test('Live Operations renders backend Trimble '+status,()=>{
 const html=render({...good,status});assert(html.includes('Trimble Routing'));assert(!/HERE|TomTom/.test(html));
 assert(html.includes(`operation ${tone}"><span>Trimble Routing</span><strong>${status.replaceAll('_',' ')}</strong>`));
});
test('missing or unrecognized API provider state never crashes or renders green',()=>{
 for(const state of [undefined,{configured:true,status:'CONFIGURED'}, {...good,status:'unexpected'}]){
  assert.equal(health.routingHealthDisplay(state).value,'UNAVAILABLE');assert(render(state).includes('Trimble Routing</span><strong>UNAVAILABLE'));
 }
});
test('expired, missing or invalid health evidence loses operational status',()=>{
 for(const validUntil of [null,'invalid',new Date(Date.now()-1).toISOString()])assert.equal(health.routingHealthDisplay({...good,validUntil}).value,'DEGRADED');
 assert.equal(health.routingHealthDisplay({...good,configured:false}).tone,'warn');
});
test('failed dashboard refresh suppresses previously operational provider evidence',()=>{
 assert.equal(health.routingHealthDisplay(good,true).value,'UNAVAILABLE');
 assert(render(good,true).includes('operation danger"><span>Trimble Routing</span><strong>UNAVAILABLE'));
});
