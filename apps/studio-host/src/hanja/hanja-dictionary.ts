import type {
  HanjaCharacterCandidate,
  HanjaCharacterRecord,
  HanjaGlyphDetail,
  HanjaLookupResult,
  HanjaToHangulLookup,
} from './hanja-types';
import dictionaryTrust from './hanja-dictionary-trust.json';
import type { HanjaAssetFetcher } from './hanja-dictionary-assets';
import { HanjaDictionaryAssets } from './hanja-dictionary-assets';
import { HanjaLookupError } from './hanja-dictionary-validation';

export type {
  HanjaCharacterCandidate,
  HanjaCharacterRecord,
  HanjaGlyphDetail,
  HanjaLookupResult,
  HanjaSyllableLookup,
  HanjaToHangulLookup,
  HanjaWordCandidate,
  HanjaWordLookup,
} from './hanja-types';
export { HanjaLookupError } from './hanja-dictionary-validation';

const MAX_CONVERSION_LENGTH = 64;

export class HanjaDictionary {
  private readonly assets: HanjaDictionaryAssets;

  constructor(
    baseUrl = 'dictionaries/hanja/',
    fetcher: HanjaAssetFetcher = globalThis.fetch.bind(globalThis),
    expectedManifestSha256?: string,
  ) {
    this.assets = new HanjaDictionaryAssets(baseUrl, fetcher, expectedManifestSha256);
  }

  async lookup(input: string): Promise<HanjaLookupResult> {
    const source = input.normalize('NFC');
    if (!source || Array.from(source).length > MAX_CONVERSION_LENGTH || !/^[가-힣]+$/u.test(source)) {
      throw new HanjaLookupError('invalid-input', '한글 음절로 이루어진 단어만 변환할 수 있습니다.');
    }

    const manifest = await this.assets.loadManifest();
    const shard = wordShardFor(source, manifest.wordDatabase.initialShards);
    const [{ characters, readings }, wordShard] = await Promise.all([
      this.assets.loadCore(),
      this.assets.loadShard(shard),
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

  async lookupHanja(input: string): Promise<HanjaToHangulLookup> {
    const source = input.normalize('NFC');
    if (!source || Array.from(source).length > MAX_CONVERSION_LENGTH || !isHanjaText(source)) {
      throw new HanjaLookupError('invalid-input', '한자로 이루어진 단어만 한글로 변환할 수 있습니다.');
    }

    const { characters } = await this.assets.loadCore();
    const units = Array.from(source, (character) => {
      const record = characters.entries[character];
      if (!record) {
        throw new HanjaLookupError('missing-candidate', `'${character}' 글자의 한글 음과 뜻이 없습니다.`);
      }
      const candidates = [...new Set(record.readings)]
        .map((reading) => buildReadingCandidate(character, reading, record));
      if (candidates.length === 0) {
        throw new HanjaLookupError('missing-candidate', `'${character}' 글자의 한글 음과 뜻이 없습니다.`);
      }
      return { source: character, candidates };
    });
    return { kind: 'hangul', source, characters: units };
  }

}

export function createBundledHanjaDictionary(): HanjaDictionary {
  return new HanjaDictionary(
    new URL('./dictionaries/hanja/', document.baseURI).toString(),
    globalThis.fetch.bind(globalThis),
    dictionaryTrust.manifestSha256,
  );
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

function buildReadingCandidate(
  character: string,
  reading: string,
  record: HanjaCharacterRecord,
): HanjaCharacterCandidate {
  const meanings = [...new Set(record.labels.flatMap((label) => {
    const words = label.split(/\s+/u);
    return words.at(-1) === reading ? [words.slice(0, -1).join(' ')] : [];
  }).filter(Boolean))];
  const fallback = detailFromRecord(character, reading, record);
  const meaning = meanings.length > 0 ? meanings.join(' · ') : fallback.meaning;
  return {
    character,
    reading,
    meaning,
    label: meaning ? `${meaning} ${reading}` : fallback.label,
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

function isHanjaText(value: string): boolean {
  return /^\p{Script=Han}+$/u.test(value);
}
