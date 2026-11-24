// The official CPIK package has Android sources but no JS entry point, podspec
// or conventional ReactPackage name. Use NativeModules after native startup;
// never import its missing index.js. No service is started by this config.
const path = require('node:path');
module.exports = {
  dependencies: {
    'trimble-maps-cpik-react-native-library': {
      platforms: {
        android: {
          sourceDir: path.join(__dirname, 'node_modules/trimble-maps-cpik-react-native-library/android'),
          packageImportPath: 'import com.alk.cpik.react.CPIKPackagesHolder;',
          packageInstance: 'new CPIKPackagesHolder()',
        },
        // iOS requires separately delivered Trimble frameworks and resources.
        ios: null,
      },
    },
  },
};
