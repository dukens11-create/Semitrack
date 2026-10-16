const fs = require('node:fs');
function verifyCertificate(report, expected) {
  const fingerprints = [...report.matchAll(/^\s*Signer[^\r\n]*? certificate SHA-256 digest:\s*([0-9a-fA-F]{64})\s*$/gm)].map(match => match[1].toLowerCase());
  if (!fingerprints.length) throw new Error('No signer certificate SHA-256 fingerprint found in apksigner output');
  if (!/^[0-9a-f]{64}$/.test(expected || '')) throw new Error('Missing or invalid expected certificate');
  if (fingerprints.some(value => value !== expected)) throw new Error('APK signer certificate differs from the saved test key');
  return expected;
}
module.exports = {verifyCertificate};
if (require.main === module) {
  const report = fs.readFileSync(process.argv[2], 'utf8');
  try {
    console.log('Verified APK certificate: ' + verifyCertificate(report, process.env.SEMITRAX_VERIFIED_CERT_SHA256));
  } catch (error) {
    console.error(report);
    console.error(error.message);
    process.exitCode = 1;
  }
}
