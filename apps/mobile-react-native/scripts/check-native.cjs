const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');
const root = path.resolve(__dirname, '..');
process.chdir(root);
const output = 'build/native-check';
fs.mkdirSync(output, {recursive:true});
function run(args) {const result = spawnSync(process.execPath,args,{stdio:'inherit'});if(result.status!==0){process.exit(result.status || 1);}}
run(['node_modules/@react-native/codegen/lib/cli/combine/combine-js-to-schema-cli.js',output+'/schema.json','src/native/navigation/NativeSemiTraxPlatform.ts']);
for(const platform of ['android','ios']) {
 run(['node_modules/react-native/scripts/generate-specs-cli.js','--platform',platform,'--schemaPath',output+'/schema.json','--outputDir',output+'/'+platform,'--libraryName','SemiTraxPlatformSpec','--javaPackageName','com.semitrax.nativebridge','--libraryType','modules']);
}
const read = p => fs.readFileSync(p,'utf8');
function assert(value,message){if(!value){throw new Error(message);}}
const java=read(output+'/android/java/com/semitrax/nativebridge/NativeSemiTraxPlatformSpec.java');
const kotlin=read('android/app/src/main/java/com/semitrax/nativebridge/SemiTraxPlatformModule.kt');
const header=read(output+'/ios/SemiTraxPlatformSpec/SemiTraxPlatformSpec.h');
const objc=read('ios/SemiTrax/SemiTraxPlatform.mm');
for(const method of ['createOperationId','locationPermissionStatus','guidanceCommand','requestLocationPermission','startLocation','stopLocation']){
 assert(java.includes(method)&&kotlin.includes('override fun '+method),'Missing Kotlin method '+method);
 assert(header.includes(method)&&objc.includes(method),'Missing iOS method '+method);
}
const manifest=read('android/app/src/main/AndroidManifest.xml');
assert(manifest.includes('FOREGROUND_SERVICE_LOCATION')&&manifest.includes('foregroundServiceType="location"'),'Missing Android location FGS contract');
const gradle=read('android/app/build.gradle');
assert(gradle.includes('applicationId "com.semitrax.app"')&&gradle.includes('applicationIdSuffix ".migration.debug"'),'Android identity mismatch');
assert(gradle.includes('configureSemiTraxRelease')&&!gradle.includes('signingConfig signingConfigs.debug'),'Unsafe release configuration');
const pbx=read('ios/SemiTrax.xcodeproj/project.pbxproj');
// Parse the OpenStep dictionary, ignoring comments rather than treating them as references.
// Unsupported syntax and duplicate dictionary keys fail closed.
function parsePbx(text) {
 const lexer = /\s+|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|[{}()=;,]|[A-Za-z0-9_./$<>+\-]+/gy;
 const tokens = [];
 let offset = 0;
 while (offset < text.length) {
  lexer.lastIndex = offset;
  const match = lexer.exec(text);
  assert(match, 'Malformed PBX syntax at offset '+offset);
  offset = lexer.lastIndex;
  const token = match[0];
  if (!/^\s|^\/\/|^\/\*/.test(token)) tokens.push(token);
 }
 let index = 0;
 const consume = token => {assert(tokens[index++] === token, 'Malformed PBX: expected '+token);};
 function scalar() {
  const token = tokens[index++];
  assert(token !== undefined && !/^[{}()=;,]$/.test(token), 'Malformed PBX scalar');
  return token.startsWith('"') ? token.slice(1, -1).replace(/\\([\s\S])/g, (_, char) => ({n:'\n', r:'\r', t:'\t'}[char] ?? char)) : token;
 }
 function value() {
  if (tokens[index] === '{') {
   consume('{');
   const object = Object.create(null);
   while (tokens[index] !== '}') {
    const key = scalar();
    assert(!Object.hasOwn(object, key), 'Duplicate PBX key: '+key);
    consume('='); object[key] = value(); consume(';');
   }
   consume('}'); return object;
  }
  if (tokens[index] === '(') {
   consume('(');
   const array = [];
   while (tokens[index] !== ')') {
    array.push(value());
    if (tokens[index] !== ')') consume(',');
   }
   consume(')'); return array;
  }
  return scalar();
 }
 const result = value();
 assert(index === tokens.length, 'Malformed PBX trailing input');
 return result;
}
const project = parsePbx(pbx);
const objects = project.objects;
function pbxObject(id, isa) {
 assert(typeof id === 'string' && /^[A-Fa-f0-9]{24}$/.test(id) && objects?.[id] && (!isa || objects[id].isa === isa), 'Malformed PBX object reference: '+id);
 return objects[id];
}
function references(value) {
 assert(Array.isArray(value) && value.every(id => typeof id === 'string') && new Set(value).size === value.length, 'Malformed or duplicate PBX references');
 return value;
}
const appTargets = references(pbxObject(project.rootObject, 'PBXProject').targets)
 .map(id => pbxObject(id, 'PBXNativeTarget'))
 .filter(target => target.name === 'SemiTrax' && target.productType === 'com.apple.product-type.application');
assert(appTargets.length === 1, 'Missing or ambiguous SemiTrax application target');
const resourcePhases = references(appTargets[0].buildPhases).map(id => pbxObject(id))
 .filter(phase => phase.isa === 'PBXResourcesBuildPhase');
assert(resourcePhases.length === 1, 'Missing or ambiguous application resources phase');
const privacyRefs = Object.entries(objects).filter(([, object]) => object.isa === 'PBXFileReference' &&
 (object.name === 'PrivacyInfo.xcprivacy' || object.path?.endsWith('PrivacyInfo.xcprivacy')));
assert(privacyRefs.length === 1 && privacyRefs[0][1].path === 'SemiTrax/PrivacyInfo.xcprivacy' && privacyRefs[0][1].sourceTree === '<group>', 'Missing or malformed privacy file reference');
const privacyBuildFiles = Object.entries(objects).filter(([, object]) => object.isa === 'PBXBuildFile' && object.fileRef === privacyRefs[0][0]);
assert(privacyBuildFiles.length === 1, 'Missing or duplicate privacy build-file reference');
const resourceFiles = references(resourcePhases[0].files);
for (const id of resourceFiles) pbxObject(pbxObject(id, 'PBXBuildFile').fileRef, 'PBXFileReference');
assert(resourceFiles.includes(privacyBuildFiles[0][0]), 'Privacy manifest missing from application resources');
assert(read('ios/'+privacyRefs[0][1].path).length > 0, 'Privacy manifest file is empty');
for(const file of ['GuidanceBoundary.swift','SemiTraxLocation.swift','SemiTraxPlatform.mm']){assert(pbx.includes(file+' in Sources'),'Missing iOS source '+file);}
assert(pbx.includes('Configure SemiTraX')&&pbx.includes('com.semitrax.app.migration.debug'),'Missing iOS configuration or identity');
assert(read('ios/SemiTrax/Info.plist').includes('<string>location</string>'),'Missing iOS location capability');
const appDelegate=read('ios/SemiTrax/AppDelegate.swift');
assert(
 appDelegate.includes('RCTLinkingManager.application(app, open: url, options: options)') &&
 appDelegate.includes('continue userActivity: NSUserActivity') &&
 appDelegate.includes('RCTLinkingManager.application('),
 'Missing iOS React Native recovery-link forwarding'
);
// Catch drift between the profile assessment and the actual installed bridge.
const profileSource = read('src/services/copilot/CopilotTruckProfile.ts');
const truckConstant = profileSource.match(/vehicleTypeConstantName: '([A-Z_]+)'/)?.[1];
const vehicleTypeSource = read('node_modules/trimble-maps-cpik-react-native-library/android/src/main/java/com/alk/cpik/react/route/VehicleTypeModule.java');
assert(truckConstant === 'TRUCK_HEAVY_DUTY' && vehicleTypeSource.includes('VehicleType.' + truckConstant + '.ordinal()'), 'Truck constant is not exported by the installed CPIK bridge');
console.log('PASS: Android/iOS bridge code generation and source/configuration wiring. This is not native compilation or device validation.');
