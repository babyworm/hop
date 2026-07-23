import type {
  HanjaAssetDescriptor,
  HanjaCharacterDatabase,
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

export type HanjaAssetFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type AssetIntegrity = { readonly sha256: string; readonly bytes?: number };

const MAX_ASSET_BYTES = 8 * 1024 * 1024;

export class HanjaDictionaryAssets {
  private readonly baseUrl: string;
  private manifestPromise: Promise<HanjaManifest> | null = null;
  private corePromise: Promise<{
    characters: HanjaCharacterDatabase;
    readings: HanjaReadingIndex;
  }> | null = null;
  private readonly shardPromises = new Map<string, Promise<HanjaWordShard>>();

  constructor(
    baseUrl: string,
    private readonly fetcher: HanjaAssetFetcher,
    private readonly expectedManifestSha256?: string,
  ) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }

  loadManifest(): Promise<HanjaManifest> {
    if (!this.manifestPromise) {
      const integrity = this.expectedManifestSha256
        ? { sha256: this.expectedManifestSha256 }
        : undefined;
      this.manifestPromise = this.loadJson('manifest.json', integrity)
        .then((manifest) => parseHanjaManifest(manifest, 'manifest.json'))
        .catch((error) => {
          this.manifestPromise = null;
          throw normalizeLoadError(error);
        });
    }
    return this.manifestPromise;
  }

  loadCore(): Promise<{
    characters: HanjaCharacterDatabase;
    readings: HanjaReadingIndex;
  }> {
    if (!this.corePromise) {
      this.corePromise = this.loadManifest()
        .then(async (manifest) => {
          const [characters, readings] = await Promise.all([
            this.loadJson(
              manifest.characterDatabase.file,
              this.trustedIntegrity(manifest.characterDatabase),
            ),
            this.loadJson(
              manifest.readingIndex.file,
              this.trustedIntegrity(manifest.readingIndex),
            ),
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

  loadShard(shard: string): Promise<HanjaWordShard> {
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
        return {
          descriptor,
          wordShard: await this.loadJson(descriptor.file, this.trustedIntegrity(descriptor)),
        };
      })
      .then(({ descriptor, wordShard }) => parseHanjaWordShard(wordShard, shard, descriptor.file))
      .catch((error) => {
        this.shardPromises.delete(shard);
        throw normalizeLoadError(error);
      });
    this.shardPromises.set(shard, promise);
    return promise;
  }

  private async loadJson(file: string, integrity?: AssetIntegrity): Promise<unknown> {
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
    let bytes: Uint8Array;
    try {
      bytes = await readBoundedResponse(response, file);
    } catch (error) {
      if (error instanceof HanjaLookupError) throw error;
      throw new HanjaLookupError(
        'invalid-data',
        '한자 사전 파일을 읽지 못했습니다.',
        { asset: file, cause: error },
      );
    }
    if (integrity) await assertAssetIntegrity(bytes, integrity, file);
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

  private trustedIntegrity(descriptor: HanjaAssetDescriptor): AssetIntegrity | undefined {
    if (!this.expectedManifestSha256) return undefined;
    const bytes = descriptor.bytes;
    if (!Number.isSafeInteger(bytes) || bytes === undefined || bytes < 0 ||
        typeof descriptor.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(descriptor.sha256)) {
      throw new HanjaLookupError(
        'invalid-data',
        '한자 사전 파일 무결성 정보가 올바르지 않습니다.',
        { asset: 'manifest.json' },
      );
    }
    return { bytes, sha256: descriptor.sha256 };
  }
}

async function readBoundedResponse(response: Response, file: string): Promise<Uint8Array> {
  const declaredLength = Number(response.headers?.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ASSET_BYTES) {
    throw oversizedAssetError(file);
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_ASSET_BYTES) throw oversizedAssetError(file);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_ASSET_BYTES) {
        await reader.cancel();
        throw oversizedAssetError(file);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function oversizedAssetError(file: string): HanjaLookupError {
  return new HanjaLookupError(
    'invalid-data',
    '한자 사전 파일이 허용된 크기를 초과했습니다.',
    { asset: file },
  );
}

async function assertAssetIntegrity(
  bytes: Uint8Array,
  integrity: AssetIntegrity,
  file: string,
): Promise<void> {
  if (integrity.bytes !== undefined && bytes.byteLength !== integrity.bytes) {
    throw invalidAssetIntegrity(file);
  }
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw invalidAssetIntegrity(file);
  const digestInput = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(digestInput).set(bytes);
  const digest = await subtle.digest('SHA-256', digestInput);
  const actual = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  if (actual !== integrity.sha256) throw invalidAssetIntegrity(file);
}

function invalidAssetIntegrity(file: string): HanjaLookupError {
  return new HanjaLookupError(
    'invalid-data',
    '한자 사전 파일 무결성을 확인하지 못했습니다.',
    { asset: file },
  );
}

function normalizeLoadError(error: unknown, asset?: string): HanjaLookupError {
  if (error instanceof HanjaLookupError) return error;
  return new HanjaLookupError(
    'load-failed',
    '내장 한자 사전을 불러오지 못했습니다.',
    { asset, cause: error },
  );
}
