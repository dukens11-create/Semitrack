// Checks real ELF files, including prebuilts. This does not certify APK ZIP
// alignment, complete dependency coverage, or operation on a 16 KB device.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function inspectElf(buffer) {
  if (buffer.length < 52 || buffer.subarray(0, 4).toString('hex') !== '7f454c46') {
    throw new Error('Not an ELF binary');
  }
  const bits = buffer[4];
  const endian = buffer[5];
  if (![1, 2].includes(bits) || ![1, 2].includes(endian)) {
    throw new Error('Unsupported ELF class or byte order');
  }
  const suffix = endian === 1 ? 'LE' : 'BE';
  const uint = (offset, width) => width === 8
    ? buffer['readBigUInt64' + suffix](offset)
    : BigInt(buffer['readUInt' + suffix](offset, width));
  const wide = bits === 2;
  const table = uint(wide ? 32 : 28, wide ? 8 : 4);
  const stride = uint(wide ? 54 : 42, 2);
  const count = uint(wide ? 56 : 44, 2);
  if (count === 0n || count === 65535n || stride < (wide ? 56n : 32n) ||
      table + stride * count > BigInt(buffer.length)) {
    throw new Error('Invalid or unsupported ELF program header table');
  }
  const segments = [];
  const headers = [];
  for (let i = 0n; i < count; i++) {
    const at = Number(table + i * stride);
    const type = uint(at, 4);
    if (type !== 1n && type !== 0x6474e552n) { continue; }
    const offset = uint(at + (wide ? 8 : 4), wide ? 8 : 4);
    const address = uint(at + (wide ? 16 : 8), wide ? 8 : 4);
    const alignment = uint(at + (wide ? 48 : 28), wide ? 8 : 4);
    const fileSize = uint(at + (wide ? 32 : 16), wide ? 8 : 4);
    const memorySize = uint(at + (wide ? 40 : 20), wide ? 8 : 4);
    const flags = uint(at + (wide ? 4 : 24), 4);
    headers.push({type, address, memorySize, flags});
    if (type !== 1n) { continue; }
    const valid = alignment >= 16384n && (alignment & (alignment - 1n)) === 0n &&
      offset % alignment === address % alignment &&
      offset + fileSize <= BigInt(buffer.length) && memorySize >= fileSize;
    segments.push({offset: offset.toString(), virtualAddress: address.toString(),
      alignment: alignment.toString(), passes16KB: valid});
  }
  if (!segments.length) { throw new Error('ELF contains no PT_LOAD segments'); }
  // Android rounds both ends of GNU_RELRO to pages. Check actual writable
  // LOAD bytes outside the nominal RELRO, not just its end modulo page size.
  // Keep the documented arithmetic check separate; this is NOT runtime proof.
  const page = 16384n;
  const loads = headers.filter(h => h.type === 1n);
  const relro = headers.filter(h => h.type === 0x6474e552n).map(h => {
    const end = h.address + h.memorySize;
    const startPage = h.address / page * page;
    const endPage = (end + page - 1n) / page * page;
    const overlap = (a, b, c, d) => a < b && c < d && a < d && c < b;
    const conflicts = loads.filter(l => (l.flags & 2n) !== 0n &&
      (overlap(startPage, h.address, l.address, l.address + l.memorySize) ||
       overlap(end, endPage, l.address, l.address + l.memorySize)));
    // RELRO can include trailing linker padding beyond the LOAD's memsz.
    const hasContainingLoad = loads.some(l => h.address >= l.address &&
      h.address < l.address + l.memorySize);
    return {virtualAddress: h.address.toString(), memorySize: h.memorySize.toString(),
      roundedStart: startPage.toString(), roundedEnd: endPage.toString(),
      endAligned16KB: end % page === 0n,
      writableOverlap: conflicts.map(l => ({virtualAddress: l.address.toString(), memorySize: l.memorySize.toString()})),
      layoutPass: h.memorySize > 0n && hasContainingLoad && conflicts.length === 0};
  });
  return {bits: wide ? 64 : 32, byteOrder: suffix,
    relro, relroPresent: relro.length > 0,
    relroEndAlignmentPass: relro.length ? relro.every(r => r.endAligned16KB) : null,
    relroLayoutPass: relro.length ? relro.every(r => r.layoutPass) : null,
    passes16KB: segments.every(segment => segment.passes16KB), segments};
}

function inspectDirectory(directory) {
  const files = [];
  function visit(folder) {
    for (const entry of fs.readdirSync(folder, {withFileTypes: true})) {
      const file = path.join(folder, entry.name);
      // Do not follow symlinks outside the requested dependency tree.
      if (entry.isDirectory()) { visit(file); }
      else if (entry.isFile() && entry.name.endsWith('.so')) { files.push(file); }
    }
  }
  visit(directory);
  return files.sort().map(file => {
    const data = fs.readFileSync(file);
    const identity = {file: path.relative(directory, file).replaceAll('\\', '/'),
      sha256: crypto.createHash('sha256').update(data).digest('hex')};
    try { return {...identity, ...inspectElf(data)}; }
    catch (error) { return {...identity, passes16KB: false, error: error.message}; }
  });
}

if (require.main === module) {
  const directory = process.argv[2];
  if (!directory) {
    console.error('Usage: node scripts/check-android-page-size.cjs <directory of extracted .so files>');
    process.exitCode = 1;
  } else {
    try {
      const binaries = inspectDirectory(path.resolve(directory));
      const passes = binaries.length > 0 && binaries.every(binary => binary.passes16KB);
      console.log(JSON.stringify({scope: path.resolve(directory),
        elfAlignmentPasses: passes, binaryCount: binaries.length,
        relroEndAlignmentPasses: binaries.length > 0 && binaries.every(b => b.relroEndAlignmentPass === true),
        relroLayoutPasses: binaries.length > 0 && binaries.every(b => b.relroLayoutPass === true),
        application16KBCompliance: 'UNVERIFIED: requires final APK/AAB coverage, ZIP alignment and 16 KB device tests',
        binaries}, null, 2));
      process.exitCode = passes ? 0 : 1;
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
module.exports = {inspectElf, inspectDirectory};
