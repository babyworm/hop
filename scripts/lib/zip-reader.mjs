import { inflateRawSync } from 'node:zlib';

const endOfCentralDirectorySignature = 0x06054b50;
const centralDirectorySignature = 0x02014b50;
const localFileSignature = 0x04034b50;

export function readZipEntries(archive) {
  const eocdOffset = findEndOfCentralDirectory(archive);
  const diskNumber = archive.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = archive.readUInt16LE(eocdOffset + 6);
  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0) {
    throw new Error('multi-disk ZIP archives are not supported');
  }
  if (entryCount === 0xffff || centralDirectoryOffset === 0xffffffff) {
    throw new Error('ZIP64 archives are not supported');
  }

  const entries = new Map();
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(offset) !== centralDirectorySignature) {
      throw new Error(`invalid ZIP central directory entry at byte ${offset}`);
    }

    const flags = archive.readUInt16LE(offset + 8);
    const compressionMethod = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const nameEncoding = (flags & 0x0800) !== 0 ? 'utf8' : 'latin1';
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString(nameEncoding);

    if (!name.endsWith('/')) {
      entries.set(name, extractEntry(
        archive,
        localHeaderOffset,
        compressedSize,
        uncompressedSize,
        compressionMethod,
      ));
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
function extractEntry(archive, offset, compressedSize, uncompressedSize, compressionMethod) {
  if (archive.readUInt32LE(offset) !== localFileSignature) {
    throw new Error(`invalid ZIP local header at byte ${offset}`);
  }
  const nameLength = archive.readUInt16LE(offset + 26);
  const extraLength = archive.readUInt16LE(offset + 28);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
  let content;
  if (compressionMethod === 0) content = Buffer.from(compressed);
  else if (compressionMethod === 8) content = inflateRawSync(compressed);
  else throw new Error(`unsupported ZIP compression method: ${compressionMethod}`);

  if (content.length !== uncompressedSize) {
    throw new Error(`ZIP entry size mismatch: expected ${uncompressedSize}, got ${content.length}`);
  }
  return content;
}

function findEndOfCentralDirectory(archive) {
  const minimumOffset = Math.max(0, archive.length - 22 - 0xffff);
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === endOfCentralDirectorySignature) return offset;
  }
  throw new Error('ZIP end-of-central-directory record not found');
}
