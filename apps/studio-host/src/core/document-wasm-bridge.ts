import { WasmBridge } from '@/upstream/core';
import type { DocumentInfo } from '@/upstream/core';
import { advanceDocumentGeneration } from './document-generation';

export class PrimaryDocumentWasmBridge extends WasmBridge {
  override loadDocument(data: Uint8Array, fileName?: string): DocumentInfo {
    advanceDocumentGeneration();
    return super.loadDocument(data, fileName);
  }

  override createNewDocument(): DocumentInfo {
    advanceDocumentGeneration();
    return super.createNewDocument();
  }
}
