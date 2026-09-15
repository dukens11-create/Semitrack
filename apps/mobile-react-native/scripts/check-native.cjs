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
for(const method of ['guidanceCommand','requestLocationPermission','startLocation','stopLocation']){
 assert(java.includes(method)&&kotlin.includes('override fun '+method),'Missing Kotlin method '+method);
 assert(header.includes(method)&&objc.includes(method),'Missing iOS method '+method);
}
const manifest=read('android/app/src/main/AndroidManifest.xml');
assert(manifest.includes('FOREGROUND_SERVICE_LOCATION')&&manifest.includes('foregroundServiceType="location"'),'Missing Android location FGS contract');
const gradle=read('android/app/build.gradle');
assert(gradle.includes('applicationId "com.semitrax.app"')&&gradle.includes('applicationIdSuffix ".migration.debug"'),'Android identity mismatch');
assert(gradle.includes('configureSemiTraxRelease')&&!gradle.includes('signingConfig signingConfigs.debug'),'Unsafe release configuration');
const pbx=read('ios/SemiTrax.xcodeproj/project.pbxproj');
for(const file of ['GuidanceBoundary.swift','SemiTraxLocation.swift','SemiTraxPlatform.mm']){assert(pbx.includes(file+' in Sources'),'Missing iOS source '+file);}
assert(pbx.includes('Configure SemiTraX')&&pbx.includes('com.semitrax.app.migration.debug'),'Missing iOS configuration or identity');
assert(read('ios/SemiTrax/Info.plist').includes('<string>location</string>'),'Missing iOS location capability');
// Catch drift between the profile assessment and the actual installed bridge.
const profileSource = read('src/services/copilot/CopilotTruckProfile.ts');
const truckConstant = profileSource.match(/vehicleTypeConstantName: '([A-Z_]+)'/)?.[1];
const vehicleTypeSource = read('node_modules/trimble-maps-cpik-react-native-library/android/src/main/java/com/alk/cpik/react/route/VehicleTypeModule.java');
assert(truckConstant === 'TRUCK_HEAVY_DUTY' && vehicleTypeSource.includes('VehicleType.' + truckConstant + '.ordinal()'), 'Truck constant is not exported by the installed CPIK bridge');
console.log('PASS: Android/iOS bridge code generation and source/configuration wiring. This is not native compilation or device validation.');
