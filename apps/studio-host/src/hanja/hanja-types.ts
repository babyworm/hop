export interface HanjaCharacterRecord {
  readings: string[];
  labels: string[];
  meanings: string[];
  educationHanja?: boolean;
  personalNameHanja?: boolean;
  definitionEn?: string;
  totalStrokes?: number[];
}

export interface HanjaCharacterDatabase {
  schemaVersion: number;
  entries: Record<string, HanjaCharacterRecord>;
}

export interface HanjaReadingIndex {
  schemaVersion: number;
  entries: Record<string, string[]>;
}

export interface HanjaWordRecord {
  hanja: string;
  source: number;
  definitions?: string[];
  partsOfSpeech?: string[];
  levels?: string[];
}

export interface HanjaWordShard {
  schemaVersion: number;
  shard: string;
  entries: Record<string, HanjaWordRecord[]>;
}

export interface HanjaAssetDescriptor {
  file: string;
  bytes?: number;
  sha256?: string;
}

export interface HanjaManifest {
  schemaVersion: number;
  characterDatabase: HanjaAssetDescriptor;
  readingIndex: HanjaAssetDescriptor;
  wordDatabase: {
    initialShards: string[];
    files: Array<HanjaAssetDescriptor & { shard: string }>;
  };
}

export interface HanjaGlyphDetail {
  character: string;
  label: string;
  reading: string;
  meaning: string;
}

export interface HanjaWordCandidate {
  text: string;
  definition?: string;
  partOfSpeech?: string;
  level?: string;
  source: number;
  characters: HanjaGlyphDetail[];
}

export interface HanjaCharacterCandidate extends HanjaGlyphDetail {
  educationHanja: boolean;
  personalNameHanja: boolean;
}

export interface HanjaWordLookup {
  kind: 'word';
  source: string;
  candidates: HanjaWordCandidate[];
}

export interface HanjaSyllableLookup {
  kind: 'syllables';
  source: string;
  syllables: Array<{
    source: string;
    candidates: HanjaCharacterCandidate[];
  }>;
}

export interface HanjaToHangulLookup {
  kind: 'hangul';
  source: string;
  characters: Array<{
    source: string;
    candidates: HanjaCharacterCandidate[];
  }>;
}

export type HanjaLookupResult = HanjaWordLookup | HanjaSyllableLookup | HanjaToHangulLookup;
