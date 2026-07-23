import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadBundledHanjaNotices = vi.hoisted(() => vi.fn());

vi.mock('../hanja/hanja-dictionary', () => ({ loadBundledHanjaNotices }));
vi.mock('@/upstream/ui', () => ({
  AboutDialog: class {
    protected createBody(): HTMLElement {
      const body = document.createElement('div');
      const version = document.createElement('div');
      version.className = 'about-version';
      const copyright = document.createElement('div');
      copyright.className = 'about-copyright';
      body.append(version, copyright);
      return body;
    }
  },
}));

import { AboutDialog } from './about-dialog';

class TestAboutDialog extends AboutDialog {
  renderBody(): void {
    this.createBody();
  }
}

class FakeElement {
  readonly children: FakeElement[] = [];
  className = '';
  textContent = '';
  open = false;
  parentNode: FakeElement | null = null;
  private readonly listeners = new Map<string, Array<() => void>>();

  append(...children: FakeElement[]): void {
    for (const child of children) this.appendChild(child);
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child: FakeElement, reference: FakeElement): FakeElement {
    const index = this.children.indexOf(reference);
    child.parentNode = this;
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    return child;
  }

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string): void {
    this.listeners.get(type)?.forEach((listener) => listener());
  }

  querySelector(selector: string): FakeElement | null {
    const className = selector.startsWith('.') ? selector.slice(1) : '';
    for (const child of this.descendants()) {
      if (child.className.split(/\s+/u).includes(className)) return child;
    }
    return null;
  }

  private descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
}

class FakeDocument {
  readonly elements: FakeElement[] = [];

  createElement(): FakeElement {
    const element = new FakeElement();
    this.elements.push(element);
    return element;
  }
}

describe('AboutDialog Hanja notices', () => {
  let fakeDocument: FakeDocument;

  beforeEach(() => {
    fakeDocument = new FakeDocument();
    Reflect.set(globalThis, 'document', fakeDocument);
    (globalThis as { __HOP_VERSION__?: string }).__HOP_VERSION__ = 'test';
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'document');
    delete (globalThis as { __HOP_VERSION__?: string }).__HOP_VERSION__;
    vi.clearAllMocks();
  });

  it('reveals the full reviewed notice as text when the disclosure opens', async () => {
    // Given
    const notice = '<img src=x onerror=alert(1)>\nfull license text';
    loadBundledHanjaNotices.mockResolvedValue(notice);
    new TestAboutDialog().renderBody();
    const body = fakeDocument.elements[0];
    if (!body) throw new Error('missing About body');
    const disclosure = body.querySelector('.about-hanja-notices');
    const content = body.querySelector('.about-hanja-notices-content');

    // When
    if (!disclosure) throw new Error('missing Hanja notice disclosure');
    disclosure.open = true;
    disclosure.dispatch('toggle');
    await Promise.resolve();
    await Promise.resolve();

    // Then
    expect(disclosure.children[0]?.textContent).toContain('한자 사전');
    expect(content?.textContent).toBe(notice);
    expect(content?.children).toHaveLength(0);
    expect(loadBundledHanjaNotices).toHaveBeenCalledOnce();
  });
});
