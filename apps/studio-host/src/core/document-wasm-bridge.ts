import { WasmBridge } from '@/upstream/core';
import type { DocumentInfo } from '@/upstream/core';
import { advanceDocumentGeneration } from './document-generation';

/**
 * Outcome hooks for one primary document replacement attempt. Upstream loads
 * atomically, so a failed attempt (password required, wrong password, corrupt
 * file) keeps the previous document and its editor state.
 */
export interface DocumentReplacementGuard {
  /** Runs synchronously after upstream committed the new document. */
  committed(): void;
  /** Runs when upstream rejected the new document and kept the previous one. */
  aborted(): void;
}

export type BeforeDocumentReplacement = () => DocumentReplacementGuard | void;

export class PrimaryDocumentWasmBridge extends WasmBridge {
  private beforeDocumentReplacement: BeforeDocumentReplacement | null = null;

  setBeforeDocumentReplacement(callback: BeforeDocumentReplacement): void {
    this.beforeDocumentReplacement = callback;
  }

  override loadDocument(data: Uint8Array, fileName?: string): DocumentInfo {
    return this.replaceDocument(() => super.loadDocument(data, fileName));
  }

  override loadDocumentWithPassword(data: Uint8Array, password: string, fileName?: string): void {
    this.replaceDocument(() => super.loadDocumentWithPassword(data, password, fileName));
  }

  override createNewDocument(): DocumentInfo {
    return this.replaceDocument(() => super.createNewDocument());
  }

  private replaceDocument<T>(replace: () => T): T {
    const guard = this.beforeDocumentReplacement?.();
    // Advancing on a failed attempt only invalidates pending document-bound
    // work, which is the fail-closed direction.
    advanceDocumentGeneration();
    let result: T;
    try {
      result = replace();
    } catch (error) {
      guard?.aborted();
      throw error;
    }
    guard?.committed();
    return result;
  }
}
