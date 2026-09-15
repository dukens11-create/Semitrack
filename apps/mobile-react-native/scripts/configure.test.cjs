const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
function generate(args, values) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'semitrax-config-test-'));
  try {
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.mkdirSync(path.join(dir, 'src/config'), {recursive:true});
    for (const file of ['scripts/configure.mts','src/config/environment.ts']) {
      fs.copyFileSync(path.join(root,file), path.join(dir,file));
    }
    const generated = path.join(dir,'src/config/generated.ts');
    fs.writeFileSync(generated,'previous configuration');
    const result = spawnSync(process.execPath, ['--experimental-strip-types','scripts/configure.mts',...args], {
      cwd:dir, encoding:'utf8', env:{...process.env, SEMITRAX_API_URL:'', MAPBOX_PUBLIC_TOKEN:'', ...values},
    });
    return {status:result.status, text:fs.readFileSync(generated,'utf8')};
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
}
test('Android generation rejects an absent API before overwriting the artifact',()=>{
  const result=generate(['--require-api-url'],{});
  assert.notEqual(result.status,0);
  assert.equal(result.text,'previous configuration');
});
test('debug generation allowlists public fields and supports runtime diagnostics',()=>{
  const result=generate(['--require-api-url','--diagnostics'],{
    SEMITRAX_API_URL:'https://api.example.test',
    DATABASE_URL:'synthetic-database-secret',JWT_SECRET:'synthetic-jwt-secret',TRIMBLE_API_KEY:'synthetic-trimble-secret',
  });
  assert.equal(result.status,0);
  assert.match(result.text,/apiUrl = "https:\/\/api.example.test"/);
  assert.match(result.text,/configurationDiagnostics = true/);
  assert.doesNotMatch(result.text,/synthetic-|DATABASE_URL|JWT_SECRET|TRIMBLE_API_KEY/);
  assert.deepEqual([...result.text.matchAll(/export const (\w+)/g)].map(m=>m[1]),['apiUrl','mapboxToken','configurationDiagnostics']);
});
test('release disables diagnostics even if requested',()=>{
  const result=generate(['--release','--diagnostics'],{SEMITRAX_API_URL:'https://api.example.test'});
  assert.equal(result.status,0);
  assert.match(result.text,/configurationDiagnostics = false/);
});
test('private Mapbox configuration cannot overwrite a safe artifact',()=>{
  const result=generate(['--require-api-url'],{SEMITRAX_API_URL:'https://api.example.test',MAPBOX_PUBLIC_TOKEN:'sk.synthetic'});
  assert.notEqual(result.status,0);
  assert.equal(result.text,'previous configuration');
});
