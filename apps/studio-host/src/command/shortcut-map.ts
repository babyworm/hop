import {
  defaultShortcuts as upstreamDefaultShortcuts,
} from '@/upstream/shortcuts';
import type { ShortcutDef } from '@/upstream/shortcuts';
import {
  detectDesktopPlatform,
  hasPrimaryModifier,
  normalizeShortcutLabel,
  type DesktopPlatform,
} from '../core/platform';
import type { HanjaConversionDirection } from '../hanja/editor-text-range';

export type { ShortcutDef };

const hopShortcuts: [ShortcutDef, string][] = [
  [{ key: 'n', ctrl: true, shift: true }, 'file:new-window'],
  [{ key: 'o', ctrl: true, alt: true }, 'file:open-recent'],
  [{ key: 's', ctrl: true, shift: true }, 'file:save-as'],
];

type HanjaShortcutEvent = Pick<
  KeyboardEvent,
  | 'key'
  | 'code'
  | 'ctrlKey'
  | 'metaKey'
  | 'shiftKey'
  | 'altKey'
  | 'target'
  | 'isComposing'
  | 'keyCode'
  | 'preventDefault'
  | 'stopPropagation'
>;

export type HanjaShortcutCaptureState = {
  readonly editorInput: EventTarget | null;
  readonly isEditorActive: boolean;
  readonly hasActiveModal: boolean;
  readonly isInternallyComposing: boolean;
  readonly hasActivePlacementMode: boolean;
  readonly editorInputHasFocus: boolean;
};

export function handleHanjaShortcutCapture(
  event: HanjaShortcutEvent,
  dispatcher: {
    dispatch(commandId: string, params?: Record<string, unknown>): boolean;
  },
  state: HanjaShortcutCaptureState,
): boolean {
  const direction = matchHanjaConversionShortcut(event);
  if (
    direction === null ||
    state.editorInput === null ||
    (event.target !== state.editorInput && !state.editorInputHasFocus) ||
    !state.isEditorActive || state.hasActiveModal ||
    event.isComposing || event.keyCode === 229 || state.isInternallyComposing ||
    state.hasActivePlacementMode
  ) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  dispatcher.dispatch('edit:convert-hanja', { direction });
  return true;
}

export function matchHanjaConversionShortcut(
  event: Pick<
    HanjaShortcutEvent,
    'key' | 'code' | 'keyCode' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'
  >,
  platform: DesktopPlatform = detectDesktopPlatform(),
): HanjaConversionDirection | null {
  if (event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (!event.altKey && isFunctionKey(event, 9)) return 'hangul-to-hanja';
  if (!event.altKey) return null;

  const reverseKey = platform === 'windows' ? 8 : 9;
  return isFunctionKey(event, reverseKey) ? 'hanja-to-hangul' : null;
}

export function hanjaConversionShortcutLabel(
  direction: HanjaConversionDirection,
  platform: DesktopPlatform = detectDesktopPlatform(),
): string {
  if (direction === 'hangul-to-hanja') return 'F9';
  const label = platform === 'windows' ? 'Alt+F8' : 'Alt+F9';
  return normalizeShortcutLabel(label, platform);
}

export function hanjaCommandShortcutLabel(
  platform: DesktopPlatform = detectDesktopPlatform(),
): string {
  return `F9 / ${hanjaConversionShortcutLabel('hanja-to-hangul', platform)}`;
}

function isFunctionKey(
  event: Pick<HanjaShortcutEvent, 'key' | 'code' | 'keyCode'>,
  number: 8 | 9,
): boolean {
  const key = `f${number}`;
  return event.key.toLowerCase() === key ||
    event.code.toLowerCase() === key ||
    event.keyCode === 111 + number;
}

const hopShortcutKeys = new Set(hopShortcuts.map(([shortcut]) => shortcutKey(shortcut)));

export const defaultShortcuts: [ShortcutDef, string][] = [
  ...hopShortcuts,
  ...upstreamDefaultShortcuts.filter(([shortcut]) => !hopShortcutKeys.has(shortcutKey(shortcut))),
];

export function matchShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
  shortcuts: [ShortcutDef, string][],
): string | null {
  const primaryModifier = hasPrimaryModifier(event);

  for (const [def, commandId] of shortcuts) {
    if ((def.ctrl ?? false) !== primaryModifier) continue;
    if ((def.shift ?? false) !== event.shiftKey) continue;
    if ((def.alt ?? false) !== event.altKey) continue;
    if (event.key.toLowerCase() === def.key) return commandId;
  }

  return null;
}

function shortcutKey(shortcut: ShortcutDef): string {
  return [
    shortcut.key.toLowerCase(),
    shortcut.ctrl ? 'ctrl' : '',
    shortcut.shift ? 'shift' : '',
    shortcut.alt ? 'alt' : '',
  ].join(':');
}
