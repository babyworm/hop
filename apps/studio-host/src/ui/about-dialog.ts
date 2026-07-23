import { AboutDialog as UpstreamAboutDialog } from '@/upstream/ui';
import { loadBundledHanjaNotices } from '../hanja/hanja-dictionary';

export class AboutDialog extends UpstreamAboutDialog {
  override show(): void {
    super.show();
    this.dialog.classList.add('hop-about-dialog');
  }

  protected override createBody(): HTMLElement {
    const body = super.createBody();
    const version = body.querySelector('.about-version');

    const hopVersion = document.createElement('div');
    hopVersion.className = 'about-hop-version';
    hopVersion.textContent = `HOP ${__HOP_VERSION__}`;

    if (version?.parentNode) {
      version.parentNode.insertBefore(hopVersion, version.nextSibling);
    } else {
      body.appendChild(hopVersion);
    }

    const notices = document.createElement('details');
    notices.className = 'about-hanja-notices';
    const summary = document.createElement('summary');
    summary.textContent = '한자 사전 제3자 라이선스 및 저작권 고지';
    const content = document.createElement('pre');
    content.className = 'about-hanja-notices-content';
    content.textContent = '전문을 불러오는 중입니다…';
    notices.append(summary, content);

    let requested = false;
    notices.addEventListener('toggle', () => {
      if (!notices.open || requested) return;
      requested = true;
      content.scrollIntoView?.({ block: 'nearest' });
      void loadBundledHanjaNotices()
        .then((text) => {
          content.textContent = text;
        })
        .catch(() => {
          requested = false;
          content.textContent = '한자 사전 제3자 고지를 불러오지 못했습니다.';
        });
    });

    const copyright = body.querySelector('.about-copyright');
    if (copyright) {
      body.insertBefore(notices, copyright);
    } else {
      body.appendChild(notices);
    }

    return body;
  }
}
