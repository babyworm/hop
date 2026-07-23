import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WasmBridge } from '@/upstream/core';
import { CommandHistory } from '@upstream/engine/history';
import { installRecoveredCommandHistoryGuard } from '../upstream/editor';
import { HanjaReplaceCommand } from './hanja-replace-command';

const BODY_POSITION = { sectionIndex: 0, paragraphIndex: 0, charOffset: 1 };
const CELL_POSITION = {
  sectionIndex: 0,
  paragraphIndex: 0,
  charOffset: 1,
  parentParaIndex: 0,
  controlIndex: 0,
  cellIndex: 0,
  cellParaIndex: 0,
};

describe('HanjaReplaceCommand', () => {
  it.each([
    ['body paragraph', BODY_POSITION],
    ['flat table cell', CELL_POSITION],
  ])('preserves mixed character shapes through execute, undo, and redo in a %s', (_, position) => {
    const wasm = new StatefulWasm('A학교B', [0, 7, 8, 0]);
    const command = new HanjaReplaceCommand(position, '학교', '학교', 2, '學校');

    expect(command.execute(wasm as never)).toMatchObject({ charOffset: 3 });
    expect(wasm.state()).toEqual({ text: 'A學校B', shapes: [0, 7, 8, 0] });

    expect(command.undo(wasm as never)).toMatchObject({ charOffset: 3 });
    expect(wasm.state()).toEqual({ text: 'A학교B', shapes: [0, 7, 8, 0] });

    command.execute(wasm as never);
    expect(wasm.state()).toEqual({ text: 'A學校B', shapes: [0, 7, 8, 0] });
  });

  it('leaves text and character shapes unchanged when insertion fails before mutation', () => {
    const wasm = new StatefulWasm('A학교B', [0, 7, 8, 0]);
    const command = new HanjaReplaceCommand(BODY_POSITION, '학교', '학교', 2, '學校');
    wasm.failNextInsert = true;

    expect(() => command.execute(wasm as never)).toThrow('injected insert failure');

    expect(wasm.state()).toEqual({ text: 'A학교B', shapes: [0, 7, 8, 0] });
  });

  it.each([
    ['body paragraph', BODY_POSITION],
    ['flat table cell', CELL_POSITION],
  ])('restores a %s when insertion mutates before throwing', (_, position) => {
    const wasm = new StatefulWasm('A학교B', [0, 7, 8, 0]);
    const command = new HanjaReplaceCommand(position, '학교', '학교', 2, '學校');
    wasm.failAfterInserting('學校', 1);

    expect(() => command.execute(wasm as never)).toThrow('injected post-insert failure');
    expect(wasm.state()).toEqual({ text: 'A학교B', shapes: [0, 7, 8, 0] });
  });

  it.each([
    ['body paragraph', BODY_POSITION],
    ['flat table cell', CELL_POSITION],
  ])('restores a %s when deletion mutates before throwing', (_, position) => {
    const wasm = new StatefulWasm('A학교B', [0, 7, 8, 0]);
    const command = new HanjaReplaceCommand(position, '학교', '학교', 2, '學校');
    wasm.failAfterDeleting(1);

    expect(() => command.execute(wasm as never)).toThrow('injected post-delete failure');
    expect(wasm.state()).toEqual({ text: 'A학교B', shapes: [0, 7, 8, 0] });
  });

  it('verifies recovery when restoring source text mutates before throwing', () => {
    const wasm = new StatefulWasm('A학교B', [0, 7, 8, 0]);
    const command = new HanjaReplaceCommand(BODY_POSITION, '학교', '학교', 2, '學校');
    wasm.failNextStyle = true;
    wasm.failAfterInserting('학교', 1);

    expect(() => command.execute(wasm as never)).toThrow('injected style failure');
    expect(wasm.state()).toEqual({ text: 'A학교B', shapes: [0, 7, 8, 0] });
  });

  it('verifies recovery when removing replacement text mutates before throwing', () => {
    const wasm = new StatefulWasm('A학교B', [0, 7, 8, 0]);
    const command = new HanjaReplaceCommand(BODY_POSITION, '학교', '학교', 2, '學校');
    wasm.failNextStyle = true;
    wasm.failAfterDeleting(2);

    expect(() => command.execute(wasm as never)).toThrow('injected style failure');
    expect(wasm.state()).toEqual({ text: 'A학교B', shapes: [0, 7, 8, 0] });
  });

  it('preserves operation and recovery errors without claiming an unrecovered edit is safe', () => {
    const wasm = new StatefulWasm('A학교B', [0, 7, 8, 0]);
    const command = new HanjaReplaceCommand(BODY_POSITION, '학교', '학교', 2, '學校');
    wasm.failNextStyle = true;
    wasm.failBeforeDeletingFrom(2);

    let caught: unknown;
    try {
      command.execute(wasm as never);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([
      expect.objectContaining({ message: 'injected style failure' }),
      expect.objectContaining({ message: 'injected delete failure' }),
    ]);
  });

  it('restores text and character shapes when character-shape application fails after insertion', () => {
    const wasm = new StatefulWasm('A학교B', [0, 7, 8, 0]);
    const command = new HanjaReplaceCommand(BODY_POSITION, '학교', '학교', 2, '學校');
    wasm.failNextStyle = true;

    expect(() => command.execute(wasm as never)).toThrow('injected style failure');

    expect(wasm.textAtStyleFailure).toBe('A學校B');
    expect(wasm.state()).toEqual({ text: 'A학교B', shapes: [0, 7, 8, 0] });
  });

  it('verifies each restored character-shape run after setters mutate and throw', () => {
    const wasm = new StatefulWasm('A학교B', [0, 7, 8, 0]);
    const command = new HanjaReplaceCommand(BODY_POSITION, '학교', '학교', 2, '學校');
    wasm.failAfterEveryStyle = true;

    expect(() => command.execute(wasm as never)).toThrow('injected post-style failure');
    expect(wasm.state()).toEqual({ text: 'A학교B', shapes: [0, 7, 8, 0] });
  });

  it('uses immediate flat-cell insertion so deferred-result parsing cannot corrupt rollback', () => {
    const wasm = new StatefulWasm('A학교B', [0, 7, 8, 0]);
    const command = new HanjaReplaceCommand(CELL_POSITION, '학교', '학교', 2, '學校');
    wasm.failDeferredAfterInsert = true;

    expect(() => command.execute(wasm as never)).not.toThrow();
    expect(wasm.deferredInsertCalls).toBe(0);
    expect(wasm.state()).toEqual({ text: 'A學校B', shapes: [0, 7, 8, 0] });
  });

  it('preserves history so a transiently failing undo and redo can be retried', () => {
    const wasm = new StatefulWasm('A학교B', [0, 7, 8, 0]);
    const history = new CommandHistory();
    installRecoveredCommandHistoryGuard({ history } as never);
    const command = new HanjaReplaceCommand(BODY_POSITION, '학교', '학교', 2, '學校');
    history.execute(command, wasm as never);

    wasm.failNextInsert = true;
    expect(() => history.undo(wasm as never)).toThrow('injected insert failure');
    expect(wasm.state()).toEqual({ text: 'A學校B', shapes: [0, 7, 8, 0] });
    expect(history.canUndo()).toBe(true);
    expect(history.undo(wasm as never)).toMatchObject({ charOffset: 3 });
    expect(wasm.state()).toEqual({ text: 'A학교B', shapes: [0, 7, 8, 0] });

    wasm.failNextInsert = true;
    expect(() => history.redo(wasm as never)).toThrow('injected insert failure');
    expect(wasm.state()).toEqual({ text: 'A학교B', shapes: [0, 7, 8, 0] });
    expect(history.canRedo()).toBe(true);
    expect(history.redo(wasm as never)).toMatchObject({ charOffset: 3 });
    expect(wasm.state()).toEqual({ text: 'A學校B', shapes: [0, 7, 8, 0] });

    expect(history.undo(wasm as never)).toMatchObject({ charOffset: 3 });
    expect(wasm.state()).toEqual({ text: 'A학교B', shapes: [0, 7, 8, 0] });
  });

  it('keeps a fully recovered command in history after repeated undo and redo failures', () => {
    const wasm = new StatefulWasm('A학교B', [0, 7, 8, 0]);
    const history = new CommandHistory();
    installRecoveredCommandHistoryGuard({ history } as never);
    const command = new HanjaReplaceCommand(BODY_POSITION, '학교', '학교', 2, '學校');
    history.execute(command, wasm as never);

    wasm.failInsertionsOf('학교', 2);
    expect(() => history.undo(wasm as never)).toThrow('injected insert failure');
    expect(wasm.state()).toEqual({ text: 'A學校B', shapes: [0, 7, 8, 0] });
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);

    expect(() => history.undo(wasm as never)).toThrow('injected insert failure');
    expect(wasm.state()).toEqual({ text: 'A學校B', shapes: [0, 7, 8, 0] });
    expect(history.canUndo()).toBe(true);

    expect(history.undo(wasm as never)).toMatchObject({ charOffset: 3 });
    expect(wasm.state()).toEqual({ text: 'A학교B', shapes: [0, 7, 8, 0] });

    wasm.failInsertionsOf('學校', 2);
    expect(() => history.redo(wasm as never)).toThrow('injected insert failure');
    expect(wasm.state()).toEqual({ text: 'A학교B', shapes: [0, 7, 8, 0] });
    expect(history.canRedo()).toBe(true);

    expect(() => history.redo(wasm as never)).toThrow('injected insert failure');
    expect(wasm.state()).toEqual({ text: 'A학교B', shapes: [0, 7, 8, 0] });
    expect(history.canRedo()).toBe(true);

    expect(history.redo(wasm as never)).toMatchObject({ charOffset: 3 });
    expect(wasm.state()).toEqual({ text: 'A學校B', shapes: [0, 7, 8, 0] });
  });

  it('keeps source text and history when both transition insertions are unavailable', () => {
    const wasm = new StatefulWasm('A학교B', [0, 7, 8, 0]);
    const history = new CommandHistory();
    installRecoveredCommandHistoryGuard({ history } as never);
    history.execute(
      new HanjaReplaceCommand(BODY_POSITION, '학교', '학교', 2, '學校'),
      wasm as never,
    );
    wasm.blockInsertionsOf('학교', '學校');

    expect(() => history.undo(wasm as never)).toThrow('injected insert failure');
    expect(wasm.state()).toEqual({ text: 'A學校B', shapes: [0, 7, 8, 0] });
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);

    wasm.allowInsertions();
    expect(history.undo(wasm as never)).toMatchObject({ charOffset: 3 });
    expect(wasm.state()).toEqual({ text: 'A학교B', shapes: [0, 7, 8, 0] });
  });

  it('maps a decomposed Hangul syllable to its first source character shape', () => {
    const wasm = new StatefulWasm('A하B', [0, 7, 8, 0]);
    const command = new HanjaReplaceCommand(BODY_POSITION, '하', '하', 2, '河');

    command.execute(wasm as never);
    expect(wasm.state()).toEqual({ text: 'A河B', shapes: [0, 7, 0] });

    command.undo(wasm as never);
    expect(wasm.state()).toEqual({ text: 'A하B', shapes: [0, 7, 8, 0] });
  });

  it('rejects a replacement whose Unicode scalar length differs from the normalized source', () => {
    const wasm = new StatefulWasm('A학교B', [0, 7, 8, 0]);
    const command = new HanjaReplaceCommand(BODY_POSITION, '학교', '학교', 2, '學');

    expect(() => command.execute(wasm as never)).toThrow(/글자 수/);
    expect(wasm.state()).toEqual({ text: 'A학교B', shapes: [0, 7, 8, 0] });
  });

  it('uses Unicode scalar counts for supplementary-plane Hanja', () => {
    const wasm = new StatefulWasm('A창황실색B', [0, 1, 2, 3, 4, 0]);
    const command = new HanjaReplaceCommand(
      BODY_POSITION,
      '창황실색',
      '창황실색',
      4,
      '𢠵怳失色',
    );

    expect(command.execute(wasm as never)).toMatchObject({ charOffset: 5 });
    expect(wasm.state()).toEqual({ text: 'A𢠵怳失色B', shapes: [0, 1, 2, 3, 4, 0] });

    expect(command.undo(wasm as never)).toMatchObject({ charOffset: 5 });
    expect(wasm.state()).toEqual({ text: 'A창황실색B', shapes: [0, 1, 2, 3, 4, 0] });
  });
});

describe('HanjaReplaceCommand with bundled WASM', () => {
  const wasm = new WasmBridge();

  beforeAll(async () => {
    const nativeFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL
        ? input
        : new URL(typeof input === 'string' ? input : input.url);
      if (url.protocol === 'file:') {
        const bytes = await readNodeFile(url);
        return new Response(new Uint8Array(bytes).buffer, {
          headers: { 'Content-Type': 'application/wasm' },
        });
      }
      return nativeFetch(input, init);
    });
    await wasm.initialize();
  });

  beforeEach(() => {
    wasm.createNewDocument();
    wasm.insertText(0, 0, 0, 'A학교B');
    wasm.applyCharFormat(0, 0, 1, 2, JSON.stringify({ bold: true }));
    wasm.applyCharFormat(0, 0, 2, 3, JSON.stringify({ italic: true }));
  });

  afterAll(() => {
    wasm.releaseDocument();
    vi.unstubAllGlobals();
  });

  it('preserves real WASM character-shape ids through execute, undo, and redo', () => {
    const originalShapeIds = realShapeIds(wasm);
    expect(new Set(originalShapeIds).size).toBeGreaterThan(1);
    const command = new HanjaReplaceCommand(BODY_POSITION, '학교', '학교', 2, '學校');

    command.execute(wasm);
    expect(wasm.getTextRange(0, 0, 0, 4)).toBe('A學校B');
    expect(realShapeIds(wasm)).toEqual(originalShapeIds);

    command.undo(wasm);
    expect(wasm.getTextRange(0, 0, 0, 4)).toBe('A학교B');
    expect(realShapeIds(wasm)).toEqual(originalShapeIds);

    command.execute(wasm);
    expect(wasm.getTextRange(0, 0, 0, 4)).toBe('A學校B');
    expect(realShapeIds(wasm)).toEqual(originalShapeIds);
  });

  it('does not evict a live WASM snapshot when all 100 shared slots are occupied', () => {
    const snapshotIds = Array.from({ length: 100 }, () => wasm.saveSnapshot());
    const oldestSnapshotId = snapshotIds[0];
    if (oldestSnapshotId === undefined) throw new Error('snapshot fixture was not created');

    try {
      const command = new HanjaReplaceCommand(BODY_POSITION, '학교', '학교', 2, '學校');
      command.execute(wasm);

      expect(() => wasm.restoreSnapshot(oldestSnapshotId)).not.toThrow();
    } finally {
      snapshotIds.forEach((snapshotId) => wasm.discardSnapshot(snapshotId));
    }
  });

  it('leaves the real WASM document unchanged when insertion fails before mutation', () => {
    const originalShapeIds = realShapeIds(wasm);
    const command = new HanjaReplaceCommand(BODY_POSITION, '학교', '학교', 2, '學校');
    const insertText = vi.spyOn(wasm, 'insertText').mockImplementationOnce(() => {
      throw new Error('injected WASM insert failure');
    });

    expect(() => command.execute(wasm)).toThrow('injected WASM insert failure');
    insertText.mockRestore();

    expect(wasm.getTextRange(0, 0, 0, 4)).toBe('A학교B');
    expect(realShapeIds(wasm)).toEqual(originalShapeIds);
  });

  it('restores the real WASM document when insertion mutates before throwing', () => {
    const originalShapeIds = realShapeIds(wasm);
    const command = new HanjaReplaceCommand(BODY_POSITION, '학교', '학교', 2, '學校');
    const originalInsertText = wasm.insertText.bind(wasm);
    const insertText = vi.spyOn(wasm, 'insertText').mockImplementationOnce((...args) => {
      originalInsertText(...args);
      throw new Error('injected WASM post-insert failure');
    });

    expect(() => command.execute(wasm)).toThrow('injected WASM post-insert failure');
    insertText.mockRestore();

    expect(wasm.getTextRange(0, 0, 0, 4)).toBe('A학교B');
    expect(realShapeIds(wasm)).toEqual(originalShapeIds);
  });

  it('restores the real WASM document when deletion mutates before throwing', () => {
    const originalShapeIds = realShapeIds(wasm);
    const command = new HanjaReplaceCommand(BODY_POSITION, '학교', '학교', 2, '學校');
    const originalDeleteText = wasm.deleteText.bind(wasm);
    const deleteText = vi.spyOn(wasm, 'deleteText').mockImplementationOnce((...args) => {
      originalDeleteText(...args);
      throw new Error('injected WASM post-delete failure');
    });

    expect(() => command.execute(wasm)).toThrow('injected WASM post-delete failure');
    deleteText.mockRestore();

    expect(wasm.getTextRange(0, 0, 0, 4)).toBe('A학교B');
    expect(realShapeIds(wasm)).toEqual(originalShapeIds);
  });

  it('keeps real WASM text and undo history when recovery insertions are unavailable', () => {
    const history = new CommandHistory();
    installRecoveredCommandHistoryGuard({ history } as never);
    history.execute(
      new HanjaReplaceCommand(BODY_POSITION, '학교', '학교', 2, '學校'),
      wasm,
    );
    const originalInsertText = wasm.insertText.bind(wasm);
    const insertText = vi.spyOn(wasm, 'insertText').mockImplementation((...args) => {
      const text = args[3];
      if (text === '학교' || text === '學校') throw new Error('injected WASM insert failure');
      return originalInsertText(...args);
    });

    expect(() => history.undo(wasm)).toThrow('injected WASM insert failure');
    expect(wasm.getTextRange(0, 0, 0, 4)).toBe('A學校B');
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);

    insertText.mockRestore();
    expect(history.undo(wasm)).toMatchObject({ charOffset: 3 });
    expect(wasm.getTextRange(0, 0, 0, 4)).toBe('A학교B');
  });
});

function realShapeIds(wasm: WasmBridge): number[] {
  return Array.from({ length: 4 }, (_, offset) => {
    const charShapeId = wasm.getCharPropertiesAt(0, 0, offset).charShapeId;
    if (charShapeId === undefined) throw new Error('WASM did not return a character-shape id');
    return charShapeId;
  });
}

function readNodeFile(url: URL): Promise<Uint8Array> {
  interface NodeProcess {
    getBuiltinModule(name: 'node:fs'): {
      promises: { readFile(path: URL): Promise<Uint8Array> };
    };
  }
  const nodeProcess = (globalThis as typeof globalThis & { process?: NodeProcess }).process;
  if (!nodeProcess) throw new Error('Bundled WASM integration tests require Node.js');
  return nodeProcess.getBuiltinModule('node:fs').promises.readFile(url);
}

class StatefulWasm {
  failNextInsert = false;
  failNextStyle = false;
  failAfterEveryStyle = false;
  failDeferredAfterInsert = false;
  deferredInsertCalls = 0;
  textAtStyleFailure: string | null = null;
  private characters: string[];
  private shapes: number[];
  private insertionFailure: { text: string; remaining: number } | null = null;
  private postInsertionFailure: { text: string; remaining: number } | null = null;
  private postDeleteFailureAt: number | null = null;
  private deleteFailureFrom: number | null = null;
  private deleteCalls = 0;
  private blockedInsertions = new Set<string>();

  constructor(text: string, shapes: number[]) {
    this.characters = Array.from(text);
    this.shapes = [...shapes];
  }

  state(): { text: string; shapes: number[] } {
    return { text: this.characters.join(''), shapes: [...this.shapes] };
  }

  failInsertionsOf(text: string, count: number): void {
    this.insertionFailure = { text, remaining: count };
  }

  failAfterInserting(text: string, count: number): void {
    this.postInsertionFailure = { text, remaining: count };
  }

  failAfterDeleting(call: number): void {
    this.postDeleteFailureAt = call;
  }

  failBeforeDeletingFrom(call: number): void {
    this.deleteFailureFrom = call;
  }

  blockInsertionsOf(...texts: string[]): void {
    this.blockedInsertions = new Set(texts);
  }

  allowInsertions(): void {
    this.blockedInsertions.clear();
  }

  getParagraphLength(): number {
    return this.characters.length;
  }

  getCellParagraphLength(): number {
    return this.characters.length;
  }

  getTextRange(_section: number, _paragraph: number, offset: number, count: number): string {
    return this.characters.slice(offset, offset + count).join('');
  }

  getTextInCell(
    _section: number,
    _parent: number,
    _control: number,
    _cell: number,
    _paragraph: number,
    offset: number,
    count: number,
  ): string {
    return this.characters.slice(offset, offset + count).join('');
  }

  getCharPropertiesAt(_section: number, _paragraph: number, offset: number) {
    return { charShapeId: this.shapes[offset] };
  }

  getCellCharPropertiesAt(
    _section: number,
    _parent: number,
    _control: number,
    _cell: number,
    _paragraph: number,
    offset: number,
  ) {
    return { charShapeId: this.shapes[offset] };
  }

  setCharShapeId(_section: number, _paragraph: number, start: number, end: number, id: number) {
    if (this.failNextStyle) {
      this.failNextStyle = false;
      this.textAtStyleFailure = this.characters.join('');
      throw new Error('injected style failure');
    }
    this.shapes.fill(id, start, end);
    if (this.failAfterEveryStyle) throw new Error('injected post-style failure');
  }

  setCharShapeIdInCell(
    _section: number,
    _parent: number,
    _control: number,
    _cell: number,
    _paragraph: number,
    start: number,
    end: number,
    id: number,
  ) {
    this.setCharShapeId(0, 0, start, end, id);
  }

  deleteText(_section: number, _paragraph: number, offset: number, count: number): void {
    this.delete(offset, count);
  }

  deleteTextInCell(
    _section: number,
    _parent: number,
    _control: number,
    _cell: number,
    _paragraph: number,
    offset: number,
    count: number,
  ): void {
    this.delete(offset, count);
  }

  insertText(_section: number, _paragraph: number, offset: number, text: string): void {
    this.insert(offset, text);
  }

  insertTextInCell(
    _section: number,
    _parent: number,
    _control: number,
    _cell: number,
    _paragraph: number,
    offset: number,
    text: string,
  ): void {
    this.insert(offset, text);
  }

  insertTextInCellDeferredPagination(
    section: number,
    parent: number,
    control: number,
    cell: number,
    paragraph: number,
    offset: number,
    text: string,
  ) {
    this.deferredInsertCalls += 1;
    this.insertTextInCell(section, parent, control, cell, paragraph, offset, text);
    if (this.failDeferredAfterInsert) throw new Error('mutated then failed parsing deferred result');
    return { paginationDeferred: false, cellFlowChanged: false };
  }

  private delete(offset: number, count: number): void {
    this.deleteCalls += 1;
    if (this.deleteFailureFrom !== null && this.deleteCalls >= this.deleteFailureFrom) {
      throw new Error('injected delete failure');
    }
    this.characters.splice(offset, count);
    this.shapes.splice(offset, count);
    if (this.deleteCalls === this.postDeleteFailureAt) {
      throw new Error('injected post-delete failure');
    }
  }

  private insert(offset: number, text: string): void {
    if (this.blockedInsertions.has(text)) throw new Error('injected insert failure');
    if (this.failNextInsert) {
      this.failNextInsert = false;
      throw new Error('injected insert failure');
    }
    if (this.insertionFailure?.text === text && this.insertionFailure.remaining > 0) {
      this.insertionFailure.remaining -= 1;
      throw new Error('injected insert failure');
    }
    const characters = Array.from(text);
    this.characters.splice(offset, 0, ...characters);
    this.shapes.splice(offset, 0, ...characters.map(() => 0));
    if (this.postInsertionFailure?.text === text && this.postInsertionFailure.remaining > 0) {
      this.postInsertionFailure.remaining -= 1;
      throw new Error('injected post-insert failure');
    }
  }
}
