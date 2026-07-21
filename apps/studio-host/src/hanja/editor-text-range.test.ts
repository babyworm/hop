import { describe, expect, it, vi } from 'vitest';
import { advanceDocumentGeneration, currentDocumentGeneration } from '../core/document-generation';
import {
  findHangulWordRange,
  findConvertibleWordRange,
  isConversionSourceCurrent,
  readConversionSource,
  replaceConversionSource,
} from './editor-text-range';

describe('findHangulWordRange', () => {
  it('finds the word on either side of a caret boundary', () => {
    expect(findHangulWordRange('문서 학교 편집', 5)).toEqual({ start: 3, end: 5, text: '학교' });
    expect(findHangulWordRange('문서 학교 편집', 3)).toEqual({ start: 3, end: 5, text: '학교' });
  });

  it('returns null when the caret is not adjacent to Hangul', () => {
    expect(findHangulWordRange('HOP 123', 4)).toBeNull();
  });

  it('uses document character offsets when supplementary-plane text precedes the word', () => {
    expect(findHangulWordRange('𢠵 학교', 4)).toEqual({ start: 2, end: 4, text: '학교' });
  });
});

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
    };
    const wasm = { getTextRange: vi.fn(() => '학교') };

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
    };
    const source = readConversionSource({
      wasm: { getTextRange: () => decomposed },
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
      getTextInCell: vi.fn(() => '학교 편집'),
    };
    const source = readConversionSource({
      wasm,
      getInputHandler: () => ({ getSelection: () => null, getCursorPosition: () => position }),
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
      getInputHandler: () => ({ getSelection: () => null, getCursorPosition: () => position }),
    } as never)).toThrow(/중첩 표/);
  });

  it('rejects a pending conversion after the document generation changes', () => {
    const services = {
      wasm: { getParagraphLength: () => 2, getTextRange: () => '학교' },
      getInputHandler: () => ({
        getSelection: () => null,
        getCursorPosition: () => ({ sectionIndex: 0, paragraphIndex: 0, charOffset: 2 }),
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
          isInHeaderFooter: () => true,
          isInFootnote: () => false,
        },
      }),
    };

    expect(() => readConversionSource(services as never)).toThrow(/머리말/);
  });

  it('derives the current word when no selection exists', () => {
    const inputHandler = {
      getSelection: () => null,
      getCursorPosition: () => ({ sectionIndex: 0, paragraphIndex: 1, charOffset: 5 }),
    };
    const wasm = {
      getParagraphLength: () => 8,
      getTextRange: () => '문서 학교 편집',
    };

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
    };
    const wasm = {
      getParagraphLength: () => 8,
      getTextRange: () => '문서 學校 편집',
    };

    expect(readConversionSource({ wasm, getInputHandler: () => inputHandler } as never)).toMatchObject({
      text: '學校',
      direction: 'hanja-to-hangul',
      start: { charOffset: 3 },
      end: { charOffset: 5 },
    });
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
      cursor: { clearSelection },
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
      cursor: { clearSelection },
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
