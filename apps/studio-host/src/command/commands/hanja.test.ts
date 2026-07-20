import { afterEach, describe, expect, it, vi } from 'vitest';
import { HanjaLookupError } from '../../hanja/hanja-dictionary';
import { hanjaCommands, logHanjaLookupFailure } from './hanja';

describe('Hanja command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('is disabled in form mode and reports an explicit reason on direct dispatch', () => {
    const status = { textContent: '' };
    vi.stubGlobal('document', { getElementById: () => status });
    const command = hanjaCommands[0]!;
    const context = {
      hasDocument: true,
      isEditable: true,
      isFormMode: true,
      inPictureObjectSelection: false,
      inTableObjectSelection: false,
      inCellSelectionMode: false,
      hasMultiCellSelection: false,
    };

    expect(command.canExecute?.(context as never)).toBe(false);
    command.execute({ getContext: () => context } as never);
    expect(status.textContent).toBe('양식 모드에서는 아직 한자 변환을 지원하지 않습니다.');
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
