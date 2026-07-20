import type {
  HanjaLookupResult,
  HanjaSyllableLookup,
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
  return result.kind === 'word'
    ? openWordDialog(result)
    : openSyllableDialog(result);
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
  return new Promise((resolve) => {
    let activeSyllable = 0;
    const selectedIndices = result.syllables.map(() => 0);
    const shell = createDialogShell('글자별 변환', result.source, resolve);
    shell.description.textContent = '단어 후보가 없어 한 음절씩 변환합니다. 좌·우 방향키로 음절을 이동하세요.';

    const syllableTabs = document.createElement('div');
    syllableTabs.className = 'hanja-syllable-tabs';
    syllableTabs.setAttribute('aria-label', '변환할 음절');

    const list = createCandidateList(shell.dialogId, '한자 글자 후보');
    shell.body.append(syllableTabs, list);

    const assembledResult = () => result.syllables
      .map((syllable, index) => syllable.candidates[selectedIndices[index] ?? 0]?.character ?? syllable.source)
      .join('');

    const renderTabs = () => {
      syllableTabs.replaceChildren();
      result.syllables.forEach((syllable, index) => {
        const candidate = syllable.candidates[selectedIndices[index] ?? 0];
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'hanja-syllable-tab';
        button.dataset.active = String(index === activeSyllable);
        button.setAttribute('aria-pressed', String(index === activeSyllable));

        const source = document.createElement('span');
        source.className = 'hanja-syllable-source';
        source.textContent = syllable.source;
        const replacement = document.createElement('span');
        replacement.className = 'hanja-syllable-choice';
        replacement.textContent = candidate?.character ?? '—';
        button.append(source, replacement);
        button.addEventListener('click', () => {
          activeSyllable = index;
          render();
          list.focus();
        });
        syllableTabs.appendChild(button);
      });
    };

    const renderCandidates = () => {
      list.replaceChildren();
      const active = result.syllables[activeSyllable];
      if (!active) return;
      active.candidates.forEach((candidate, index) => {
        const item = characterCandidateElement(candidate, index === selectedIndices[activeSyllable]);
        item.id = `${shell.dialogId}-option-${activeSyllable}-${index}`;
        item.dataset.index = String(index);
        item.addEventListener('click', () => {
          selectedIndices[activeSyllable] = index;
          render();
        });
        item.addEventListener('dblclick', acceptAndAdvance);
        list.appendChild(item);
      });
      updateListSelection(list, selectedIndices[activeSyllable] ?? 0);
    };

    const render = () => {
      renderTabs();
      renderCandidates();
      shell.previewValue.textContent = assembledResult();
    };

    const acceptAndAdvance = () => {
      if (activeSyllable < result.syllables.length - 1) {
        activeSyllable += 1;
        render();
      } else {
        shell.close(assembledResult());
      }
    };

    shell.applyButton.addEventListener('click', () => shell.close(assembledResult()));
    shell.setKeyHandler((event) => {
      const active = result.syllables[activeSyllable];
      if (!active) return false;
      if (event.key === 'ArrowDown') {
        selectedIndices[activeSyllable] = Math.min(
          active.candidates.length - 1,
          (selectedIndices[activeSyllable] ?? 0) + 1,
        );
        render();
        return true;
      }
      if (event.key === 'ArrowUp') {
        selectedIndices[activeSyllable] = Math.max(0, (selectedIndices[activeSyllable] ?? 0) - 1);
        render();
        return true;
      }
      if (event.key === 'ArrowRight') {
        activeSyllable = Math.min(result.syllables.length - 1, activeSyllable + 1);
        render();
        return true;
      }
      if (event.key === 'ArrowLeft') {
        activeSyllable = Math.max(0, activeSyllable - 1);
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
