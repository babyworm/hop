import type {
  HanjaCharacterDatabase,
  HanjaCharacterRecord,
  HanjaManifest,
  HanjaReadingIndex,
  HanjaWordRecord,
  HanjaWordShard,
} from './hanja-types';

const INITIAL_SHARDS = [
  'g', 'gg', 'n', 'd', 'dd', 'r', 'm', 'b', 'bb', 's',
  'ss', 'ng', 'j', 'jj', 'ch', 'k', 't', 'p', 'h',
] as const;
const WORD_METADATA_FIELDS = [
  'definitions', 'partsOfSpeech', 'levels', 'targetCodes', 'stdictTargetCodes',
] as const;
const MAX_MANIFEST_DESCRIPTORS = 32;
const MAX_CHARACTER_ENTRIES = 65_536;
const MAX_READING_ENTRIES = 2_048;
const MAX_WORD_SHARD_ENTRIES = 65_536;
const MAX_RECORD_ITEMS = 32;
const MAX_READING_CANDIDATES = 512;
const MAX_WORD_CANDIDATES = 128;
const MAX_METADATA_ITEMS = 32;
const MAX_WORD_LENGTH = 64;
const MAX_FILE_NAME_LENGTH = 128;
const MAX_SHARD_NAME_LENGTH = 16;
const MAX_VISIBLE_STRING_LENGTH = 1_024;
const localJsonFilePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/u;
const localMarkdownFilePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/u;
const hangulPattern = /^[가-힣]+$/u;
const hangulSyllablePattern = /^[가-힣]$/u;
const singleHanPattern = /^\p{Script=Han}$/u;
const containsHanPattern = /\p{Script=Han}/u;
const safeHanjaPattern = /^[\p{Script=Han}가-힣A-Za-z0-9·ㆍ-]+$/u;

export class HanjaLookupError extends Error {
  readonly asset?: string;
  readonly status?: number;

  constructor(
    readonly code: 'invalid-input' | 'missing-candidate' | 'invalid-data' | 'load-failed',
    message: string,
    details: { asset?: string; status?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: details.cause });
    this.name = 'HanjaLookupError';
    this.asset = details.asset;
    this.status = details.status;
  }
}

export function parseHanjaManifest(value: unknown, asset: string): HanjaManifest {
  if (!isHanjaManifest(value)) {
    throw invalidData('지원하지 않는 한자 사전 매니페스트입니다.', asset);
  }
  return value;
}

export function parseHanjaCharacterDatabase(
  value: unknown,
  asset: string,
): HanjaCharacterDatabase {
  if (!isCharacterDatabase(value)) {
    throw invalidData('지원하지 않는 한자 글자 사전입니다.', asset);
  }
  return value;
}

export function parseHanjaReadingIndex(
  value: unknown,
  characters: HanjaCharacterDatabase,
  asset: string,
): HanjaReadingIndex {
  if (!isReadingIndex(value, characters)) {
    throw invalidData('지원하지 않는 한자 음가 색인입니다.', asset);
  }
  return value;
}

export function parseHanjaWordShard(
  value: unknown,
  expectedShard: string,
  asset: string,
): HanjaWordShard {
  if (!isWordShard(value, expectedShard)) {
    throw invalidData('한자 단어 샤드 형식이 올바르지 않습니다.', asset);
  }
  return value;
}

function isHanjaManifest(value: unknown): value is HanjaManifest {
  return isRecord(value) && value.schemaVersion === 1 &&
    isRecord(value.characterDatabase) && isLocalJsonFile(value.characterDatabase.file) &&
    isRecord(value.readingIndex) && isLocalJsonFile(value.readingIndex.file) &&
    isRecord(value.notices) && isLocalMarkdownFile(value.notices.file) &&
    isRecord(value.wordDatabase) && hasCanonicalInitialShards(value.wordDatabase.initialShards) &&
    hasUniqueDescriptors(value.wordDatabase.files);
}

function isCharacterDatabase(value: unknown): value is HanjaCharacterDatabase {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.entries) ||
      Object.keys(value.entries).length > MAX_CHARACTER_ENTRIES) return false;
  return Object.entries(value.entries).every(([character, record]) =>
    singleHanPattern.test(character) && isCharacterRecord(record));
}

function isCharacterRecord(value: unknown): value is HanjaCharacterRecord {
  return isRecord(value) &&
    isBoundedStringArray(value.readings, MAX_RECORD_ITEMS) && value.readings.length > 0 &&
    value.readings.every((reading) => hangulSyllablePattern.test(reading)) &&
    isBoundedStringArray(value.labels, MAX_RECORD_ITEMS, MAX_VISIBLE_STRING_LENGTH) &&
    isBoundedStringArray(value.meanings, MAX_RECORD_ITEMS, MAX_VISIBLE_STRING_LENGTH) &&
    isOptionalBoolean(value.educationHanja) && isOptionalBoolean(value.personalNameHanja) &&
    isOptionalBoundedString(value.definitionEn, MAX_VISIBLE_STRING_LENGTH) &&
    isOptionalNumberArray(value.totalStrokes);
}

function isReadingIndex(
  value: unknown,
  characters: HanjaCharacterDatabase,
): value is HanjaReadingIndex {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.entries) ||
      Object.keys(value.entries).length > MAX_READING_ENTRIES) return false;
  return Object.entries(value.entries).every(([reading, candidates]) => {
    if (!hangulSyllablePattern.test(reading) || !isStringArray(candidates) ||
        candidates.length === 0 || candidates.length > MAX_READING_CANDIDATES ||
        new Set(candidates).size !== candidates.length) return false;
    return candidates.every((character) => {
      const record = characters.entries[character];
      return singleHanPattern.test(character) && record !== undefined &&
        record.readings.includes(reading) && record.labels.length > 0;
    });
  });
}

function isWordShard(value: unknown, expectedShard: string): value is HanjaWordShard {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.shard !== expectedShard ||
      !isRecord(value.entries) || Object.keys(value.entries).length > MAX_WORD_SHARD_ENTRIES) {
    return false;
  }
  return Object.entries(value.entries).every(([word, candidates]) => {
    if (!hangulPattern.test(word) || !hasAtMostCodePoints(word, MAX_WORD_LENGTH) ||
        shardForWord(word) !== expectedShard || !Array.isArray(candidates) ||
        candidates.length === 0 || candidates.length > MAX_WORD_CANDIDATES) return false;
    const seen = new Set<string>();
    return candidates.every((candidate) => {
      if (!isWordRecord(candidate, word) || seen.has(candidate.hanja)) return false;
      seen.add(candidate.hanja);
      return true;
    });
  });
}

function isWordRecord(value: unknown, word: string): value is HanjaWordRecord {
  if (!isRecord(value) || typeof value.hanja !== 'string' ||
      !containsHanPattern.test(value.hanja) || !safeHanjaPattern.test(value.hanja) ||
      codePointLength(value.hanja) !== codePointLength(word) ||
      typeof value.source !== 'number' || !Number.isInteger(value.source) ||
      value.source < 1 || value.source > 7) return false;
  return WORD_METADATA_FIELDS.every((field) =>
    value[field] === undefined || (
      isBoundedStringArray(value[field], MAX_METADATA_ITEMS, MAX_VISIBLE_STRING_LENGTH) &&
      value[field].length > 0
    ));
}

function hasCanonicalInitialShards(value: unknown): value is string[] {
  return Array.isArray(value) && value.length === INITIAL_SHARDS.length &&
    value.every((shard, index) => shard === INITIAL_SHARDS[index]);
}

function hasUniqueDescriptors(
  value: unknown,
): value is Array<{ shard: string; file: string }> {
  if (!Array.isArray(value) || value.length > MAX_MANIFEST_DESCRIPTORS) return false;
  const shards = new Set<string>();
  const files = new Set<string>();
  for (const descriptor of value) {
    if (!isRecord(descriptor) || typeof descriptor.shard !== 'string' || !descriptor.shard ||
        !hasAtMostCodePoints(descriptor.shard, MAX_SHARD_NAME_LENGTH) ||
        !isLocalJsonFile(descriptor.file) || shards.has(descriptor.shard) ||
        files.has(descriptor.file)) {
      return false;
    }
    shards.add(descriptor.shard);
    files.add(descriptor.file);
  }
  return true;
}

function shardForWord(word: string): string | undefined {
  const first = word.codePointAt(0);
  if (first === undefined || first < 0xac00 || first > 0xd7a3) return undefined;
  return INITIAL_SHARDS[Math.floor((first - 0xac00) / 588)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isBoundedStringArray(
  value: unknown,
  maxItems: number,
  maxStringLength = MAX_VISIBLE_STRING_LENGTH,
): value is string[] {
  return isStringArray(value) && value.length <= maxItems &&
    value.every((item) => hasAtMostCodePoints(item, maxStringLength));
}

function isLocalJsonFile(value: unknown): value is string {
  return typeof value === 'string' && hasAtMostCodePoints(value, MAX_FILE_NAME_LENGTH) &&
    localJsonFilePattern.test(value);
}

function isLocalMarkdownFile(value: unknown): value is string {
  return typeof value === 'string' && hasAtMostCodePoints(value, MAX_FILE_NAME_LENGTH) &&
    localMarkdownFilePattern.test(value);
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

function isOptionalBoundedString(value: unknown, maxLength: number): value is string | undefined {
  return value === undefined || (typeof value === 'string' && hasAtMostCodePoints(value, maxLength));
}

function isOptionalNumberArray(value: unknown): value is number[] | undefined {
  return value === undefined ||
    (Array.isArray(value) && value.length <= MAX_RECORD_ITEMS &&
      value.every((item) => typeof item === 'number' && Number.isFinite(item)));
}

function hasAtMostCodePoints(value: string, maximum: number): boolean {
  let count = 0;
  for (const _character of value) {
    count += 1;
    if (count > maximum) return false;
  }
  return true;
}

function codePointLength(value: string): number {
  let length = 0;
  for (const _character of value) length += 1;
  return length;
}

function invalidData(message: string, asset: string): HanjaLookupError {
  return new HanjaLookupError('invalid-data', message, { asset });
}
