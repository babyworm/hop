import type { DocumentPosition, WasmBridge } from '@/upstream/core';
import type { EditCommand, TextMutationEffects } from '../upstream/editor';
import {
  DeleteTextCommand,
  IMMEDIATE_TEXT_MUTATION_EFFECTS,
  InsertTextCommand,
  NO_TEXT_MUTATION_EFFECTS,
} from '../upstream/editor';

type CharShapeRun = { start: number; end: number; charShapeId: number };
type StyleRuns = { readonly original: readonly CharShapeRun[]; readonly replacement: readonly CharShapeRun[] };

type TextStyleTransition = {
  readonly sourceText: string; readonly sourceLength: number;
  readonly sourceRuns: readonly CharShapeRun[]; readonly targetText: string;
  readonly targetLength: number; readonly targetRuns: readonly CharShapeRun[];
  readonly retry: boolean;
};

export class HanjaReplaceCommand implements EditCommand {
  readonly type = 'replaceText';
  readonly timestamp = Date.now();
  private styleRuns: StyleRuns | null = null;
  private state: 'ready' | 'applied' | 'undone' = 'ready';
  private effects: TextMutationEffects = NO_TEXT_MUTATION_EFFECTS;

  constructor(
    private readonly position: DocumentPosition,
    private readonly sourceText: string,
    private readonly originalText: string,
    private readonly originalLength: number,
    private readonly replacementText: string,
  ) {}

  execute(wasm: WasmBridge): DocumentPosition {
    if (this.state === 'applied') throw new Error('이미 실행된 한자 변환입니다.');
    const runs = this.ensureStyleRuns(wasm);
    const transition = {
      sourceText: this.originalText,
      sourceLength: this.originalLength,
      sourceRuns: runs.original,
      targetText: this.replacementText,
      targetLength: characterCount(this.replacementText),
      targetRuns: runs.replacement,
      retry: this.state === 'undone',
    } satisfies TextStyleTransition;

    this.effects = NO_TEXT_MUTATION_EFFECTS;
    this.effects = applyTransition(wasm, this.position, transition);
    this.state = 'applied';
    return advancedPosition(this.position, transition.targetLength);
  }

  undo(wasm: WasmBridge): DocumentPosition {
    if (this.state !== 'applied' || !this.styleRuns) {
      throw new Error('실행되지 않은 한자 변환은 되돌릴 수 없습니다.');
    }
    const transition = {
      sourceText: this.replacementText,
      sourceLength: characterCount(this.replacementText),
      sourceRuns: this.styleRuns.replacement,
      targetText: this.originalText,
      targetLength: this.originalLength,
      targetRuns: this.styleRuns.original,
      retry: true,
    } satisfies TextStyleTransition;

    this.effects = NO_TEXT_MUTATION_EFFECTS;
    applyTransition(wasm, this.position, transition);
    this.effects = IMMEDIATE_TEXT_MUTATION_EFFECTS;
    this.state = 'undone';
    return advancedPosition(this.position, this.originalLength);
  }

  consumeTextMutationEffects(): TextMutationEffects {
    const effects = this.effects;
    this.effects = NO_TEXT_MUTATION_EFFECTS;
    return effects;
  }

  mergeWith(): null {
    return null;
  }

  private ensureStyleRuns(wasm: WasmBridge): StyleRuns {
    if (this.styleRuns) return this.styleRuns;
    const sourceLength = characterCount(this.sourceText);
    if (characterCount(this.replacementText) !== sourceLength) {
      throw new Error('원문과 대체 한자의 글자 수가 다릅니다.');
    }
    if (characterCount(this.originalText) !== this.originalLength) {
      throw new Error('원문의 문서 글자 수를 확인할 수 없습니다.');
    }

    const originalIds = captureCharShapeIds(wasm, this.position, this.originalLength);
    const replacementIds = mapNormalizedStyles(this.originalText, this.sourceText, originalIds);
    this.styleRuns = {
      original: compressRuns(originalIds),
      replacement: compressRuns(replacementIds),
    };
    return this.styleRuns;
  }
}

class RecoveredTransitionError extends Error {
  readonly name = 'RecoveredTransitionError';

  constructor(readonly operationError: unknown) {
    super('한자 변환 중 실패한 문서 상태를 복원했습니다.', { cause: operationError });
  }
}

function applyTransition(
  wasm: WasmBridge,
  position: DocumentPosition,
  transition: TextStyleTransition,
): TextMutationEffects {
  try {
    return applyTransitionOnce(wasm, position, transition);
  } catch (error) {
    if (!(error instanceof RecoveredTransitionError)) throw error;
    if (!transition.retry) throw error.operationError;
  }
  try {
    return applyTransitionOnce(wasm, position, transition);
  } catch (error) {
    if (error instanceof RecoveredTransitionError) throw error.operationError;
    throw error;
  }
}

function applyTransitionOnce(
  wasm: WasmBridge,
  position: DocumentPosition,
  transition: TextStyleTransition,
): TextMutationEffects {
  const deletion = new DeleteTextCommand(
    position,
    transition.sourceLength,
    'forward',
    transition.sourceText,
  );
  const insertion = new InsertTextCommand(position, transition.targetText);
  let sourceDeleted = false;
  let targetInserted = false;
  try {
    deletion.execute(wasm);
    sourceDeleted = true;
    insertion.execute(wasm);
    targetInserted = true;
    applyRuns(wasm, position, transition.targetRuns);
    return mergeEffects(
      deletion.consumeTextMutationEffects(),
      insertion.consumeTextMutationEffects(),
    );
  } catch (error) {
    if (targetInserted) {
      new DeleteTextCommand(
        position,
        transition.targetLength,
        'forward',
        transition.targetText,
      ).execute(wasm);
    }
    if (sourceDeleted) new InsertTextCommand(position, transition.sourceText).execute(wasm);
    applyRuns(wasm, position, transition.sourceRuns);
    throw new RecoveredTransitionError(error);
  }
}

function captureCharShapeIds(
  wasm: WasmBridge,
  position: DocumentPosition,
  length: number,
): number[] {
  if ((position.cellPath?.length ?? 0) > 1) {
    throw new Error('중첩 표 셀의 문자 서식은 안전하게 복원할 수 없습니다.');
  }
  return Array.from({ length }, (_, index) => {
    const offset = position.charOffset + index;
    const props = position.parentParaIndex === undefined
      ? wasm.getCharPropertiesAt(position.sectionIndex, position.paragraphIndex, offset)
      : wasm.getCellCharPropertiesAt(
          position.sectionIndex,
          position.parentParaIndex,
          position.controlIndex!,
          position.cellIndex!,
          position.cellParaIndex!,
          offset,
        );
    if (!Number.isInteger(props.charShapeId)) {
      throw new Error('원문의 문자 서식을 확인할 수 없습니다.');
    }
    return props.charShapeId!;
  });
}

function mapNormalizedStyles(originalText: string, sourceText: string, originalIds: number[]): number[] {
  const originalCharacters = Array.from(originalText);
  const sourceLength = characterCount(sourceText);
  const mapped: number[] = [];
  let prefix = '';

  originalCharacters.forEach((character, index) => {
    prefix += character;
    const normalizedLength = characterCount(prefix.normalize('NFC'));
    while (mapped.length < normalizedLength && mapped.length < sourceLength) {
      mapped.push(originalIds[index]!);
    }
  });

  if (mapped.length !== sourceLength || originalText.normalize('NFC') !== sourceText) {
    throw new Error('정규화된 원문의 문자 서식을 매핑할 수 없습니다.');
  }
  return mapped;
}

function compressRuns(ids: number[]): CharShapeRun[] {
  const runs: CharShapeRun[] = [];
  ids.forEach((charShapeId, index) => {
    const previous = runs[runs.length - 1];
    if (previous?.charShapeId === charShapeId) {
      previous.end = index + 1;
    } else {
      runs.push({ start: index, end: index + 1, charShapeId });
    }
  });
  return runs;
}

function applyRuns(wasm: WasmBridge, position: DocumentPosition, runs: readonly CharShapeRun[]): void {
  for (const run of runs) {
    const start = position.charOffset + run.start;
    const end = position.charOffset + run.end;
    if (position.parentParaIndex === undefined) {
      wasm.setCharShapeId(
        position.sectionIndex,
        position.paragraphIndex,
        start,
        end,
        run.charShapeId,
      );
    } else {
      wasm.setCharShapeIdInCell(
        position.sectionIndex,
        position.parentParaIndex,
        position.controlIndex!,
        position.cellIndex!,
        position.cellParaIndex!,
        start,
        end,
        run.charShapeId,
      );
    }
  }
}

function mergeEffects(first: TextMutationEffects, second: TextMutationEffects): TextMutationEffects {
  return {
    deferredPagination: first.deferredPagination || second.deferredPagination,
    cellFlowChanged: first.cellFlowChanged || second.cellFlowChanged,
    paginationCompleted: first.paginationCompleted || second.paginationCompleted,
  };
}

function advancedPosition(position: DocumentPosition, count: number): DocumentPosition {
  return { ...position, charOffset: position.charOffset + count };
}

function characterCount(value: string): number {
  return Array.from(value).length;
}
