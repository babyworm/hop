import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const stdictSnapshot = {
  version: '2026-06-05',
  mirrorCommit: '42c0d01889f34536e9cf94fe57f62bd2055b1bde',
  expectedFiles: 88,
  expectedItems: 436_578,
  expectedSafePairs: 163_626,
  sourceDigest: '9d33d037278c85c66f6ce69da896d8645a2a57ec5571e7d6cc6d1fbe7dbadf1b',
};

const hangulWordPattern = /^[가-힣]+$/u;
const safeOriginPattern = /^[\p{Script=Han}가-힣]+$/u;
const containsHanPattern = /\p{Script=Han}/u;

export async function extractStdictSupplement(sourceDirectory) {
  const filenames = (await readdir(sourceDirectory)).filter((name) => name.endsWith('.xml')).sort();
  if (filenames.length !== stdictSnapshot.expectedFiles) {
    throw new Error(`expected ${stdictSnapshot.expectedFiles} standard dictionary XML files, got ${filenames.length}`);
  }

  const sourceHash = createHash('sha256');
  const buildDates = new Set();
  const pairs = new Map();
  let sourceItems = 0;
  for (const filename of filenames) {
    const content = await readFile(join(sourceDirectory, filename));
    sourceHash.update(filename).update('\0').update(content);
    const xml = content.toString('utf8');
    buildDates.add(tagValue(xml, 'lastBuildDate'));
    for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gu)) {
      sourceItems += 1;
      addItem(pairs, match[1]);
    }
  }

  const sourceDigest = sourceHash.digest('hex');
  if (sourceDigest !== stdictSnapshot.sourceDigest) {
    throw new Error(`standard dictionary source digest mismatch: expected ${stdictSnapshot.sourceDigest}, got ${sourceDigest}`);
  }
  if (sourceItems !== stdictSnapshot.expectedItems) {
    throw new Error(`expected ${stdictSnapshot.expectedItems} standard dictionary items, got ${sourceItems}`);
  }
  if (pairs.size !== stdictSnapshot.expectedSafePairs) {
    throw new Error(`expected ${stdictSnapshot.expectedSafePairs} safe pairs, got ${pairs.size}`);
  }
  if ([...buildDates].some((value) => !value.startsWith('20260605'))) {
    throw new Error(`unexpected standard dictionary build dates: ${[...buildDates].join(', ')}`);
  }

  return {
    schemaVersion: 1,
    source: {
      dictionary: '국립국어원 표준국어대사전',
      version: stdictSnapshot.version,
      mirrorCommit: stdictSnapshot.mirrorCommit,
      sourceDigest,
      sourceFiles: filenames.length,
      sourceItems,
      buildDate: '2026-06-05',
    },
    pairs: [...pairs.values()]
      .sort((left, right) => compare(left.word, right.word) || compare(left.hanja, right.hanja))
      .map(({ word, hanja, targetCodes, partsOfSpeech }) => [
        word,
        hanja,
        [...targetCodes].sort(compare),
        [...partsOfSpeech].sort(compare),
      ]),
  };
}

function addItem(pairs, item) {
  const wordInfo = tagValue(item, 'word_info');
  const rawWord = tagValue(wordInfo, 'word');
  if (tagValue(wordInfo, 'word_unit') !== '단어' || /[\s^]/u.test(rawWord)) return;

  const originParts = [];
  let hasHanja = false;
  for (const match of wordInfo.matchAll(/<original_language_info>([\s\S]*?)<\/original_language_info>/gu)) {
    originParts.push(tagValue(match[1], 'original_language'));
    if (tagValue(match[1], 'language_type') === '한자') hasHanja = true;
  }
  if (!hasHanja) return;

  const word = rawWord.replaceAll('-', '').normalize('NFC');
  const hanja = originParts.join('').replace(/[-\s^]/gu, '').normalize('NFC');
  if (!hangulWordPattern.test(word)
    || !safeOriginPattern.test(hanja)
    || !containsHanPattern.test(hanja)
    || Array.from(word).length !== Array.from(hanja).length) return;

  const key = `${word}\0${hanja}`;
  const record = pairs.get(key) ?? { word, hanja, targetCodes: new Set(), partsOfSpeech: new Set() };
  const targetCode = tagValue(item, 'target_code');
  if (targetCode) record.targetCodes.add(targetCode);
  for (const match of wordInfo.matchAll(/<pos>([\s\S]*?)<\/pos>/gu)) {
    const partOfSpeech = decodeXml(match[1].trim());
    if (partOfSpeech) record.partsOfSpeech.add(partOfSpeech);
  }
  pairs.set(key, record);
}

function tagValue(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'u'));
  return match ? decodeXml(match[1].trim()) : '';
}

function decodeXml(value) {
  return value
    .replace(/^<!\[CDATA\[/u, '')
    .replace(/\]\]>$/u, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
