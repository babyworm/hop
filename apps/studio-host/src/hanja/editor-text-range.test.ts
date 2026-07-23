import { describe, expect, it, vi } from 'vitest';
import { advanceDocumentGeneration, currentDocumentGeneration } from '../core/document-generation';
import {
  findConvertibleWordRange,
  isConversionSourceCurrent,
  readConversionSource,
  replaceConversionSource,
} from './editor-text-range';

describe('findConvertibleWordRange', () => {
  it('finds a contiguous Hanja run and records its conversion direction', () => {
    expect(findConvertibleWordRange('문서 學校 편집', 5)).toEqual({
      start: 3,
      end: 5,
      text: '學校',
      direction: 'hanja-to-hangul',
    });
  });

  it('keeps supplementary-plane Hanja aligned to document scalar offsets', () => {
    expect(findConvertibleWordRange('𢠵校 편집', 1)).toEqual({
      start: 0,
      end: 2,
      text: '𢠵校',
      direction: 'hanja-to-hangul',
    });
  });
});

describe('editor conversion range', () => {
  it('uses a same-paragraph selection before the current word', () => {
    const inputHandler = {
      getSelection: () => ({
        start: { sectionIndex: 0, paragraphIndex: 2, charOffset: 3 },
        end: { sectionIndex: 0, paragraphIndex: 2, charOffset: 5 },
      }),
      getCursorPosition: vi.fn(),
      cursor: supportedCursor(),
    };
    const wasm = bodyWasm('문서 학교 편집');

    const source = readConversionSource({ wasm, getInputHandler: () => inputHandler } as never);

    expect(source).toMatchObject({ text: '학교', start: { charOffset: 3 }, end: { charOffset: 5 } });
    expect(source).toMatchObject({
      originalText: '학교',
      rangeLength: 2,
      direction: 'hangul-to-hanja',
    });
    expect(inputHandler.getCursorPosition).not.toHaveBeenCalled();
  });

  it('keeps the exact selected text and authoritative range length for undo', () => {
    const decomposed = '하';
    const inputHandler = {
      getSelection: () => ({
        start: { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 },
        end: { sectionIndex: 0, paragraphIndex: 0, charOffset: 2 },
      }),
      getCursorPosition: vi.fn(),
      cursor: supportedCursor(),
    };
    const source = readConversionSource({
      wasm: bodyWasm(decomposed),
      getInputHandler: () => inputHandler,
    } as never);

    expect(source).toMatchObject({ text: '하', originalText: decomposed, rangeLength: 2 });
  });

  it('reads the current word from a flat table cell', () => {
    const position = {
      sectionIndex: 0, paragraphIndex: 0, charOffset: 2,
      parentParaIndex: 3, controlIndex: 1, cellIndex: 2, cellParaIndex: 0,
    };
    const wasm = {
      getCellParagraphLength: vi.fn(() => 5),
      getLineInfoInCell: vi.fn(() => ({ charEnd: 5 })),
      getTextInCell: vi.fn(() => '학교 편집'),
      getFieldInfoAt: vi.fn(() => ({ inField: false })),
    };
    const source = readConversionSource({
      wasm,
      getInputHandler: () => ({
        getSelection: () => null,
        getCursorPosition: () => position,
        cursor: supportedCursor(),
      }),
    } as never);

    expect(source).toMatchObject({ text: '학교', start: { charOffset: 0 }, end: { charOffset: 2 } });
  });

  it('rejects nested table cells whose character shapes cannot be restored by path', () => {
    const position = {
      sectionIndex: 0, paragraphIndex: 0, charOffset: 2, parentParaIndex: 3,
      cellPath: [
        { controlIndex: 1, cellIndex: 2, cellParaIndex: 0 },
        { controlIndex: 0, cellIndex: 1, cellParaIndex: 0 },
      ],
    };

    expect(() => readConversionSource({
      wasm: {},
      getInputHandler: () => ({
        getSelection: () => null,
        getCursorPosition: () => position,
        cursor: supportedCursor(),
      }),
    } as never)).toThrow(/중첩 표/);
  });

  it('rejects a pending conversion after the document generation changes', () => {
    const services = {
      wasm: bodyWasm('학교'),
      getInputHandler: () => ({
        getSelection: () => null,
        getCursorPosition: () => ({ sectionIndex: 0, paragraphIndex: 0, charOffset: 2 }),
        cursor: supportedCursor(),
      }),
    };
    const source = readConversionSource(services as never);

    advanceDocumentGeneration();

    expect(isConversionSourceCurrent(services as never, source)).toBe(false);
  });

  it('rejects unsupported header, footer, and note editor contexts', () => {
    const services = {
      wasm: {},
      getInputHandler: () => ({
        getSelection: () => null,
        getCursorPosition: vi.fn(),
        cursor: {
          clearSelection: vi.fn(),
          isInHeaderFooter: () => true,
          isInFootnote: () => false,
        },
      }),
    };

    expect(() => readConversionSource(services as never)).toThrow(/머리말/);
  });

  it('rejects conversion text inside a ClickHere field', () => {
    const wasm = {
      ...bodyWasm('학교'),
      getFieldInfoAt: () => ({ inField: true, fieldType: 'clickhere' }),
    };

    expect(() => readConversionSource({
      wasm,
      getInputHandler: () => ({
        getSelection: () => null,
        getCursorPosition: () => ({ sectionIndex: 0, paragraphIndex: 0, charOffset: 1 }),
        cursor: supportedCursor(),
      }),
    } as never)).toThrow(/누름틀/);
  });

  it('derives the current word when no selection exists', () => {
    const inputHandler = {
      getSelection: () => null,
      getCursorPosition: () => ({ sectionIndex: 0, paragraphIndex: 1, charOffset: 5 }),
      cursor: supportedCursor(),
    };
    const wasm = bodyWasm('문서 학교 편집');

    expect(readConversionSource({ wasm, getInputHandler: () => inputHandler } as never)).toMatchObject({
      text: '학교',
      start: { charOffset: 3 },
      end: { charOffset: 5 },
    });
  });

  it('reads a Hanja run at the caret for reverse conversion', () => {
    const inputHandler = {
      getSelection: () => null,
      getCursorPosition: () => ({ sectionIndex: 0, paragraphIndex: 1, charOffset: 5 }),
      cursor: supportedCursor(),
    };
    const wasm = bodyWasm('문서 學校 편집');

    expect(readConversionSource({ wasm, getInputHandler: () => inputHandler } as never)).toMatchObject({
      text: '學校',
      direction: 'hanja-to-hangul',
      start: { charOffset: 3 },
      end: { charOffset: 5 },
    });
  });

  it('rejects a body paragraph with inline controls before reading selected text', () => {
    const getTextRange = vi.fn();

    expect(() => readConversionSource({
      wasm: {
        getParagraphLength: () => 4,
        getLineInfo: () => ({ charEnd: 5 }),
        getTextRange,
      },
      getInputHandler: () => ({
        getSelection: () => ({
          start: { sectionIndex: 0, paragraphIndex: 0, charOffset: 1 },
          end: { sectionIndex: 0, paragraphIndex: 0, charOffset: 3 },
        }),
        getCursorPosition: vi.fn(),
        cursor: supportedCursor(),
      }),
    } as never)).toThrow(/개체/);
    expect(getTextRange).not.toHaveBeenCalled();
  });

  it('rejects a selection longer than the conversion limit before reading document text', () => {
    const getTextRange = vi.fn();

    expect(() => readConversionSource({
      wasm: {
        getParagraphLength: () => 100,
        getLineInfo: () => ({ charEnd: 100 }),
        getTextRange,
      },
      getInputHandler: () => ({
        getSelection: () => ({
          start: { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 },
          end: { sectionIndex: 0, paragraphIndex: 0, charOffset: 65 },
        }),
        getCursorPosition: vi.fn(),
        cursor: supportedCursor(),
      }),
    } as never)).toThrow(/64/);
    expect(getTextRange).not.toHaveBeenCalled();
  });

  it('reads only a bounded body window around the caret', () => {
    const paragraph = `${'가'.repeat(900)} 학교 ${'나'.repeat(900)}`;
    const characters = Array.from(paragraph);
    const getTextRange = vi.fn(
      (_section: number, _paragraph: number, offset: number, count: number) =>
        characters.slice(offset, offset + count).join(''),
    );
    const cursorOffset = 903;

    const source = readConversionSource({
      wasm: {
        getParagraphLength: () => characters.length,
        getLineInfo: () => ({ charEnd: characters.length }),
        getTextRange,
        getFieldInfoAt: () => ({ inField: false }),
      },
      getInputHandler: () => ({
        getSelection: () => null,
        getCursorPosition: () => ({ sectionIndex: 0, paragraphIndex: 0, charOffset: cursorOffset }),
        cursor: supportedCursor(),
      }),
    } as never);

    expect(source.text).toBe('학교');
    expect(getTextRange).toHaveBeenCalledOnce();
    expect(getTextRange.mock.calls[0]?.[3]).toBeLessThanOrEqual(130);
  });

  it('fails closed when the pinned cursor or logical-length capability is unavailable', () => {
    expect(() => readConversionSource({
      wasm: bodyWasm('학교'),
      getInputHandler: () => ({
        getSelection: () => null,
        getCursorPosition: () => ({ sectionIndex: 0, paragraphIndex: 0, charOffset: 1 }),
      }),
    } as never)).toThrow(/지원하지/);

    expect(() => readConversionSource({
      wasm: { getParagraphLength: () => 2, getTextRange: () => '학교' },
      getInputHandler: () => ({
        getSelection: () => null,
        getCursorPosition: () => ({ sectionIndex: 0, paragraphIndex: 0, charOffset: 1 }),
        cursor: supportedCursor(),
      }),
    } as never)).toThrow(/지원하지/);
  });

  it('applies a replacement as one undo-aware command and clears a selection', () => {
    const executeOperation = vi.fn();
    const clearSelection = vi.fn();
    const inputHandler = {
      executeOperation,
      getSelection: () => ({
        start: { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 },
        end: { sectionIndex: 0, paragraphIndex: 0, charOffset: 2 },
      }),
      cursor: { ...supportedCursor(), clearSelection },
    };
    const source = {
      text: '학교',
      originalText: '학교',
      rangeLength: 2,
      start: { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 },
      end: { sectionIndex: 0, paragraphIndex: 0, charOffset: 2 },
      documentGeneration: currentDocumentGeneration(),
      fingerprint: 'stable',
      selected: true,
      direction: 'hangul-to-hanja' as const,
    };

    replaceConversionSource(inputHandler as never, source, '學校');

    expect(clearSelection).toHaveBeenCalledOnce();
    expect(executeOperation).toHaveBeenCalledWith(expect.objectContaining({ kind: 'command' }));
    expect(executeOperation.mock.calls[0]?.[0]).toMatchObject({
      command: { type: 'replaceText' },
      meta: { refresh: 'full' },
    });
  });

  it('keeps the selection when command routing throws', () => {
    const clearSelection = vi.fn();
    const inputHandler = {
      executeOperation: vi.fn(() => { throw new Error('injected operation failure'); }),
      cursor: { ...supportedCursor(), clearSelection },
    };
    const source = {
      text: '학교',
      originalText: '학교',
      rangeLength: 2,
      start: { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 },
      end: { sectionIndex: 0, paragraphIndex: 0, charOffset: 2 },
      documentGeneration: currentDocumentGeneration(),
      fingerprint: 'stable',
      selected: true,
      direction: 'hangul-to-hanja' as const,
    };

    expect(() => replaceConversionSource(inputHandler as never, source, '學校')).toThrow(
      'injected operation failure',
    );
    expect(clearSelection).not.toHaveBeenCalled();
  });
});

function supportedCursor() {
  return {
    clearSelection: vi.fn(),
    isInHeaderFooter: () => false,
    isInFootnote: () => false,
  };
}

function bodyWasm(text: string) {
  const characters = Array.from(text);
  return {
    getParagraphLength: () => characters.length,
    getLineInfo: () => ({ charEnd: characters.length }),
    getTextRange: (_section: number, _paragraph: number, offset: number, count: number) =>
      characters.slice(offset, offset + count).join(''),
    getFieldInfoAt: () => ({ inField: false }),
  };
}
