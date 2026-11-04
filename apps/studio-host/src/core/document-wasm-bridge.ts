import { WasmBridge } from '@/upstream/core';
import type { DocumentInfo } from '@/upstream/core';
import { advanceDocumentGeneration } from './document-generation';

export class PrimaryDocumentWasmBridge extends WasmBridge {
  private beforeDocumentReplacement: (() => void) | null = null;

  setBeforeDocumentReplacement(callback: () => void): void {
    this.beforeDocumentReplacement = callback;
  }

  private prepareDocumentReplacement(): void {
    this.beforeDocumentReplacement?.();
    advanceDocumentGeneration();
  }

  override loadDocument(data: Uint8Array, fileName?: string): DocumentInfo {
    this.prepareDocumentReplacement();
    return super.loadDocument(data, fileName);
  }

  override createNewDocument(): DocumentInfo {
    this.prepareDocumentReplacement();
    return super.createNewDocument();
  }
}
