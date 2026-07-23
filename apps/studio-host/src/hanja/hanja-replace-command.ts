import type { DocumentPosition, WasmBridge } from '@/upstream/core';
import type { EditCommand, TextMutationEffects } from '../upstream/editor';
import {
  IMMEDIATE_TEXT_MUTATION_EFFECTS,
  NO_TEXT_MUTATION_EFFECTS,
  RecoveredEditCommandError,
} from '../upstream/editor';
import {
  deleteHanjaTextImmediate,
  getHanjaParagraphLength,
  insertHanjaTextImmediate,
  readHanjaText,
} from './hanja-editor-text-access';

type CharShapeRun = { start: number; end: number; charShapeId: number };
type StyleRuns = { readonly original: readonly CharShapeRun[]; readonly replacement: readonly CharShapeRun[] };

type TextStyleTransition = {
  readonly sourceText: string; readonly sourceLength: number;
  readonly sourceRuns: readonly CharShapeRun[]; readonly targetText: string;
  readonly targetLength: number; readonly targetRuns: readonly CharShapeRun[];
  readonly preserveHistoryOnRecovery: boolean;
};

type TransitionDocumentState = 'source' | 'staged' | 'target' | 'unknown';

const MAX_RECOVERY_STEPS = 6;

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
      preserveHistoryOnRecovery: this.state === 'undone',
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
      preserveHistoryOnRecovery: true,
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
    if (transition.preserveHistoryOnRecovery) {
      throw new RecoveredEditCommandError(error.operationError);
    }
    throw error.operationError;
  }
}

function applyTransitionOnce(
  wasm: WasmBridge,
  position: DocumentPosition,
  transition: TextStyleTransition,
): TextMutationEffects {
  const sourceParagraphLength = getHanjaParagraphLength(wasm, position);
  if (!transitionStateMatches(
    wasm,
    position,
    transition,
    sourceParagraphLength,
    'source',
    transition.sourceRuns,
  )) {
    throw new Error('변환할 원문 상태가 예상과 다릅니다.');
  }
  try {
    insertHanjaTextImmediate(
      wasm,
      advancedPosition(position, transition.sourceLength),
      transition.targetText,
    );
    deleteHanjaTextImmediate(wasm, position, transition.sourceLength);
    applyRuns(wasm, position, transition.targetRuns);
    if (!transitionStateMatches(
      wasm,
      position,
      transition,
      sourceParagraphLength,
      'target',
      transition.targetRuns,
    )) {
      throw new Error('한자 변환 결과를 확인할 수 없습니다.');
    }
    return IMMEDIATE_TEXT_MUTATION_EFFECTS;
  } catch (error) {
    restoreTransitionSource(wasm, position, transition, sourceParagraphLength, error);
    throw new RecoveredTransitionError(error);
  }
}

function restoreTransitionSource(
  wasm: WasmBridge,
  position: DocumentPosition,
  transition: TextStyleTransition,
  sourceParagraphLength: number,
  operationError: unknown,
): void {
  let lastRecoveryError: unknown;
  for (let step = 0; step < MAX_RECOVERY_STEPS; step += 1) {
    const state = transitionDocumentState(wasm, position, transition, sourceParagraphLength);
    try {
      if (state === 'staged') {
        deleteHanjaTextImmediate(
          wasm,
          advancedPosition(position, transition.sourceLength),
          transition.targetLength,
        );
      } else if (state === 'target') {
        insertHanjaTextImmediate(wasm, position, transition.sourceText);
      } else if (state === 'source') {
        applyRunsRecoverably(wasm, position, transition.sourceRuns);
      } else {
        throw new Error('복구할 문서 상태를 판별할 수 없습니다.');
      }
    } catch (error) {
      lastRecoveryError = error;
    }

    if (transitionStateMatches(
      wasm,
      position,
      transition,
      sourceParagraphLength,
      'source',
      transition.sourceRuns,
    )) return;
  }

  throw new AggregateError(
    [operationError, lastRecoveryError].filter((error) => error !== undefined),
    '한자 변환 실패 후 문서 상태를 복원하지 못했습니다.',
  );
}

function transitionStateMatches(
  wasm: WasmBridge,
  position: DocumentPosition,
  transition: TextStyleTransition,
  sourceParagraphLength: number,
  expectedState: 'source' | 'target',
  expectedRuns: readonly CharShapeRun[],
): boolean {
  try {
    return transitionDocumentState(wasm, position, transition, sourceParagraphLength) === expectedState &&
      charShapeRunsMatch(wasm, position, expectedRuns);
  } catch {
    return false;
  }
}

function transitionDocumentState(
  wasm: WasmBridge,
  position: DocumentPosition,
  transition: TextStyleTransition,
  sourceParagraphLength: number,
): TransitionDocumentState {
  const paragraphLength = getHanjaParagraphLength(wasm, position);
  const targetParagraphLength = sourceParagraphLength - transition.sourceLength +
    transition.targetLength;
  if (
    paragraphLength === sourceParagraphLength &&
    readHanjaText(wasm, position, transition.sourceLength) === transition.sourceText
  ) return 'source';
  if (
    paragraphLength === sourceParagraphLength + transition.targetLength &&
    readHanjaText(wasm, position, transition.sourceLength) === transition.sourceText &&
    readHanjaText(
      wasm,
      advancedPosition(position, transition.sourceLength),
      transition.targetLength,
    ) === transition.targetText
  ) return 'staged';
  if (
    paragraphLength === targetParagraphLength &&
    readHanjaText(wasm, position, transition.targetLength) === transition.targetText
  ) return 'target';
  return 'unknown';
}

function charShapeRunsMatch(
  wasm: WasmBridge,
  position: DocumentPosition,
  runs: readonly CharShapeRun[],
): boolean {
  return runs.every((run) => charShapeRunMatches(wasm, position, run));
}

function charShapeRunMatches(
  wasm: WasmBridge,
  position: DocumentPosition,
  run: CharShapeRun,
): boolean {
  for (let index = run.start; index < run.end; index += 1) {
    if (charShapeIdAt(wasm, position, index) !== run.charShapeId) return false;
  }
  return true;
}

function charShapeIdAt(
  wasm: WasmBridge,
  position: DocumentPosition,
  relativeOffset: number,
): number | undefined {
  const offset = position.charOffset + relativeOffset;
  if (position.parentParaIndex === undefined) {
    return wasm.getCharPropertiesAt(
      position.sectionIndex,
      position.paragraphIndex,
      offset,
    ).charShapeId;
  }
  return wasm.getCellCharPropertiesAt(
    position.sectionIndex,
    position.parentParaIndex,
    position.controlIndex!,
    position.cellIndex!,
    position.cellParaIndex!,
    offset,
  ).charShapeId;
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
    applyRun(wasm, position, run);
  }
}

function applyRunsRecoverably(
  wasm: WasmBridge,
  position: DocumentPosition,
  runs: readonly CharShapeRun[],
): void {
  for (const run of runs) {
    if (charShapeRunMatches(wasm, position, run)) continue;
    try {
      applyRun(wasm, position, run);
    } catch (error) {
      if (!charShapeRunMatches(wasm, position, run)) throw error;
    }
  }
}

function applyRun(wasm: WasmBridge, position: DocumentPosition, run: CharShapeRun): void {
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

function advancedPosition(position: DocumentPosition, count: number): DocumentPosition {
  return { ...position, charOffset: position.charOffset + count };
}

function characterCount(value: string): number {
  return Array.from(value).length;
}
