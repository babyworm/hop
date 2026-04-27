import * as upstreamKeyboard from '@upstream/engine/input-handler-keyboard';
import { sanitizeAuthoringHtml } from '@/core/font-authoring-policy';

export * from '@upstream/engine/input-handler-keyboard';

export function onPaste(this: unknown, event: ClipboardEvent): void {
  const html = event.clipboardData?.getData('text/html') ?? '';
  const sanitizedHtml = sanitizeAuthoringHtml(html);
  if (!html || sanitizedHtml === html || !event.clipboardData) {
    upstreamKeyboard.onPaste.call(this, event);
    return;
  }

  const clipboardData = event.clipboardData;
  const clipboardProxy = new Proxy(clipboardData, {
    get(target, property) {
      if (property === 'getData') {
        return (type: string) => type === 'text/html' ? sanitizedHtml : target.getData(type);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  const eventProxy = new Proxy(event, {
    get(target, property) {
      if (property === 'clipboardData') return clipboardProxy;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const pasteContext = isNewDocumentContext(this) ? disableInternalClipboard(this) : this;

  upstreamKeyboard.onPaste.call(pasteContext, eventProxy as ClipboardEvent);
}

function isNewDocumentContext(context: unknown): boolean {
  return Boolean((context as { wasm?: { isNewDocument?: boolean } })?.wasm?.isNewDocument);
}

function disableInternalClipboard(context: unknown): unknown {
  const target = context as object;
  return new Proxy(target, {
    get(base, property) {
      if (property === 'wasm') {
        const wasm = Reflect.get(base, property, base);
        if (!wasm || typeof wasm !== 'object') return wasm;
        return new Proxy(wasm, {
          get(wasmBase, wasmProperty) {
            if (wasmProperty === 'hasInternalClipboard' || wasmProperty === 'clipboardHasControl') {
              return () => false;
            }
            const value = Reflect.get(wasmBase, wasmProperty, wasmBase);
            return typeof value === 'function' ? value.bind(wasmBase) : value;
          },
        });
      }
      const value = Reflect.get(base, property, base);
      return typeof value === 'function' ? value.bind(base) : value;
    },
  });
}
