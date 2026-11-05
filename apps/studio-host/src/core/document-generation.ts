let documentGeneration = 0;
const generationChangeListeners = new Set<() => void>();

export function currentDocumentGeneration(): number {
  return documentGeneration;
}

export function advanceDocumentGeneration(): number {
  documentGeneration += 1;
  generationChangeListeners.forEach((listener) => listener());
  return documentGeneration;
}

export function onDocumentGenerationChange(listener: () => void): () => void {
  generationChangeListeners.add(listener);
  return () => generationChangeListeners.delete(listener);
}
