import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { advanceDocumentGeneration } from '../core/document-generation';
import { openHanjaConversionDialog } from './hanja-conversion-dialog';

const hanjaDialogCss = readNodeTextFile(
  new URL('../styles/hanja-conversion-dialog.css', import.meta.url),
);

class FakeElement {
  id = '';
  className = '';
  textContent = '';
  type = '';
  tabIndex: number;
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  private attributes = new Map<string, string>();
  private listeners = new Map<string, Array<(event: FakeEvent) => void>>();
  readonly scrollIntoViewCalls: ScrollIntoViewOptions[] = [];
  focusCalls = 0;

  constructor(private readonly owner?: FakeDocument, readonly tagName = 'DIV') {
    this.tabIndex = tagName === 'BUTTON' ? 0 : -1;
  }

  append(...children: FakeElement[]): void {
    children.forEach((child) => this.appendChild(child));
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.forEach((child) => { child.parent = null; });
    this.children = [];
    this.append(...children);
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    if (!selector.startsWith('.')) return [];
    const className = selector.slice(1);
    return this.descendants().filter((element) => element.className.split(/\s+/u).includes(className));
  }

  focus(): void {
    this.focusCalls += 1;
    if (this.owner) this.owner.activeElement = this;
  }

  remove(): void {
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = null;
  }

  scrollIntoView(options?: ScrollIntoViewOptions): void {
    this.scrollIntoViewCalls.push(options ?? {});
  }

  dispatch(type: string, event = new FakeEvent()): void {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }

  descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
}

class FakeEvent {
  key = '';
  shiftKey = false;
  target: FakeElement | null = null;
  defaultPrevented = false;
  propagationStopped = false;

  preventDefault(): void { this.defaultPrevented = true; }
  stopPropagation(): void { this.propagationStopped = true; }
}

class FakeWindow {
  private listeners = new Map<string, Array<(event: FakeEvent) => void>>();

  addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  }

  dispatch(type: string, event: FakeEvent): void {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

class FakeDocument {
  body = new FakeElement(this);
  activeElement: FakeElement = this.body;
  private listeners = new Map<string, Array<(event: FakeEvent) => void>>();

  constructor(private readonly defaultView: FakeWindow) {}

  createElement(tagName = 'div'): FakeElement {
    return new FakeElement(this, tagName.toUpperCase());
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  }

  key(key: string, target = this.activeElement, shiftKey = false): FakeEvent {
    const event = new FakeEvent();
    event.key = key;
    event.target = target;
    event.shiftKey = shiftKey;
    this.defaultView.dispatch('keydown', event);
    if (!event.propagationStopped) {
      this.listeners.get('keydown')?.forEach((listener) => listener(event));
    }
    return event;
  }
}

describe('openHanjaConversionDialog', () => {
  let fakeDocument: FakeDocument;
  let fakeWindow: FakeWindow;

  beforeEach(() => {
    fakeWindow = new FakeWindow();
    fakeDocument = new FakeDocument(fakeWindow);
    (globalThis as Record<string, unknown>).document = fakeDocument;
    (globalThis as Record<string, unknown>).HTMLElement = FakeElement;
    (globalThis as Record<string, unknown>).window = fakeWindow;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).document;
    delete (globalThis as Record<string, unknown>).HTMLElement;
    delete (globalThis as Record<string, unknown>).window;
  });

  it('renders word 훈음 and confirms the selected word with Enter', async () => {
    const pending = openHanjaConversionDialog({
      kind: 'word',
      source: '학교',
      candidates: [{
        text: '學校',
        source: 7,
        definition: '교육 기관',
        characters: [
          { character: '學', label: '배울 학', reading: '학', meaning: '배울' },
          { character: '校', label: '학교 교', reading: '교', meaning: '학교' },
        ],
      }],
    });

    const renderedText = fakeDocument.body.descendants().map(({ textContent }) => textContent).join(' ');
    expect(renderedText).toContain('學 배울 학 · 校 학교 교');
    expect(fakeDocument.key('Enter').defaultPrevented).toBe(true);
    await expect(pending).resolves.toBe('學校');
    expect(fakeDocument.body.children).toHaveLength(0);
  });

  it('selects characters per syllable and advances with Enter', async () => {
    const pending = openHanjaConversionDialog({
      kind: 'syllables',
      source: '학교',
      syllables: [
        {
          source: '학',
          candidates: [
            character('學', '배울 학'),
            character('鶴', '학 학'),
          ],
        },
        { source: '교', candidates: [character('校', '학교 교')] },
      ],
    });

    fakeDocument.key('ArrowDown');
    expect(previewText(fakeDocument)).toBe('鶴校');
    fakeDocument.key('Enter');
    fakeDocument.key('Enter');

    await expect(pending).resolves.toBe('鶴校');
  });

  it('renders Hanja readings with meanings and assembles a Hangul result', async () => {
    const pending = openHanjaConversionDialog({
      kind: 'hangul',
      source: '樂校',
      characters: [
        {
          source: '樂',
          candidates: [
            character('樂', '즐길 낙'),
            character('樂', '즐거울 락'),
            character('樂', '풍류 악'),
          ],
        },
        { source: '校', candidates: [character('校', '학교 교')] },
      ],
    });

    const renderedText = fakeDocument.body.descendants().map(({ textContent }) => textContent).join(' ');
    expect(renderedText).toContain('즐길 낙');
    expect(previewText(fakeDocument)).toBe('낙교');
    fakeDocument.key('ArrowDown');
    expect(previewText(fakeDocument)).toBe('락교');
    fakeDocument.key('Enter');
    fakeDocument.key('Enter');

    await expect(pending).resolves.toBe('락교');
  });

  it('cancels without a replacement on Escape', async () => {
    const pending = openHanjaConversionDialog({
      kind: 'syllables',
      source: '학',
      syllables: [{ source: '학', candidates: [character('學', '배울 학')] }],
    });

    expect(fakeDocument.key('Escape').propagationStopped).toBe(true);
    await expect(pending).resolves.toBeNull();
  });

  it('blocks F11 before an earlier document capture handler can mutate the editor', async () => {
    let editorHandledF11 = false;
    fakeDocument.addEventListener('keydown', (event) => {
      if (event.key === 'F11') editorHandledF11 = true;
    });
    const pending = openWordDialog();

    const event = fakeDocument.key('F11');

    expect(editorHandledF11).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    fakeDocument.key('Escape');
    await pending;
  });

  it('cancels when the primary document generation advances', async () => {
    const previouslyFocused = fakeDocument.createElement('textarea');
    fakeDocument.body.appendChild(previouslyFocused);
    previouslyFocused.focus();
    const pending = openWordDialog();

    advanceDocumentGeneration();

    expect(fakeDocument.body.children.length).toBe(1);
    expect(fakeDocument.body.children[0]).toBe(previouslyFocused);
    expect(previouslyFocused.focusCalls).toBe(1);
    await expect(pending).resolves.toBeNull();
  });

  it.each([
    ['Cancel', '.dialog-btn', 1],
    ['Close', '.dialog-close', 0],
  ])('lets the native %s button handle Enter', async (_name, selector, index) => {
    const pending = openWordDialog();
    const button = fakeDocument.body.querySelectorAll(selector)[index]!;
    button.focus();

    const event = fakeDocument.key('Enter', button);
    if (!event.defaultPrevented) button.dispatch('click', event);

    expect(event.defaultPrevented).toBe(false);
    await expect(pending).resolves.toBeNull();
  });

  it('keeps only the listbox in the candidate tab order', async () => {
    const pending = openWordDialog();
    const list = fakeDocument.body.querySelectorAll('.hanja-candidate-list')[0]!;

    expect(list.tabIndex).toBe(0);
    expect(list.querySelectorAll('.hanja-candidate-item').map(({ tabIndex }) => tabIndex))
      .toEqual([-1]);

    fakeDocument.key('Escape');
    await pending;
  });

  it('wraps Tab from the last modal control to the close button', async () => {
    const pending = openWordDialog();
    const cancel = fakeDocument.body.querySelectorAll('.dialog-btn')[1]!;
    const close = fakeDocument.body.querySelectorAll('.dialog-close')[0]!;
    cancel.focus();

    const event = fakeDocument.key('Tab', cancel);

    expect(event.defaultPrevented).toBe(true);
    expect(fakeDocument.activeElement === close).toBe(true);
    fakeDocument.key('Escape');
    await pending;
  });

  it('wraps Shift+Tab from the close button to the last modal control', async () => {
    const pending = openWordDialog();
    const cancel = fakeDocument.body.querySelectorAll('.dialog-btn')[1]!;
    const close = fakeDocument.body.querySelectorAll('.dialog-close')[0]!;
    close.focus();

    const event = fakeDocument.key('Tab', close, true);

    expect(event.defaultPrevented).toBe(true);
    expect(fakeDocument.activeElement === cancel).toBe(true);
    fakeDocument.key('Escape');
    await pending;
  });

  it('keeps syllable tabs, the listbox, and shared actions in the intended tab order', async () => {
    const pending = openTwoSyllableDialog();
    const list = fakeDocument.body.querySelectorAll('.hanja-candidate-list')[0]!;

    expect(fakeDocument.body.querySelectorAll('.hanja-syllable-tab').map(({ tabIndex }) => tabIndex))
      .toEqual([0, 0]);
    expect(list.tabIndex).toBe(0);
    expect(list.querySelectorAll('.hanja-candidate-item').map(({ tabIndex }) => tabIndex))
      .toEqual([-1, -1]);
    expect(fakeDocument.body.querySelectorAll('.dialog-btn').map(({ tabIndex }) => tabIndex))
      .toEqual([0, 0]);
    expect(fakeDocument.body.querySelectorAll('.dialog-close')[0]!.tabIndex).toBe(0);

    fakeDocument.key('Escape');
    await pending;
  });

  it('handles syllable Arrow and Enter mode keys only from the listbox', async () => {
    const pending = openTwoSyllableDialog();
    const list = fakeDocument.body.querySelectorAll('.hanja-candidate-list')[0]!;
    const tab = fakeDocument.body.querySelectorAll('.hanja-syllable-tab')[0]!;

    expect(fakeDocument.key('ArrowDown', tab).defaultPrevented).toBe(false);
    expect(fakeDocument.key('Enter', tab).defaultPrevented).toBe(false);
    expect(previewText(fakeDocument)).toBe('學校');

    expect(fakeDocument.key('ArrowDown', list).defaultPrevented).toBe(true);
    expect(previewText(fakeDocument)).toBe('鶴校');
    expect(fakeDocument.key('Enter', list).defaultPrevented).toBe(true);
    expect(fakeDocument.body.querySelectorAll('.hanja-syllable-tab').map((item) => (
      item.getAttribute('aria-pressed')
    ))).toEqual(['false', 'true']);

    fakeDocument.key('Escape');
    await pending;
  });

  it('returns focus to the word list after a candidate click', async () => {
    const pending = openWordDialog();
    const list = fakeDocument.body.querySelectorAll('.hanja-candidate-list')[0]!;
    const candidate = list.querySelectorAll('.hanja-candidate-item')[0]!;
    candidate.focus();

    candidate.dispatch('click');

    expect(fakeDocument.activeElement === list).toBe(true);
    fakeDocument.key('Escape');
    await pending;
  });

  it('keeps the clicked syllable candidate mounted and returns focus to its list', async () => {
    const pending = openHanjaConversionDialog({
      kind: 'syllables',
      source: '학',
      syllables: [{ source: '학', candidates: [character('學', '배울 학'), character('鶴', '학 학')] }],
    });
    const list = fakeDocument.body.querySelectorAll('.hanja-candidate-list')[0]!;
    const candidate = list.querySelectorAll('.hanja-candidate-item')[1]!;
    candidate.focus();

    candidate.dispatch('click');

    expect(list.querySelectorAll('.hanja-candidate-item')[1] === candidate).toBe(true);
    expect(fakeDocument.activeElement === list).toBe(true);
    fakeDocument.key('Escape');
    await pending;
  });

  it('keeps the active syllable tab visible during keyboard navigation', async () => {
    const pending = openHanjaConversionDialog({
      kind: 'syllables',
      source: '학'.repeat(9),
      syllables: Array.from({ length: 9 }, () => ({
        source: '학',
        candidates: [character('學', '배울 학')],
      })),
    });

    fakeDocument.key('ArrowRight');

    const activeTab = fakeDocument.body.querySelectorAll('.hanja-syllable-tab')[1]!;
    expect(activeTab.scrollIntoViewCalls).toContainEqual({ block: 'nearest', inline: 'nearest' });
    fakeDocument.key('Escape');
    await pending;
  });

  it('keeps candidate rows at their natural height inside the scrollable list', () => {
    expect(cssRule('.hanja-candidate-item')).toContain('flex-shrink: 0;');
  });

  it('uses a solid focus border in addition to the soft listbox halo', () => {
    expect(cssRule('.hanja-candidate-list:focus-visible'))
      .toContain('outline: 1px solid var(--color-focus-border);');
  });

  it('uses contrast-safe semantic colors for the primary action in both themes', () => {
    expect(cssRule('.hanja-conversion-dialog .dialog-btn-primary')).toContain(
      'background: var(--color-primary-dark);',
    );
    expect(cssRule(':root[data-theme-effective="dark"] .hanja-conversion-dialog .dialog-btn-primary'))
      .toContain('color: var(--color-bg);');
  });
});

function cssRule(selector: string): string {
  const start = hanjaDialogCss.indexOf(`${selector} {`);
  if (start < 0) {
    throw new Error(`missing CSS rule: ${selector}; loaded ${JSON.stringify(hanjaDialogCss.slice(0, 80))}`);
  }
  const end = hanjaDialogCss.indexOf('}', start);
  if (end < 0) throw new Error(`unterminated CSS rule: ${selector}`);
  return hanjaDialogCss.slice(start, end + 1);
}

function readNodeTextFile(url: URL): string {
  interface NodeProcess {
    getBuiltinModule(name: 'node:fs'): {
      readFileSync(path: URL, encoding: 'utf8'): string;
    };
  }
  const nodeProcess = (globalThis as typeof globalThis & { process?: NodeProcess }).process;
  if (!nodeProcess) throw new Error('CSS contract tests require Node.js');
  return nodeProcess.getBuiltinModule('node:fs').readFileSync(url, 'utf8');
}

function character(characterValue: string, label: string) {
  const words = label.split(' ');
  return {
    character: characterValue,
    label,
    reading: words.at(-1) ?? '',
    meaning: words.slice(0, -1).join(' '),
    educationHanja: true,
    personalNameHanja: false,
  };
}

function previewText(document: FakeDocument): string {
  const preview = document.body.querySelectorAll('.hanja-conversion-preview-value')[0];
  if (!preview) throw new Error('missing preview');
  return preview.textContent;
}

function openWordDialog(): Promise<string | null> {
  return openHanjaConversionDialog({
    kind: 'word',
    source: '학',
    candidates: [{
      text: '學',
      source: 1,
      characters: [{ character: '學', label: '배울 학', reading: '학', meaning: '배울' }],
    }],
  });
}

function openTwoSyllableDialog(): Promise<string | null> {
  return openHanjaConversionDialog({
    kind: 'syllables',
    source: '학교',
    syllables: [
      { source: '학', candidates: [character('學', '배울 학'), character('鶴', '학 학')] },
      { source: '교', candidates: [character('校', '학교 교')] },
    ],
  });
}
