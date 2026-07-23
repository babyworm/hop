import type { DocumentPosition, WasmBridge } from '@/upstream/core';

export class HanjaEditorRangeError extends Error {
  constructor(
    readonly code: 'no-editor' | 'unsupported-context' | 'invalid-selection' | 'no-convertible-text',
    message: string,
  ) {
    super(message);
    this.name = 'HanjaEditorRangeError';
  }
}

export function assertCompatibleTextOffsets(
  wasm: WasmBridge,
  position: DocumentPosition,
): number {
  try {
    if (position.parentParaIndex !== undefined) {
      const rawLength = wasm.getCellParagraphLength(
        position.sectionIndex,
        position.parentParaIndex,
        position.controlIndex!,
        position.cellIndex!,
        position.cellParaIndex!,
      );
      const logicalLength = wasm.getLineInfoInCell(
        position.sectionIndex,
        position.parentParaIndex,
        position.controlIndex!,
        position.cellIndex!,
        position.cellParaIndex!,
        0xffffffff,
      ).charEnd;
      assertEqualTextLengths(rawLength, logicalLength);
      return rawLength;
    }
    const rawLength = wasm.getParagraphLength(position.sectionIndex, position.paragraphIndex);
    const logicalLength = wasm.getLineInfo(
      position.sectionIndex,
      position.paragraphIndex,
      0xffffffff,
    ).charEnd;
    assertEqualTextLengths(rawLength, logicalLength);
    return rawLength;
  } catch (error) {
    if (error instanceof HanjaEditorRangeError) throw error;
    throw new HanjaEditorRangeError(
      'unsupported-context',
      '현재 편집기에서는 한글/한자 변환을 지원하지 않습니다.',
    );
  }
}

export function readHanjaText(
  wasm: WasmBridge,
  position: DocumentPosition,
  count: number,
): string {
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

export function getHanjaParagraphLength(
  wasm: WasmBridge,
  position: DocumentPosition,
): number {
  if (position.parentParaIndex === undefined) {
    return wasm.getParagraphLength(position.sectionIndex, position.paragraphIndex);
  }
  return wasm.getCellParagraphLength(
    position.sectionIndex,
    position.parentParaIndex,
    position.controlIndex!,
    position.cellIndex!,
    position.cellParaIndex!,
  );
}

export function deleteHanjaTextImmediate(
  wasm: WasmBridge,
  position: DocumentPosition,
  count: number,
): void {
  if (position.parentParaIndex === undefined) {
    wasm.deleteText(position.sectionIndex, position.paragraphIndex, position.charOffset, count);
    return;
  }
  wasm.deleteTextInCell(
    position.sectionIndex,
    position.parentParaIndex,
    position.controlIndex!,
    position.cellIndex!,
    position.cellParaIndex!,
    position.charOffset,
    count,
  );
}

export function insertHanjaTextImmediate(
  wasm: WasmBridge,
  position: DocumentPosition,
  text: string,
): void {
  if (position.parentParaIndex === undefined) {
    wasm.insertText(position.sectionIndex, position.paragraphIndex, position.charOffset, text);
    return;
  }
  wasm.insertTextInCell(
    position.sectionIndex,
    position.parentParaIndex,
    position.controlIndex!,
    position.cellIndex!,
    position.cellParaIndex!,
    position.charOffset,
    text,
  );
}

function assertEqualTextLengths(rawLength: number, logicalLength: number): void {
  if (!Number.isSafeInteger(rawLength) || !Number.isSafeInteger(logicalLength) ||
      rawLength < 0 || rawLength !== logicalLength) {
    throw new HanjaEditorRangeError(
      'unsupported-context',
      '인라인 개체가 있는 문단에서는 한글/한자 변환을 지원하지 않습니다.',
    );
  }
}
