const {test} = require('node:test');
const assert = require('node:assert/strict');
const {inspectElf} = require('./check-android-page-size.cjs');

function elf(wide, alignment, little = true) {
  const b = Buffer.alloc(256);
  b.write('7f454c46', 0, 'hex'); b[4] = wide ? 2 : 1; b[5] = little ? 1 : 2;
  const end = little ? 'LE' : 'BE';
  const write = (value, offset, width) => width === 8
    ? b['writeBigUInt64' + end](BigInt(value), offset)
    : b['writeUInt' + end](value, offset, width);
  write(64, wide ? 32 : 28, wide ? 8 : 4);
  write(wide ? 56 : 32, wide ? 54 : 42, 2);
  write(1, wide ? 56 : 44, 2);
  write(1, 64, 4);
  write(alignment, 64 + (wide ? 48 : 28), wide ? 8 : 4);
  return b;
}
test('accepts 16 KB or larger ELF32/ELF64 segments in both byte orders', () => {
  for (const wide of [true, false]) {
    for (const little of [true, false]) {
      for (const alignment of [16384, 65536]) {
        assert.equal(inspectElf(elf(wide, alignment, little)).passes16KB, true);
      }
    }
  }
});
test('rejects 4 KB, invalid alignments and incongruent load addresses', () => {
  for (const alignment of [0, 4096, 16385]) {
    assert.equal(inspectElf(elf(true, alignment)).passes16KB, false);
  }
  const data = elf(true, 16384); data.writeBigUInt64LE(1n, 80);
  assert.equal(inspectElf(data).passes16KB, false);
});
test('does not accept malformed, truncated, empty or non-load ELF headers', () => {
  assert.throws(() => inspectElf(Buffer.alloc(100)));
  assert.throws(() => inspectElf(elf(true, 16384).subarray(0, 100)));
  const data = elf(false, 16384); data.writeUInt16LE(0, 44);
  assert.throws(() => inspectElf(data));
  data.writeUInt16LE(1, 44); data.writeUInt32LE(2, 64);
  assert.throws(() => inspectElf(data));
});
