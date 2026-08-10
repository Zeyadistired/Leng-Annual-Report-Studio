const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function findEOCD(buf) {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error('Not a zip archive (no end-of-central-directory record)');
}

function safeJoin(dest, entryName) {
  const clean = String(entryName || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = clean.split('/').filter(p => p && p !== '.' && p !== '..');
  return path.join(dest, ...parts);
}

function extract(zipPath, destDir) {
  const buf = fs.readFileSync(zipPath);
  const eocd = findEOCD(buf);
  const entryCount = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const written = [];
  let off = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const flags = buf.readUInt16LE(off + 8);
    const localOff = buf.readUInt32LE(off + 42);
    const nameBuf = buf.subarray(off + 46, off + 46 + nameLen);
    const name = (flags & 0x800) ? nameBuf.toString('utf8') : nameBuf.toString('latin1');
    off += 46 + nameLen + extraLen + commentLen;
    if (!name) continue;
    if (/\/$/.test(name)) continue;
    const local = localOff;
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const dataStart = local + 30 + lNameLen + lExtraLen;
    const compressed = buf.subarray(dataStart, dataStart + compSize);
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = zlib.inflateRawSync(compressed);
    else throw new Error('Unsupported zip method ' + method + ' for ' + name);
    const outPath = safeJoin(destDir, name);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, data);
    written.push(outPath);
  }
  return written;
}

function findFile(dir, targetName) {
  const target = String(targetName).toLowerCase();
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch (e) { continue; }
    for (const en of entries) {
      const full = path.join(cur, en.name);
      if (en.isDirectory()) stack.push(full);
      else if (en.name.toLowerCase() === target) return full;
    }
  }
  return null;
}

module.exports = { extract, findFile };
