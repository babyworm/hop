import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLibhangul } from '../scripts/lib/hanja-source-parsers.mjs';
import { downloadSource, repoRoot, sha256 } from '../scripts/lib/hanja-database.mjs';
import { extractStdictSupplement, stdictSnapshot } from '../scripts/lib/stdict-supplement.mjs';
import { readZipEntries } from '../scripts/lib/zip-reader.mjs';
import * as hanjaVerifier from '../scripts/verify-hanja-database.mjs';

test('libhangul word parsing rejects malformed and non-aligned conversion pairs', () => {
  const { words } = parseLibhangul(Buffer.from([
    '학교:學校:학교',
    '창황실색:𢠵怳失色:창황실색',
    '기학:氣:private-use character',
    '눌도:율도[訥島:broken source text',
    '대부동:大阜東洞:length mismatch',
    '버스 정류장:버스停留場:space in lookup key',
  ].join('\n')));

  assert.deepEqual([...words.keys()], ['학교', '창황실색']);
});

test('generated Hanja databases preserve their source and lookup contracts', async () => {
  await hanjaVerifier.verifyHanjaDatabase();
});

test('Hanja verification rejects a missing third-party notice', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hop-hanja-notice-missing-'));
  try {
    await assert.rejects(
      hanjaVerifier.verifyHanjaNotices(noticeManifest(Buffer.from('reviewed')), directory),
      /ENOENT|no such file/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Hanja verification rejects a corrupted third-party notice', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hop-hanja-notice-corrupt-'));
  try {
    const reviewed = Buffer.from('reviewed');
    await writeFile(join(directory, 'THIRD_PARTY_NOTICES.md'), 'tampered');

    await assert.rejects(
      hanjaVerifier.verifyHanjaNotices(noticeManifest(reviewed), directory),
      /hash|sha|digest/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Hanja verification rejects malformed UTF-8 in the third-party notice', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hop-hanja-notice-utf8-'));
  try {
    const malformed = Buffer.from([0xc3, 0x28]);
    await writeFile(join(directory, 'THIRD_PARTY_NOTICES.md'), malformed);

    await assert.rejects(
      hanjaVerifier.verifyHanjaNotices(noticeManifest(malformed), directory),
      /UTF-?8|encoding/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Hanja verification rejects an oversized third-party notice before reading it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hop-hanja-notice-size-'));
  try {
    const oversized = Buffer.alloc(8 * 1024 * 1024 + 1);
    await writeFile(join(directory, 'THIRD_PARTY_NOTICES.md'), oversized);

    await assert.rejects(
      hanjaVerifier.verifyHanjaNotices(noticeManifest(oversized), directory),
      /size|exceed|large/iu,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('hashed Hanja JSON assets keep LF bytes on every Git checkout', () => {
  const paths = [
    'apps/studio-host/public/dictionaries/hanja/characters.json',
    'assets/dictionaries/hanja/stdict-20260605.json',
  ];
  const result = spawnSync('git', ['check-attr', 'text', 'eol', '--', ...paths], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/u).map((line) => line.split(': ')), [
    [paths[0], 'text', 'set'],
    [paths[0], 'eol', 'lf'],
    [paths[1], 'text', 'set'],
    [paths[1], 'eol', 'lf'],
  ]);
});

test('source downloads reject oversized headers before allocating a body', async () => {
  const originalFetch = globalThis.fetch;
  let bodyRead = false;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => '4' },
    body: null,
    arrayBuffer: async () => {
      bodyRead = true;
      return new Uint8Array([1, 2, 3, 4]).buffer;
    },
  });
  try {
    await assert.rejects(
      downloadSource({ url: 'https://example.invalid/source', sha256: sha256('abc'), bytes: 3 }),
      /size|bytes|large/iu,
    );
    assert.equal(bodyRead, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ZIP entries reject impossible declared output before decompression', () => {
  const archive = storedZip('entry.txt', Buffer.from('x'));
  const centralOffset = archive.readUInt32LE(archive.length - 6);
  archive.writeUInt32LE(0xffffffff, centralOffset + 24);

  assert.throws(() => [...readZipEntries(archive)], /limit|large|size.*exceed/iu);
});

test('the Standard Dictionary snapshot pins its aggregate source digest', async () => {
  const supplement = JSON.parse(await readFile(
    join(repoRoot, 'assets/dictionaries/hanja/stdict-20260605.json'),
    'utf8',
  ));
  assert.equal(
    stdictSnapshot.sourceDigest,
    '9d33d037278c85c66f6ce69da896d8645a2a57ec5571e7d6cc6d1fbe7dbadf1b',
  );
  assert.equal(supplement.source.sourceDigest, stdictSnapshot.sourceDigest);
});

test('Standard Dictionary extraction rejects a same-count snapshot with another digest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hop-stdict-digest-'));
  try {
    await Promise.all(Array.from({ length: stdictSnapshot.expectedFiles }, (_, index) =>
      writeFile(join(directory, `${String(index).padStart(3, '0')}.xml`), '<dictionary/>')));
    await assert.rejects(extractStdictSupplement(directory), /digest/iu);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function storedZip(name, content) {
  const encodedName = Buffer.from(name);
  const local = Buffer.alloc(30 + encodedName.length + content.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(encodedName.length, 26);
  encodedName.copy(local, 30);
  content.copy(local, 30 + encodedName.length);

  const central = Buffer.alloc(46 + encodedName.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(encodedName.length, 28);
  central.writeUInt32LE(0, 42);
  encodedName.copy(central, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, eocd]);
}

function noticeManifest(content) {
  return {
    notices: {
      file: 'THIRD_PARTY_NOTICES.md',
      bytes: content.length,
      sha256: sha256(content),
    },
  };
}
