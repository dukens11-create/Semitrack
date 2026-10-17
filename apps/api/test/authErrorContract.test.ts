import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function harness(invalid=false,accountUnavailable=false){
 const module={exports:{}};
 const source=fs.readFileSync(new URL('../src/middleware/auth.ts',import.meta.url),'utf8');
 const mocks={prisma:{$executeRawUnsafe:async()=>{}},verifyToken:()=>{if(invalid)throw Error('private token detail');return{}},currentAccessSession:async()=>accountUnavailable?null:{id:'fixture',email:'fixture@example.test',role:'DRIVER'}};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:()=>mocks});
 let status,body,nextCalled=false;
 const response={status:n=>{status=n;return response},json:value=>{body=value;return response}};
 return {auth:module.exports,response,next:()=>{nextCalled=true},check:(expected,code)=>{assert.equal(status,expected);assert.equal(typeof body.error,'object');assert.equal(body.error.code,code);assert.equal(nextCalled,false);assert.ok(!JSON.stringify(body).includes('private token detail'))}};
}
test('missing bearer token uses the structured 401 error contract',()=>{const h=harness();h.auth.requireAuth({headers:{}},h.response,h.next);h.check(401,'UNAUTHORIZED')});
test('invalid bearer token uses the structured 401 error contract',()=>{const h=harness(true);h.auth.requireAuth({headers:{authorization:'Bearer fixture'}},h.response,h.next);h.check(401,'UNAUTHORIZED')});
test('unavailable account uses the structured 401 error contract',async()=>{const h=harness(false,true);h.auth.requireAuth({headers:{authorization:'Bearer fixture'}},h.response,h.next);await new Promise(resolve=>setImmediate(resolve));h.check(401,'UNAUTHORIZED')});
test('role middleware missing user uses the structured 401 contract',()=>{const h=harness();h.auth.requireRole(['ADMIN'])({},h.response,h.next);h.check(401,'UNAUTHORIZED')});
test('role middleware denies a driver with structured 403',()=>{const h=harness();h.auth.requireRole(['ADMIN'])({user:{role:'DRIVER'}},h.response,h.next);h.check(403,'FORBIDDEN')});