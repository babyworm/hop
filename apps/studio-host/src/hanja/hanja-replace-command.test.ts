import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WasmBridge } from '@/upstream/core';
import { CommandHistory } from '@upstream/engine/history';
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

  it('restores text and character shapes when insertion fails after deletion', () => {
    const wasm = new StatefulWasm('A학교B', [0, 7, 8, 0]);
    const command = new HanjaReplaceCommand(BODY_POSITION, '학교', '학교', 2, '學校');
    wasm.failNextInsert = true;

    expect(() => command.execute(wasm as never)).toThrow('injected insert failure');

    expect(wasm.state()).toEqual({ text: 'A학교B', shapes: [0, 7, 8, 0] });
  });

  it('restores text and character shapes when character-shape application fails after insertion', () => {
    const wasm = new StatefulWasm('A학교B', [0, 7, 8, 0]);
    const command = new HanjaReplaceCommand(BODY_POSITION, '학교', '학교', 2, '學校');
    wasm.failNextStyle = true;

    expect(() => command.execute(wasm as never)).toThrow('injected style failure');

    expect(wasm.textAtStyleFailure).toBe('A學校B');
    expect(wasm.state()).toEqual({ text: 'A학교B', shapes: [0, 7, 8, 0] });
  });

  it('completes transiently failing undo and redo without corrupting command history', () => {
    const wasm = new StatefulWasm('A학교B', [0, 7, 8, 0]);
    const history = new CommandHistory();
    const command = new HanjaReplaceCommand(BODY_POSITION, '학교', '학교', 2, '學校');
    history.execute(command, wasm as never);

    wasm.failNextInsert = true;
    expect(() => history.undo(wasm as never)).not.toThrow();
    expect(wasm.state()).toEqual({ text: 'A학교B', shapes: [0, 7, 8, 0] });

    wasm.failNextInsert = true;
    expect(() => history.redo(wasm as never)).not.toThrow();
    expect(wasm.state()).toEqual({ text: 'A學校B', shapes: [0, 7, 8, 0] });

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

  it('restores the real WASM document when insertion throws after deletion', () => {
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
  textAtStyleFailure: string | null = null;
  private characters: string[];
  private shapes: number[];

  constructor(text: string, shapes: number[]) {
    this.characters = Array.from(text);
    this.shapes = [...shapes];
  }

  state(): { text: string; shapes: number[] } {
    return { text: this.characters.join(''), shapes: [...this.shapes] };
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
    this.insertTextInCell(section, parent, control, cell, paragraph, offset, text);
    return { paginationDeferred: false, cellFlowChanged: false };
  }

  private delete(offset: number, count: number): void {
    this.characters.splice(offset, count);
    this.shapes.splice(offset, count);
  }

  private insert(offset: number, text: string): void {
    if (this.failNextInsert) {
      this.failNextInsert = false;
      throw new Error('injected insert failure');
    }
    const characters = Array.from(text);
    this.characters.splice(offset, 0, ...characters);
    this.shapes.splice(offset, 0, ...characters.map(() => 0));
  }
}
