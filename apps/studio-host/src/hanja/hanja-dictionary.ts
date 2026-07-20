import type {
  HanjaCharacterCandidate,
  HanjaCharacterDatabase,
  HanjaCharacterRecord,
  HanjaGlyphDetail,
  HanjaLookupResult,
  HanjaManifest,
  HanjaReadingIndex,
  HanjaWordShard,
} from './hanja-types';

export type {
  HanjaCharacterCandidate,
  HanjaCharacterRecord,
  HanjaGlyphDetail,
  HanjaLookupResult,
  HanjaSyllableLookup,
  HanjaWordCandidate,
  HanjaWordLookup,
} from './hanja-types';

export class HanjaLookupError extends Error {
  constructor(
    readonly code: 'invalid-input' | 'missing-candidate' | 'invalid-data' | 'load-failed',
    message: string,
  ) {
    super(message);
    this.name = 'HanjaLookupError';
  }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const INITIAL_SHARDS = [
  'g', 'gg', 'n', 'd', 'dd', 'r', 'm', 'b', 'bb', 's',
  'ss', 'ng', 'j', 'jj', 'ch', 'k', 't', 'p', 'h',
] as const;

const MAX_CONVERSION_LENGTH = 64;

export class HanjaDictionary {
  private readonly baseUrl: string;
  private manifestPromise: Promise<HanjaManifest> | null = null;
  private corePromise: Promise<{
    characters: HanjaCharacterDatabase;
    readings: HanjaReadingIndex;
  }> | null = null;
  private readonly shardPromises = new Map<string, Promise<HanjaWordShard>>();

  constructor(
    baseUrl = 'dictionaries/hanja/',
    private readonly fetcher: Fetcher = globalThis.fetch.bind(globalThis),
  ) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }

  async lookup(input: string): Promise<HanjaLookupResult> {
    const source = input.normalize('NFC');
    if (!source || source.length > MAX_CONVERSION_LENGTH || !/^[가-힣]+$/u.test(source)) {
      throw new HanjaLookupError('invalid-input', '한글 음절로 이루어진 단어만 변환할 수 있습니다.');
    }

    const shard = wordShardFor(source);
    const [{ characters, readings }, wordShard] = await Promise.all([
      this.loadCore(),
      this.loadShard(shard),
    ]);
    const words = wordShard.entries[source] ?? [];
    if (words.length > 0) {
      return {
        kind: 'word',
        source,
        candidates: words.map((word) => ({
          text: word.hanja,
          definition: word.definitions?.[0],
          partOfSpeech: word.partsOfSpeech?.[0],
          level: word.levels?.[0],
          source: word.source,
          characters: buildWordDetails(source, word.hanja, characters.entries),
        })),
      };
    }

    const syllables = Array.from(source, (syllable) => {
      const candidates = (readings.entries[syllable] ?? [])
        .map((character) => buildCharacterCandidate(character, syllable, characters.entries[character]))
        .filter((candidate): candidate is HanjaCharacterCandidate => candidate !== null);
      if (candidates.length === 0) {
        throw new HanjaLookupError('missing-candidate', `'${syllable}' 음절의 한자 후보가 없습니다.`);
      }
      return { source: syllable, candidates };
    });
    return { kind: 'syllables', source, syllables };
  }

  private loadManifest(): Promise<HanjaManifest> {
    if (!this.manifestPromise) {
      this.manifestPromise = this.loadJson<HanjaManifest>('manifest.json')
        .then((manifest) => {
          if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.wordDatabase?.files)) {
            throw new HanjaLookupError('invalid-data', '지원하지 않는 한자 사전 매니페스트입니다.');
          }
          return manifest;
        })
        .catch((error) => {
          this.manifestPromise = null;
          throw normalizeLoadError(error);
        });
    }
    return this.manifestPromise;
  }

  private loadCore(): Promise<{
    characters: HanjaCharacterDatabase;
    readings: HanjaReadingIndex;
  }> {
    if (!this.corePromise) {
      this.corePromise = Promise.all([
        this.loadJson<HanjaCharacterDatabase>('characters.json'),
        this.loadJson<HanjaReadingIndex>('readings.json'),
      ])
        .then(([characters, readings]) => {
          if (
            characters.schemaVersion !== 1 || readings.schemaVersion !== 1 ||
            !characters.entries || !readings.entries
          ) {
            throw new HanjaLookupError('invalid-data', '지원하지 않는 한자 글자 사전입니다.');
          }
          return { characters, readings };
        })
        .catch((error) => {
          this.corePromise = null;
          throw normalizeLoadError(error);
        });
    }
    return this.corePromise;
  }

  private loadShard(shard: string): Promise<HanjaWordShard> {
    const cached = this.shardPromises.get(shard);
    if (cached) return cached;

    const promise = this.loadManifest()
      .then((manifest) => {
        const descriptor = manifest.wordDatabase.files.find((file) => file.shard === shard);
        if (!descriptor) {
          throw new HanjaLookupError('invalid-data', `한자 단어 샤드를 찾을 수 없습니다: ${shard}`);
        }
        return this.loadJson<HanjaWordShard>(descriptor.file);
      })
      .then((wordShard) => {
        if (!wordShard.entries || typeof wordShard.entries !== 'object') {
          throw new HanjaLookupError('invalid-data', '한자 단어 샤드 형식이 올바르지 않습니다.');
        }
        return wordShard;
      })
      .catch((error) => {
        this.shardPromises.delete(shard);
        throw normalizeLoadError(error);
      });
    this.shardPromises.set(shard, promise);
    return promise;
  }

  private async loadJson<T>(file: string): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${file}`);
    } catch (error) {
      throw normalizeLoadError(error);
    }
    if (!response.ok) {
      throw new HanjaLookupError('load-failed', `한자 사전 파일을 읽지 못했습니다 (${response.status}).`);
    }
    try {
      return await response.json() as T;
    } catch {
      throw new HanjaLookupError('invalid-data', '한자 사전 JSON을 해석하지 못했습니다.');
    }
  }
}

export function createBundledHanjaDictionary(): HanjaDictionary {
  return new HanjaDictionary(new URL('./dictionaries/hanja/', document.baseURI).toString());
}

export function wordShardFor(word: string): string {
  const codePoint = word.codePointAt(0);
  if (codePoint === undefined || codePoint < 0xac00 || codePoint > 0xd7a3) return 'other';
  const initialIndex = Math.floor((codePoint - 0xac00) / 588);
  return INITIAL_SHARDS[initialIndex] ?? 'other';
}

function buildWordDetails(
  source: string,
  replacement: string,
  records: Record<string, HanjaCharacterRecord>,
): HanjaGlyphDetail[] {
  const sourceSyllables = Array.from(source);
  return Array.from(replacement).map((character, index) => {
    const preferredReading = sourceSyllables[index] ?? '';
    const record = records[character];
    if (!record) {
      return {
        character,
        label: preferredReading ? `${preferredReading} (뜻 정보 없음)` : '뜻 정보 없음',
        reading: preferredReading,
        meaning: '',
      };
    }
    return detailFromRecord(character, preferredReading, record);
  });
}

function buildCharacterCandidate(
  character: string,
  reading: string,
  record: HanjaCharacterRecord | undefined,
): HanjaCharacterCandidate | null {
  if (!record) return null;
  return {
    ...detailFromRecord(character, reading, record),
    educationHanja: record.educationHanja === true,
    personalNameHanja: record.personalNameHanja === true,
  };
}

function detailFromRecord(
  character: string,
  preferredReading: string,
  record: HanjaCharacterRecord,
): HanjaGlyphDetail {
  const matchingLabel = record.labels.find((label) => label.split(/\s+/u).at(-1) === preferredReading);
  const fallbackReading = preferredReading || record.readings[0] || '';
  const label = matchingLabel ?? record.labels[0] ?? `${fallbackReading} (뜻 정보 없음)`;
  const words = label.split(/\s+/u);
  return {
    character,
    label,
    reading: words.at(-1) ?? preferredReading,
    meaning: words.slice(0, -1).join(' '),
  };
}

function normalizeLoadError(error: unknown): HanjaLookupError {
  if (error instanceof HanjaLookupError) return error;
  return new HanjaLookupError('load-failed', '내장 한자 사전을 불러오지 못했습니다.');
}
