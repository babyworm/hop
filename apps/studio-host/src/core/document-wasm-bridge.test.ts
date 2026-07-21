import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WasmBridge } from '@/upstream/core';
import { createBridge } from './bridge-factory';
import { currentDocumentGeneration } from './document-generation';

vi.mock('@/core/wasm-bridge', () => ({
  WasmBridge: class {
    loadDocument(_data: Uint8Array, _fileName?: string) {
      return { pageCount: 1, fontsUsed: [] };
    }

    createNewDocument() {
      return { pageCount: 1, fontsUsed: [] };
    }
  },
}));

describe('primary document bridge generation', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('advances generation immediately before loading a primary document', () => {
    const bridge = createBridge();
    const before = currentDocumentGeneration();

    bridge.loadDocument(new Uint8Array([1]), 'next.hwp');

    expect(currentDocumentGeneration()).toBe(before + 1);
  });

  it('advances generation immediately before creating a primary document', () => {
    const bridge = createBridge();
    const before = currentDocumentGeneration();

    bridge.createNewDocument();

    expect(currentDocumentGeneration()).toBe(before + 1);
  });

  it('does not advance generation for an auxiliary upstream bridge', () => {
    const bridge = new WasmBridge();
    const before = currentDocumentGeneration();

    bridge.loadDocument(new Uint8Array([1]), 'comparison.hwp');

    expect(currentDocumentGeneration()).toBe(before);
  });
});
