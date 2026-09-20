const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
function compile(file,extra='',resolve=require){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src',file),'utf8')+extra,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:resolve});return exports;}
const health=compile('providerHealth.ts');
const {LiveOperations}=compile('App.tsx','\nexport {LiveOperations};',name=>{
 if(name==='./providerHealth')return health;
 if(['./SubscriptionAdmin','./Operations','./truckDetails','./api'].includes(name))return {};
 return require(name);
});
const good={configured:true,status:'OPERATIONAL',validUntil:new Date(Date.now()+240_000).toISOString()};
function renderResponse(routing,unavailable=false){return renderToStaticMarkup(React.createElement(LiveOperations,{data:{liveOperations:{...routing,driversOnline:0,driversNavigating:null,activeTrips:null,routesOverDrivingThreshold:null,apiErrors24Hours:0,paymentProblems:null}},healthUnavailable:unavailable}));}
function render(status,unavailable=false){return renderResponse({trimbleRouting:status},unavailable);}
for(const [status,tone] of [['OPERATIONAL','ok'],['DEGRADED','warn'],['UNAVAILABLE','danger'],['NOT_CONFIGURED','muted']])test('Live Operations renders backend Trimble '+status,()=>{
 const html=render({...good,status});assert(html.includes('Trimble Routing'));assert(!/HERE|TomTom/.test(html));
 assert(html.includes(`operation ${tone}"><span>Trimble Routing</span><strong>${status.replaceAll('_',' ')}</strong>`));
});
test('missing or unrecognized API provider state never crashes or renders green',()=>{
 for(const state of [undefined,{configured:true,status:'CONFIGURED'}, {...good,status:'unexpected'}]){
  assert.equal(health.routingHealthDisplay({trimbleRouting:state}).value,'UNAVAILABLE');assert(render(state).includes('Trimble Routing</span><strong>UNAVAILABLE'));
 }
});
test('expired, missing or invalid health evidence loses operational status',()=>{
 for(const validUntil of [null,'invalid',new Date(Date.now()-1).toISOString()])assert.equal(health.routingHealthDisplay({trimbleRouting:{...good,validUntil}}).value,'DEGRADED');
 assert.equal(health.routingHealthDisplay({trimbleRouting:{...good,configured:false}}).tone,'warn');
});
test('failed dashboard refresh suppresses previously operational provider evidence',()=>{
 assert.equal(health.routingHealthDisplay({trimbleRouting:good},true).value,'UNAVAILABLE');
 assert(render(good,true).includes('operation danger"><span>Trimble Routing</span><strong>UNAVAILABLE'));
});


test('updated Admin accepts the old production API without presenting HERE health as Trimble proof', () => {
  for (const status of ['CONFIGURED','NOT_CONFIGURED','DEGRADED','OPERATIONAL']) {
    const html = renderResponse({hereService:{configured:true,status}});
    assert(html.includes('Trimble Routing</span><strong>UNAVAILABLE'));
    assert(!/HERE|TomTom/.test(html));
  }
});
test('updated Admin prefers new Trimble evidence when both response shapes are present', () => {
  const html = renderResponse({trimbleRouting:good,hereService:{configured:false,status:'NOT_CONFIGURED'}});
  assert(html.includes('operation ok"><span>Trimble Routing</span><strong>OPERATIONAL'));
});
test('updated Admin accepts a response with neither routing-health field', () => {
  assert(renderResponse({}).includes('Trimble Routing</span><strong>UNAVAILABLE'));
  assert.equal(health.routingHealthDisplay(undefined).value,'UNAVAILABLE');
});
test('legacy health cannot mask degraded, unavailable or malformed new Trimble evidence', () => {
  for (const status of ['DEGRADED','UNAVAILABLE','unexpected']) {
    const html = renderResponse({trimbleRouting:{...good,status},hereService:{configured:true,status:'OPERATIONAL'}});
    assert(html.includes('Trimble Routing</span><strong>'+(status==='DEGRADED'?'DEGRADED':'UNAVAILABLE')));
    assert(!html.includes('operation ok"><span>Trimble Routing'));
  }
});
