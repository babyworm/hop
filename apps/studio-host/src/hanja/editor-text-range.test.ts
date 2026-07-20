import { describe, expect, it, vi } from 'vitest';
import { findHangulWordRange, readConversionSource, replaceConversionSource } from './editor-text-range';

describe('findHangulWordRange', () => {
  it('finds the word on either side of a caret boundary', () => {
    expect(findHangulWordRange('문서 학교 편집', 5)).toEqual({ start: 3, end: 5, text: '학교' });
    expect(findHangulWordRange('문서 학교 편집', 3)).toEqual({ start: 3, end: 5, text: '학교' });
  });

  it('returns null when the caret is not adjacent to Hangul', () => {
    expect(findHangulWordRange('HOP 123', 4)).toBeNull();
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
    expect(inputHandler.getCursorPosition).not.toHaveBeenCalled();
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
      start: { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 },
      end: { sectionIndex: 0, paragraphIndex: 0, charOffset: 2 },
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
});
