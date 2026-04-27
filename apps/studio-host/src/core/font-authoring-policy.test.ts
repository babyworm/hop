import { describe, expect, it } from 'vitest';

import {
  filterAuthoringFontFamilies,
  isAuthoringBlockedFontFamily,
  sanitizeAuthoringFontFamily,
  sanitizeAuthoringHtml,
} from './font-authoring-policy';

describe('font authoring policy', () => {
  it('blocks proprietary Hancom and Human authoring families', () => {
    expect(isAuthoringBlockedFontFamily('HY헤드라인M')).toBe(true);
    expect(isAuthoringBlockedFontFamily('HYHeadLine M')).toBe(true);
    expect(isAuthoringBlockedFontFamily('휴먼명조')).toBe(true);
    expect(isAuthoringBlockedFontFamily('HCI Poppy')).toBe(true);
    expect(isAuthoringBlockedFontFamily('Happiness Sans Regular')).toBe(false);
  });

  it('normalizes blocked authoring families to safe substitutes', () => {
    expect(sanitizeAuthoringFontFamily('HY헤드라인M')).toBe('함초롬돋움');
    expect(sanitizeAuthoringFontFamily('휴먼명조')).toBe('함초롬바탕');
    expect(filterAuthoringFontFamilies(['HY헤드라인M', '나눔고딕'])).toEqual(['나눔고딕']);
  });

  it('removes blocked families from pasted inline HTML styles', () => {
    const html = `<span style="font-family:'HY헤드라인M','Malgun Gothic',sans-serif;color:red">A</span>`;

    const sanitized = sanitizeAuthoringHtml(html);

    expect(sanitized).toContain("font-family:'Malgun Gothic', sans-serif");
    expect(sanitized).not.toContain('HY헤드라인M');
    expect(sanitized).toContain('color:red');
  });

  it('uses a safe fallback when pasted HTML only names a blocked family', () => {
    const html = `<font face="휴먼명조"><span style="font-family:'휴먼명조'">A</span></font>`;

    const sanitized = sanitizeAuthoringHtml(html);

    expect(sanitized).toContain(`face="함초롬바탕"`);
    expect(sanitized).toContain(`font-family:'함초롬바탕'`);
    expect(sanitized).not.toContain('휴먼명조');
  });

  it('keeps safe legacy face candidates while removing blocked ones', () => {
    const html = `<font face="휴먼명조, Malgun Gothic">A</font>`;

    const sanitized = sanitizeAuthoringHtml(html);

    expect(sanitized).toContain(`face="Malgun Gothic"`);
    expect(sanitized).not.toContain('휴먼명조');
  });
});
