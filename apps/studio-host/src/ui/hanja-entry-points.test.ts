import { describe, expect, it, vi } from 'vitest';
import studioHtml from '../../index.html?raw';
import {
  contextMenuConversionLabel,
  shouldOfferHanjaContextMenu,
} from './hanja-context-menu';
import { hanjaConversionShortcutLabel } from '../command/shortcut-map';

const entryPointCss = readNodeTextFile(
  new URL('../styles/hanja-entry-points.css', import.meta.url),
);

describe('Hanja conversion entry points', () => {
  it('places the Input menu command directly below Character Table', () => {
    const html = studioHtml;
    const characterTable = html.indexOf('data-cmd="insert:symbols"');
    const conversion = html.indexOf('data-cmd="edit:convert-hanja"', characterTable);
    const nextSeparator = html.indexOf('<div class="md-sep"></div>', characterTable);

    expect(characterTable).toBeGreaterThan(-1);
    expect(conversion).toBeGreaterThan(characterTable);
    expect(conversion).toBeLessThan(nextSeparator);
    expect(html).toContain('<span class="md-label">한글/한자 변환</span>');
  });

  it('shows both conversion shortcuts in every menu entry', () => {
    const entries = Array.from(
      studioHtml.matchAll(
        /<div class="md-item" data-cmd="edit:convert-hanja">([\s\S]*?)<\/div>/gu,
      ),
      (match) => match[1],
    );

    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry?.includes('F9 / Alt+F9'))).toBe(true);
  });

  it('places a Hanja toolbar button directly after Character Table', () => {
    const html = studioHtml;
    const toolbar = html.indexOf('title="문자표 (Alt+F10)"');
    const conversion = html.indexOf('title="한글/한자 변환 (F9 / Alt+F9)"', toolbar);
    const hyperlink = html.indexOf('title="하이퍼링크"', toolbar);

    expect(toolbar).toBeGreaterThan(-1);
    expect(conversion).toBeGreaterThan(toolbar);
    expect(conversion).toBeLessThan(hyperlink);
  });

  it('keeps the menu icon absolute while positioning the toolbar glyph', () => {
    expect(cssRule('.icon-hanja')).not.toContain('position:');
    expect(cssRule('.tb-sprite.icon-hanja')).toContain('position: relative;');
  });

  it('offers the context submenu for a Hangul conversion source', () => {
    const readSource = vi.fn(() => ({
      text: '학교',
      selected: true,
      direction: 'hangul-to-hanja',
    }));

    expect(shouldOfferHanjaContextMenu(editableServices() as never, readSource as never)).toBe(true);
  });

  it('offers a Hangul action for a Hanja conversion source', () => {
    const readSource = vi.fn(() => ({
      text: '學校',
      selected: true,
      direction: 'hanja-to-hangul',
    }));

    expect(shouldOfferHanjaContextMenu(editableServices() as never, readSource as never)).toBe(true);
    expect(contextMenuConversionLabel('hanja-to-hangul')).toBe('한글로 변환');
    expect(hanjaConversionShortcutLabel('hanja-to-hangul', 'macos')).toBe('⌥F9');
    expect(hanjaConversionShortcutLabel('hanja-to-hangul', 'windows')).toBe('Alt+F9');
  });

  it('hides the context submenu for an English selection', () => {
    const readSource = vi.fn(() => {
      throw new Error('한글 음절로 이루어진 단어만 변환할 수 있습니다.');
    });

    expect(shouldOfferHanjaContextMenu(editableServices() as never, readSource as never)).toBe(false);
  });

  it('hides the context submenu when the conversion command is disabled', () => {
    const services = editableServices();
    services.getContext = () => ({ ...editableContext(), isFormMode: true } as never);

    expect(shouldOfferHanjaContextMenu(services as never, vi.fn() as never)).toBe(false);
  });
});

function editableServices() {
  return {
    getContext: () => editableContext(),
    wasm: {},
    getInputHandler: () => ({}),
  };
}

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

function cssRule(selector: string): string {
  const start = entryPointCss.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing CSS rule: ${selector}`);
  const end = entryPointCss.indexOf('}', start);
  if (end < 0) throw new Error(`unterminated CSS rule: ${selector}`);
  return entryPointCss.slice(start, end + 1);
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
