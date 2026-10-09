const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'semitrax-copilot-native-'));
const sdk = path.join(root, 'node_modules/trimble-maps-cpik-react-native-library/android/libs/cpik.jar');
function run(args) {
  const result = spawnSync('java', args, {stdio:'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Native credential regression check failed');
}
try {
  run(['-m','jdk.compiler/com.sun.tools.javac.Main','-cp',sdk,'-d',output,
    path.join(root,'android/app/src/main/java/com/semitrax/nativebridge/CoPilotCredentialPolicy.java'),
    path.join(root,'android/app/src/main/java/com/semitrax/nativebridge/CoPilotEnrollmentPolicy.java'),
    path.join(root,'scripts/native-tests/CoPilotCredentialPolicyTest.java')]);
  run(['-cp', output + path.delimiter + sdk, 'com.semitrax.nativebridge.CoPilotCredentialPolicyTest']);
} finally { fs.rmSync(output, {recursive:true,force:true}); }
