'use strict';
/* Minimal dependency-free PNG writer for QA heatmaps (Node zlib only). */
const fs = require('node:fs');
const zlib = require('node:zlib');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, data.length + 8)), data.length + 8);
  return out;
}

/** pixels: Uint8Array of RGB triples, row-major, width*height*3 bytes. */
function encodePng(width, height, pixels) {
  if (!(width > 0) || !(height > 0) || pixels.length !== width * height * 3)
    throw new Error(`bad PNG pixels: ${width}x${height}, ${pixels.length} bytes`);
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 3, width * 3)
      .copy(raw, y * (width * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit truecolour
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function writePng(file, width, height, pixels) {
  fs.writeFileSync(file, encodePng(width, height, pixels));
}

/** 0 = deep blue, 0.5 = teal/green, 1 = red. NaN/empty -> dark grey. */
function heatColor(value) {
  if (!Number.isFinite(value)) return [24, 24, 28];
  const v = Math.max(0, Math.min(1, value));
  const stops = [[16, 32, 96], [24, 128, 160], [64, 192, 96], [240, 208, 64], [224, 48, 32]];
  const x = v * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  return stops[i].map((c, k) => Math.round(c + (stops[i + 1][k] - c) * f));
}

module.exports = { crc32, encodePng, writePng, heatColor };
