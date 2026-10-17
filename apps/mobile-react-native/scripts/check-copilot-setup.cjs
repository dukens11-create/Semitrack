// Read-only preflight. Package presence/alignment never means usable guidance.
const fs = require('node:fs');
const path = require('node:path');
const {inspectDirectory} = require('./check-android-page-size.cjs');
const root = path.resolve(__dirname, '..');
const vendor = path.join(root, 'node_modules/trimble-maps-cpik-react-native-library');
const exists = relative => fs.existsSync(path.join(vendor, relative));
const blockers = [];
const report = {guidanceOperational: false, android: {}, ios: {}};
if (!exists('package.json')) {
  blockers.push('Official Android package missing: run npm ci.');
} else {
  const pkg = JSON.parse(fs.readFileSync(path.join(vendor, 'package.json'), 'utf8'));
  const app = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const gradle = fs.readFileSync(path.join(vendor, 'android/build.gradle'), 'utf8');
  const source = fs.readFileSync(path.join(vendor,
    'android/src/main/java/com/alk/cpik/react/CopilotStartupModule.java'), 'utf8');
  const rn = gradle.match(/react-android:([^"']+)/)?.[1];
  const libraries = inspectDirectory(path.join(vendor, 'android/src/jniLibs'));
  report.android = {
    packageVersion: pkg.version,
    appReactNative: app.dependencies['react-native'], vendorReactNative: rn,
    binaries: libraries,
    elfAlignmentPasses: libraries.length > 0 && libraries.every(lib => lib.passes16KB),
    startupUsesNullNotificationIcon: /\.setSmallIcon\(null\)/.test(source),
  };
  if (pkg.version !== '10.28.2-497') {
    blockers.push('Package version changed; repeat the API, native and 16 KB audit.');
  }
  if (!report.android.elfAlignmentPasses) { blockers.push('Android ELF alignment failed.'); }
  if (rn !== app.dependencies['react-native']) {
    blockers.push('App/vendor React Native versions differ; native compatibility is unverified.');
  }
  if (report.android.startupUsesNullNotificationIcon) {
    blockers.push('Vendor startup passes a null small icon to the foreground notification; correct and device-test before binding.');
  }
}

// Point to the delivered Resource/ios directory. Never read license contents.
// This inventories assets only; it cannot establish framework ABI or entitlement.
const iosRoot = process.env.SEMITRAX_COPILOT_IOS_SDK_DIR;
if (iosRoot) {
  const frameworks = ['CoPilotIntegrationKit', 'CPIKReactNative'].map(name => ({
    name, present: fs.existsSync(path.join(iosRoot, 'framework', name + '.framework', name)),
  }));
  const resourceDir = path.join(iosRoot, 'resources');
  const bundles = fs.existsSync(resourceDir)
    ? fs.readdirSync(resourceDir, {withFileTypes: true})
      .filter(entry => entry.isDirectory() && entry.name.endsWith('.bundle')).map(entry => entry.name)
    : [];
  report.ios = {frameworks, resourceBundles: bundles, linked: false};
  if (frameworks.some(framework => !framework.present) || !bundles.length) {
    blockers.push('Incomplete iOS delivery: both framework executables and resource bundles are required.');
  }
} else {
  report.ios = {deliveryProvided: false, linked: false};
  blockers.push('iOS framework/resource delivery not supplied (SEMITRAX_COPILOT_IOS_SDK_DIR).');
}
blockers.push(
  'No verified truck/region/navigation license, AMS provisioning or map installation is connected.',
  'Android native compilation, module startup and release shrinking have not been verified.',
  'iOS linking and native device compatibility have not been verified on macOS/Xcode.',
  'Truck restriction parity, including axle/trailer data and road avoidance, is unresolved.',
  'Final Android APK/AAB dependency coverage, ZIP alignment and 16 KB device behavior are unverified.',
  'No real CoPilot route calculation or turn-by-turn start has been demonstrated.',
);
console.log(JSON.stringify({...report, blockers}, null, 2));
process.exitCode = 1;
