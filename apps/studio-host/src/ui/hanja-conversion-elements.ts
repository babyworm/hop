import type { HanjaCharacterCandidate, HanjaWordCandidate } from '../hanja/hanja-dictionary';

let dialogSequence = 0;

export interface DialogShell {
  dialogId: string;
  body: HTMLElement;
  description: HTMLElement;
  previewValue: HTMLElement;
  applyButton: HTMLButtonElement;
  close(value: string | null): void;
  setKeyHandler(handler: (event: KeyboardEvent) => boolean): void;
  mount(focusTarget: HTMLElement): void;
}

export function createDialogShell(
  modeLabel: string,
  source: string,
  resolve: (value: string | null) => void,
): DialogShell {
  const dialogId = `hanja-conversion-${++dialogSequence}`;
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let settled = false;
  let modeKeyHandler: (event: KeyboardEvent) => boolean = () => false;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const dialog = createDialog(dialogId);
  const { titleBar, closeButton } = createTitleBar(dialogId);
  const { body, description, previewValue } = createBody(modeLabel, source);
  const { footer, applyButton, cancelButton } = createFooter();
  dialog.append(titleBar, body, footer);
  overlay.appendChild(dialog);

  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      close(null);
      return;
    }
    if (modeKeyHandler(event)) event.preventDefault();
  };

  const close = (value: string | null) => {
    if (settled) return;
    settled = true;
    document.removeEventListener('keydown', onKeyDown, true);
    overlay.remove();
    previouslyFocused?.focus();
    resolve(value);
  };

  closeButton.addEventListener('click', () => close(null));
  cancelButton.addEventListener('click', () => close(null));
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close(null);
  });

  return {
    dialogId,
    body,
    description,
    previewValue,
    applyButton,
    close,
    setKeyHandler(handler) { modeKeyHandler = handler; },
    mount(focusTarget) {
      document.body.appendChild(overlay);
      document.addEventListener('keydown', onKeyDown, true);
      focusTarget.focus();
    },
  };
}

export function createCandidateList(dialogId: string, label: string): HTMLElement {
  const list = document.createElement('div');
  list.id = `${dialogId}-list`;
  list.className = 'hanja-candidate-list';
  list.tabIndex = 0;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', label);
  return list;
}

export function wordCandidateElement(
  candidate: HanjaWordCandidate,
  selected: boolean,
): HTMLButtonElement {
  const item = candidateShell(selected);
  const top = document.createElement('span');
  top.className = 'hanja-candidate-top';
  const text = document.createElement('span');
  text.className = 'hanja-word-value';
  text.textContent = candidate.text;
  const metadata = document.createElement('span');
  metadata.className = 'hanja-word-metadata';
  metadata.textContent = [candidate.partOfSpeech, candidate.level].filter(Boolean).join(' · ');
  top.append(text, metadata);

  const labels = document.createElement('span');
  labels.className = 'hanja-candidate-labels';
  labels.textContent = candidate.characters.map(({ character, label }) => `${character} ${label}`).join(' · ');
  item.append(top, labels);
  if (candidate.definition) {
    const definition = document.createElement('span');
    definition.className = 'hanja-candidate-definition';
    definition.textContent = candidate.definition;
    item.appendChild(definition);
  }
  return item;
}

export function characterCandidateElement(
  candidate: HanjaCharacterCandidate,
  selected: boolean,
): HTMLButtonElement {
  const item = candidateShell(selected);
  const character = document.createElement('span');
  character.className = 'hanja-character-value';
  character.textContent = candidate.character;
  const details = document.createElement('span');
  details.className = 'hanja-character-details';
  const label = document.createElement('span');
  label.className = 'hanja-character-label';
  label.textContent = candidate.label;
  const flags = document.createElement('span');
  flags.className = 'hanja-character-flags';
  flags.textContent = [
    candidate.educationHanja ? '교육용' : '',
    candidate.personalNameHanja ? '인명용' : '',
  ].filter(Boolean).join(' · ');
  details.append(label, flags);
  item.append(character, details);
  return item;
}

export function updateListSelection(list: HTMLElement, selectedIndex: number): void {
  list.querySelectorAll<HTMLElement>('.hanja-candidate-item').forEach((item) => {
    const selected = Number(item.dataset.index) === selectedIndex;
    item.setAttribute('aria-selected', String(selected));
    if (selected) {
      list.setAttribute('aria-activedescendant', item.id);
      item.scrollIntoView?.({ block: 'nearest' });
    }
  });
}

function createDialog(dialogId: string): HTMLElement {
  const dialog = document.createElement('div');
  dialog.className = 'dialog-wrap hanja-conversion-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', `${dialogId}-title`);
  return dialog;
}

function createTitleBar(dialogId: string) {
  const titleBar = document.createElement('div');
  titleBar.className = 'dialog-title';
  const title = document.createElement('span');
  title.id = `${dialogId}-title`;
  title.textContent = '한글/한자 변환';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'dialog-close';
  closeButton.setAttribute('aria-label', '닫기');
  closeButton.textContent = '×';
  titleBar.append(title, closeButton);
  return { titleBar, closeButton };
}

function createBody(modeLabel: string, source: string) {
  const body = document.createElement('div');
  body.className = 'dialog-body hanja-conversion-body';
  const heading = document.createElement('div');
  heading.className = 'hanja-conversion-heading';
  const mode = document.createElement('span');
  mode.className = 'hanja-conversion-mode';
  mode.textContent = modeLabel;
  const original = document.createElement('span');
  original.className = 'hanja-conversion-original';
  original.textContent = source;
  heading.append(mode, original);
  const description = document.createElement('p');
  description.className = 'hanja-conversion-description';
  const preview = document.createElement('div');
  preview.className = 'hanja-conversion-preview';
  preview.setAttribute('aria-live', 'polite');
  const previewLabel = document.createElement('span');
  previewLabel.className = 'hanja-conversion-preview-label';
  previewLabel.textContent = '변환 결과';
  const previewValue = document.createElement('span');
  previewValue.className = 'hanja-conversion-preview-value';
  preview.append(previewLabel, previewValue);
  body.append(heading, description, preview);
  return { body, description, previewValue };
}

function createFooter() {
  const footer = document.createElement('div');
  footer.className = 'dialog-footer';
  const applyButton = document.createElement('button');
  applyButton.type = 'button';
  applyButton.className = 'dialog-btn dialog-btn-primary';
  applyButton.textContent = '변환';
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'dialog-btn';
  cancelButton.textContent = '취소';
  footer.append(applyButton, cancelButton);
  return { footer, applyButton, cancelButton };
}

function candidateShell(selected: boolean): HTMLButtonElement {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'hanja-candidate-item';
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', String(selected));
  return item;
}
