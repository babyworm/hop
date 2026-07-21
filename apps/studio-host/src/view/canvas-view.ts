import { EventBus, WasmBridge } from '@/upstream/core';
import type { PageInfo } from '@/upstream/core';
import { CanvasPool, CoordinateSystem, ViewportManager, VirtualScroll } from '@/upstream/view';
import type { PageRenderContext, PageRenderResult } from '@/upstream/view';
import {
  applyCanvasDisplayLayout,
  inferCanvasDevicePixelRatio,
} from './canvas-layout';
import { HopPageRenderer } from './hop-page-renderer';
import {
  applyPageOverlayDisplayLayout,
  removeAllPageOverlays,
  removePageOverlays,
} from './page-overlays';

const TEXT_EDIT_STATIC_LAYER_VERIFY_DELAY_MS = 800;

export class CanvasView {
  private virtualScroll: VirtualScroll;
  private canvasPool: CanvasPool;
  private pageRenderer: HopPageRenderer;
  private viewportManager: ViewportManager;
  private coordinateSystem: CoordinateSystem;

  private scrollContent: HTMLElement;
  private pages: PageInfo[] = [];
  private unsubscribers: (() => void)[] = [];
  private pendingTextEditRefreshes = new Map<number, PageRenderContext>();
  private textEditRefreshRafId: number | null = null;
  private textEditStaticLayerVerifyTimers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(
    private container: HTMLElement,
    private wasm: WasmBridge,
    private eventBus: EventBus,
  ) {
    this.virtualScroll = new VirtualScroll();
    this.canvasPool = new CanvasPool();
    this.pageRenderer = new HopPageRenderer(wasm);
    this.viewportManager = new ViewportManager(eventBus);
    this.coordinateSystem = new CoordinateSystem(this.virtualScroll);

    this.scrollContent = container.querySelector('#scroll-content')!;
    this.viewportManager.attachTo(container);

    this.unsubscribers.push(
      eventBus.on('viewport-scroll', () => this.updateVisiblePages()),
      eventBus.on('viewport-resize', () => this.onViewportResize()),
      eventBus.on('zoom-changed', (zoom) => this.onZoomChanged(zoom as number)),
      eventBus.on('document-page-invalidated', (payload) => this.refreshInvalidatedPage(payload)),
      eventBus.on('document-changed', () => this.refreshPages()),
      eventBus.on('document-view-changed', () => this.refreshPages()),
    );
  }

  loadDocument(): void {
    this.reset();

    const pageCount = this.wasm.pageCount;
    this.pages = [];
    for (let i = 0; i < pageCount; i++) {
      try {
        this.pages.push(this.wasm.getPageInfo(i));
      } catch (e) {
        console.error(`[CanvasView] 페이지 ${i} 정보 조회 실패:`, e);
      }
    }

    if (this.pages.length === 0) {
      console.error('[CanvasView] 로드된 페이지가 없습니다');
      return;
    }

    if (window.innerWidth < 1024 && this.pages.length > 0) {
      const containerWidth = this.container.clientWidth - 20;
      const pageWidth = this.pages[0].width;
      if (pageWidth > 0 && containerWidth > 0) {
        const fitZoom = containerWidth / pageWidth;
        this.viewportManager.setZoom(Math.max(0.1, Math.min(fitZoom, 4.0)));
      }
    }

    this.recalcLayout();

    this.container.scrollTop = 0;
    this.updateVisiblePages();

    console.log(
      `[CanvasView] ${this.pages.length}/${pageCount}페이지 로드, 총 높이: ${this.virtualScroll.getTotalHeight()}px`,
    );
  }

  private recalcLayout(): void {
    const zoom = this.viewportManager.getZoom();
    const { width: vpWidth } = this.viewportManager.getViewportSize();
    this.virtualScroll.setPageDimensions(this.pages, zoom, vpWidth);
    this.scrollContent.style.height = `${this.virtualScroll.getTotalHeight()}px`;
    this.scrollContent.style.width = `${this.virtualScroll.getTotalWidth()}px`;
    this.scrollContent.classList.toggle('grid-mode', this.virtualScroll.isGridMode());
  }

  private updateVisiblePages(): void {
    const scrollY = this.viewportManager.getScrollY();
    const { height: vpHeight } = this.viewportManager.getViewportSize();

    const prefetchPages = this.virtualScroll.getPrefetchPages(scrollY, vpHeight);
    const visiblePages = this.virtualScroll.getVisiblePages(scrollY, vpHeight);

    const prefetchSet = new Set(prefetchPages);
    for (const pageIdx of this.canvasPool.activePages) {
      if (!prefetchSet.has(pageIdx)) {
        this.pageRenderer.cancelReRender(pageIdx);
        this.releasePage(pageIdx);
      }
    }

    for (const pageIdx of prefetchPages) {
      if (!this.canvasPool.has(pageIdx)) {
        this.renderPage(pageIdx);
      }
    }

    if (visiblePages.length > 0) {
      const vpCenter = scrollY + vpHeight / 2;
      const currentPage = this.virtualScroll.getPageAtY(vpCenter);
      this.eventBus.emit(
        'current-page-changed',
        currentPage,
        this.virtualScroll.pageCount,
      );
    }
  }

  private renderPage(
    pageIdx: number,
    canvas: HTMLCanvasElement = this.canvasPool.acquire(pageIdx),
    context: PageRenderContext = {},
  ): void {
    const zoom = this.viewportManager.getZoom();
    const rawDpr = window.devicePixelRatio || 1;

    const pageInfo = this.pages[pageIdx];
    const MAX_CANVAS_PIXELS = 67108864;
    let dpr = rawDpr;
    if (pageInfo) {
      const physW = pageInfo.width * zoom * dpr;
      const physH = pageInfo.height * zoom * dpr;
      if (physW * physH > MAX_CANVAS_PIXELS) {
        dpr = Math.sqrt(MAX_CANVAS_PIXELS / (pageInfo.width * zoom * pageInfo.height * zoom));
        dpr = Math.max(1, Math.floor(dpr));
      }
    }
    const renderScale = zoom * dpr;

    applyCanvasDisplayLayout(
      canvas,
      this.virtualScroll,
      pageIdx,
      this.scrollContent.clientWidth,
      dpr,
    );
    if (context.allowStaticOverlayReuse !== true) {
      removePageOverlays(this.scrollContent, pageIdx);
    }
    this.scrollContent.appendChild(canvas);

    let renderResult: PageRenderResult;
    try {
      renderResult = this.pageRenderer.renderPage(
        pageIdx,
        canvas,
        renderScale,
        zoom,
        dpr,
        context,
      );
    } catch (e) {
      console.error(`[CanvasView] 페이지 ${pageIdx} 렌더링 실패:`, e);
      this.releasePage(pageIdx);
      return;
    }

    applyCanvasDisplayLayout(
      canvas,
      this.virtualScroll,
      pageIdx,
      this.scrollContent.clientWidth,
      dpr,
    );
    applyPageOverlayDisplayLayout(this.scrollContent, canvas, pageIdx);

    if (renderResult.needsTextEditStaticLayerVerification) {
      this.scheduleTextEditStaticLayerVerification(pageIdx);
    } else if (context.reason !== 'text-edit') {
      this.cancelTextEditStaticLayerVerification(pageIdx);
    }
  }

  private refreshInvalidatedPage(payload: unknown): void {
    if (this.pages.length === 0) return;

    const pageIndex =
      typeof payload === 'object' && payload !== null && 'pageIndex' in payload
        ? Number((payload as { pageIndex?: unknown }).pageIndex)
        : Number(payload);
    const reason =
      typeof payload === 'object' && payload !== null && 'reason' in payload
        ? (payload as { reason?: unknown }).reason
        : undefined;
    const context: PageRenderContext =
      reason === 'text-edit'
        ? { reason: 'text-edit', allowStaticOverlayReuse: true }
        : { reason: 'unknown', allowStaticOverlayReuse: false };

    if (!Number.isInteger(pageIndex) || pageIndex < 0) {
      this.cancelPendingTextEditRefresh();
      this.cancelTextEditStaticLayerVerification();
      this.refreshPages();
      return;
    }

    const pageIdx = pageIndex;
    const pageCount = this.wasm.pageCount;
    if (pageCount !== this.pages.length || pageIdx >= pageCount) {
      this.cancelPendingTextEditRefresh();
      this.cancelTextEditStaticLayerVerification();
      this.refreshPages();
      return;
    }

    if (context.reason !== 'text-edit') {
      this.cancelPendingTextEditRefresh(pageIdx);
      this.cancelTextEditStaticLayerVerification(pageIdx);
      this.refreshInvalidatedPageNow(pageIdx, context);
      return;
    }

    this.cancelTextEditStaticLayerVerification(pageIdx);
    this.pendingTextEditRefreshes.set(pageIdx, context);
    if (this.textEditRefreshRafId !== null) return;

    this.textEditRefreshRafId = window.requestAnimationFrame(() => {
      this.textEditRefreshRafId = null;
      const pendingPages = Array.from(this.pendingTextEditRefreshes.entries());
      this.pendingTextEditRefreshes.clear();

      for (const [pendingPageIdx, pendingContext] of pendingPages) {
        this.refreshInvalidatedPageNow(pendingPageIdx, pendingContext);
      }
    });
  }

  private refreshInvalidatedPageNow(pageIdx: number, context: PageRenderContext): void {
    const pageCount = this.wasm.pageCount;
    if (pageCount !== this.pages.length || pageIdx >= pageCount) {
      this.refreshPages();
      return;
    }

    const canvas = this.canvasPool.getCanvas(pageIdx);
    if (canvas) {
      this.renderPage(pageIdx, canvas, context);
    } else {
      this.updateVisiblePages();
    }
  }

  private cancelPendingTextEditRefresh(pageIdx?: number): void {
    if (typeof pageIdx === 'number') {
      this.pendingTextEditRefreshes.delete(pageIdx);
    } else {
      this.pendingTextEditRefreshes.clear();
    }
    if (this.pendingTextEditRefreshes.size > 0) return;
    if (this.textEditRefreshRafId !== null) {
      window.cancelAnimationFrame(this.textEditRefreshRafId);
      this.textEditRefreshRafId = null;
    }
  }

  private scheduleTextEditStaticLayerVerification(pageIdx: number): void {
    this.cancelTextEditStaticLayerVerification(pageIdx);
    const timer = setTimeout(() => {
      this.textEditStaticLayerVerifyTimers.delete(pageIdx);
      this.refreshInvalidatedPageNow(pageIdx, {
        reason: 'unknown',
        allowStaticOverlayReuse: false,
      });
    }, TEXT_EDIT_STATIC_LAYER_VERIFY_DELAY_MS);
    this.textEditStaticLayerVerifyTimers.set(pageIdx, timer);
  }

  private cancelTextEditStaticLayerVerification(pageIdx?: number): void {
    if (typeof pageIdx === 'number') {
      const timer = this.textEditStaticLayerVerifyTimers.get(pageIdx);
      if (timer) clearTimeout(timer);
      this.textEditStaticLayerVerifyTimers.delete(pageIdx);
      return;
    }

    for (const timer of this.textEditStaticLayerVerifyTimers.values()) {
      clearTimeout(timer);
    }
    this.textEditStaticLayerVerifyTimers.clear();
  }

  private repositionActivePages(): void {
    const scrollContentWidth = this.scrollContent.clientWidth;
    const fallbackDpr = window.devicePixelRatio || 1;

    for (const pageIdx of this.canvasPool.activePages) {
      const canvas = this.canvasPool.getCanvas(pageIdx);
      if (!canvas) continue;

      applyCanvasDisplayLayout(
        canvas,
        this.virtualScroll,
        pageIdx,
        scrollContentWidth,
        inferCanvasDevicePixelRatio(canvas, this.virtualScroll, pageIdx, fallbackDpr),
      );
      applyPageOverlayDisplayLayout(this.scrollContent, canvas, pageIdx);
    }
  }

  private onViewportResize(): void {
    if (this.pages.length === 0) {
      this.updateVisiblePages();
      return;
    }

    const wasGrid = this.virtualScroll.isGridMode();
    this.recalcLayout();
    const isGrid = this.virtualScroll.isGridMode();

    if (wasGrid || isGrid) {
      this.releaseAllPages();
      this.pageRenderer.cancelAll();
    } else {
      this.repositionActivePages();
    }
    this.updateVisiblePages();
  }

  private onZoomChanged(zoom: number): void {
    if (this.pages.length === 0) return;

    const scrollY = this.viewportManager.getScrollY();
    const { height: vpHeight } = this.viewportManager.getViewportSize();
    const vpCenter = scrollY + vpHeight / 2;
    const focusPage = this.virtualScroll.getPageAtY(vpCenter);
    const oldOffset = this.virtualScroll.getPageOffset(focusPage);
    const relativeY = vpCenter - oldOffset;
    const oldHeight = this.virtualScroll.getPageHeight(focusPage);
    const ratio = oldHeight > 0 ? relativeY / oldHeight : 0;

    this.recalcLayout();

    const newOffset = this.virtualScroll.getPageOffset(focusPage);
    const newHeight = this.virtualScroll.getPageHeight(focusPage);
    const newCenter = newOffset + newHeight * ratio;
    this.viewportManager.setScrollTop(newCenter - vpHeight / 2);

    this.releaseAllPages();
    this.pageRenderer.cancelAll();
    this.updateVisiblePages();

    this.eventBus.emit('zoom-level-display', zoom);
  }

  refreshPages(): void {
    if (this.pages.length === 0) return;

    const pageCount = this.wasm.pageCount;
    this.pages = [];
    for (let i = 0; i < pageCount; i++) {
      try {
        this.pages.push(this.wasm.getPageInfo(i));
      } catch (e) {
        console.error(`[CanvasView] 페이지 ${i} 정보 조회 실패:`, e);
      }
    }

    this.recalcLayout();
    this.releaseAllPages();
    this.pageRenderer.cancelAll();
    this.updateVisiblePages();
  }

  private reset(): void {
    this.pageRenderer.cancelAll();
    this.releaseAllPages();
    this.pages = [];
    this.scrollContent.replaceChildren();
  }

  private releasePage(pageIdx: number): void {
    this.cancelPendingTextEditRefresh(pageIdx);
    this.cancelTextEditStaticLayerVerification(pageIdx);
    removePageOverlays(this.scrollContent, pageIdx);
    this.canvasPool.release(pageIdx);
  }

  private releaseAllPages(): void {
    this.cancelPendingTextEditRefresh();
    this.cancelTextEditStaticLayerVerification();
    removeAllPageOverlays(this.scrollContent);
    this.canvasPool.releaseAll();
  }

  dispose(): void {
    this.reset();
    this.viewportManager.detach();
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }

  getVirtualScroll(): VirtualScroll {
    return this.virtualScroll;
  }

  getViewportManager(): ViewportManager {
    return this.viewportManager;
  }

  getCoordinateSystem(): CoordinateSystem {
    return this.coordinateSystem;
  }
}
