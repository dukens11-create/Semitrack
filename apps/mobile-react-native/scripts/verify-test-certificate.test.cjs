const {test} = require('node:test');
const assert = require('node:assert/strict');
const {verifyCertificate} = require('./verify-test-certificate.cjs');
const expected = '2a7e2c27ae807aa117d6acf849e86cabafcdd90cabeaaa338db4e26056d85ab8';
for (const label of ['V2 Signer:', 'V3 Signer:', 'Signer #1', 'Signer (minSdkVersion=24, maxSdkVersion=32) #1']) {
 test(label, () => assert.equal(verifyCertificate(label + ' certificate SHA-256 digest: ' + expected + '\r\n', expected), expected));
}
for (const report of ['', 'Source Stamp Signer certificate SHA-256 digest: ' + expected,
 'V2 Signer: certificate SHA-256 digest: ' + 'b'.repeat(64),
 'V2 Signer: certificate SHA-256 digest: ' + expected + '\nV3 Signer: certificate SHA-256 digest: ' + 'b'.repeat(64)]) {
 test('reject missing or untrusted signer: ' + report.slice(0, 30), () => assert.throws(() => verifyCertificate(report, expected)));
}
