const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'build/copilot-policy-test');
fs.mkdirSync(output, {recursive: true});
function run(exe, args) {
  const binary = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', exe + (process.platform === 'win32' ? '.exe' : '')) : exe;
  const r = spawnSync(binary, args, {stdio: 'inherit', windowsHide: true});
  if (r.status !== 0) process.exit(r.status || 1);
}
run('javac', ['-d', output, path.join(root, 'android/app/src/main/java/com/semitrax/nativebridge/MapDownloadPolicy.java'), path.join(__dirname, 'MapDownloadPolicyTest.java')]);
run('java', ['-cp', output, 'com.semitrax.nativebridge.MapDownloadPolicyTest']);
