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
  },
};

const readings = {
  schemaVersion: 1,
  entries: { 학: ['學'], 교: ['校'] },
};

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

    const invalidJsonDictionary = new HanjaDictionary('/dictionaries/hanja/', vi.fn(async () => ({
      ok: true,
      json: async () => { throw new SyntaxError('bad json'); },
    })) as unknown as typeof fetch);
    await expect(invalidJsonDictionary.lookup('학교')).rejects.toMatchObject({
      code: 'invalid-data',
      asset: 'manifest.json',
      cause: expect.any(SyntaxError),
    });
  });
});

function response(value: unknown): Response {
  return { ok: true, status: 200, json: async () => value } as Response;
}
