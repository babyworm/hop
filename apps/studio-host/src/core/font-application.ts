import type { CharProperties } from '@/core/types';
import type { WasmBridge } from '@/core/wasm-bridge';
import { loadWebFonts } from './font-loader';
import { sanitizeAuthoringFontFamily } from './font-authoring-policy';

type FontIdBridge = Pick<WasmBridge, 'findOrCreateFontId'>;

export async function resolveCharShapeFontMods(
  wasm: FontIdBridge,
  mods: Partial<CharProperties>,
): Promise<Partial<CharProperties>> {
  const fontName = mods.fontName;
  if (!fontName) {
    return mods;
  }

  const authoringFontName = sanitizeAuthoringFontFamily(fontName);

  await Promise.resolve(loadWebFonts([authoringFontName])).catch(() => undefined);

  const normalizedMods = { ...mods };
  const fontId = wasm.findOrCreateFontId(authoringFontName);
  if (fontId >= 0) {
    normalizedMods.fontId = fontId;
  }
  delete normalizedMods.fontName;
  return normalizedMods;
}
