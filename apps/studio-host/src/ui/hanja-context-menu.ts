import type {
  CommandDispatcher,
  CommandRegistry,
  CommandServices,
} from '@/upstream/commands';
import { ContextMenu } from '@/upstream/ui';
import type { ContextMenuItem } from '@/upstream/ui';
import {
  isHanjaConversionContextEditable,
} from '../command/commands/hanja';
import {
  readConversionSource,
  type HanjaConversionDirection,
  type HanjaConversionSource,
} from '../hanja/editor-text-range';

const CONVERT_HANJA_COMMAND = 'edit:convert-hanja';
const CONTEXT_SUBMENU_MIN_WIDTH = 180;

type ConversionSourceReader = (
  services: Pick<CommandServices, 'wasm' | 'getInputHandler'>,
) => HanjaConversionSource;

export function shouldOfferHanjaContextMenu(
  services: CommandServices,
  readSource: ConversionSourceReader = readConversionSource,
): boolean {
  return contextMenuConversionSource(services, readSource) !== null;
}

function contextMenuConversionSource(
  services: CommandServices,
  readSource: ConversionSourceReader = readConversionSource,
): HanjaConversionSource | null {
  if (!isHanjaConversionContextEditable(services.getContext())) return null;
  try {
    return readSource(services);
  } catch {
    return null;
  }
}

export function contextMenuConversionLabel(direction: HanjaConversionDirection): string {
  return direction === 'hanja-to-hangul' ? '한글로 변환' : '한자로 변환';
}

/** Adds HOP-only conversion affordances without modifying the upstream menu. */
export class HanjaContextMenu extends ContextMenu {
  constructor(
    private readonly hopDispatcher: CommandDispatcher,
    registry: CommandRegistry,
    private readonly services: CommandServices,
  ) {
    super(hopDispatcher, registry);
  }

  override show(x: number, y: number, items: ContextMenuItem[]): void {
    super.show(x, y, items);
    const source = contextMenuConversionSource(this.services);
    if (!source) return;

    const menu = document.querySelector<HTMLElement>('.context-menu');
    if (!menu) return;
    const openLeft = menu.getBoundingClientRect().right + CONTEXT_SUBMENU_MIN_WIDTH >
      window.innerWidth;
    menu.append(createSeparator(), this.createConversionSubmenu(source.direction, openLeft));
    keepMenuInsideViewport(menu);
  }

  private createConversionSubmenu(
    direction: HanjaConversionDirection,
    openLeft: boolean,
  ): HTMLElement {
    const submenu = document.createElement('div');
    submenu.className = 'md-sub hanja-context-submenu';
    submenu.setAttribute('aria-haspopup', 'menu');

    const label = document.createElement('span');
    label.className = 'md-label';
    label.textContent = '한글/한자 변환';

    const arrow = document.createElement('span');
    arrow.className = 'md-arrow';
    arrow.textContent = '▶';

    const panel = document.createElement('div');
    panel.className = 'md-sub-panel';
    panel.setAttribute('role', 'menu');
    panel.appendChild(this.createConversionItem(direction));

    submenu.append(label, arrow, panel);
    if (!this.hopDispatcher.isEnabled(CONVERT_HANJA_COMMAND)) {
      submenu.classList.add('disabled');
    }
    submenu.classList.toggle('open-left', openLeft);
    return submenu;
  }

  private createConversionItem(direction: HanjaConversionDirection): HTMLElement {
    const item = document.createElement('div');
    item.className = 'md-item';
    item.dataset.cmd = CONVERT_HANJA_COMMAND;
    item.setAttribute('role', 'menuitem');
    item.appendChild(document.createTextNode(contextMenuConversionLabel(direction)));

    const shortcut = document.createElement('span');
    shortcut.className = 'md-shortcut';
    shortcut.textContent = 'F9';
    item.appendChild(shortcut);

    item.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!this.hopDispatcher.isEnabled(CONVERT_HANJA_COMMAND)) return;
      this.hopDispatcher.dispatch(CONVERT_HANJA_COMMAND);
      this.hide();
    });
    return item;
  }
}

function createSeparator(): HTMLElement {
  const separator = document.createElement('div');
  separator.className = 'md-sep';
  return separator;
}

function keepMenuInsideViewport(menu: HTMLElement): void {
  const rect = menu.getBoundingClientRect();
  const left = Math.max(
    0,
    Math.min(parseFloat(menu.style.left) || 0, window.innerWidth - rect.width - 2),
  );
  const top = Math.max(
    0,
    Math.min(parseFloat(menu.style.top) || 0, window.innerHeight - rect.height - 2),
  );
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}
