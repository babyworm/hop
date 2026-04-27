import { describe, expect, it, vi, beforeEach } from 'vitest';

const { loadWebFontsMock } = vi.hoisted(() => ({
  loadWebFontsMock: vi.fn(),
}));

vi.mock('./font-loader', () => ({
  loadWebFonts: loadWebFontsMock,
}));

import { resolveCharShapeFontMods } from './font-application';

describe('resolveCharShapeFontMods', () => {
  beforeEach(() => {
    loadWebFontsMock.mockReset();
  });

  it('loads the selected font before converting fontName to fontId', async () => {
    const wasm = {
      findOrCreateFontId: vi.fn(() => 42),
    };
    const mods = {
      fontName: '나눔고딕',
      italic: true,
    };

    const resolved = await resolveCharShapeFontMods(wasm, mods);

    expect(loadWebFontsMock).toHaveBeenCalledWith(['나눔고딕']);
    expect(wasm.findOrCreateFontId).toHaveBeenCalledWith('나눔고딕');
    expect(resolved).toEqual({
      italic: true,
      fontId: 42,
    });
    expect(mods).toEqual({
      fontName: '나눔고딕',
      italic: true,
    });
  });

  it('sanitizes blocked font names before converting them to font IDs', async () => {
    const wasm = {
      findOrCreateFontId: vi.fn(() => 7),
    };

    const resolved = await resolveCharShapeFontMods(wasm, {
      fontName: 'HY헤드라인M',
      bold: true,
    });

    expect(loadWebFontsMock).toHaveBeenCalledWith(['함초롬돋움']);
    expect(wasm.findOrCreateFontId).toHaveBeenCalledWith('함초롬돋움');
    expect(resolved).toEqual({
      bold: true,
      fontId: 7,
    });
  });

  it('leaves unrelated mods untouched when no font change exists', async () => {
    const wasm = {
      findOrCreateFontId: vi.fn(),
    };
    const mods = { bold: true };

    const resolved = await resolveCharShapeFontMods(wasm, mods);

    expect(loadWebFontsMock).not.toHaveBeenCalled();
    expect(wasm.findOrCreateFontId).not.toHaveBeenCalled();
    expect(resolved).toBe(mods);
  });
});
