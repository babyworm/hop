import type { CommandDef, CommandServices, EditorContext } from '@/upstream/commands';
import {
  getInputHandlerShortcutCaptureState,
  type InputHandlerShortcutCaptureState,
} from '@/upstream/editor';
import { currentDocumentGeneration } from '../../core/document-generation';
import type { HanjaDictionary } from '../../hanja/hanja-dictionary';
import {
  createBundledHanjaDictionary,
  HanjaLookupError,
} from '../../hanja/hanja-dictionary';
import {
  type HanjaConversionDirection,
  HanjaEditorRangeError,
  isConversionSourceCurrent,
  readConversionSource,
  replaceConversionSource,
} from '../../hanja/editor-text-range';
import { openHanjaConversionDialog } from '../../ui/hanja-conversion-dialog';
import {
  hanjaCommandShortcutLabel,
  hanjaConversionShortcutLabel,
} from '../shortcut-map';

let dictionary: HanjaDictionary | null = null;

type ConversionRun = {
  readonly documentGeneration: number;
};

type InputFocusOwner = {
  readonly target: EventTarget;
  readonly mayMoveToBody: boolean;
};

let activeConversion: ConversionRun | null = null;

export const hanjaCommands: CommandDef[] = [{
  id: 'edit:convert-hanja',
  label: '한글/한자 변환',
  shortcutLabel: hanjaCommandShortcutLabel(),
  canExecute: isHanjaConversionContextEditable,
  execute: (services, params) => {
    const run = { documentGeneration: currentDocumentGeneration() };
    if (activeConversion?.documentGeneration === run.documentGeneration) return;
    activeConversion = run;
    void convertHanja(services, conversionDirectionParam(params), params, run).finally(() => {
      if (activeConversion === run) activeConversion = null;
    });
  },
}];

async function convertHanja(
  services: CommandServices,
  expectedDirection: HanjaConversionDirection | null,
  params: Record<string, unknown> | undefined,
  run: ConversionRun,
): Promise<void> {
  const initialInputHandler = services.getInputHandler();
  const initialInputState = getInputHandlerShortcutCaptureState(initialInputHandler);
  const initialFocusOwner = captureInputFocusOwner(initialInputState, params);
  let shouldRestoreFocus = false;
  try {
    const source = readConversionSource(services);
    if (expectedDirection && source.direction !== expectedDirection) {
      const shortcut = hanjaConversionShortcutLabel(source.direction);
      setStatusMessage(`${contextName(source.direction)} 변환 단축키는 ${shortcut}입니다.`);
      return;
    }
    setStatusMessage('내장 한자 사전에서 후보를 찾는 중입니다…');
    dictionary ??= createBundledHanjaDictionary();
    const lookup = source.direction === 'hanja-to-hangul'
      ? await dictionary.lookupHanja(source.text)
      : await dictionary.lookup(source.text);
    if (!isCurrentConversion(run)) return;

    const currentInputHandler = services.getInputHandler();
    const inputState = getInputHandlerShortcutCaptureState(currentInputHandler);
    if (
      initialInputHandler === null ||
      currentInputHandler !== initialInputHandler ||
      !isInputFocusOwnerCurrent(initialFocusOwner) ||
      !isHanjaConversionContextEditable(services.getContext()) ||
      !isConversionSourceCurrent(services, source) ||
      !inputState.isEditorActive ||
      inputState.isInternallyComposing ||
      inputState.hasActivePlacementMode
    ) {
      setStatusMessage('편집 위치가 바뀌어 한자 변환을 취소했습니다.');
      return;
    }
    if (hasActiveModal()) {
      setStatusMessage('다른 대화상자가 열려 한자 변환을 취소했습니다.');
      return;
    }

    shouldRestoreFocus = true;
    const replacement = await openHanjaConversionDialog(lookup);
    if (!isCurrentConversion(run)) return;
    if (replacement === null) {
      setStatusMessage('한자 변환을 취소했습니다.');
      return;
    }
    if (
      services.getInputHandler() !== initialInputHandler ||
      !isHanjaConversionContextEditable(services.getContext()) ||
      !isConversionSourceCurrent(services, source)
    ) {
      setStatusMessage('편집 위치가 바뀌어 한자 변환을 취소했습니다.');
      return;
    }

    if (replaceConversionSource(initialInputHandler, source, replacement)) {
      setStatusMessage(`한글/한자 변환: ${source.text} → ${replacement}`);
    }
  } catch (error) {
    if (!isCurrentConversion(run)) return;
    if (error instanceof HanjaLookupError) {
      logHanjaLookupFailure(error);
      setStatusMessage(error.message);
      return;
    }
    if (error instanceof HanjaEditorRangeError) {
      setStatusMessage(error.message);
      return;
    }
    console.warn('[hanja-conversion] 변환 작업을 완료하지 못했습니다.', errorSummary(error));
    setStatusMessage('한자 변환 중 오류가 발생했습니다.');
  } finally {
    if (
      shouldRestoreFocus &&
      isCurrentConversion(run) &&
      services.getInputHandler() === initialInputHandler &&
      !hasActiveModal()
    ) {
      initialInputHandler?.focus();
    }
  }
}

function isCurrentConversion(run: ConversionRun): boolean {
  return activeConversion === run &&
    currentDocumentGeneration() === run.documentGeneration;
}

function captureInputFocusOwner(
  inputState: InputHandlerShortcutCaptureState,
  params: Record<string, unknown> | undefined,
): InputFocusOwner | null | undefined {
  if (!('activeElement' in document)) return undefined;
  if (inputState.editorInputHasFocus && inputState.editorInput !== null) {
    return { target: inputState.editorInput, mayMoveToBody: false };
  }
  if (document.activeElement === document.body) {
    return { target: document.body, mayMoveToBody: false };
  }
  const anchorEl = params?.anchorEl;
  return anchorEl instanceof EventTarget && document.activeElement === anchorEl
    ? {
      target: anchorEl,
      mayMoveToBody: params?.focusOwnerAfterDispatch === 'body',
    }
    : null;
}

function isInputFocusOwnerCurrent(
  initialFocusOwner: InputFocusOwner | null | undefined,
): boolean {
  return initialFocusOwner === undefined ||
    (initialFocusOwner !== null && (
      document.activeElement === initialFocusOwner.target ||
      (initialFocusOwner.mayMoveToBody && document.activeElement === document.body)
    ));
}

function hasActiveModal(): boolean {
  return typeof document.querySelector === 'function' &&
    document.querySelector('.modal-overlay') !== null;
}

function conversionDirectionParam(
  params: Record<string, unknown> | undefined,
): HanjaConversionDirection | null {
  const direction = params?.direction;
  return direction === 'hangul-to-hanja' || direction === 'hanja-to-hangul'
    ? direction
    : null;
}

function contextName(direction: HanjaConversionDirection): string {
  return direction === 'hanja-to-hangul' ? '한자에서 한글로' : '한글에서 한자로';
}

export function isHanjaConversionContextEditable(context: EditorContext): boolean {
  return context.hasDocument && context.isEditable &&
    !context.isFormMode && !context.inField &&
    !context.inPictureObjectSelection && !context.inTableObjectSelection &&
    !context.inCellSelectionMode && !context.hasMultiCellSelection;
}

export function logHanjaLookupFailure(error: HanjaLookupError): void {
  console.warn('[hanja-conversion] 내장 사전 오류', {
    code: error.code,
    asset: error.asset,
    status: error.status,
    cause: errorSummary(error.cause),
  });
}

function errorSummary(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

function setStatusMessage(message: string): void {
  const status = document.getElementById('sb-message');
  if (status) status.textContent = message;
}
