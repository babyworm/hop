# GitHub Issue Comment Drafts: #10, #12, #13, #14, #16, #17, #19

이 문서는 HOP 이슈에 남길 짧은 댓글 초안이다.

## Issue #10 Draft: Windows 저장/다른 이름 저장 시 파일 손상

```markdown
잠재적으로 파일이 손상될 수 있는 저장 경로를 수정했습니다.

최신 빌드에서 기존 `.hwp` 파일을 열어 저장하거나 다른 이름으로 저장한 뒤 다시 열었을 때 문제가 해결되었다면 이 이슈를 닫아주세요.

아직 파일이 깨진다면 Windows 버전, 저장 방식(저장/다른 이름으로 저장), 가능한 경우 문제가 재현되는 원본 파일과 손상된 결과 파일, 그리고 상세한 재현 순서를 남겨주세요.

저장된 파일 자체가 `rhwp` export 단계에서 이미 깨지는 것으로 확인되면 같은 파일과 재현 순서로 rhwp 쪽에도 이슈를 남겨주세요: https://github.com/edwardkim/rhwp/issues
```

## Issue #12 Draft: macOS fullscreen 후 A4 페이지 중앙 정렬 깨짐

```markdown
fullscreen 전환 후 페이지 위치가 어긋날 수 있는 경로를 수정했습니다.

최신 빌드에서 fullscreen 진입 후 다시 windowed로 돌아왔을 때 페이지가 정상적으로 중앙에 보이면 이 이슈를 닫아주세요.

아직 어긋난다면 macOS 버전, 디스플레이 배율/외부 모니터 여부, HOP 창 크기, zoom 값, 스크린샷, 그리고 상세한 재현 순서를 남겨주세요.

HOP의 화면 배치가 아니라 `rhwp`가 반환하는 페이지/커서 좌표 자체가 잘못된 것으로 보이면 rhwp 쪽에도 이슈를 남겨주세요: https://github.com/edwardkim/rhwp/issues
```

## Issue #13 Draft: macOS 표 셀 선택 및 병합 불가

```markdown
macOS에서 표 셀 선택과 병합에 접근하기 어려웠던 경로를 수정했습니다.

최신 빌드에서 표 안에서 셀 블록 선택 후 병합이 정상적으로 동작한다면 이 이슈를 닫아주세요.

아직 동작하지 않는다면 macOS 버전, 표 구조, 사용한 진입 경로(메뉴/단축키/컨텍스트 메뉴), 선택한 셀 범위, 실제로 일어난 현상, 가능하면 스크린샷이나 샘플 파일을 남겨주세요.

선택은 되는데 병합 결과나 저장 결과가 깨진다면 `rhwp`의 표 처리 문제일 수 있으니 같은 샘플로 rhwp 쪽에도 이슈를 남겨주세요: https://github.com/edwardkim/rhwp/issues
```

## Issue #14 Draft: Linux 한글 입력 불가

```markdown
Linux에서 한글 IME가 붙지 않거나 조합 입력이 불안정할 수 있는 경로를 수정했습니다.

최신 빌드에서 사용 중인 IME로 한글 입력이 정상 동작한다면 이 이슈를 닫아주세요.

아직 문제가 있다면 배포판/버전, X11/Wayland 여부, 사용 IME(fcitx5/ibus-hangul 등), AppImage/.deb/.rpm 중 어떤 패키지인지, 입력한 문자열과 실제 입력 결과를 남겨주세요.

조합 이벤트는 들어오는데 자모 분리/중복 입력/undo 오류가 난다면 `rhwp-studio` 입력 처리 문제일 수 있으니 rhwp 쪽에도 이슈를 남겨주세요: https://github.com/edwardkim/rhwp/issues
```

## Issue #16 Draft: macOS 설치 글꼴 적용 불가

```markdown
설치된 글꼴이 HOP에서 제대로 선택/적용되지 않을 수 있는 경로를 수정했습니다.

최신 빌드에서 설치 글꼴이 toolbar, 글자 모양, 스타일 편집에서 정상 적용된다면 이 이슈를 닫아주세요.

아직 fallback 글꼴로 보인다면 macOS 버전, 글꼴명, 설치 위치, 어떤 UI에서 적용했는지, 화면 렌더링 또는 PDF 내보내기 결과, 가능하면 샘플 파일이나 스크린샷을 남겨주세요.

HOP가 글꼴을 찾고 있는데 렌더링/내보내기에서만 무시된다면 rhwp 쪽에도 이슈를 남겨주세요: https://github.com/edwardkim/rhwp/issues
```

## Issue #17 Draft: 로컬/한컴/vendor font file 읽기

```markdown
한컴/vendor 글꼴 파일을 HOP에서 찾고 적용하는 경로를 보강했습니다.

최신 빌드에서 해당 글꼴이 목록에 보이고 편집 화면과 PDF 내보내기에서 일관되게 적용된다면 이 이슈를 닫아주세요.

아직 누락된다면 Windows 버전, 한컴 설치 버전/경로, 글꼴 파일명 또는 family name, HOP 글꼴 목록에 보이는지 여부, 편집 화면/PDF 각각의 결과, 가능하면 샘플 파일을 남겨주세요.

글꼴 파일은 로드되는데 특정 face/style만 잘못 매칭된다면 rhwp 쪽에도 이슈를 남겨주세요: https://github.com/edwardkim/rhwp/issues
```

## Issue #19 Draft: Ubuntu 22.04 glibc 호환성

```markdown
Linux 릴리즈 빌드의 glibc 기준과 ABI 검증 경로를 수정했습니다.

최신 Linux 빌드가 Ubuntu 22.04에서 정상 실행된다면 이 이슈를 닫아주세요.

아직 실행되지 않는다면 배포판/버전, 사용한 패키지(AppImage/.deb/.rpm), 실행 명령, 터미널 오류, `ldd --version` 결과를 남겨주세요.
```
