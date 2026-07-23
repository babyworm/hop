import type { WasmBridge } from '@/upstream/core';
import { PageRenderer as UpstreamPageRenderer } from '@/upstream/view';
import type { PageRenderContext, PageRenderResult } from '@/upstream/view';

const RE_RENDER_DELAYS_MS = [200, 600];

export class HopPageRenderer {
  private readonly upstream: UpstreamPageRenderer;
  private reRenderTimers = new Map<number, ReturnType<typeof setTimeout>[]>();

  constructor(wasm: WasmBridge) {
    this.upstream = new UpstreamPageRenderer(wasm);
  }

  renderPage(
    pageIdx: number,
    canvas: HTMLCanvasElement,
    renderScale: number,
    displayScale: number,
    dpr: number,
    context: PageRenderContext = {},
  ): PageRenderResult {
    if (context.reason === 'text-edit') {
      this.upstream.cancelReRender(pageIdx);
    } else {
      this.cancelReRender(pageIdx);
    }
    let result: PageRenderResult;
    try {
      result = this.upstream.renderPage(
        pageIdx,
        canvas,
        renderScale,
        displayScale,
        dpr,
        context,
      );
    } finally {
      this.upstream.cancelReRender(pageIdx);
    }
    if (context.reason !== 'text-edit') {
      this.scheduleFlowReRender(pageIdx, canvas, renderScale);
    }
    return result;
  }

  cancelReRender(pageIdx: number): void {
    const timers = this.reRenderTimers.get(pageIdx);
    if (timers) {
      for (const timer of timers) clearTimeout(timer);
      this.reRenderTimers.delete(pageIdx);
    }
    this.upstream.cancelReRender(pageIdx);
  }

  cancelAll(): void {
    for (const timers of this.reRenderTimers.values()) {
      for (const timer of timers) clearTimeout(timer);
    }
    this.reRenderTimers.clear();
    this.upstream.cancelAll();
  }

  private renderFlowOnce(pageIdx: number, canvas: HTMLCanvasElement, scale: number): void {
    try {
      this.upstream.renderPageFlow(pageIdx, canvas, scale);
    } finally {
      this.upstream.cancelReRender(pageIdx);
    }
  }

  private scheduleFlowReRender(
    pageIdx: number,
    canvas: HTMLCanvasElement,
    scale: number,
  ): void {
    const timers = RE_RENDER_DELAYS_MS.map((delay) =>
      setTimeout(() => {
        if (canvas.parentElement) {
          this.renderFlowOnce(pageIdx, canvas, scale);
        }
      }, delay),
    );
    this.reRenderTimers.set(pageIdx, timers);
  }
}
