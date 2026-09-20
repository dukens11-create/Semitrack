const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
function compile(file,resolve=require,globals={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:resolve,...globals});return exports;}
const controls=compile('subscriptionControls.ts');
const ui=compile('SubscriptionAdmin.tsx',name=>name==='./api'?{api:{}}:name==='./subscriptionControls'?controls:require(name));
const prices={monthlyRegular:1999,monthlyIntro:1499,annual:19999,fleet1:1999,fleet5:1799,fleet25:1599,fleet100:1399};
test('money input converts decimal cents exactly and rejects ambiguous amounts',()=>{
 for(const [input,expected] of [['19.99',1999],['0.01',1],['10.1',1010],['10000.00',1000000]])assert.equal(controls.dollarsToCents(input),expected);
 for(const input of ['','0','-1','1e3','1.999','10,50','10000.01'])assert.throws(()=>controls.dollarsToCents(input));
});
test('price editor rejects introductory and volume pricing inversions',()=>{
 const values=Object.fromEntries(Object.entries(prices).map(([key,cents])=>[key,(cents/100).toFixed(2)]));
 assert.equal(controls.parsePriceForm(values).annual,19999);
 assert.throws(()=>controls.parsePriceForm({...values,monthlyIntro:'99.00'}));assert.throws(()=>controls.parsePriceForm({...values,fleet100:'99.00'}));
});
test('price editor displays all seven price fields, version and audit reason',()=>{
 const html=renderToStaticMarkup(React.createElement(ui.PriceForm,{record:{prices,version:4,updatedAt:'2026-09-19T00:00:00Z'},onSaved(){}}));
 for(const [,label] of controls.priceFields)assert(html.includes(label));
 assert(html.includes('Version 4'));assert(html.includes('Reason for change'));assert(html.includes('Review and save prices'));
});
const row={id:'s',plan:'GOLD',provider:'APPLE',status:'GRACE_PERIOD',environment:'TEST',verifiedAt:'2026-09-19T00:00:00Z',gracePeriodEnd:'2026-09-20T00:00:00Z',currentPeriodEnd:null,user:{fullName:'Fixture',email:'fixture@example.invalid'},hold:{version:0,suspended:false},canSuspend:false,canRestore:false};
test('grace-period record cannot present enabled suspension or a mark-paid control',()=>{
 const html=renderToStaticMarkup(React.createElement(ui.SubscriptionAccessCard,{row,onChanged(){}}));
 assert(html.includes('grace period ends'));assert.match(html,/<button[^>]*disabled[^>]*>Suspend access/);assert(!html.includes('Mark paid'));assert(html.includes('Test / sandbox record'));
});
test('manual hold shows restore only with verified paid evidence and keeps independent access clear',()=>{
 const html=renderToStaticMarkup(React.createElement(ui.SubscriptionAccessCard,{row:{...row,hold:{version:1,suspended:true}},onChanged(){}}));
 assert(html.includes('Suspended by admin'));assert(html.includes('Restore requires verified active payment'));assert.match(html,/<button[^>]*disabled[^>]*>Restore access/);assert(html.includes('Other valid access sources remain independent'));
});

function interactive(states,patch,confirm=()=>true){let index=0;return compile('SubscriptionAdmin.tsx',name=>name==='react'?{...React,useState:initial=>[index<states.length?states[index++]:initial,()=>{}],useRef:()=>({current:false})}:name==='./api'?{api:{patch}}:name==='./subscriptionControls'?controls:require(name),{window:{confirm}});}
test('saving prices sends exact integer cents, reason, confirmation and current version',async()=>{
 const values=Object.fromEntries(Object.entries(prices).map(([key,value])=>[key,(value/100).toFixed(2)]));values.monthlyRegular='24.99';let sent,saved;
 const {PriceForm}=interactive([values,'Approved local review','',false],async(path,body)=>{sent={path,body};return {prices:body.prices,version:5};});
 const form=PriceForm({record:{prices,version:4,updatedAt:null},onSaved:r=>saved=r});await form.props.onSubmit({preventDefault(){}});
 assert.equal(sent.path,'/admin/subscription-controls/pricing');assert.equal(sent.body.prices.monthlyRegular,2499);assert.equal(sent.body.expectedVersion,4);assert.equal(sent.body.confirmation,'UPDATE DISPLAY PRICES');assert.equal(saved.version,5);
});
test('canceling the price confirmation performs no API write',async()=>{
 const values=Object.fromEntries(Object.entries(prices).map(([key,value])=>[key,(value/100).toFixed(2)]));let writes=0;
 const {PriceForm}=interactive([values,'Approved reason','',false],async()=>writes++,()=>false);
 await PriceForm({record:{prices,version:4},onSaved(){throw Error('Not saved');}}).props.onSubmit({preventDefault(){}});assert.equal(writes,0);
});
test('suspend submits only the reviewed access hold, blocks duplicate clicks, and refreshes after success',async()=>{
 let writes=0,resolve,changed=0,sent;const pending=new Promise(r=>resolve=r);
 const {SubscriptionAccessCard}=interactive(['Verified grace expired','','',false],async(path,body)=>{writes++;sent={path,body};return pending;});
 const form=SubscriptionAccessCard({row:{...row,status:'PAST_DUE',canSuspend:true,hold:{version:3,suspended:false}},onChanged(){changed++;}});
 const first=form.props.onSubmit({preventDefault(){}});await form.props.onSubmit({preventDefault(){}});assert.equal(writes,1);assert.equal(sent.body.expectedVersion,3);assert.equal(sent.body.suspended,true);assert.equal(sent.body.confirmation,'SUSPEND');assert(!('status' in sent.body));resolve({});await first;assert.equal(changed,1);
});
test('unverified restore does not write even if its submit handler is invoked',async()=>{
 let writes=0;const {SubscriptionAccessCard}=interactive(['Paid allegedly','','',false],async()=>writes++);
 await SubscriptionAccessCard({row:{...row,hold:{version:1,suspended:true},canRestore:false},onChanged(){}}).props.onSubmit({preventDefault(){}});assert.equal(writes,0);
});
