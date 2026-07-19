import { editCommands as upstreamEditCommands } from '@/upstream/commands';
import type { CommandDef } from '@/upstream/commands';
import { replaceUpstreamCommands } from '../replace-upstream-commands';

type PasteCapableInputHandler = {
  performPaste?: () => void | Promise<void>;
};

const hopEditCommands: CommandDef[] = [
  {
    id: 'edit:paste',
    label: '붙이기',
    icon: 'icon-paste',
    shortcutLabel: 'Ctrl+V',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      const pending = (services.getInputHandler() as PasteCapableInputHandler | null)?.performPaste?.();
      if (pending) {
        void Promise.resolve(pending).catch((error) => {
          console.warn('[edit:paste] 붙이기 실패:', error);
        });
      }
    },
  },
];

export const editCommands = replaceUpstreamCommands(upstreamEditCommands, hopEditCommands);
