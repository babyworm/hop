import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openHanjaConversionDialog } from './hanja-conversion-dialog';

class FakeElement {
  id = '';
  className = '';
  textContent = '';
  type = '';
  tabIndex = -1;
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  private attributes = new Map<string, string>();
  private listeners = new Map<string, Array<(event: FakeEvent) => void>>();

  constructor(private readonly owner?: FakeDocument) {}

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
    if (this.owner) this.owner.activeElement = this;
  }

  remove(): void {
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = null;
  }

  scrollIntoView(): void {}

  dispatch(type: string, event = new FakeEvent()): void {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }

  descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
}

class FakeEvent {
  key = '';
  target: FakeElement | null = null;
  defaultPrevented = false;
  propagationStopped = false;

  preventDefault(): void { this.defaultPrevented = true; }
  stopPropagation(): void { this.propagationStopped = true; }
}

class FakeDocument {
  body = new FakeElement(this);
  activeElement: FakeElement = this.body;
  private listeners = new Map<string, Array<(event: FakeEvent) => void>>();

  createElement(): FakeElement {
    return new FakeElement(this);
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

  key(key: string): FakeEvent {
    const event = new FakeEvent();
    event.key = key;
    this.listeners.get('keydown')?.forEach((listener) => listener(event));
    return event;
  }
}

describe('openHanjaConversionDialog', () => {
  let fakeDocument: FakeDocument;

  beforeEach(() => {
    fakeDocument = new FakeDocument();
    (globalThis as Record<string, unknown>).document = fakeDocument;
    (globalThis as Record<string, unknown>).HTMLElement = FakeElement;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).document;
    delete (globalThis as Record<string, unknown>).HTMLElement;
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

  it('cancels without a replacement on Escape', async () => {
    const pending = openHanjaConversionDialog({
      kind: 'syllables',
      source: '학',
      syllables: [{ source: '학', candidates: [character('學', '배울 학')] }],
    });

    expect(fakeDocument.key('Escape').propagationStopped).toBe(true);
    await expect(pending).resolves.toBeNull();
  });
});

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
