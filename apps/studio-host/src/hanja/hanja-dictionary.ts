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
import {
  HanjaLookupError,
  parseHanjaCharacterDatabase,
  parseHanjaManifest,
  parseHanjaReadingIndex,
  parseHanjaWordShard,
} from './hanja-dictionary-validation';

export type {
  HanjaCharacterCandidate,
  HanjaCharacterRecord,
  HanjaGlyphDetail,
  HanjaLookupResult,
  HanjaSyllableLookup,
  HanjaWordCandidate,
  HanjaWordLookup,
} from './hanja-types';
export { HanjaLookupError } from './hanja-dictionary-validation';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const MAX_CONVERSION_LENGTH = 64;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;

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
    if (!source || Array.from(source).length > MAX_CONVERSION_LENGTH || !/^[가-힣]+$/u.test(source)) {
      throw new HanjaLookupError('invalid-input', '한글 음절로 이루어진 단어만 변환할 수 있습니다.');
    }

    const manifest = await this.loadManifest();
    const shard = wordShardFor(source, manifest.wordDatabase.initialShards);
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
      this.manifestPromise = this.loadJson('manifest.json')
        .then((manifest) => parseHanjaManifest(manifest, 'manifest.json'))
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
      this.corePromise = this.loadManifest()
        .then(async (manifest) => {
          const [characters, readings] = await Promise.all([
            this.loadJson(manifest.characterDatabase.file),
            this.loadJson(manifest.readingIndex.file),
          ]);
          const parsedCharacters = parseHanjaCharacterDatabase(
            characters,
            manifest.characterDatabase.file,
          );
          const parsedReadings = parseHanjaReadingIndex(
            readings,
            parsedCharacters,
            manifest.readingIndex.file,
          );
          return { characters: parsedCharacters, readings: parsedReadings };
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
      .then(async (manifest) => {
        const descriptor = manifest.wordDatabase.files.find((file) => file.shard === shard);
        if (!descriptor) {
          throw new HanjaLookupError(
            'invalid-data',
            `한자 단어 샤드를 찾을 수 없습니다: ${shard}`,
            { asset: 'manifest.json' },
          );
        }
        return { descriptor, wordShard: await this.loadJson(descriptor.file) };
      })
      .then(({ descriptor, wordShard }) => parseHanjaWordShard(wordShard, shard, descriptor.file))
      .catch((error) => {
        this.shardPromises.delete(shard);
        throw normalizeLoadError(error);
      });
    this.shardPromises.set(shard, promise);
    return promise;
  }

  private async loadJson(file: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${file}`);
    } catch (error) {
      throw normalizeLoadError(error, file);
    }
    if (!response.ok) {
      throw new HanjaLookupError(
        'load-failed',
        `한자 사전 파일을 읽지 못했습니다 (${response.status}).`,
        { asset: file, status: response.status },
      );
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await response.arrayBuffer();
    } catch (error) {
      throw new HanjaLookupError(
        'invalid-data',
        '한자 사전 파일을 읽지 못했습니다.',
        { asset: file, cause: error },
      );
    }
    if (bytes.byteLength > MAX_ASSET_BYTES) {
      throw new HanjaLookupError(
        'invalid-data',
        '한자 사전 파일이 허용된 크기를 초과했습니다.',
        { asset: file },
      );
    }
    try {
      const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const value: unknown = JSON.parse(json);
      return value;
    } catch (error) {
      throw new HanjaLookupError(
        'invalid-data',
        '한자 사전 JSON을 해석하지 못했습니다.',
        { asset: file, cause: error },
      );
    }
  }
}

export function createBundledHanjaDictionary(): HanjaDictionary {
  return new HanjaDictionary(new URL('./dictionaries/hanja/', document.baseURI).toString());
}

function wordShardFor(word: string, initialShards: readonly string[]): string {
  const codePoint = word.codePointAt(0);
  if (codePoint === undefined || codePoint < 0xac00 || codePoint > 0xd7a3) {
    throw new HanjaLookupError('invalid-input', '한글 음절로 이루어진 단어만 변환할 수 있습니다.');
  }
  const initialIndex = Math.floor((codePoint - 0xac00) / 588);
  const shard = initialShards[initialIndex];
  if (!shard) {
    throw new HanjaLookupError('invalid-data', '한자 사전의 초성 샤드 정보가 올바르지 않습니다.');
  }
  return shard;
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
  if (matchingLabel) {
    const words = matchingLabel.split(/\s+/u);
    return {
      character,
      label: matchingLabel,
      reading: words.at(-1) ?? preferredReading,
      meaning: words.slice(0, -1).join(' '),
    };
  }

  const reading = preferredReading || record.readings[0] || '';
  const fallbackWords = (record.labels[0] ?? '').split(/\s+/u);
  const meaning = record.meanings[0] ?? fallbackWords.slice(0, -1).join(' ');
  return {
    character,
    label: meaning ? `${meaning} ${reading}` : `${reading} (뜻 정보 없음)`,
    reading,
    meaning,
  };
}

function normalizeLoadError(error: unknown, asset?: string): HanjaLookupError {
  if (error instanceof HanjaLookupError) return error;
  return new HanjaLookupError(
    'load-failed',
    '내장 한자 사전을 불러오지 못했습니다.',
    { asset, cause: error },
  );
}
