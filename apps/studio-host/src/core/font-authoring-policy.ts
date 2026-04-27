const SANS_FALLBACK = '함초롬돋움';
const SERIF_FALLBACK = '함초롬바탕';

const BLOCKED_FONT_KEYS = new Set([
  'hy헤드라인m',
  'hyheadlinem',
  'hyheadlinemedium',
  'hy견고딕',
  'hygothicextra',
  'hy그래픽',
  'hy그래픽m',
  'hygraphicmedium',
  'hy견명조',
  'hymyeongjoextra',
  'hy신명조',
  'hy중고딕',
  '휴먼명조',
  '휴먼고딕',
  '휴먼옛체',
  '휴먼매직체',
  '휴먼편지체',
  '휴먼둥근헤드라인',
  'hcipoppy',
]);

const GENERIC_FONT_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
]);

export function isAuthoringBlockedFontFamily(family: string | null | undefined): boolean {
  const key = fontFamilyKey(family);
  if (!key) return false;
  if (BLOCKED_FONT_KEYS.has(key)) return true;
  if (key.startsWith('휴먼')) return true;
  if (key.startsWith('hci')) return true;
  return /^hy(?:[가-힣]|headline|gothic|graphic|myeong|mj|gt|gp|sn|sm)/i.test(key);
}

export function authoringFallbackForFontFamily(family: string | null | undefined): string {
  const key = fontFamilyKey(family);
  if (
    key.includes('명조')
    || key.includes('바탕')
    || key.includes('궁서')
    || key.includes('myeong')
    || key.includes('serif')
  ) {
    return SERIF_FALLBACK;
  }
  return SANS_FALLBACK;
}

export function sanitizeAuthoringFontFamily(family: string): string {
  const trimmed = family.trim();
  if (!trimmed) return trimmed;
  return isAuthoringBlockedFontFamily(trimmed)
    ? authoringFallbackForFontFamily(trimmed)
    : trimmed;
}

export function filterAuthoringFontFamilies(families: Iterable<string>): string[] {
  return Array.from(families)
    .map((family) => family.trim())
    .filter((family) => family && !isAuthoringBlockedFontFamily(family));
}

export function sanitizeAuthoringHtml(html: string): string {
  if (!html || !mightContainFontFamily(html)) return html;

  return html
    .replace(/\sstyle=(["'])(.*?)\1/gis, (_match, quote: string, style: string) =>
      ` style=${quote}${sanitizeInlineStyle(style)}${quote}`)
    .replace(/\sface=(["'])(.*?)\1/gis, (_match, quote: string, face: string) =>
      ` face=${quote}${sanitizeFaceAttribute(face)}${quote}`);
}

function sanitizeInlineStyle(style: string): string {
  return style
    .split(';')
    .map((declaration) => {
      const separatorIndex = declaration.indexOf(':');
      if (separatorIndex < 0) return declaration;

      const property = declaration.slice(0, separatorIndex).trim().toLowerCase();
      if (property !== 'font-family') return declaration;

      const prefix = declaration.slice(0, separatorIndex + 1);
      const value = declaration.slice(separatorIndex + 1);
      return `${prefix}${sanitizeFontFamilyList(value)}`;
    })
    .join(';');
}

function sanitizeFontFamilyList(value: string): string {
  return safeFontFamiliesFromList(value).map(formatCssFontFamily).join(', ');
}

function sanitizeFaceAttribute(value: string): string {
  return safeFontFamiliesFromList(value).join(', ');
}

function safeFontFamiliesFromList(value: string): string[] {
  const safeFamilies = splitFontFamilyList(value)
    .map((family) => unquoteCssString(family.trim()))
    .filter((family) => family && !isAuthoringBlockedFontFamily(family));

  if (safeFamilies.length === 0) {
    safeFamilies.push(authoringFallbackForFontFamily(value));
  }

  return safeFamilies;
}

function splitFontFamilyList(value: string): string[] {
  const families: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (const char of value) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }

    if (char === '\'' || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if (char === ',') {
      families.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  families.push(current);
  return families;
}

function formatCssFontFamily(family: string): string {
  const key = family.toLowerCase();
  if (GENERIC_FONT_FAMILIES.has(key)) return key;
  return `'${family.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function unquoteCssString(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '\'' && last === '\'') || (first === '"' && last === '"')) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function fontFamilyKey(family: string | null | undefined): string {
  return (family ?? '')
    .trim()
    .replace(/["']/g, '')
    .replace(/[\s_-]+/g, '')
    .toLocaleLowerCase('ko-KR');
}

function mightContainFontFamily(html: string): boolean {
  return /font-family|face=/i.test(html);
}
