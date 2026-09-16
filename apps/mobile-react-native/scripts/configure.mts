import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createEnvironment} from '../src/config/environment.ts';
const release=process.argv.includes('--release');
const requireApiUrl=process.argv.includes('--require-api-url');
const configurationDiagnostics=!release && process.argv.includes('--diagnostics');
const apiUrl=process.env.SEMITRAX_API_URL ?? '';
// Prefer the React Native name, but preserve the existing SemiTraX/Flutter
// public-token name during migration so a valid configured map is not dropped.
const mapboxToken=process.env.MAPBOX_PUBLIC_TOKEN ?? process.env.MAPBOX_ACCESS_TOKEN ?? '';
if(requireApiUrl && !apiUrl){throw new Error('SEMITRAX_API_URL is required before Android bundling.');}
if(release && !mapboxToken){throw new Error('MAPBOX_PUBLIC_TOKEN (or legacy MAPBOX_ACCESS_TOKEN) is required for release so SemiTraX cannot ship with the driver map unavailable.');}
if(release || apiUrl){createEnvironment(apiUrl,mapboxToken,release);}
else if(mapboxToken && !mapboxToken.startsWith('pk.')){throw new Error('Only public Mapbox tokens may be bundled.');}
writeFileSync(fileURLToPath(new URL('../src/config/generated.ts',import.meta.url)),
 '// Generated public build configuration. Never include private credentials.\nexport const apiUrl = '+JSON.stringify(apiUrl)+';\nexport const mapboxToken = '+JSON.stringify(mapboxToken)+';\nexport const configurationDiagnostics = '+JSON.stringify(configurationDiagnostics)+';\n');
