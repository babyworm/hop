import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultShortcuts,
  handleHanjaShortcutCapture,
  matchShortcut,
} from './shortcut-map';
import { resetDesktopPlatformOverride } from '../core/platform';
import { getInputHandlerShortcutCaptureState } from '../upstream/editor';

describe('shortcut-map', () => {
  afterEach(() => {
    delete (globalThis as { navigator?: Navigator }).navigator;
    resetDesktopPlatformOverride();
  });

  it('matches Meta shortcuts on macOS', () => {
    installNavigator({ platform: 'MacIntel', userAgent: 'Mac OS X' });

    expect(matchShortcut(keyEvent({ key: 's', metaKey: true }), defaultShortcuts)).toBe('file:save');
    expect(matchShortcut(keyEvent({ key: 'n', metaKey: true, shiftKey: true }), defaultShortcuts))
      .toBe('file:new-window');
    expect(matchShortcut(keyEvent({ key: 'o', metaKey: true, altKey: true }), defaultShortcuts))
      .toBe('file:open-recent');
  });

  it('keeps Ctrl+E mapped to upstream delete instead of PDF export', () => {
    installNavigator({ platform: 'Win32', userAgent: 'Windows NT 10.0' });

    expect(matchShortcut(keyEvent({ key: 'e', ctrlKey: true }), defaultShortcuts)).toBe('edit:delete');
  });

  it('does not treat Meta as Ctrl on Windows', () => {
    installNavigator({ platform: 'Win32', userAgent: 'Windows NT 10.0' });

    expect(matchShortcut(keyEvent({ key: 's', metaKey: true }), defaultShortcuts)).toBeNull();
    expect(matchShortcut(keyEvent({ key: 's', ctrlKey: true }), defaultShortcuts)).toBe('file:save');
  });

  it('keeps F9 out of the late upstream shortcut path', () => {
    installNavigator({ platform: 'MacIntel', userAgent: 'Mac OS X' });

    expect(matchShortcut(keyEvent({ key: 'F9' }), defaultShortcuts)).toBeNull();
    expect(matchShortcut(keyEvent({ key: 'F9', metaKey: true }), defaultShortcuts)).toBeNull();
  });

  it('consumes unmodified F9 before upstream even when the command is disabled', () => {
    const dispatcher = { dispatch: vi.fn(() => false) };
    const event = captureKeyEvent({ key: 'F9' });

    expect(handleHanjaShortcutCapture(event, dispatcher, captureState())).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(dispatcher.dispatch).toHaveBeenCalledWith('edit:convert-hanja');
  });

  it('ignores modified F9 in the capture path', () => {
    expectHanjaCaptureIgnored(
      captureKeyEvent({ key: 'F9', shiftKey: true }),
      captureState(),
    );
  });

  it('ignores F9 while a modal overlay is active', () => {
    expectHanjaCaptureIgnored(
      captureKeyEvent({ key: 'F9' }),
      captureState({ hasActiveModal: true }),
    );
  });

  it.each([
    ['event composition state', { isComposing: true }],
    ['legacy IME key code', { keyCode: 229 }],
  ])('ignores F9 during %s', (_label, eventState) => {
    expectHanjaCaptureIgnored(
      captureKeyEvent({ key: 'F9', ...eventState }),
      captureState(),
    );
  });

  it('ignores F9 while the input handler still owns an IME composition', () => {
    expectHanjaCaptureIgnored(
      captureKeyEvent({ key: 'F9' }),
      captureState({ isInternallyComposing: true }),
    );
  });

  it('ignores F9 from a target other than the current editor input', () => {
    expectHanjaCaptureIgnored(
      captureKeyEvent({ key: 'F9', target: new EventTarget() }),
      captureState(),
    );
  });

  it('ignores F9 when the editor input handler is inactive', () => {
    expectHanjaCaptureIgnored(
      captureKeyEvent({ key: 'F9' }),
      captureState({ isEditorActive: false }),
    );
  });

  it('ignores F9 while the editor owns a placement or drawing mode', () => {
    expectHanjaCaptureIgnored(
      captureKeyEvent({ key: 'F9' }),
      captureState({ hasActivePlacementMode: true }),
    );
  });

  it('fails closed when the pinned input-handler private state contract drifts', () => {
    const state = getInputHandlerShortcutCaptureState({
      isActive: () => true,
      textarea: editorInputTarget,
    } as never);

    expect(state).toMatchObject({
      editorInput: editorInputTarget,
      isEditorActive: true,
      isInternallyComposing: true,
      hasActivePlacementMode: true,
    });
  });
});

function expectHanjaCaptureIgnored(
  event: ReturnType<typeof captureKeyEvent>,
  state: ReturnType<typeof captureState>,
): void {
  const dispatcher = { dispatch: vi.fn(() => true) };

  expect(handleHanjaShortcutCapture(event, dispatcher, state)).toBe(false);
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(event.stopPropagation).not.toHaveBeenCalled();
  expect(dispatcher.dispatch).not.toHaveBeenCalled();
}

function installNavigator(value: Pick<Navigator, 'platform' | 'userAgent'>): void {
  Object.defineProperty(globalThis, 'navigator', {
    value,
    configurable: true,
  });
}

function keyEvent(
  overrides: Partial<Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>>,
): KeyboardEvent {
  return {
    key: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  } as KeyboardEvent;
}

function captureKeyEvent(
  overrides: Partial<Pick<
    KeyboardEvent,
    | 'key'
    | 'ctrlKey'
    | 'metaKey'
    | 'shiftKey'
    | 'altKey'
    | 'isComposing'
    | 'keyCode'
    | 'target'
  >>,
) {
  return {
    ...keyEvent(overrides),
    target: editorInputTarget,
    isComposing: false,
    keyCode: 0,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  };
}

const editorInputTarget = new EventTarget();

function captureState(overrides: Partial<{
  editorInput: EventTarget | null;
  isEditorActive: boolean;
  hasActiveModal: boolean;
  isInternallyComposing: boolean;
  hasActivePlacementMode: boolean;
}> = {}) {
  return {
    editorInput: editorInputTarget,
    isEditorActive: true,
    hasActiveModal: false,
    isInternallyComposing: false,
    hasActivePlacementMode: false,
    ...overrides,
  };
}
