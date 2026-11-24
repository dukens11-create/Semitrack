const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript');
const test=require('node:test'),assert=require('node:assert/strict');
function config(value,command='build'){
 const source=fs.readFileSync(path.join(__dirname,'../vite.config.ts'),'utf8');const exports={};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,URL,process:{env:{},cwd:()=>'.'},require:n=>n==='vite'?{defineConfig:x=>x,loadEnv:()=>({VITE_API_URL:value})}:{default:()=>({}),__esModule:true}});
 return exports.default({command,mode:'production'});
}
test('production admin build fails closed on absent, development, obsolete or deceptive API URLs',()=>{
 for(const value of [undefined,'','http://localhost:4000','https://api.semitrax.com','https://www.semitrax.com','https://semitrax-api.onrender.com.attacker.test','https://user:password@semitrax-api.onrender.com','https://semitrax-api.onrender.com/?token=x'])assert.throws(()=>config(value));
});
test('approved production API builds and development retains its explicit local workflow',()=>{
 assert.ok(config('https://semitrax-api.onrender.com'));assert.ok(config(undefined,'serve'));
});
