import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  outputDir,
  readJson,
  sha256,
  shardForWord,
  shardNames,
  sources,
  stdictSupplementPath,
} from './lib/hanja-database.mjs';
import { stdictSnapshot } from './lib/stdict-supplement.mjs';

const containsHanPattern = /\p{Script=Han}/u;
const singleHanPattern = /^\p{Script=Han}$/u;
const safeOriginPattern = /^[\p{Script=Han}가-힣A-Za-z0-9·ㆍ-]+$/u;

export async function verifyHanjaDatabase() {
  const manifest = await readJson(join(outputDir, 'manifest.json'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.dataVersion, sources.krdict.version);
  assert.deepEqual(manifest.sources, sources);
  assert.equal(manifest.characterDatabase.license, 'BSD-3-Clause AND Unicode-3.0');
  assert.equal(manifest.readingIndex.license, 'BSD-3-Clause AND Unicode-3.0');
  assert.equal(manifest.wordDatabase.license, 'CC-BY-SA-2.0-KR');
  assert.equal(manifest.notices, 'THIRD_PARTY_NOTICES.md');
  assert.deepEqual(manifest.wordDatabase.sourceBits, { libhangul: 1, krdict: 2, stdict: 4 });
  assert.deepEqual(manifest.wordDatabase.initialShards, shardNames.slice(0, 19));
  assert.deepEqual(manifest.wordDatabase.files.map((file) => file.shard), shardNames);

  const stdictContent = await readFile(stdictSupplementPath);
  assert.equal(sha256(stdictContent), sources.stdict.supplementSha256);
  const stdictSupplement = JSON.parse(stdictContent);
  assert.equal(stdictSupplement.schemaVersion, 1);
  assert.equal(stdictSupplement.source.sourceItems, stdictSnapshot.expectedItems);
  assert.equal(stdictSupplement.pairs.length, stdictSnapshot.expectedSafePairs);

  const characterContent = await readFile(join(outputDir, manifest.characterDatabase.file));
  assert.equal(sha256(characterContent), manifest.characterDatabase.sha256);
  assert.equal(characterContent.length, manifest.characterDatabase.bytes);
  const characters = JSON.parse(characterContent).entries;
  assert.equal(Object.keys(characters).length, manifest.characterDatabase.entries);
  assert.ok(manifest.characterDatabase.entries > 25_000);
  verifyCharacters(characters);

  const readingContent = await readFile(join(outputDir, manifest.readingIndex.file));
  assert.equal(sha256(readingContent), manifest.readingIndex.sha256);
  assert.equal(readingContent.length, manifest.readingIndex.bytes);
  const readings = JSON.parse(readingContent).entries;
  assert.equal(Object.keys(readings).length, manifest.readingIndex.entries);
  assert.equal(verifyReadings(readings, characters), manifest.readingIndex.candidates);
  assert.ok(manifest.characterDatabase.entriesWithKoreanMeaning > 7_000);
  assert.ok(manifest.readingIndex.entries > 450);

  let wordCount = 0;
  let candidateCount = 0;
  const fixtures = new Map();
  for (const metadata of manifest.wordDatabase.files) {
    const content = await readFile(join(outputDir, metadata.file));
    assert.equal(sha256(content), metadata.sha256, `${metadata.file} hash mismatch`);
    assert.equal(content.length, metadata.bytes, `${metadata.file} byte count mismatch`);
    const document = JSON.parse(content);
    assert.equal(document.schemaVersion, 1);
    assert.equal(document.shard, metadata.shard);
    assert.equal(Object.keys(document.entries).length, metadata.entries);
    const shardCandidateCount = verifyWordShard(document.entries, metadata.shard, fixtures);
    assert.equal(shardCandidateCount, metadata.candidates);
    wordCount += metadata.entries;
    candidateCount += shardCandidateCount;
  }
  assert.equal(wordCount, manifest.wordDatabase.entries);
  assert.equal(candidateCount, manifest.wordDatabase.candidates);
  assert.ok(wordCount > 275_000);
  assert.ok(candidateCount > 335_000);
  verifyFixtures(characters, readings, fixtures);
  return manifest;
}

function verifyReadings(readings, characters) {
  let candidateCount = 0;
  for (const [reading, candidates] of Object.entries(readings)) {
    assert.match(reading, /^[가-힣]$/u);
    assert.deepEqual(candidates, unique(candidates));
    for (const character of candidates) {
      assert.ok(characters[character].readings.includes(reading));
      assert.ok(characters[character].labels.length > 0);
    }
    candidateCount += candidates.length;
  }
  return candidateCount;
}

function verifyCharacters(characters) {
  for (const [character, record] of Object.entries(characters)) {
    assert.match(character, singleHanPattern);
    assert.ok(Array.isArray(record.readings) && record.readings.length > 0);
    assert.deepEqual(record.readings, unique(record.readings));
    assert.deepEqual(record.labels, unique(record.labels));
    assert.deepEqual(record.meanings, unique(record.meanings));
  }
}

function verifyWordShard(entries, shard, fixtures) {
  let candidateCount = 0;
  for (const [word, candidates] of Object.entries(entries)) {
    assert.match(word, /^[가-힣]+$/u);
    assert.equal(shardForWord(word), shard, `${word} belongs in another shard`);
    assert.ok(candidates.length > 0);
    assert.equal(new Set(candidates.map((candidate) => candidate.hanja)).size, candidates.length);
    for (const candidate of candidates) {
      assert.match(candidate.hanja, containsHanPattern);
      assert.match(candidate.hanja, safeOriginPattern);
      assert.equal(
        Array.from(candidate.hanja).length,
        Array.from(word).length,
        `${word} and ${candidate.hanja} must have one-to-one character alignment`,
      );
      assert.ok(candidate.source >= 1 && (candidate.source & ~7) === 0);
      for (const field of ['definitions', 'partsOfSpeech', 'levels', 'targetCodes', 'stdictTargetCodes']) {
        if (field in candidate) assert.ok(Array.isArray(candidate[field]) && candidate[field].length > 0);
      }
    }
    candidateCount += candidates.length;
    if (['학교', '사기', '가감되다', '가공물', '가건축'].includes(word)) fixtures.set(word, candidates);
  }
  return candidateCount;
}

function verifyFixtures(characters, readings, fixtures) {
  assert.ok(characters.學.readings.includes('학'));
  assert.ok(characters.學.labels.includes('배울 학'));
  assert.equal(characters.學.educationHanja, true);
  assert.ok(characters.樂.readings.includes('락'));
  assert.ok(characters.樂.readings.includes('악'));
  assert.ok(characters.樂.readings.includes('요'));
  assert.ok(characters.歷.readings.includes('력'));
  assert.ok(characters.歷.readings.includes('역'));
  assert.ok(readings.학.includes('學'));
  assert.ok(readings.교.includes('校'));

  const school = new Set(fixtures.get('학교')?.map((candidate) => candidate.hanja));
  assert.ok(school.has('學校'));
  const fraud = new Set(fixtures.get('사기')?.map((candidate) => candidate.hanja));
  for (const expected of ['士氣', '史記', '詐欺']) assert.ok(fraud.has(expected));

  assert.ok(fixtures.get('가감되다')?.some((candidate) => candidate.hanja === '加減되다' && (candidate.source & 4) !== 0));
  assert.ok(fixtures.get('가공물')?.some((candidate) => candidate.hanja === '加工物' && (candidate.source & 4) !== 0));
  assert.ok(fixtures.get('가건축')?.some((candidate) => candidate.hanja === '假建築' && (candidate.source & 4) !== 0));
}

function unique(values) {
  return [...new Set(values)];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyHanjaDatabase()
    .then((manifest) => console.log(
      `Hanja database verified: ${manifest.characterDatabase.entries} characters, `
      + `${manifest.wordDatabase.entries} words, ${manifest.wordDatabase.candidates} candidates`,
    ))
    .catch((error) => {
      console.error(error instanceof Error ? error.stack : error);
      process.exitCode = 1;
    });
}
