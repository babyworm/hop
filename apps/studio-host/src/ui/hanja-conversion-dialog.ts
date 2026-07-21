import type {
  HanjaCharacterCandidate,
  HanjaLookupResult,
  HanjaSyllableLookup,
  HanjaToHangulLookup,
  HanjaWordLookup,
} from '../hanja/hanja-dictionary';
import {
  characterCandidateElement,
  createCandidateList,
  createDialogShell,
  updateListSelection,
  wordCandidateElement,
} from './hanja-conversion-elements';

export function openHanjaConversionDialog(result: HanjaLookupResult): Promise<string | null> {
  if (result.kind === 'word') return openWordDialog(result);
  if (result.kind === 'syllables') return openSyllableDialog(result);
  return openHangulDialog(result);
}

function openWordDialog(result: HanjaWordLookup): Promise<string | null> {
  return new Promise((resolve) => {
    let selectedIndex = 0;
    const shell = createDialogShell('단어 후보', result.source, resolve);
    shell.description.textContent = '일치하는 한자 단어를 찾았습니다. 위·아래 방향키로 후보를 고르세요.';

    const list = createCandidateList(shell.dialogId, '한자 단어 후보');
    shell.body.appendChild(list);

    const render = () => {
      list.replaceChildren();
      result.candidates.forEach((candidate, index) => {
        const item = wordCandidateElement(candidate, index === selectedIndex);
        item.id = `${shell.dialogId}-option-${index}`;
        item.dataset.index = String(index);
        item.addEventListener('click', () => {
          selectedIndex = index;
          updateSelection();
          list.focus();
        });
        item.addEventListener('dblclick', () => shell.close(candidate.text));
        list.appendChild(item);
      });
      updateSelection();
    };

    const updateSelection = () => {
      updateListSelection(list, selectedIndex);
      shell.previewValue.textContent = result.candidates[selectedIndex]?.text ?? result.source;
    };

    shell.applyButton.addEventListener('click', () => {
      shell.close(result.candidates[selectedIndex]?.text ?? null);
    });
    shell.setKeyHandler((event) => {
      if (event.key === 'ArrowDown') {
        selectedIndex = Math.min(result.candidates.length - 1, selectedIndex + 1);
        updateSelection();
        return true;
      }
      if (event.key === 'ArrowUp') {
        selectedIndex = Math.max(0, selectedIndex - 1);
        updateSelection();
        return true;
      }
      if (event.key === 'Enter') {
        shell.close(result.candidates[selectedIndex]?.text ?? null);
        return true;
      }
      return false;
    });
    render();
    shell.mount(list);
  });
}

function openSyllableDialog(result: HanjaSyllableLookup): Promise<string | null> {
  return openPerCharacterDialog(result.source, result.syllables, {
    modeLabel: '글자별 변환',
    description: '단어 후보가 없어 한 음절씩 변환합니다. 좌·우 방향키로 음절을 이동하세요.',
    tabLabel: '변환할 음절',
    listLabel: '한자 글자 후보',
    candidateValue: (candidate) => candidate.character,
  });
}

function openHangulDialog(result: HanjaToHangulLookup): Promise<string | null> {
  return openPerCharacterDialog(result.source, result.characters, {
    modeLabel: '한자에서 한글로',
    description: '각 한자의 음과 훈(뜻)을 확인하고 한글 음을 선택하세요.',
    tabLabel: '변환할 한자',
    listLabel: '한글 음과 훈 후보',
    candidateValue: (candidate) => candidate.reading,
  });
}

interface PerCharacterUnit {
  source: string;
  candidates: HanjaCharacterCandidate[];
}

interface PerCharacterDialogOptions {
  modeLabel: string;
  description: string;
  tabLabel: string;
  listLabel: string;
  candidateValue(candidate: HanjaCharacterCandidate): string;
}

function openPerCharacterDialog(
  sourceText: string,
  units: PerCharacterUnit[],
  options: PerCharacterDialogOptions,
): Promise<string | null> {
  return new Promise((resolve) => {
    let activeUnit = 0;
    const selectedIndices = units.map(() => 0);
    const shell = createDialogShell(options.modeLabel, sourceText, resolve);
    shell.description.textContent = options.description;

    const syllableTabs = document.createElement('div');
    syllableTabs.className = 'hanja-syllable-tabs';
    syllableTabs.setAttribute('aria-label', options.tabLabel);

    const list = createCandidateList(shell.dialogId, options.listLabel);
    shell.body.append(syllableTabs, list);

    const assembledResult = () => units
      .map((unit, index) => {
        const candidate = unit.candidates[selectedIndices[index] ?? 0];
        return candidate ? options.candidateValue(candidate) : unit.source;
      })
      .join('');

    const renderTabs = () => {
      syllableTabs.replaceChildren();
      units.forEach((unit, index) => {
        const candidate = unit.candidates[selectedIndices[index] ?? 0];
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'hanja-syllable-tab';
        button.dataset.active = String(index === activeUnit);
        button.setAttribute('aria-pressed', String(index === activeUnit));

        const source = document.createElement('span');
        source.className = 'hanja-syllable-source';
        source.textContent = unit.source;
        const replacement = document.createElement('span');
        replacement.className = 'hanja-syllable-choice';
        replacement.textContent = candidate ? options.candidateValue(candidate) : '—';
        button.append(source, replacement);
        button.addEventListener('click', () => {
          activeUnit = index;
          render();
          list.focus();
        });
        syllableTabs.appendChild(button);
      });
      const activeTab = syllableTabs.children[activeUnit];
      activeTab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };

    const renderCandidates = () => {
      list.replaceChildren();
      const active = units[activeUnit];
      if (!active) return;
      active.candidates.forEach((candidate, index) => {
        const item = characterCandidateElement(candidate, index === selectedIndices[activeUnit]);
        item.id = `${shell.dialogId}-option-${activeUnit}-${index}`;
        item.dataset.index = String(index);
        item.addEventListener('click', () => {
          selectedIndices[activeUnit] = index;
          renderTabs();
          updateListSelection(list, index);
          shell.previewValue.textContent = assembledResult();
          list.focus();
        });
        item.addEventListener('dblclick', acceptAndAdvance);
        list.appendChild(item);
      });
      updateListSelection(list, selectedIndices[activeUnit] ?? 0);
    };

    const render = () => {
      renderTabs();
      renderCandidates();
      shell.previewValue.textContent = assembledResult();
    };

    const acceptAndAdvance = () => {
      if (activeUnit < units.length - 1) {
        activeUnit += 1;
        render();
        list.focus();
      } else {
        shell.close(assembledResult());
      }
    };

    shell.applyButton.addEventListener('click', () => shell.close(assembledResult()));
    shell.setKeyHandler((event) => {
      const active = units[activeUnit];
      if (!active) return false;
      if (event.key === 'ArrowDown') {
        selectedIndices[activeUnit] = Math.min(
          active.candidates.length - 1,
          (selectedIndices[activeUnit] ?? 0) + 1,
        );
        render();
        return true;
      }
      if (event.key === 'ArrowUp') {
        selectedIndices[activeUnit] = Math.max(0, (selectedIndices[activeUnit] ?? 0) - 1);
        render();
        return true;
      }
      if (event.key === 'ArrowRight') {
        activeUnit = Math.min(units.length - 1, activeUnit + 1);
        render();
        return true;
      }
      if (event.key === 'ArrowLeft') {
        activeUnit = Math.max(0, activeUnit - 1);
        render();
        return true;
      }
      if (event.key === 'Enter') {
        acceptAndAdvance();
        return true;
      }
      return false;
    });
    render();
    shell.mount(list);
  });
}
