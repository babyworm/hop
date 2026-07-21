import type { CommandServices } from '@/upstream/commands';
import type { DocumentPosition, WasmBridge } from '@/upstream/core';
import { currentDocumentGeneration } from '../core/document-generation';
import type { EditCommand } from '../upstream/editor';
import { getInputHandlerCursorAccess } from '../upstream/editor';
import { HanjaReplaceCommand } from './hanja-replace-command';

interface ConversionInputHandler {
  getSelection(): { start: DocumentPosition; end: DocumentPosition } | null;
  getCursorPosition(): DocumentPosition;
  executeOperation(descriptor: {
    kind: 'command';
    command: EditCommand;
    meta?: { refresh: 'full' };
  }): void;
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
  direction: HanjaConversionDirection;
}

export type HanjaConversionDirection = 'hangul-to-hanja' | 'hanja-to-hangul';

export class HanjaEditorRangeError extends Error {
  constructor(
    readonly code: 'no-editor' | 'unsupported-context' | 'invalid-selection' | 'no-convertible-text',
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

export function findConvertibleWordRange(
  paragraphText: string,
  cursorOffset: number,
): {
  start: number;
  end: number;
  text: string;
  direction: HanjaConversionDirection;
} | null {
  const characters = Array.from(paragraphText);
  const offset = Math.max(0, Math.min(characters.length, cursorOffset));
  let index = offset;
  let direction = conversionDirectionForCharacter(characters[index] ?? '');
  if (!direction) {
    index -= 1;
    direction = conversionDirectionForCharacter(characters[index] ?? '');
  }
  if (!direction) return null;

  let start = index;
  let end = index + 1;
  while (start > 0 && conversionDirectionForCharacter(characters[start - 1] ?? '') === direction) {
    start -= 1;
  }
  while (
    end < characters.length &&
    conversionDirectionForCharacter(characters[end] ?? '') === direction
  ) {
    end += 1;
  }
  return { start, end, text: characters.slice(start, end).join(''), direction };
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
    assertSupportedContainer(selection.start);
    const count = selection.end.charOffset - selection.start.charOffset;
    if (count <= 0) {
      throw new HanjaEditorRangeError('invalid-selection', '변환할 글자를 선택해 주세요.');
    }
    const text = readText(services.wasm, selection.start, count);
    return sourceFrom(text, selection.start, selection.end, true);
  }

  const cursor = inputHandler.getCursorPosition();
  assertSupportedContainer(cursor);
  const paragraphText = readParagraph(services.wasm, cursor);
  const word = findConvertibleWordRange(paragraphText, cursor.charOffset);
  if (!word) {
    throw new HanjaEditorRangeError(
      'no-convertible-text',
      '한글 또는 한자 단어를 선택하거나 단어 안에 커서를 놓아 주세요.',
    );
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
  inputHandler.executeOperation({
    kind: 'command',
    command: new HanjaReplaceCommand(
      source.start,
      source.text,
      source.originalText,
      source.rangeLength,
      replacement,
    ),
    meta: { refresh: 'full' },
  });
  getInputHandlerCursorAccess(inputHandler)?.clearSelection?.();
  return true;
}

function sourceFrom(
  text: string,
  start: DocumentPosition,
  end: DocumentPosition,
  selected: boolean,
): HanjaConversionSource {
  const normalized = text.normalize('NFC');
  const direction = conversionDirectionForText(normalized);
  if (!direction) {
    throw new HanjaEditorRangeError(
      'no-convertible-text',
      '한글 음절 또는 한자로만 이루어진 단어를 변환할 수 있습니다.',
    );
  }
  const source = {
    text: normalized,
    originalText: text,
    rangeLength: end.charOffset - start.charOffset,
    start: { ...start },
    end: { ...end },
    documentGeneration: currentDocumentGeneration(),
    selected,
    direction,
  };
  return { ...source, fingerprint: fingerprint(source) };
}

function readParagraph(wasm: WasmBridge, position: DocumentPosition): string {
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

function assertSupportedContainer(position: DocumentPosition): void {
  if ((position.cellPath?.length ?? 0) > 1) {
    throw new HanjaEditorRangeError(
      'unsupported-context',
      '중첩 표 셀에서는 아직 문자 서식을 보존한 한자 변환을 지원하지 않습니다.',
    );
  }
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
    throw new HanjaEditorRangeError(
      'invalid-selection',
      '한 문단 안의 한글 또는 한자 단어만 변환할 수 있습니다.',
    );
  }
}

function fingerprint(source: Omit<HanjaConversionSource, 'fingerprint'>): string {
  return JSON.stringify({
    text: source.text,
    originalText: source.originalText,
    rangeLength: source.rangeLength,
    documentGeneration: source.documentGeneration,
    selected: source.selected,
    direction: source.direction,
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

function conversionDirectionForText(value: string): HanjaConversionDirection | null {
  if (/^[가-힣]+$/u.test(value)) return 'hangul-to-hanja';
  if (/^\p{Script=Han}+$/u.test(value)) return 'hanja-to-hangul';
  return null;
}

function conversionDirectionForCharacter(value: string): HanjaConversionDirection | null {
  if (/^[가-힣]$/u.test(value)) return 'hangul-to-hanja';
  if (/^\p{Script=Han}$/u.test(value)) return 'hanja-to-hangul';
  return null;
}
