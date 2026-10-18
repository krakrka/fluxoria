import { inflateRawSync } from "zlib";

const LOCAL = 0x04034b50;
const MAX_FILES = 40;
const MAX_UNCOMPRESSED = 30 * 1024 * 1024;

export type ZipEntry = { name: string; bytes: Buffer };

export function unzip(buffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  let total = 0;
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== LOCAL) break;
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    if (dataStart + compressedSize > buffer.length) throw new Error("Archive ZIP incomplète.");
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    offset = dataStart + compressedSize;
    if (name.endsWith("/") || name.includes("__MACOSX") || name.startsWith(".")) continue;
    if (flags & 0x1) throw new Error("Les ZIP chiffrés sont refusés.");
    if (flags & 0x8 && compressedSize === 0) throw new Error("Cette archive ZIP n'indique pas la taille des fichiers.");
    const bytes = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null;
    if (!bytes) throw new Error(`Méthode ZIP ${method} non prise en charge.`);
    if (uncompressedSize > 0 && bytes.length !== uncompressedSize) throw new Error(`Taille inattendue pour ${safeName(name)}.`);
    total += bytes.length;
    if (total > MAX_UNCOMPRESSED) throw new Error("L'archive dépasse 30 MB décompressés.");
    entries.push({ name: safeName(name), bytes });
    if (entries.length > MAX_FILES) throw new Error("40 fichiers maximum par archive.");
  }
  return entries;
}

export function zipStored(files: Array<{ name: string; bytes: Buffer }>) {
  const parts: Buffer[] = [];
  let offset = 0;
  const central: Buffer[] = [];
  for (const file of files) {
    const name = Buffer.from(safeName(file.name));
    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 8);
    header.writeUInt32LE(file.bytes.length, 18);
    header.writeUInt32LE(file.bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    const local = Buffer.concat([header, name, file.bytes]);
    parts.push(local);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(file.bytes.length, 20);
    centralHeader.writeUInt32LE(file.bytes.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([centralHeader, name]));
    offset += local.length;
  }
  const centralDirectory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralDirectory, end]);
}

function safeName(name: string) {
  const base = name.split(/[/\\]/).pop() ?? "fichier";
  return base.replace(/[^\w.\- ()àâäéèêëïîôùûüçÀÂÄÉÈÊËÏÎÔÙÛÜÇ]/g, "_").slice(0, 140);
}
