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


// ELF64 fixtures describe memory independently from file bytes (zero-filled LOAD).
function relroElf(loads, relro) {
  const b = Buffer.alloc(1024);
  elf(true, 16384).copy(b);
  const headers = [...loads.map(l => ({type:1, ...l})), ...relro.map(l => ({type:0x6474e552, ...l}))];
  b.writeUInt16LE(headers.length, 56);
  headers.forEach((h, i) => {
    const at = 64 + i * 56;
    b.writeUInt32LE(h.type, at); b.writeUInt32LE(h.flags ?? 6, at + 4);
    b.writeBigUInt64LE(BigInt(h.start % 16384), at + 8);
    b.writeBigUInt64LE(BigInt(h.start), at + 16);
    b.writeBigUInt64LE(0n, at + 32);
    b.writeBigUInt64LE(BigInt(h.size), at + 40);
    b.writeBigUInt64LE(16384n, at + 48);
  });
  return b;
}
test('RELRO unaligned end with only padding is separate from LOAD alignment', () => {
  const r = inspectElf(relroElf([{start:0x4000,size:0x1000},{start:0x8000,size:0x1000}], [{start:0x4000,size:0x1000}]));
  assert.equal(r.passes16KB,true);
  assert.equal(r.relroEndAlignmentPass,false);
  assert.equal(r.relroLayoutPass,true);
});
test('RELRO rejects writable suffix within same LOAD and a following LOAD', () => {
  for(const loads of [
    [{start:0x4000,size:0x4000}],
    [{start:0x4000,size:0x1000},{start:0x5100,size:0x100}],
  ]) assert.equal(inspectElf(relroElf(loads,[{start:0x4000,size:0x1000}])).relroLayoutPass,false);
});
test('aligned RELRO end alone cannot hide a writable prefix', () => {
  const r=inspectElf(relroElf([{start:0x4000,size:0x8000}],[{start:0x4100,size:0x3f00}]));
  assert.equal(r.relroEndAlignmentPass,true);
  assert.equal(r.relroLayoutPass,false);
});
test('RELRO aligned end allows writable data starting exactly at that boundary', () => {
  const r=inspectElf(relroElf([{start:0x4000,size:0x8000}],[{start:0x4000,size:0x4000}]));
  assert.equal(r.relroLayoutPass,true);
});
test('read-only padding, multiple RELRO and absent RELRO retain independent results', () => {
  const r=inspectElf(relroElf([{start:0x4000,size:0x1000},{start:0x5000,size:0x3000,flags:4},{start:0xc000,size:0x4000}],[{start:0x4000,size:0x1000},{start:0xc000,size:0x4000}]));
  assert.equal(r.relroLayoutPass,true);
  const absent=inspectElf(elf(true,16384));
  assert.equal(absent.relroPresent,false);
  assert.equal(absent.relroLayoutPass,null);
});
test('zero-sized or unmapped RELRO is not accepted', () => {
  for(const r of [{start:0x4000,size:0},{start:0x8000,size:0x1000}])
    assert.equal(inspectElf(relroElf([{start:0x4000,size:0x1000}],[r])).relroLayoutPass,false);
});
