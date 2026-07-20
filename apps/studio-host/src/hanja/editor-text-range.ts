import type { CommandServices } from '@/upstream/commands';
import type { DocumentPosition, WasmBridge } from '@/upstream/core';
import { currentDocumentGeneration } from '../core/document-generation';
import type { EditCommand, TextMutationEffects } from '../upstream/editor';
import {
  DeleteTextCommand,
  getInputHandlerCursorAccess,
  IMMEDIATE_TEXT_MUTATION_EFFECTS,
  InsertTextCommand,
  NO_TEXT_MUTATION_EFFECTS,
} from '../upstream/editor';

interface ConversionInputHandler {
  getSelection(): { start: DocumentPosition; end: DocumentPosition } | null;
  getCursorPosition(): DocumentPosition;
  executeOperation(descriptor: { kind: 'command'; command: EditCommand }): void;
}

export interface HanjaConversionSource {
  text: string;
  originalText: string;
  rangeLength: number;
  start: DocumentPosition;
  end: DocumentPosition;
  documentGeneration: number;
  fingerprint: string;
  selected: boolean;
}

export class HanjaEditorRangeError extends Error {
  constructor(
    readonly code: 'no-editor' | 'unsupported-context' | 'invalid-selection' | 'no-hangul',
    message: string,
  ) {
    super(message);
    this.name = 'HanjaEditorRangeError';
  }
}

export function findHangulWordRange(
  paragraphText: string,
  cursorOffset: number,
): { start: number; end: number; text: string } | null {
  const characters = Array.from(paragraphText);
  const offset = Math.max(0, Math.min(characters.length, cursorOffset));
  let index = offset;
  if (!isHangulAt(characters, index) && isHangulAt(characters, index - 1)) index -= 1;
  if (!isHangulAt(characters, index)) return null;

  let start = index;
  let end = index + 1;
  while (start > 0 && isHangulAt(characters, start - 1)) start -= 1;
  while (end < characters.length && isHangulAt(characters, end)) end += 1;
  return { start, end, text: characters.slice(start, end).join('') };
}

export function readConversionSource(
  services: Pick<CommandServices, 'wasm' | 'getInputHandler'>,
): HanjaConversionSource {
  const inputHandler = services.getInputHandler() as ConversionInputHandler | null;
  if (!inputHandler) {
    throw new HanjaEditorRangeError('no-editor', '변환할 문서가 없습니다.');
  }
  const cursorAccess = getInputHandlerCursorAccess(inputHandler);
  if (cursorAccess?.isInHeaderFooter?.() || cursorAccess?.isInFootnote?.()) {
    throw new HanjaEditorRangeError(
      'unsupported-context',
      '머리말·꼬리말·각주에서는 아직 한자 변환을 지원하지 않습니다.',
    );
  }

  const selection = inputHandler.getSelection();
  if (selection) {
    assertSameTextContainer(selection.start, selection.end);
    const count = selection.end.charOffset - selection.start.charOffset;
    if (count <= 0) {
      throw new HanjaEditorRangeError('invalid-selection', '변환할 글자를 선택해 주세요.');
    }
    const text = readText(services.wasm, selection.start, count);
    return sourceFrom(text, selection.start, selection.end, true);
  }

  const cursor = inputHandler.getCursorPosition();
  const paragraphText = readParagraph(services.wasm, cursor);
  const word = findHangulWordRange(paragraphText, cursor.charOffset);
  if (!word) {
    throw new HanjaEditorRangeError('no-hangul', '한글 단어를 선택하거나 단어 안에 커서를 놓아 주세요.');
  }
  const start = { ...cursor, charOffset: word.start };
  const end = { ...cursor, charOffset: word.end };
  return sourceFrom(word.text, start, end, false);
}

export function isConversionSourceCurrent(
  services: Pick<CommandServices, 'wasm' | 'getInputHandler'>,
  expected: HanjaConversionSource,
): boolean {
  try {
    const current = readConversionSource(services);
    return current.fingerprint === expected.fingerprint;
  } catch {
    return false;
  }
}

export function replaceConversionSource(
  inputHandler: ConversionInputHandler,
  source: HanjaConversionSource,
  replacement: string,
): boolean {
  if (!replacement || replacement === source.text) return false;
  getInputHandlerCursorAccess(inputHandler)?.clearSelection?.();
  inputHandler.executeOperation({
    kind: 'command',
    command: new ReplaceTextCommand(
      source.start,
      source.originalText,
      source.rangeLength,
      replacement,
    ),
  });
  return true;
}

class ReplaceTextCommand implements EditCommand {
  readonly type = 'replaceText';
  readonly timestamp = Date.now();
  private readonly deleteCommand: DeleteTextCommand;
  private readonly insertCommand: InsertTextCommand;
  private readonly deleteReplacementCommand: DeleteTextCommand;
  private effects: TextMutationEffects = NO_TEXT_MUTATION_EFFECTS;

  constructor(
    private readonly position: DocumentPosition,
    private readonly originalText: string,
    private readonly originalLength: number,
    private readonly replacementText: string,
  ) {
    this.deleteCommand = new DeleteTextCommand(position, originalLength, 'forward', originalText);
    this.insertCommand = new InsertTextCommand(position, replacementText);
    this.deleteReplacementCommand = new DeleteTextCommand(
      position,
      characterCount(replacementText),
      'forward',
      replacementText,
    );
  }

  execute(wasm: WasmBridge): DocumentPosition {
    this.deleteCommand.execute(wasm);
    this.insertCommand.execute(wasm);
    this.effects = mergeEffects(
      this.deleteCommand.consumeTextMutationEffects(),
      this.insertCommand.consumeTextMutationEffects(),
    );
    return { ...this.position, charOffset: this.position.charOffset + characterCount(this.replacementText) };
  }

  undo(wasm: WasmBridge): DocumentPosition {
    this.deleteReplacementCommand.execute(wasm);
    this.deleteCommand.undo(wasm);
    this.effects = IMMEDIATE_TEXT_MUTATION_EFFECTS;
    return { ...this.position, charOffset: this.position.charOffset + this.originalLength };
  }

  consumeTextMutationEffects(): TextMutationEffects {
    const effects = this.effects;
    this.effects = NO_TEXT_MUTATION_EFFECTS;
    return effects;
  }

  mergeWith(): null {
    return null;
  }
}

function mergeEffects(first: TextMutationEffects, second: TextMutationEffects): TextMutationEffects {
  if (first === NO_TEXT_MUTATION_EFFECTS) return second;
  if (second === NO_TEXT_MUTATION_EFFECTS) return first;
  return {
    deferredPagination: first.deferredPagination || second.deferredPagination,
    cellFlowChanged: first.cellFlowChanged || second.cellFlowChanged,
    paginationCompleted: first.paginationCompleted || second.paginationCompleted,
  };
}

function sourceFrom(
  text: string,
  start: DocumentPosition,
  end: DocumentPosition,
  selected: boolean,
): HanjaConversionSource {
  const normalized = text.normalize('NFC');
  if (!/^[가-힣]+$/u.test(normalized)) {
    throw new HanjaEditorRangeError('no-hangul', '한글 음절로 이루어진 단어만 변환할 수 있습니다.');
  }
  const source = {
    text: normalized,
    originalText: text,
    rangeLength: end.charOffset - start.charOffset,
    start: { ...start },
    end: { ...end },
    documentGeneration: currentDocumentGeneration(),
    selected,
  };
  return { ...source, fingerprint: fingerprint(source) };
}

function readParagraph(wasm: WasmBridge, position: DocumentPosition): string {
  const cellPath = position.cellPath ?? [];
  if (cellPath.length > 1) {
    const path = JSON.stringify(cellPath);
    const length = wasm.getCellParagraphLengthByPath(
      position.sectionIndex,
      position.parentParaIndex!,
      path,
    );
    return wasm.getTextInCellByPath(position.sectionIndex, position.parentParaIndex!, path, 0, length);
  }
  if (position.parentParaIndex !== undefined) {
    const length = wasm.getCellParagraphLength(
      position.sectionIndex,
      position.parentParaIndex,
      position.controlIndex!,
      position.cellIndex!,
      position.cellParaIndex!,
    );
    return wasm.getTextInCell(
      position.sectionIndex,
      position.parentParaIndex,
      position.controlIndex!,
      position.cellIndex!,
      position.cellParaIndex!,
      0,
      length,
    );
  }
  const length = wasm.getParagraphLength(position.sectionIndex, position.paragraphIndex);
  return wasm.getTextRange(position.sectionIndex, position.paragraphIndex, 0, length);
}

function readText(wasm: WasmBridge, position: DocumentPosition, count: number): string {
  const cellPath = position.cellPath ?? [];
  if (cellPath.length > 1) {
    return wasm.getTextInCellByPath(
      position.sectionIndex,
      position.parentParaIndex!,
      JSON.stringify(cellPath),
      position.charOffset,
      count,
    );
  }
  if (position.parentParaIndex !== undefined) {
    return wasm.getTextInCell(
      position.sectionIndex,
      position.parentParaIndex,
      position.controlIndex!,
      position.cellIndex!,
      position.cellParaIndex!,
      position.charOffset,
      count,
    );
  }
  return wasm.getTextRange(position.sectionIndex, position.paragraphIndex, position.charOffset, count);
}

function assertSameTextContainer(start: DocumentPosition, end: DocumentPosition): void {
  const same = start.sectionIndex === end.sectionIndex &&
    start.paragraphIndex === end.paragraphIndex &&
    start.parentParaIndex === end.parentParaIndex &&
    start.controlIndex === end.controlIndex &&
    start.cellIndex === end.cellIndex &&
    start.cellParaIndex === end.cellParaIndex &&
    JSON.stringify(start.cellPath ?? []) === JSON.stringify(end.cellPath ?? []);
  if (!same) {
    throw new HanjaEditorRangeError('invalid-selection', '한 문단 안의 한글 단어만 변환할 수 있습니다.');
  }
}

function fingerprint(source: Omit<HanjaConversionSource, 'fingerprint'>): string {
  return JSON.stringify({
    text: source.text,
    originalText: source.originalText,
    rangeLength: source.rangeLength,
    documentGeneration: source.documentGeneration,
    selected: source.selected,
    start: positionKey(source.start),
    end: positionKey(source.end),
  });
}

function positionKey(position: DocumentPosition): object {
  return {
    sectionIndex: position.sectionIndex,
    paragraphIndex: position.paragraphIndex,
    charOffset: position.charOffset,
    parentParaIndex: position.parentParaIndex,
    controlIndex: position.controlIndex,
    cellIndex: position.cellIndex,
    cellParaIndex: position.cellParaIndex,
    cellPath: position.cellPath,
    isTextBox: position.isTextBox,
  };
}

function isHangulAt(value: readonly string[], index: number): boolean {
  return index >= 0 && index < value.length && /[가-힣]/u.test(value[index] ?? '');
}

function characterCount(value: string): number {
  return Array.from(value).length;
}
