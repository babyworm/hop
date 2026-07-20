import type { CommandDef, CommandServices } from '@/upstream/commands';
import type { HanjaDictionary } from '../../hanja/hanja-dictionary';
import {
  createBundledHanjaDictionary,
  HanjaLookupError,
} from '../../hanja/hanja-dictionary';
import {
  HanjaEditorRangeError,
  isConversionSourceCurrent,
  readConversionSource,
  replaceConversionSource,
} from '../../hanja/editor-text-range';
import { openHanjaConversionDialog } from '../../ui/hanja-conversion-dialog';

let dictionary: HanjaDictionary | null = null;
let conversionPending = false;

export const hanjaCommands: CommandDef[] = [{
  id: 'edit:convert-hanja',
  label: '한글을 한자로',
  shortcutLabel: 'F9',
  canExecute: (context) => context.hasDocument && context.isEditable &&
    !context.inPictureObjectSelection && !context.inTableObjectSelection &&
    !context.inCellSelectionMode && !context.hasMultiCellSelection,
  execute: (services) => {
    if (conversionPending) return;
    conversionPending = true;
    void convertHanja(services).finally(() => {
      conversionPending = false;
    });
  },
}];

async function convertHanja(services: CommandServices): Promise<void> {
  try {
    const source = readConversionSource(services);
    setStatusMessage('내장 한자 사전에서 후보를 찾는 중입니다…');
    dictionary ??= createBundledHanjaDictionary();
    const lookup = await dictionary.lookup(source.text);
    if (!isConversionSourceCurrent(services, source)) {
      setStatusMessage('편집 위치가 바뀌어 한자 변환을 취소했습니다.');
      return;
    }

    const replacement = await openHanjaConversionDialog(lookup);
    if (replacement === null) {
      setStatusMessage('한자 변환을 취소했습니다.');
      return;
    }
    if (!isConversionSourceCurrent(services, source)) {
      setStatusMessage('편집 위치가 바뀌어 한자 변환을 취소했습니다.');
      return;
    }

    const inputHandler = services.getInputHandler();
    if (!inputHandler) {
      setStatusMessage('변환할 문서가 없습니다.');
      return;
    }
    replaceConversionSource(inputHandler as never, source, replacement);
    setStatusMessage('한자로 변환했습니다.');
  } catch (error) {
    if (error instanceof HanjaLookupError || error instanceof HanjaEditorRangeError) {
      setStatusMessage(error.message);
      return;
    }
    console.warn('[hanja-conversion] 변환 작업을 완료하지 못했습니다.');
    setStatusMessage('한자 변환 중 오류가 발생했습니다.');
  }
}

function setStatusMessage(message: string): void {
  const status = document.getElementById('sb-message');
  if (status) status.textContent = message;
}
