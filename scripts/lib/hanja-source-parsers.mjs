import { readZipEntries } from './zip-reader.mjs';

const hanCharacterPattern = /^\p{Script=Han}$/u;
const containsHanPattern = /\p{Script=Han}/u;
const hangulSyllablePattern = /^[가-힣]$/u;
const hangulWordPattern = /^[가-힣]+$/u;
const safeOriginPattern = /^[\p{Script=Han}가-힣A-Za-z0-9·ㆍ-]+$/u;
const unihanProperties = new Set([
  'kHangul',
  'kDefinition',
  'kKoreanEducationHanja',
  'kKoreanName',
  'kTotalStrokes',
]);

export function parseLibhangul(content) {
  const characters = new Map();
  const words = new Map();
  for (const rawLine of content.toString('utf8').split(/\r?\n/u)) {
    if (!rawLine || rawLine.startsWith('#')) continue;
    const firstSeparator = rawLine.indexOf(':');
    const secondSeparator = rawLine.indexOf(':', firstSeparator + 1);
    if (firstSeparator < 1 || secondSeparator < 0) continue;
    const key = normalize(rawLine.slice(0, firstSeparator));
    const value = normalize(rawLine.slice(firstSeparator + 1, secondSeparator));
    const description = normalize(rawLine.slice(secondSeparator + 1));

    if (hangulSyllablePattern.test(key) && isSingleHan(value)) {
      addCharacter(characters, value, key, description);
    } else if (hangulWordPattern.test(key) && isConvertibleOrigin(key, value)) {
      addWordCandidate(words, key, value, 1);
    }
  }
  return { characters, words };
}

export function applyUnihan(characters, archive) {
  const properties = new Map();
  for (const [name, content] of readZipEntries(archive)) {
    if (!name.endsWith('.txt')) continue;
    for (const line of content.toString('utf8').split(/\r?\n/u)) {
      if (!line || line.startsWith('#')) continue;
      const [codePoint, property, value] = line.split('\t');
      if (!unihanProperties.has(property)) continue;
      const character = String.fromCodePoint(Number.parseInt(codePoint.slice(2), 16));
      const record = properties.get(character) ?? {};
      record[property] = value;
      properties.set(character, record);
    }
  }

  for (const [character, property] of properties) {
    const readings = parseUnihanReadings(property.kHangul);
    if (!characters.has(character) && readings.length === 0) continue;
    const record = characters.get(character) ?? createCharacterRecord();
    for (const reading of readings) record.readings.add(reading);
    if (property.kDefinition) record.definitionEn = property.kDefinition;
    if (property.kKoreanEducationHanja) record.educationHanja = true;
    if (property.kKoreanName) record.personalNameHanja = true;
    if (property.kTotalStrokes) {
      record.totalStrokes = unique(property.kTotalStrokes.split(/\s+/u).map(Number).filter(Number.isFinite));
    }
    characters.set(character, record);
  }
}

export function applyKrdict(words, archive) {
  for (const [name, content] of readZipEntries(archive)) {
    if (!name.endsWith('.json')) continue;
    const document = JSON.parse(content.toString('utf8'));
    const entries = asArray(document?.LexicalResource?.Lexicon?.LexicalEntry);
    for (const entry of entries) applyKrdictEntry(words, entry);
  }
}

export function applyStdictSupplement(words, supplement) {
  if (supplement?.schemaVersion !== 1 || !Array.isArray(supplement.pairs)) {
    throw new Error('invalid Standard Dictionary supplement schema');
  }
  for (const [word, hanja, targetCodes = [], partsOfSpeech = []] of supplement.pairs) {
    const candidate = addWordCandidate(words, word, hanja, 4);
    addAll(candidate.stdictTargetCodes, targetCodes);
    addAll(candidate.partsOfSpeech, partsOfSpeech);
  }
}

function applyKrdictEntry(words, entry) {
  const lemma = featureValues(entry?.Lemma, 'writtenForm')[0];
  const normalizedLemma = lemma ? normalize(lemma) : '';
  if (!hangulWordPattern.test(normalizedLemma)) return;
  const origins = featureValues(entry, 'origin')
    .map(cleanOrigin)
    .filter((origin) => isConvertibleOrigin(normalizedLemma, origin));
  const definitions = asArray(entry?.Sense).flatMap((sense) => featureValues(sense, 'definition'));
  const partsOfSpeech = featureValues(entry, 'partOfSpeech');
  const levels = featureValues(entry, 'vocabularyLevel');
  const targetCode = entry?.val === undefined ? undefined : String(entry.val);

  for (const origin of unique(origins)) {
    const candidate = addWordCandidate(words, normalizedLemma, origin, 2);
    addAll(candidate.definitions, definitions);
    addAll(candidate.partsOfSpeech, partsOfSpeech);
    addAll(candidate.levels, levels);
    if (targetCode) candidate.targetCodes.add(targetCode);
  }
}

function addCharacter(characters, character, reading, description) {
  const record = characters.get(character) ?? createCharacterRecord();
  record.readings.add(reading);
  for (const label of description.split(/,\s*/u).map((value) => value.trim()).filter(Boolean)) {
    record.labels.add(label);
    const meaning = label.replace(/\s+[가-힣]+$/u, '').trim();
    if (meaning) record.meanings.add(meaning);
  }
  characters.set(character, record);
}

function createCharacterRecord() {
  return { readings: new Set(), labels: new Set(), meanings: new Set() };
}

function addWordCandidate(words, key, hanja, source) {
  const group = words.get(key) ?? { candidates: [], byHanja: new Map() };
  let candidate = group.byHanja.get(hanja);
  if (!candidate) {
    candidate = {
      hanja,
      source,
      definitions: new Set(),
      partsOfSpeech: new Set(),
      levels: new Set(),
      targetCodes: new Set(),
      stdictTargetCodes: new Set(),
    };
    group.byHanja.set(hanja, candidate);
    group.candidates.push(candidate);
  } else {
    candidate.source |= source;
  }
  words.set(key, group);
  return candidate;
}

function featureValues(node, attribute) {
  return asArray(node).flatMap((item) => asArray(item?.feat))
    .filter((feature) => feature?.att === attribute && feature.val !== undefined)
    .map((feature) => normalize(String(feature.val)))
    .filter(Boolean);
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function cleanOrigin(value) {
  return normalize(value).replaceAll('^', '').replace(/\s+/gu, '');
}

function isConvertibleOrigin(lemma, origin) {
  return containsHanPattern.test(origin)
    && safeOriginPattern.test(origin)
    && Array.from(lemma).length === Array.from(origin).length;
}

function parseUnihanReadings(value = '') {
  return unique(value.split(/\s+/u).map((token) => token.split(':')[0]).filter(Boolean));
}

function isSingleHan(value) {
  return Array.from(value).length === 1 && hanCharacterPattern.test(value);
}

function addAll(set, values) {
  for (const value of values) set.add(value);
}

function normalize(value) {
  return value.normalize('NFC').trim();
}

function unique(values) {
  return [...new Set(values)];
}
