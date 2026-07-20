import { afterEach, describe, expect, it } from 'vitest';
import { defaultShortcuts, matchShortcut } from './shortcut-map';
import { resetDesktopPlatformOverride } from '../core/platform';

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

  it('maps unmodified F9 to Hangul-Hanja conversion on every platform', () => {
    installNavigator({ platform: 'MacIntel', userAgent: 'Mac OS X' });

    expect(matchShortcut(keyEvent({ key: 'F9' }), defaultShortcuts)).toBe('edit:convert-hanja');
    expect(matchShortcut(keyEvent({ key: 'F9', metaKey: true }), defaultShortcuts)).toBeNull();
  });
});

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
