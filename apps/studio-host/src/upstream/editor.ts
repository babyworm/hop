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
