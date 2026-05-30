import { deflateRawSync } from "node:zlib";
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";

const EXCLUDE_DIRS = new Set(["node_modules", "dist", ".cache", ".git", ".pnpm-store"]);
const EXCLUDE_EXT = [".tsbuildinfo"];
const roots = ["artifacts/music-studio", "artifacts/api-server", "lib", "scripts"];
const topFiles = [
  "package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", ".npmrc",
  "tsconfig.json", "tsconfig.base.json", ".gitignore", "replit.md",
];

function walk(dir, acc) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      walk(join(dir, e.name), acc);
    } else if (e.isFile()) {
      if (EXCLUDE_EXT.some((x) => e.name.endsWith(x))) continue;
      acc.push(join(dir, e.name));
    }
  }
  return acc;
}

const fileList = [];
for (const f of topFiles) {
  try { if (statSync(f).isFile()) fileList.push(f); } catch {}
}
for (const r of roots) walk(r, fileList);

// CRC32
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const chunks = [];
const central = [];
let offset = 0;

for (const path of fileList) {
  const data = readFileSync(path);
  const comp = deflateRawSync(data);
  const crc = crc32(data);
  const nameBuf = Buffer.from(path, "utf8");

  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4);          // version needed
  lfh.writeUInt16LE(0x0800, 6);      // flags: UTF-8
  lfh.writeUInt16LE(8, 8);           // method: deflate
  lfh.writeUInt16LE(0, 10);          // time
  lfh.writeUInt16LE(0, 12);          // date
  lfh.writeUInt32LE(crc, 14);
  lfh.writeUInt32LE(comp.length, 18);
  lfh.writeUInt32LE(data.length, 22);
  lfh.writeUInt16LE(nameBuf.length, 26);
  lfh.writeUInt16LE(0, 28);
  chunks.push(lfh, nameBuf, comp);

  const cdh = Buffer.alloc(46);
  cdh.writeUInt32LE(0x02014b50, 0);
  cdh.writeUInt16LE(20, 4);
  cdh.writeUInt16LE(20, 6);
  cdh.writeUInt16LE(0x0800, 8);
  cdh.writeUInt16LE(8, 10);
  cdh.writeUInt16LE(0, 12);
  cdh.writeUInt16LE(0, 14);
  cdh.writeUInt32LE(crc, 16);
  cdh.writeUInt32LE(comp.length, 20);
  cdh.writeUInt32LE(data.length, 24);
  cdh.writeUInt16LE(nameBuf.length, 28);
  cdh.writeUInt16LE(0, 30);
  cdh.writeUInt16LE(0, 32);
  cdh.writeUInt16LE(0, 34);
  cdh.writeUInt16LE(0, 36);
  cdh.writeUInt32LE(0, 38);
  cdh.writeUInt32LE(offset, 42);
  central.push(Buffer.concat([cdh, nameBuf]));

  offset += lfh.length + nameBuf.length + comp.length;
}

const cdBuf = Buffer.concat(central);
const cdOffset = offset;
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(fileList.length, 8);
eocd.writeUInt16LE(fileList.length, 10);
eocd.writeUInt32LE(cdBuf.length, 12);
eocd.writeUInt32LE(cdOffset, 16);
eocd.writeUInt16LE(0, 20);

const out = Buffer.concat([...chunks, cdBuf, eocd]);
writeFileSync("exports/music-studio-source.zip", out);
console.log("files:", fileList.length);
console.log("size:", Math.round(out.length / 1024), "KB");
