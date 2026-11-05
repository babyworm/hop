import type { BeforeDocumentReplacement } from '../core/document-wasm-bridge';

interface DocumentReplacementGuardDependencies {
  getInputHandler: () => { deactivate(): void } | null;
  getToolbar: () => { setEnabled(enabled: boolean): void } | null;
  hasLoadedDocument: () => boolean;
}

export interface DocumentReplacementInputGuard {
  readonly beforeReplacement: BeforeDocumentReplacement;
  /** True only while upstream is replacing the primary document. */
  isReplacing(): boolean;
}

/**
 * Holds editor command input while the primary document is replaced.
 *
 * Upstream InputHandler.deactivate() also clears undo history, so it must run
 * only once the replacement has committed. A rejected attempt (password prompt
 * required or cancelled, corrupt file) keeps the previous document editable.
 */
export function createDocumentReplacementInputGuard(
  deps: DocumentReplacementGuardDependencies,
): DocumentReplacementInputGuard {
  let replacing = false;

  const beforeReplacement: BeforeDocumentReplacement = () => {
    replacing = true;
    deps.getToolbar()?.setEnabled(false);
    return {
      committed: () => {
        replacing = false;
        deps.getInputHandler()?.deactivate();
      },
      aborted: () => {
        replacing = false;
        if (deps.hasLoadedDocument()) deps.getToolbar()?.setEnabled(true);
      },
    };
  };

  return { beforeReplacement, isReplacing: () => replacing };
}
