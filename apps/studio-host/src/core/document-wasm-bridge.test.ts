import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WasmBridge } from '@/upstream/core';
import { createBridge } from './bridge-factory';
import { currentDocumentGeneration, onDocumentGenerationChange } from './document-generation';
import { PrimaryDocumentWasmBridge } from './document-wasm-bridge';

const observeUpstreamReplacement = vi.hoisted(() => vi.fn());

vi.mock('@/core/wasm-bridge', () => ({
  WasmBridge: class {
    loadDocument(_data: Uint8Array, _fileName?: string) {
      observeUpstreamReplacement();
      return { pageCount: 1, fontsUsed: [] };
    }

    createNewDocument() {
      observeUpstreamReplacement();
      return { pageCount: 1, fontsUsed: [] };
    }
  },
}));

describe('primary document bridge generation', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    observeUpstreamReplacement.mockReset();
  });

  it.each([
    ['loading', (bridge: PrimaryDocumentWasmBridge) => bridge.loadDocument(new Uint8Array([1]), 'next.hwp')],
    ['creating', (bridge: PrimaryDocumentWasmBridge) => bridge.createNewDocument()],
  ])('holds old input before %s replaces the upstream document', (_operation, replaceDocument) => {
    const bridge = new PrimaryDocumentWasmBridge();
    const inputLease = { active: true };
    const getCommandInput = () => inputLease.active ? inputLease : null;
    const observedOrder: string[] = [];
    bridge.setBeforeDocumentReplacement(() => {
      inputLease.active = false;
      observedOrder.push('guard');
    });
    const stopObservingGeneration = onDocumentGenerationChange(() => {
      expect(getCommandInput()).toBeNull();
      observedOrder.push('generation');
    });
    observeUpstreamReplacement.mockImplementation(() => {
      expect(getCommandInput()).toBeNull();
      observedOrder.push('upstream');
    });

    try {
      replaceDocument(bridge);
    } finally {
      stopObservingGeneration();
    }

    expect(observedOrder).toEqual(['guard', 'generation', 'upstream']);
    expect(observeUpstreamReplacement).toHaveBeenCalledOnce();
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
