import { describe, expect, it, vi } from 'vitest';
import { HanjaDictionary } from './hanja-dictionary';

const manifest = {
  schemaVersion: 1,
  characterDatabase: { file: 'characters.json' },
  readingIndex: { file: 'readings.json' },
  wordDatabase: {
    initialShards: [
      'g', 'gg', 'n', 'd', 'dd', 'r', 'm', 'b', 'bb', 's',
      'ss', 'ng', 'j', 'jj', 'ch', 'k', 't', 'p', 'h',
    ],
    files: [
      { shard: 'h', file: 'words-h.json' },
      { shard: 's', file: 'words-s.json' },
    ],
  },
};

const characters = {
  schemaVersion: 1,
  entries: {
    學: { readings: ['학'], labels: ['배울 학'], meanings: ['배울'], educationHanja: true },
    校: { readings: ['교'], labels: ['학교 교'], meanings: ['학교'], educationHanja: true },
    樂: {
      readings: ['낙', '락', '악', '요'],
      labels: ['좋아할 요', '즐거울 락', '즐길 낙', '즐길 악', '풍류 악'],
      meanings: ['좋아할', '즐거울', '즐길', '풍류'],
      educationHanja: true,
    },
  },
};

const readings = {
  schemaVersion: 1,
  entries: { 학: ['學'], 교: ['校'] },
};

const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_DESCRIPTORS = 32;
const MAX_RECORD_ITEMS = 32;
const MAX_READING_CANDIDATES = 512;
const MAX_WORD_CANDIDATES = 128;
const MAX_METADATA_ITEMS = 32;
const MAX_VISIBLE_STRING_LENGTH = 1024;

describe('HanjaDictionary', () => {
  it('loads only the required word shard and caches bundled assets', async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      const path = String(input);
      if (path.endsWith('manifest.json')) return response(manifest);
      if (path.endsWith('characters.json')) return response(characters);
      if (path.endsWith('readings.json')) return response(readings);
      if (path.endsWith('words-h.json')) {
        return response({
          schemaVersion: 1,
          shard: 'h',
          entries: { 학교: [{ hanja: '學校', source: 7, definitions: ['교육 기관'] }] },
        });
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    const dictionary = new HanjaDictionary('/dictionaries/hanja/', fetcher as typeof fetch);

    const first = await dictionary.lookup('학교');
    const second = await dictionary.lookup('학교');

    expect(first.kind).toBe('word');
    if (first.kind === 'word') {
      expect(first.candidates[0]).toMatchObject({ text: '學校', definition: '교육 기관' });
      expect(first.candidates[0]?.characters.map(({ label }) => label)).toEqual(['배울 학', '학교 교']);
    }
    expect(second).toEqual(first);
    expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith('words-h.json'))).toHaveLength(1);
    expect(fetcher.mock.calls.some(([path]) => String(path).endsWith('words-s.json'))).toBe(false);
  });

  it('falls back to labeled candidates for each syllable when no word exists', async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      const path = String(input);
      if (path.endsWith('manifest.json')) return response(manifest);
      if (path.endsWith('characters.json')) return response(characters);
      if (path.endsWith('readings.json')) return response(readings);
      if (path.endsWith('words-h.json')) {
        return response({ schemaVersion: 1, shard: 'h', entries: {} });
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    const dictionary = new HanjaDictionary('/dictionaries/hanja/', fetcher as typeof fetch);

    const result = await dictionary.lookup('학교');

    expect(result).toMatchObject({
      kind: 'syllables',
      syllables: [
        { source: '학', candidates: [{ character: '學', label: '배울 학' }] },
        { source: '교', candidates: [{ character: '校', label: '학교 교' }] },
      ],
    });
  });

  it('looks up Hanja readings and meanings without loading a word shard', async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      const path = String(input);
      if (path.endsWith('manifest.json')) return response(manifest);
      if (path.endsWith('characters.json')) return response(characters);
      if (path.endsWith('readings.json')) return response(readings);
      throw new Error(`unexpected fetch: ${path}`);
    });
    const dictionary = new HanjaDictionary('/dictionaries/hanja/', fetcher as typeof fetch);

    const result = await dictionary.lookupHanja('樂校');

    expect(result).toMatchObject({
      kind: 'hangul',
      source: '樂校',
      characters: [
        {
          source: '樂',
          candidates: [
            { reading: '낙', meaning: '즐길', label: '즐길 낙' },
            { reading: '락', meaning: '즐거울', label: '즐거울 락' },
            { reading: '악', meaning: '즐길 · 풍류', label: '즐길 · 풍류 악' },
            { reading: '요', meaning: '좋아할', label: '좋아할 요' },
          ],
        },
        { source: '校', candidates: [{ reading: '교', meaning: '학교', label: '학교 교' }] },
      ],
    });
    expect(fetcher.mock.calls.some(([path]) => /words-/u.test(String(path)))).toBe(false);
  });

  it('labels a character with the requested reading when its canonical label uses another reading', async () => {
    const result = await dictionaryWith({
      characters: {
        ...characters,
        entries: {
          ...characters.entries,
          熇: {
            readings: ['학', '효'],
            labels: ['불김 효'],
            meanings: ['불김'],
            personalNameHanja: true,
          },
        },
      },
      readings: {
        ...readings,
        entries: { ...readings.entries, 학: ['熇'] },
      },
    }).lookup('학교');

    expect(result.kind).toBe('syllables');
    if (result.kind === 'syllables') {
      expect(result.syllables[0]).toMatchObject({
        source: '학',
        candidates: [{ character: '熇', label: '불김 학', reading: '학', meaning: '불김' }],
      });
    }
  });

  it('rejects a shard whose declared schema or identity does not match the manifest', async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      const path = String(input);
      if (path.endsWith('manifest.json')) return response(manifest);
      if (path.endsWith('characters.json')) return response(characters);
      if (path.endsWith('readings.json')) return response(readings);
      if (path.endsWith('words-h.json')) {
        return response({ schemaVersion: 1, shard: 's', entries: {} });
      }
      throw new Error(`unexpected fetch: ${path}`);
    });

    await expect(new HanjaDictionary('/dictionaries/hanja/', fetcher as typeof fetch).lookup('학교'))
      .rejects.toMatchObject({ code: 'invalid-data' });
  });

  it('rejects a reordered initial-shard routing table', async () => {
    const reorderedManifest = {
      ...manifest,
      wordDatabase: {
        ...manifest.wordDatabase,
        initialShards: manifest.wordDatabase.initialShards.map((shard, index) =>
          index === 18 ? 's' : shard),
      },
    };

    await expect(dictionaryWith({ manifest: reorderedManifest, wordShard: {
      schemaVersion: 1,
      shard: 's',
      entries: {},
    } }).lookup('학교')).rejects.toMatchObject({
      code: 'invalid-data',
      asset: 'manifest.json',
    });
  });

  it('rejects malformed character records at the asset boundary', async () => {
    const malformedCharacters = {
      ...characters,
      entries: {
        ...characters.entries,
        學: { ...characters.entries.學, labels: '배울 학' },
      },
    };

    await expect(dictionaryWith({ characters: malformedCharacters }).lookup('학교'))
      .rejects.toMatchObject({ code: 'invalid-data', asset: 'characters.json' });
  });

  it('rejects malformed reading references at the asset boundary', async () => {
    const malformedReadings = {
      ...readings,
      entries: { ...readings.entries, 학: '學' },
    };

    await expect(dictionaryWith({ readings: malformedReadings }).lookup('학교'))
      .rejects.toMatchObject({ code: 'invalid-data', asset: 'readings.json' });
  });

  it('rejects an oversized Content-Length before reading the response body', async () => {
    const arrayBuffer = vi.fn();
    const fetcher = vi.fn(async (input: string | URL) => {
      const path = String(input);
      if (path.endsWith('manifest.json')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Length': String(MAX_ASSET_BYTES + 1) }),
          body: null,
          arrayBuffer,
        } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${path}`);
    });

    await expect(new HanjaDictionary('/dictionaries/hanja/', fetcher as typeof fetch).lookup('학교'))
      .rejects.toMatchObject({
        code: 'invalid-data',
        asset: 'manifest.json',
        message: expect.stringContaining('크기'),
      });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('cancels a streamed asset as soon as its bytes exceed the limit', async () => {
    const cancel = vi.fn(async () => undefined);
    const arrayBuffer = vi.fn();
    const chunks = [new Uint8Array(MAX_ASSET_BYTES), new Uint8Array(1)];
    let index = 0;
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: async () => index < chunks.length
            ? { done: false, value: chunks[index++] }
            : { done: true, value: undefined },
          cancel,
          releaseLock: vi.fn(),
        }),
      },
      arrayBuffer,
    })) as unknown as typeof fetch;

    await expect(new HanjaDictionary('/dictionaries/hanja/', fetcher).lookup('학교'))
      .rejects.toMatchObject({ code: 'invalid-data', asset: 'manifest.json' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('rejects a bundled manifest that does not match its reviewed trust anchor', async () => {
    const fetcher = vi.fn(async () => response(manifest));
    const dictionary = new HanjaDictionary(
      '/dictionaries/hanja/',
      fetcher as typeof fetch,
      '0'.repeat(64),
    );

    await expect(dictionary.lookup('학교')).rejects.toMatchObject({
      code: 'invalid-data',
      asset: 'manifest.json',
    });
  });

  it('rejects a bundled asset whose bytes do not match the trusted manifest', async () => {
    const characterBytes = encoded(characters);
    const readingBytes = encoded(readings);
    const trustedManifest = {
      ...manifest,
      characterDatabase: {
        file: 'characters.json',
        bytes: characterBytes.byteLength,
        sha256: await sha256Hex(characterBytes),
      },
      readingIndex: {
        file: 'readings.json',
        bytes: readingBytes.byteLength,
        sha256: await sha256Hex(readingBytes),
      },
    };
    const manifestBytes = encoded(trustedManifest);
    const fetcher = vi.fn(async (input: string | URL) => {
      const path = String(input);
      if (path.endsWith('manifest.json')) return rawResponse(manifestBytes, async () => trustedManifest);
      if (path.endsWith('characters.json')) {
        return response({ ...characters, entries: { ...characters.entries, 學: undefined } });
      }
      if (path.endsWith('readings.json')) return rawResponse(readingBytes, async () => readings);
      throw new Error(`unexpected fetch: ${path}`);
    });
    const dictionary = new HanjaDictionary(
      '/dictionaries/hanja/',
      fetcher as typeof fetch,
      await sha256Hex(manifestBytes),
    );

    await expect(dictionary.lookupHanja('學')).rejects.toMatchObject({
      code: 'invalid-data',
      asset: 'characters.json',
    });
  });

  it('rejects a manifest with excessive file descriptors', async () => {
    const files = [
      { shard: 'h', file: 'words-h.json' },
      ...Array.from({ length: MAX_MANIFEST_DESCRIPTORS }, (_, index) => ({
        shard: `extra-${index}`,
        file: `words-extra-${index}.json`,
      })),
    ];

    await expect(dictionaryWith({ manifest: {
      ...manifest,
      wordDatabase: { ...manifest.wordDatabase, files },
    } }).lookup('학교')).rejects.toMatchObject({
      code: 'invalid-data',
      asset: 'manifest.json',
    });
  });

  it('rejects excessive character labels and user-visible label lengths', async () => {
    const excessiveLabels = Array.from(
      { length: MAX_RECORD_ITEMS + 1 },
      (_, index) => `뜻${index} 학`,
    );
    const tooLongLabel = `${'가'.repeat(MAX_VISIBLE_STRING_LENGTH + 1)} 학`;

    await expect(dictionaryWith({ characters: {
      ...characters,
      entries: {
        ...characters.entries,
        學: { ...characters.entries.學, labels: excessiveLabels },
      },
    } }).lookup('학교')).rejects.toMatchObject({
      code: 'invalid-data',
      asset: 'characters.json',
    });

    await expect(dictionaryWith({ characters: {
      ...characters,
      entries: {
        ...characters.entries,
        學: { ...characters.entries.學, labels: [tooLongLabel] },
      },
    } }).lookup('학교')).rejects.toMatchObject({
      code: 'invalid-data',
      asset: 'characters.json',
    });
  });

  it('rejects excessive candidates per reading and per word', async () => {
    const hanja = Array.from(
      { length: MAX_READING_CANDIDATES + 1 },
      (_, index) => String.fromCodePoint(0x4e00 + index),
    );
    const excessiveCharacters = Object.fromEntries(hanja.map((character) => [
      character,
      { readings: ['학'], labels: ['뜻 학'], meanings: ['뜻'] },
    ]));
    await expect(dictionaryWith({
      characters: { schemaVersion: 1, entries: excessiveCharacters },
      readings: { schemaVersion: 1, entries: { 학: hanja } },
    }).lookup('학교')).rejects.toMatchObject({
      code: 'invalid-data',
      asset: 'readings.json',
    });

    const wordCandidates = Array.from({ length: MAX_WORD_CANDIDATES + 1 }, (_, index) => ({
      hanja: `${String.fromCodePoint(0x4e00 + index)}校`,
      source: 7,
    }));
    await expect(dictionaryWith({ wordShard: {
      schemaVersion: 1,
      shard: 'h',
      entries: { 학교: wordCandidates },
    } }).lookup('학교')).rejects.toMatchObject({
      code: 'invalid-data',
      asset: 'words-h.json',
    });
  });

  it('rejects excessive metadata cardinality and user-visible metadata length', async () => {
    await expect(dictionaryWith({ wordShard: {
      schemaVersion: 1,
      shard: 'h',
      entries: { 학교: [{
        hanja: '學校',
        source: 7,
        definitions: Array.from({ length: MAX_METADATA_ITEMS + 1 }, (_, index) => `정의 ${index}`),
      }] },
    } }).lookup('학교')).rejects.toMatchObject({
      code: 'invalid-data',
      asset: 'words-h.json',
    });

    await expect(dictionaryWith({ wordShard: {
      schemaVersion: 1,
      shard: 'h',
      entries: { 학교: [{
        hanja: '學校',
        source: 7,
        definitions: ['가'.repeat(MAX_VISIBLE_STRING_LENGTH + 1)],
      }] },
    } }).lookup('학교')).rejects.toMatchObject({
      code: 'invalid-data',
      asset: 'words-h.json',
    });
  });

  it('evicts a rejected manifest promise so a later lookup can retry', async () => {
    let attempts = 0;
    const fetcher = vi.fn(async (input: string | URL) => {
      const path = String(input);
      if (path.endsWith('manifest.json')) {
        attempts += 1;
        return response(attempts === 1 ? { ...manifest, schemaVersion: 2 } : manifest);
      }
      if (path.endsWith('characters.json')) return response(characters);
      if (path.endsWith('readings.json')) return response(readings);
      if (path.endsWith('words-h.json')) {
        return response({ schemaVersion: 1, shard: 'h', entries: {} });
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    const dictionary = new HanjaDictionary('/dictionaries/hanja/', fetcher as typeof fetch);

    await expect(dictionary.lookup('학교')).rejects.toMatchObject({ asset: 'manifest.json' });
    await expect(dictionary.lookup('학교')).resolves.toMatchObject({ kind: 'syllables' });
    expect(attempts).toBe(2);
  });

  it('evicts a rejected core promise so a later lookup can retry', async () => {
    let attempts = 0;
    const fetcher = vi.fn(async (input: string | URL) => {
      const path = String(input);
      if (path.endsWith('manifest.json')) return response(manifest);
      if (path.endsWith('characters.json')) {
        attempts += 1;
        return response(attempts === 1 ? { ...characters, schemaVersion: 2 } : characters);
      }
      if (path.endsWith('readings.json')) return response(readings);
      if (path.endsWith('words-h.json')) {
        return response({ schemaVersion: 1, shard: 'h', entries: {} });
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    const dictionary = new HanjaDictionary('/dictionaries/hanja/', fetcher as typeof fetch);

    await expect(dictionary.lookup('학교')).rejects.toMatchObject({ asset: 'characters.json' });
    await expect(dictionary.lookup('학교')).resolves.toMatchObject({ kind: 'syllables' });
    expect(attempts).toBe(2);
  });

  it('evicts a rejected shard promise so a later lookup can retry', async () => {
    let attempts = 0;
    const fetcher = vi.fn(async (input: string | URL) => {
      const path = String(input);
      if (path.endsWith('manifest.json')) return response(manifest);
      if (path.endsWith('characters.json')) return response(characters);
      if (path.endsWith('readings.json')) return response(readings);
      if (path.endsWith('words-h.json')) {
        attempts += 1;
        return response(attempts === 1
          ? { schemaVersion: 1, shard: 's', entries: {} }
          : { schemaVersion: 1, shard: 'h', entries: {} });
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    const dictionary = new HanjaDictionary('/dictionaries/hanja/', fetcher as typeof fetch);

    await expect(dictionary.lookup('학교')).rejects.toMatchObject({ asset: 'words-h.json' });
    await expect(dictionary.lookup('학교')).resolves.toMatchObject({ kind: 'syllables' });
    expect(attempts).toBe(2);
  });

  it.each([
    ['empty replacement', { hanja: '', source: 7 }],
    ['misaligned replacement', { hanja: '學', source: 7 }],
    ['replacement without Han', { hanja: '학교', source: 7 }],
    ['unknown source bits', { hanja: '學校', source: 8 }],
    ['non-array metadata', { hanja: '學校', source: 7, definitions: '교육 기관' }],
  ])('rejects an unsafe word candidate: %s', async (_name, candidate) => {
    await expect(dictionaryWith({ wordShard: {
      schemaVersion: 1,
      shard: 'h',
      entries: { 학교: [candidate] },
    } }).lookup('학교')).rejects.toMatchObject({
      code: 'invalid-data',
      asset: 'words-h.json',
    });
  });

  it('retains non-sensitive asset diagnostics for network and JSON failures', async () => {
    const networkFailure = new Error('offline');
    const networkDictionary = new HanjaDictionary('/dictionaries/hanja/', vi.fn(async () => {
      throw networkFailure;
    }) as typeof fetch);

    await expect(networkDictionary.lookup('학교')).rejects.toMatchObject({
      code: 'load-failed',
      asset: 'manifest.json',
      cause: networkFailure,
    });

    const httpDictionary = new HanjaDictionary('/dictionaries/hanja/', vi.fn(async () => ({
      ok: false,
      status: 503,
    })) as unknown as typeof fetch);
    await expect(httpDictionary.lookup('학교')).rejects.toMatchObject({
      code: 'load-failed',
      asset: 'manifest.json',
      status: 503,
    });

    const invalidJsonFetcher = vi.fn(
      async () => rawResponse(
        new TextEncoder().encode('{'),
        async () => { throw new SyntaxError('bad json'); },
      ),
    ) as unknown as typeof fetch;
    const invalidJsonDictionary = new HanjaDictionary(
      '/dictionaries/hanja/',
      invalidJsonFetcher,
    );
    await expect(invalidJsonDictionary.lookup('학교')).rejects.toMatchObject({
      code: 'invalid-data',
      asset: 'manifest.json',
      cause: expect.any(SyntaxError),
    });
  });
});

function response(value: unknown): Response {
  return rawResponse(encoded(value), async () => value);
}

function encoded(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestInput = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(digestInput).set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', digestInput);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function rawResponse(bytes: Uint8Array, json: () => Promise<unknown>): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer as ArrayBuffer,
    json,
  } as Response;
}

function dictionaryWith(overrides: {
  readonly manifest?: unknown;
  readonly characters?: unknown;
  readonly readings?: unknown;
  readonly wordShard?: unknown;
}): HanjaDictionary {
  const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
    const path = String(input);
    if (path.endsWith('manifest.json')) return response(overrides.manifest ?? manifest);
    if (path.endsWith('characters.json')) return response(overrides.characters ?? characters);
    if (path.endsWith('readings.json')) return response(overrides.readings ?? readings);
    if (/words-[a-z]+\.json$/u.test(path)) {
      return response(overrides.wordShard ?? { schemaVersion: 1, shard: 'h', entries: {} });
    }
    throw new Error(`unexpected fetch: ${path}`);
  };
  return new HanjaDictionary('/dictionaries/hanja/', fetcher);
}
