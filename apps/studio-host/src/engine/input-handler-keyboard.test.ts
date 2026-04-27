import { beforeEach, describe, expect, it, vi } from 'vitest';

const { pasteCalls, upstreamPasteMock } = vi.hoisted(() => ({
  pasteCalls: [] as Array<{ html: string; hasInternalClipboard: boolean }>,
  upstreamPasteMock: vi.fn(function (this: { wasm: { hasInternalClipboard: () => boolean } }, event: ClipboardEvent) {
    pasteCalls.push({
      html: event.clipboardData?.getData('text/html') ?? '',
      hasInternalClipboard: this.wasm.hasInternalClipboard(),
    });
  }),
}));

vi.mock('@upstream/engine/input-handler-keyboard', () => ({
  onPaste: upstreamPasteMock,
}));

import { onPaste } from './input-handler-keyboard';

describe('HOP keyboard paste wrapper', () => {
  beforeEach(() => {
    pasteCalls.length = 0;
    upstreamPasteMock.mockClear();
  });

  it('sanitizes blocked HTML fonts and disables stale internal clipboard for new documents', () => {
    const event = clipboardEventWithHtml(`<span style="font-family:'HY헤드라인M'">A</span>`);
    const context = {
      wasm: {
        isNewDocument: true,
        hasInternalClipboard: () => true,
        clipboardHasControl: () => true,
      },
    };

    onPaste.call(context, event);

    expect(upstreamPasteMock).toHaveBeenCalledTimes(1);
    expect(pasteCalls).toEqual([
      {
        html: `<span style="font-family:'함초롬돋움'">A</span>`,
        hasInternalClipboard: false,
      },
    ]);
  });
});

function clipboardEventWithHtml(html: string): ClipboardEvent {
  return {
    clipboardData: {
      getData: vi.fn((type: string) => type === 'text/html' ? html : ''),
    },
  } as unknown as ClipboardEvent;
}
