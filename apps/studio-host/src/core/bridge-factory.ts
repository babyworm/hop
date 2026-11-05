import { PrimaryDocumentWasmBridge } from './document-wasm-bridge';
import { TauriBridge } from './tauri-bridge';

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined'
    && (
      '__TAURI_INTERNALS__' in window
      || window.location?.protocol === 'tauri:'
    );
}

export function createBridge(): PrimaryDocumentWasmBridge {
  if (isTauriRuntime()) {
    return new TauriBridge();
  }
  return new PrimaryDocumentWasmBridge();
}
