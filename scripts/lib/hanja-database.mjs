import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export { applyKrdict, applyStdictSupplement, applyUnihan, parseLibhangul } from './hanja-source-parsers.mjs';

export const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const outputDir = join(repoRoot, 'apps/studio-host/public/dictionaries/hanja');
export const shardNames = [
  'g', 'gg', 'n', 'd', 'dd', 'r', 'm', 'b', 'bb', 's',
  'ss', 'ng', 'j', 'jj', 'ch', 'k', 't', 'p', 'h', 'other',
];

export const sources = {
  libhangul: {
    version: 'a34aef73378c0992316861bbf13fc914ee7577d9',
    url: 'https://raw.githubusercontent.com/libhangul/libhangul/a34aef73378c0992316861bbf13fc914ee7577d9/data/hanja/hanja.txt',
    sha256: 'dd44dcc856cf542b1022d0f39c2e9b9f8805fdcc5923be80f04849ed97ce0996',
    license: 'BSD-3-Clause',
  },
  unihan: {
    version: '17.0.0',
    url: 'https://www.unicode.org/Public/17.0.0/ucd/Unihan.zip',
    sha256: 'f7a48b2b545acfaa77b2d607ae28747404ce02baefee16396c5d2d7a8ef34b5e',
    license: 'Unicode-3.0',
  },
  krdict: {
    version: '2026-07-19',
    url: 'https://krdict.korean.go.kr/dicBatchDownload?seq=211',
    sha256: '13ff666e78363e3abc73cdb2e582a6776ddfa7a120f18c0b79bd03fa56d860f9',
    license: 'CC-BY-SA-2.0-KR',
  },
  stdict: {
    version: '2026-06-05',
    url: 'https://stdict.korean.go.kr/',
    snapshotUrl: 'https://github.com/spellcheck-ko/korean-dict-nikl/tree/42c0d01889f34536e9cf94fe57f62bd2055b1bde/stdict',
    snapshotCommit: '42c0d01889f34536e9cf94fe57f62bd2055b1bde',
    supplementSha256: '7ff0c9390d96cefc614380ef9ee989709130d7ad9538724bbc9a84c8f10f3104',
    license: 'CC-BY-SA-2.0-KR',
  },
};

export const stdictSupplementPath = join(repoRoot, 'assets/dictionaries/hanja/stdict-20260605.json');

export async function downloadSource(source) {
  const headers = { 'User-Agent': 'HOP hanja database builder' };
  if (source === sources.krdict) {
    headers.Referer = 'https://krdict.korean.go.kr/download/downloadPopup?lang=ko';
  }
  const response = await fetch(source.url, { headers, redirect: 'follow' });
  if (!response.ok) throw new Error(`download failed (${response.status}): ${source.url}`);
  const content = Buffer.from(await response.arrayBuffer());
  const actualHash = sha256(content);
  if (actualHash !== source.sha256) {
    throw new Error(`${source.url} SHA-256 mismatch: expected ${source.sha256}, got ${actualHash}`);
  }
  return content;
}

export async function readStdictSupplement() {
  const content = await readFile(stdictSupplementPath);
  const actualHash = sha256(content);
  if (actualHash !== sources.stdict.supplementSha256) {
    throw new Error(`Standard Dictionary supplement SHA-256 mismatch: expected ${sources.stdict.supplementSha256}, got ${actualHash}`);
  }
  return JSON.parse(content);
}

export function serializeCharacters(characters) {
  const entries = {};
  for (const character of sorted(characters.keys())) {
    const record = characters.get(character);
    const serialized = {
      readings: sorted(record.readings),
      labels: sorted(record.labels),
      meanings: sorted(record.meanings),
    };
    if (record.educationHanja) serialized.educationHanja = true;
    if (record.personalNameHanja) serialized.personalNameHanja = true;
    if (record.definitionEn) serialized.definitionEn = record.definitionEn;
    if (record.totalStrokes?.length) serialized.totalStrokes = record.totalStrokes;
    entries[character] = serialized;
  }
  return { schemaVersion: 1, entries };
}

export function serializeWordShards(words) {
  const shards = new Map(shardNames.map((name) => [name, {}]));
  for (const key of sorted(words.keys())) {
    const group = words.get(key);
    const candidates = group.candidates.map((candidate) => ({
      hanja: candidate.hanja,
      source: candidate.source,
      ...(candidate.definitions?.size ? { definitions: sorted(candidate.definitions) } : {}),
      ...(candidate.partsOfSpeech?.size ? { partsOfSpeech: sorted(candidate.partsOfSpeech) } : {}),
      ...(candidate.levels?.size ? { levels: sorted(candidate.levels) } : {}),
      ...(candidate.targetCodes?.size ? { targetCodes: sorted(candidate.targetCodes) } : {}),
      ...(candidate.stdictTargetCodes?.size ? { stdictTargetCodes: sorted(candidate.stdictTargetCodes) } : {}),
    }));
    shards.get(shardForWord(key))[key] = candidates;
  }
  return new Map(shardNames.map((name) => [name, { schemaVersion: 1, shard: name, entries: shards.get(name) }]));
}

export function serializeReadingIndex(characters) {
  const readings = new Map();
  for (const [character, record] of characters) {
    if (record.labels.size === 0) continue;
    for (const reading of record.readings) {
      const candidates = readings.get(reading) ?? [];
      candidates.push(character);
      readings.set(reading, candidates);
    }
  }
  const entries = {};
  for (const reading of sorted(readings.keys())) {
    entries[reading] = readings.get(reading).sort((left, right) => compareCharacterPriority(
      characters.get(left),
      characters.get(right),
      left,
      right,
    ));
  }
  return { schemaVersion: 1, entries };
}

export async function writeDatabase(characters, words) {
  await mkdir(outputDir, { recursive: true });
  const characterContent = jsonLine(serializeCharacters(characters));
  await writeFile(join(outputDir, 'characters.json'), characterContent);
  const readingContent = jsonLine(serializeReadingIndex(characters));
  await writeFile(join(outputDir, 'readings.json'), readingContent);

  const wordFiles = [];
  for (const [shard, document] of serializeWordShards(words)) {
    const filename = `words-${shard}.json`;
    const content = jsonLine(document);
    await writeFile(join(outputDir, filename), content);
    const candidates = Object.values(document.entries).reduce((sum, values) => sum + values.length, 0);
    wordFiles.push({
      shard,
      file: filename,
      sha256: sha256(content),
      bytes: content.length,
      entries: Object.keys(document.entries).length,
      candidates,
    });
  }

  const characterDocument = JSON.parse(characterContent);
  const readingDocument = JSON.parse(readingContent);
  const characterRecords = Object.values(characterDocument.entries);
  const manifest = {
    schemaVersion: 1,
    dataVersion: sources.krdict.version,
    sources,
    characterDatabase: {
      file: 'characters.json',
      license: 'BSD-3-Clause AND Unicode-3.0',
      sha256: sha256(characterContent),
      bytes: characterContent.length,
      entries: Object.keys(characterDocument.entries).length,
      entriesWithKoreanMeaning: characterRecords.filter((record) => record.labels.length > 0).length,
      entriesWithEnglishDefinition: characterRecords.filter((record) => record.definitionEn).length,
      educationHanja: characterRecords.filter((record) => record.educationHanja).length,
      personalNameHanja: characterRecords.filter((record) => record.personalNameHanja).length,
    },
    readingIndex: {
      file: 'readings.json',
      license: 'BSD-3-Clause AND Unicode-3.0',
      sha256: sha256(readingContent),
      bytes: readingContent.length,
      entries: Object.keys(readingDocument.entries).length,
      candidates: Object.values(readingDocument.entries).reduce((sum, values) => sum + values.length, 0),
    },
    wordDatabase: {
      license: 'CC-BY-SA-2.0-KR',
      sourceBits: { libhangul: 1, krdict: 2, stdict: 4 },
      initialShards: shardNames.slice(0, 19),
      files: wordFiles,
      entries: wordFiles.reduce((sum, file) => sum + file.entries, 0),
      candidates: wordFiles.reduce((sum, file) => sum + file.candidates, 0),
    },
    notices: 'THIRD_PARTY_NOTICES.md',
  };
  await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function shardForWord(word) {
  const first = word.codePointAt(0);
  if (first === undefined || first < 0xac00 || first > 0xd7a3) return 'other';
  return shardNames[Math.floor((first - 0xac00) / 588)];
}

export function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function compareCharacterPriority(left, right, leftCharacter, rightCharacter) {
  const score = (record) => [
    record.educationHanja ? 1 : 0,
    record.labels.size,
    record.personalNameHanja ? 1 : 0,
  ];
  const leftScore = score(left);
  const rightScore = score(right);
  for (let index = 0; index < leftScore.length; index += 1) {
    if (leftScore[index] !== rightScore[index]) return rightScore[index] - leftScore[index];
  }
  return leftCharacter < rightCharacter ? -1 : leftCharacter > rightCharacter ? 1 : 0;
}

function sorted(values) {
  return [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function jsonLine(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`);
}
