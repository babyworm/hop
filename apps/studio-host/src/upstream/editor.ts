import { InputHandler } from '@upstream/engine/input-handler';

export { InputHandler };
export { CellSelectionRenderer } from '@upstream/engine/cell-selection-renderer';
export { TableObjectRenderer } from '@upstream/engine/table-object-renderer';
export { TableResizeRenderer } from '@upstream/engine/table-resize-renderer';
export {
  DeleteTextCommand,
  IMMEDIATE_TEXT_MUTATION_EFFECTS,
  InsertTextCommand,
  NO_TEXT_MUTATION_EFFECTS,
} from '@upstream/engine/command';
export type { EditCommand, TextMutationEffects } from '@upstream/engine/command';

export type InputHandlerShortcutCaptureState = {
  readonly editorInput: EventTarget | null;
  readonly isEditorActive: boolean;
  readonly isInternallyComposing: boolean;
  readonly hasActivePlacementMode: boolean;
  readonly editorInputHasFocus: boolean;
};

interface CursorAccess {
  clearSelection?: () => void;
  isInHeaderFooter?: () => boolean;
  isInFootnote?: () => boolean;
}

/**
 * HOP-only compatibility boundary for cursor operations that upstream does not
 * yet expose on InputHandler. Keep the private-field cast isolated here so an
 * upstream API change has one audited failure point.
 */
export function getInputHandlerCursorAccess(inputHandler: unknown): CursorAccess | null {
  const cursor = (inputHandler as { cursor?: CursorAccess }).cursor;
  return cursor && typeof cursor === 'object' ? cursor : null;
}

/**
 * Audited HOP compatibility boundary for the capture-phase F9 exception.
 * These private upstream fields must be rechecked whenever InputHandler changes.
 */
export function getInputHandlerShortcutCaptureState(
  inputHandler: InputHandler | null,
): InputHandlerShortcutCaptureState {
  if (inputHandler === null) {
    return {
      editorInput: null,
      isEditorActive: false,
      isInternallyComposing: false,
      hasActivePlacementMode: false,
      editorInputHasFocus: false,
    };
  }

  const editorInput: unknown = Reflect.get(inputHandler, 'textarea');
  return {
    editorInput: editorInput instanceof EventTarget ? editorInput : null,
    isEditorActive: inputHandler.isActive(),
    isInternallyComposing:
      privateStateMayBeActive(inputHandler, 'isComposing') ||
      privateStateMayBeActive(inputHandler, '_iosComposing'),
    hasActivePlacementMode:
      privateStateMayBeActive(inputHandler, 'imagePlacementMode') ||
      privateStateMayBeActive(inputHandler, 'textboxPlacementMode') ||
      privateStateMayBeActive(inputHandler, 'connectorDrawingMode') ||
      privateStateMayBeActive(inputHandler, 'polygonDrawingMode'),
    editorInputHasFocus:
      typeof document !== 'undefined' && document.activeElement === editorInput,
  };
}

function privateStateMayBeActive(inputHandler: InputHandler, field: string): boolean {
  return Reflect.get(inputHandler, field) !== false;
}
