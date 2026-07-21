import type { CommandDef, CommandServices, EditorContext } from '@/upstream/commands';
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
let conversionPending = false;

export const hanjaCommands: CommandDef[] = [{
  id: 'edit:convert-hanja',
  label: '한글/한자 변환',
  shortcutLabel: hanjaCommandShortcutLabel(),
  canExecute: isHanjaConversionContextEditable,
  execute: (services, params) => {
    if (conversionPending) return;
    conversionPending = true;
    void convertHanja(services, conversionDirectionParam(params)).finally(() => {
      conversionPending = false;
    });
  },
}];

async function convertHanja(
  services: CommandServices,
  expectedDirection: HanjaConversionDirection | null,
): Promise<void> {
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
    if (
      !isHanjaConversionContextEditable(services.getContext()) ||
      !isConversionSourceCurrent(services, source)
    ) {
      setStatusMessage('편집 위치가 바뀌어 한자 변환을 취소했습니다.');
      return;
    }

    const replacement = await openHanjaConversionDialog(lookup);
    if (replacement === null) {
      setStatusMessage('한자 변환을 취소했습니다.');
      return;
    }
    if (
      !isHanjaConversionContextEditable(services.getContext()) ||
      !isConversionSourceCurrent(services, source)
    ) {
      setStatusMessage('편집 위치가 바뀌어 한자 변환을 취소했습니다.');
      return;
    }

    const inputHandler = services.getInputHandler();
    if (!inputHandler) {
      setStatusMessage('변환할 문서가 없습니다.');
      return;
    }
    if (replaceConversionSource(inputHandler, source, replacement)) {
      setStatusMessage(`한글/한자 변환: ${source.text} → ${replacement}`);
    }
  } catch (error) {
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
  }
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
    !context.isFormMode &&
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
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return error === undefined ? undefined : String(error);
}

function setStatusMessage(message: string): void {
  const status = document.getElementById('sb-message');
  if (status) status.textContent = message;
}
