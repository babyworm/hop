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

    loadDocumentWithPassword(_data: Uint8Array, _password: string, _fileName?: string) {
      observeUpstreamReplacement();
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

  const replacements = [
    ['loading', (bridge: PrimaryDocumentWasmBridge) => bridge.loadDocument(new Uint8Array([1]), 'next.hwp')],
    [
      'password loading',
      (bridge: PrimaryDocumentWasmBridge) => bridge.loadDocumentWithPassword(
        new Uint8Array([1]),
        'secret',
        'locked.hwp',
      ),
    ],
    ['creating', (bridge: PrimaryDocumentWasmBridge) => bridge.createNewDocument()],
  ] as const;

  it.each(replacements)('holds old input before %s replaces the upstream document', (_operation, replaceDocument) => {
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

  it.each(replacements)('commits the replacement guard after %s succeeds', (_operation, replaceDocument) => {
    const bridge = new PrimaryDocumentWasmBridge();
    const observedOrder: string[] = [];
    bridge.setBeforeDocumentReplacement(() => ({
      committed: () => observedOrder.push('committed'),
      aborted: () => observedOrder.push('aborted'),
    }));
    observeUpstreamReplacement.mockImplementation(() => observedOrder.push('upstream'));

    replaceDocument(bridge);

    expect(observedOrder).toEqual(['upstream', 'committed']);
  });

  it('aborts the replacement guard when upstream keeps the previous document', () => {
    const bridge = new PrimaryDocumentWasmBridge();
    const committed = vi.fn();
    const aborted = vi.fn();
    bridge.setBeforeDocumentReplacement(() => ({ committed, aborted }));
    observeUpstreamReplacement.mockImplementation(() => {
      throw new Error('비밀번호가 필요한 암호 문서');
    });
    const before = currentDocumentGeneration();

    expect(() => bridge.loadDocument(new Uint8Array([1]), 'locked.hwp'))
      .toThrow('비밀번호가 필요한 암호 문서');
    expect(aborted).toHaveBeenCalledOnce();
    expect(committed).not.toHaveBeenCalled();
    expect(currentDocumentGeneration()).toBe(before + 1);
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
