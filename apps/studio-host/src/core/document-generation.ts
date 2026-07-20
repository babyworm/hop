let documentGeneration = 0;

export function currentDocumentGeneration(): number {
  return documentGeneration;
}

export function advanceDocumentGeneration(): number {
  documentGeneration += 1;
  return documentGeneration;
}
