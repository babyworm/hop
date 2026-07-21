import { afterEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  lookupHanja: vi.fn(),
  openDialog: vi.fn(),
  readSource: vi.fn(),
  replaceSource: vi.fn(),
  sourceCurrent: vi.fn(),
}));

vi.mock('../../hanja/hanja-dictionary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hanja/hanja-dictionary')>();
  return {
    ...actual,
    createBundledHanjaDictionary: () => ({
      lookup: commandMocks.lookup,
      lookupHanja: commandMocks.lookupHanja,
    }),
  };
});
vi.mock('../../hanja/editor-text-range', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hanja/editor-text-range')>();
  return {
    ...actual,
    isConversionSourceCurrent: commandMocks.sourceCurrent,
    readConversionSource: commandMocks.readSource,
    replaceConversionSource: commandMocks.replaceSource,
  };
});
vi.mock('../../ui/hanja-conversion-dialog', () => ({
  openHanjaConversionDialog: commandMocks.openDialog,
}));

import { HanjaLookupError } from '../../hanja/hanja-dictionary';
import {
  hanjaCommands,
  isHanjaConversionContextEditable,
  logHanjaLookupFailure,
} from './hanja';

describe('Hanja command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    ['read-only document', { isEditable: false }],
    ['form mode', { isFormMode: true }],
    ['picture selection', { inPictureObjectSelection: true }],
    ['table selection', { inTableObjectSelection: true }],
    ['cell selection', { inCellSelectionMode: true }],
    ['multi-cell selection', { hasMultiCellSelection: true }],
  ])('disables conversion in %s', (_name, override) => {
    expect(isHanjaConversionContextEditable({ ...editableContext(), ...override } as never)).toBe(false);
  });

  it('routes a Hanja source to reverse lookup and applies the selected Hangul reading', async () => {
    const status = { textContent: '' };
    const source = { text: '學校', direction: 'hanja-to-hangul' };
    vi.stubGlobal('document', { getElementById: () => status });
    commandMocks.readSource.mockReturnValue(source);
    commandMocks.lookupHanja.mockResolvedValue({ kind: 'hangul', source: '學校', characters: [] });
    commandMocks.sourceCurrent.mockReturnValue(true);
    commandMocks.openDialog.mockResolvedValue('학교');

    hanjaCommands[0]!.execute({
      getContext: () => editableContext(),
      getInputHandler: () => ({}),
    } as never);

    await vi.waitFor(() => {
      expect(commandMocks.replaceSource).toHaveBeenCalledWith({}, source, '학교');
    });
    expect(commandMocks.lookupHanja).toHaveBeenCalledWith('學校');
    expect(commandMocks.lookup).not.toHaveBeenCalled();
  });

  it('rechecks editable context after the dialog resolves', async () => {
    const status = { textContent: '' };
    let context = editableContext();
    vi.stubGlobal('document', { getElementById: () => status });
    commandMocks.readSource.mockReturnValue({ text: '학' });
    commandMocks.lookup.mockResolvedValue({ kind: 'word', source: '학', candidates: [] });
    commandMocks.sourceCurrent.mockReturnValue(true);
    commandMocks.openDialog.mockImplementation(async () => {
      context = { ...context, inCellSelectionMode: true };
      return '學';
    });

    hanjaCommands[0]!.execute({
      getContext: () => context,
      getInputHandler: () => ({}),
    } as never);

    await vi.waitFor(() => {
      expect(status.textContent).toBe('편집 위치가 바뀌어 한자 변환을 취소했습니다.');
    });
    expect(commandMocks.replaceSource).not.toHaveBeenCalled();
  });

  it('does not open the dialog when context changes while dictionary lookup is pending', async () => {
    const status = { textContent: '' };
    let context = editableContext();
    let resolveLookup = (_value: unknown): void => {};
    const lookupPending = new Promise<unknown>((resolve) => {
      resolveLookup = (value) => resolve(value);
    });
    vi.stubGlobal('document', { getElementById: () => status });
    commandMocks.readSource.mockReturnValue({ text: '학' });
    commandMocks.lookup.mockReturnValue(lookupPending);
    commandMocks.sourceCurrent.mockReturnValue(true);

    hanjaCommands[0]!.execute({
      getContext: () => context,
      getInputHandler: () => ({}),
    } as never);
    context = { ...context, isFormMode: true };
    resolveLookup({ kind: 'word', source: '학', candidates: [] });

    await vi.waitFor(() => {
      expect(status.textContent).toBe('편집 위치가 바뀌어 한자 변환을 취소했습니다.');
    });
    expect(commandMocks.openDialog).not.toHaveBeenCalled();
    expect(commandMocks.replaceSource).not.toHaveBeenCalled();
  });

  it('logs only bounded dictionary diagnostics without source document text', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = new HanjaLookupError('load-failed', '사전을 읽지 못했습니다.', {
      asset: 'words-h.json',
      status: 404,
      cause: new Error('missing asset'),
    });

    logHanjaLookupFailure(error);

    expect(warn).toHaveBeenCalledWith('[hanja-conversion] 내장 사전 오류', {
      code: 'load-failed',
      asset: 'words-h.json',
      status: 404,
      cause: 'Error: missing asset',
    });
  });
});

function editableContext() {
  return {
    hasDocument: true,
    isEditable: true,
    isFormMode: false,
    inPictureObjectSelection: false,
    inTableObjectSelection: false,
    inCellSelectionMode: false,
    hasMultiCellSelection: false,
  };
}
