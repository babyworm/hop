import { describe, expect, it, vi } from 'vitest';
import { createDocumentReplacementInputGuard } from './document-replacement-guard';

function setup(hasLoadedDocument: boolean) {
  const inputHandler = { deactivate: vi.fn() };
  const toolbar = { setEnabled: vi.fn() };
  const guard = createDocumentReplacementInputGuard({
    getInputHandler: () => inputHandler,
    getToolbar: () => toolbar,
    hasLoadedDocument: () => hasLoadedDocument,
  });
  return { guard, inputHandler, toolbar };
}

describe('createDocumentReplacementInputGuard', () => {
  it('holds command input without clearing editor state until replacement commits', () => {
    const { guard, inputHandler, toolbar } = setup(true);

    const outcome = guard.beforeReplacement();

    expect(guard.isReplacing()).toBe(true);
    expect(toolbar.setEnabled).toHaveBeenCalledWith(false);
    expect(inputHandler.deactivate).not.toHaveBeenCalled();

    outcome?.committed();

    expect(guard.isReplacing()).toBe(false);
    expect(inputHandler.deactivate).toHaveBeenCalledOnce();
  });

  it('keeps the previous document editable when replacement is rejected', () => {
    const { guard, inputHandler, toolbar } = setup(true);

    guard.beforeReplacement()?.aborted();

    expect(guard.isReplacing()).toBe(false);
    expect(inputHandler.deactivate).not.toHaveBeenCalled();
    expect(toolbar.setEnabled).toHaveBeenLastCalledWith(true);
  });

  it('leaves the toolbar disabled when a rejected first open has no document', () => {
    const { guard, toolbar } = setup(false);

    guard.beforeReplacement()?.aborted();

    expect(toolbar.setEnabled).toHaveBeenCalledOnce();
    expect(toolbar.setEnabled).toHaveBeenCalledWith(false);
  });
});
