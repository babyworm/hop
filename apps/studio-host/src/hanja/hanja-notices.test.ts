import { describe, expect, it, vi } from 'vitest';
import { HanjaDictionaryAssets } from './hanja-dictionary-assets';

const initialShards = [
  'g', 'gg', 'n', 'd', 'dd', 'r', 'm', 'b', 'bb', 's',
  'ss', 'ng', 'j', 'jj', 'ch', 'k', 't', 'p', 'h',
] as const;

describe('Hanja third-party notices', () => {
  it('loads the reviewed notice through the manifest integrity boundary', async () => {
    // Given
    const noticeBytes = new TextEncoder().encode('reviewed notice');
    const manifest = await trustedManifest(noticeBytes);
    const manifestBytes = encoded(manifest);
    const fetcher = noticeFetcher(manifestBytes, noticeBytes);
    const assets = new HanjaDictionaryAssets(
      '/dictionaries/hanja/',
      fetcher,
      await sha256Hex(manifestBytes),
    );

    // When
    const notice = await assets.loadNotices();

    // Then
    expect(notice).toBe('reviewed notice');
  });

  it('rejects notice bytes that differ from the trusted manifest', async () => {
    // Given
    const noticeBytes = new TextEncoder().encode('reviewed notice');
    const manifest = await trustedManifest(noticeBytes);
    const manifestBytes = encoded(manifest);
    const fetcher = noticeFetcher(
      manifestBytes,
      new TextEncoder().encode('tampered notice'),
    );
    const assets = new HanjaDictionaryAssets(
      '/dictionaries/hanja/',
      fetcher,
      await sha256Hex(manifestBytes),
    );

    // When / Then
    await expect(assets.loadNotices()).rejects.toMatchObject({
      code: 'invalid-data',
      asset: 'THIRD_PARTY_NOTICES.md',
    });
  });

  it('rejects malformed UTF-8 after integrity verification', async () => {
    // Given
    const noticeBytes = new Uint8Array([0xc3, 0x28]);
    const manifest = await trustedManifest(noticeBytes);
    const manifestBytes = encoded(manifest);
    const assets = new HanjaDictionaryAssets(
      '/dictionaries/hanja/',
      noticeFetcher(manifestBytes, noticeBytes),
      await sha256Hex(manifestBytes),
    );

    // When / Then
    await expect(assets.loadNotices()).rejects.toMatchObject({
      code: 'invalid-data',
      asset: 'THIRD_PARTY_NOTICES.md',
    });
  });

  it('rejects the legacy string notice path at the manifest boundary', async () => {
    // Given
    const manifestBytes = encoded({
      ...(await trustedManifest(new Uint8Array())),
      notices: 'THIRD_PARTY_NOTICES.md',
    });
    const assets = new HanjaDictionaryAssets(
      '/dictionaries/hanja/',
      noticeFetcher(manifestBytes, new Uint8Array()),
      await sha256Hex(manifestBytes),
    );

    // When / Then
    await expect(assets.loadNotices()).rejects.toMatchObject({
      code: 'invalid-data',
      asset: 'manifest.json',
    });
  });
});

async function trustedManifest(noticeBytes: Uint8Array) {
  return {
    schemaVersion: 1,
    characterDatabase: { file: 'characters.json' },
    readingIndex: { file: 'readings.json' },
    wordDatabase: { initialShards, files: [] },
    notices: {
      file: 'THIRD_PARTY_NOTICES.md',
      bytes: noticeBytes.byteLength,
      sha256: await sha256Hex(noticeBytes),
    },
  };
}

function noticeFetcher(manifestBytes: Uint8Array, noticeBytes: Uint8Array) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('manifest.json')) return rawResponse(manifestBytes);
    if (path.endsWith('THIRD_PARTY_NOTICES.md')) return rawResponse(noticeBytes);
    throw new Error(`unexpected fetch: ${path}`);
  });
}

function encoded(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestInput = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(digestInput).set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', digestInput);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

function rawResponse(bytes: Uint8Array): Response {
  return {
    ok: true,
    status: 200,
    body: null,
    headers: new Headers(),
    arrayBuffer: async () => bytes.buffer,
  } as Response;
}
