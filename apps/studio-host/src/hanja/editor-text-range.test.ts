import { describe, expect, it, vi } from 'vitest';
import { advanceDocumentGeneration, currentDocumentGeneration } from '../core/document-generation';
import {
  findHangulWordRange,
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
    expect(source).toMatchObject({ originalText: '학교', rangeLength: 2 });
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

  it.each([
    {
      name: 'flat table cell',
      position: {
        sectionIndex: 0, paragraphIndex: 0, charOffset: 2,
        parentParaIndex: 3, controlIndex: 1, cellIndex: 2, cellParaIndex: 0,
      },
      wasm: {
        getCellParagraphLength: vi.fn(() => 5),
        getTextInCell: vi.fn(() => '학교 편집'),
      },
    },
    {
      name: 'nested table cell',
      position: {
        sectionIndex: 0, paragraphIndex: 0, charOffset: 2, parentParaIndex: 3,
        cellPath: [
          { controlIndex: 1, cellIndex: 2, cellParaIndex: 0 },
          { controlIndex: 0, cellIndex: 1, cellParaIndex: 0 },
        ],
      },
      wasm: {
        getCellParagraphLengthByPath: vi.fn(() => 5),
        getTextInCellByPath: vi.fn(() => '학교 편집'),
      },
    },
  ])('reads the current word from a $name', ({ position, wasm }) => {
    const source = readConversionSource({
      wasm,
      getInputHandler: () => ({ getSelection: () => null, getCursorPosition: () => position }),
    } as never);

    expect(source).toMatchObject({ text: '학교', start: { charOffset: 0 }, end: { charOffset: 2 } });
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
    };

    replaceConversionSource(inputHandler as never, source, '學校');

    expect(clearSelection).toHaveBeenCalledOnce();
    expect(executeOperation).toHaveBeenCalledWith(expect.objectContaining({ kind: 'command' }));

    const descriptor = executeOperation.mock.calls[0]?.[0] as { command: {
      execute(wasm: unknown): unknown;
      undo(wasm: unknown): unknown;
    } };
    const wasm = { deleteText: vi.fn(), insertText: vi.fn() };
    expect(descriptor.command.execute(wasm)).toMatchObject({ charOffset: 2 });
    expect(wasm.deleteText).toHaveBeenCalledWith(0, 0, 0, 2);
    expect(wasm.insertText).toHaveBeenCalledWith(0, 0, 0, '學校');

    expect(descriptor.command.undo(wasm)).toMatchObject({ charOffset: 2 });
    expect(wasm.deleteText).toHaveBeenLastCalledWith(0, 0, 0, 2);
    expect(wasm.insertText).toHaveBeenLastCalledWith(0, 0, 0, '학교');
  });

  it('uses Unicode scalar counts when undoing supplementary-plane Hanja', () => {
    const executeOperation = vi.fn();
    const source = {
      text: '창황실색',
      originalText: '창황실색',
      rangeLength: 4,
      start: { sectionIndex: 0, paragraphIndex: 0, charOffset: 1 },
      end: { sectionIndex: 0, paragraphIndex: 0, charOffset: 5 },
      documentGeneration: currentDocumentGeneration(),
      fingerprint: 'stable',
      selected: false,
    };
    replaceConversionSource({ executeOperation } as never, source, '𢠵怳失色');
    const command = executeOperation.mock.calls[0]?.[0].command;
    const wasm = { deleteText: vi.fn(), insertText: vi.fn() };

    expect(command.execute(wasm)).toMatchObject({ charOffset: 5 });
    expect(command.undo(wasm)).toMatchObject({ charOffset: 5 });
    expect(wasm.deleteText).toHaveBeenNthCalledWith(1, 0, 0, 1, 4);
    expect(wasm.deleteText).toHaveBeenNthCalledWith(2, 0, 0, 1, 4);
  });
});
