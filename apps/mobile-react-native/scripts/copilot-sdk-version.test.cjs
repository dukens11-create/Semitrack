const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('prepared SDK, configuration and native verifier pin the same version', () => {
  const lock = JSON.parse(read('package-lock.json'));
  const packageVersion = lock.packages['vendor/copilot'].version;
  const runtimeVersion = packageVersion.replace('-', '.');
  const prep = read('scripts/prepare-copilot-v11.py');
  assert.ok(prep.includes(`pkg['version'] != '${packageVersion}'`));
  assert.ok(read('src/services/copilot/CopilotConfiguration.ts').includes(`sdkVersion: z.literal('${runtimeVersion}')`));
  assert.equal(JSON.parse(read('copilot.configuration.example.json')).sdkVersion, runtimeVersion);
  const native = read('android/app/src/main/java/com/semitrax/nativebridge/CoPilotHostModule.java');
  assert.ok(native.includes(`!"${runtimeVersion}".equals(CopilotMgr.getVersionInfo().getAppVersion())`), 'runtime verifier must check the bundled SDK version');
  assert.ok(native.includes(`result.putString("sdkVersion", "${runtimeVersion}")`), 'cold-start provisioning must describe the bundled SDK');
});
