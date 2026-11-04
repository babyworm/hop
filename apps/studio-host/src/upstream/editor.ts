import { InputHandler } from '@upstream/engine/input-handler';

export { InputHandler };
export { CellSelectionRenderer } from '@upstream/engine/cell-selection-renderer';
export { TableObjectRenderer } from '@upstream/engine/table-object-renderer';
export { TableResizeRenderer } from '@upstream/engine/table-resize-renderer';
export {
  IMMEDIATE_TEXT_MUTATION_EFFECTS,
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
  clearSelection(): void;
  isInHeaderFooter(): boolean;
  isInFootnote(): boolean;
}

const guardedHistories = new WeakSet<object>();

export class RecoveredEditCommandError extends Error {
  readonly name = 'RecoveredEditCommandError';

  constructor(readonly operationError: unknown) {
    super('복구된 편집 명령을 다시 시도할 수 있도록 히스토리를 보존합니다.', {
      cause: operationError,
    });
  }
}

/**
 * HOP-only compatibility boundary for cursor operations that upstream does not
 * yet expose on InputHandler. Keep the private-field cast isolated here so an
 * upstream API change has one audited failure point.
 */
export function getInputHandlerCursorAccess(inputHandler: unknown): CursorAccess | null {
  const cursor: unknown = Reflect.get(Object(inputHandler), 'cursor');
  return isCursorAccess(cursor) ? cursor : null;
}

/**
 * Upstream currently pops before undo/redo invokes a command. Preserve only a
 * Hanja command that explicitly reports that its failed transition was fully
 * recovered; all other errors retain upstream behavior.
 */
export function installRecoveredCommandHistoryGuard(inputHandler: InputHandler): void {
  const history: unknown = Reflect.get(inputHandler, 'history');
  if (!history || typeof history !== 'object') {
    throw new Error('호환되는 편집 히스토리를 찾을 수 없습니다.');
  }
  if (guardedHistories.has(history)) return;

  historyStack(history, 'undoStack');
  historyStack(history, 'redoStack');
  wrapRecoveredHistoryMethod(history, 'undo', 'undoStack');
  wrapRecoveredHistoryMethod(history, 'redo', 'redoStack');
  guardedHistories.add(history);
}

function isCursorAccess(cursor: unknown): cursor is CursorAccess {
  return !!cursor && typeof cursor === 'object' &&
    typeof Reflect.get(cursor, 'clearSelection') === 'function' &&
    typeof Reflect.get(cursor, 'isInHeaderFooter') === 'function' &&
    typeof Reflect.get(cursor, 'isInFootnote') === 'function';
}

function historyStack(history: object, field: 'undoStack' | 'redoStack'): unknown[] {
  const stack: unknown = Reflect.get(history, field);
  if (!Array.isArray(stack)) throw new Error(`호환되는 ${field}을 찾을 수 없습니다.`);
  return stack;
}

function wrapRecoveredHistoryMethod(
  history: object,
  methodName: 'undo' | 'redo',
  sourceField: 'undoStack' | 'redoStack',
): void {
  const original: unknown = Reflect.get(history, methodName);
  if (typeof original !== 'function') {
    throw new Error(`호환되는 히스토리 ${methodName} 동작을 찾을 수 없습니다.`);
  }
  const guarded = (...args: unknown[]) => {
    const sourceStack = historyStack(history, sourceField);
    const sourceLength = sourceStack.length;
    const command = sourceStack[sourceLength - 1];
    try {
      return Reflect.apply(original, history, args);
    } catch (error) {
      if (!(error instanceof RecoveredEditCommandError)) throw error;
      if (command === undefined || sourceStack.length !== sourceLength - 1) {
        throw new Error('복구된 편집 명령의 히스토리 상태가 예상과 다릅니다.', { cause: error });
      }
      sourceStack.push(command);
      throw error.operationError;
    }
  };
  if (!Reflect.set(history, methodName, guarded)) {
    throw new Error(`히스토리 ${methodName} 보호 동작을 설치하지 못했습니다.`);
  }
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
