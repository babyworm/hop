# upstream 경계

HOP는 `edwardkim/rhwp`를 읽기 전용 upstream 의존성으로 사용한다.

* upstream URL: `https://github.com/edwardkim/rhwp.git`
* submodule 경로: `third_party/rhwp`
* 기준 source, 버전과 커밋: `config/rhwp-upstream.json`이 단일 기준선(SSOT)
* HOP 작업 브랜치: `main`

## 소유권 규칙

`third_party/rhwp` submodule은 vendor source로 취급한다. HOP 제품 동작을 구현하기 위해 이 폴더 아래 파일을 직접 수정하지 않는다.

HOP가 소유하는 코드는 다음 위치에 둔다.

* `apps/desktop/`: Tauri 셸, native document session, 저장/내보내기/인쇄, 창 관리, 파일 연결, 패키징
* `apps/studio-host/`: HOP studio host, Tauri bridge, desktop event routing, command override, 메뉴 추가, upstream에 패치하지 않을 UI 보정
* `assets/`, `docs/`, `scripts/`, 릴리즈 메타데이터: 제품 수준 자산과 운영 코드

studio host는 Vite alias로 upstream `rhwp-studio`를 가져오고, HOP가 반드시 소유해야 하는 파일만 같은 import 경로로 shadowing한다. 이렇게 하면 upstream 업데이트의 기본 작업이 submodule pointer 갱신과 작은 호환성 조정으로 줄어든다.

`config/rhwp-studio-overrides.json`은 모든 shadow alias의 검토 가능한 목록이다. 각 항목은 upstream
구현을 감싸는 `extension`, 의도적으로 유지하는 `fork`, HOP 전용 `contribution` 중 하나로 분류하고
존재 이유를 기록한다. 경계 테스트는 누락·중복과 사라진 upstream counterpart를 차단한다.
manifest의 SHA-256 baseline은 extension/fork counterpart와 HOP adapter가 의존하는 private upstream
입력의 변경을 감지한다. 업데이트 명령은 바뀐 counterpart와 private input 목록을 출력하므로 해당
adapter나 fork를 우선 리뷰한다.
upstream CSS가 직접 참조하는 mirrored public asset도 같은 baseline과 검증 절차로 동기화한다.

제품 TypeScript는 `apps/studio-host/src/upstream` port를 통해서만 upstream API를 사용한다. 명령군은
`apps/studio-host/src/host/command-runtime.ts`에서 typed contribution으로 조립한다. 로컬 글꼴의 브라우저
동작은 upstream에 위임하고 Tauri 확장만 native 조회와 font bytes를 제공한다. desktop과 Quick Look의
Rust 코드는 `apps/desktop/rhwp-adapter`에 의존하며 이 adapter만 `rhwp`를 직접 import한다.

HOP는 upstream `main.ts`를 그대로 실행하지 않으므로 browser/PWA file handling, embed runtime,
upstream autosave/recovery, theme, optional CanvasKit host wiring 같은 full-host 기능은 자동으로 채택하지
않는다. 이 기능들은 HOP native session·제품 정책과 충돌 여부를 별도로 검토한 뒤 도입한다. 현재
범위에서는 엔진/command API 호환성과 HOP의 기존 SVG/page renderer 경로를 유지한다.

현재 HOP가 소유하는 studio host override 범위는 다음과 같다.

* `core/bridge-factory`, `core/tauri-bridge`, `core/desktop-events`, `core/font-loader`, `core/font-application`, `core/local-fonts`: 데스크톱 런타임, 파일 이벤트, 로컬/벤더 폰트 연동
* `command/commands/file`, `command/commands/format`, `command/shortcut-map`: 데스크톱 파일 명령, 로컬 폰트 적용 보정, HOP 단축키
* `ui/dialog`, `ui/style-edit-dialog`, `ui/toolbar`, `ui/custom-select`, `ui/print-dialog`: HOP UI 보정, 인쇄 준비
* `view/*`: 데스크톱 viewport/page positioning, ruler 보정
* `styles/*`, `style.css`: HOP가 소유하는 스타일 override
* `main.ts`: upstream이 더 작은 bootstrap hook을 제공하기 전까지 유지하는 앱 bootstrap override
* `vendor/rhwp-core`, `vite-env.d.ts`: upstream release WASM import 경계를 맞추기 위한 generated WASM package와 타입 선언

## 업데이트 절차

실제 업데이트 작업은 [`rhwp 업데이트 운영 매뉴얼`](../operations/RHWP_UPDATE.md)의 준비, diff 리뷰,
검증, smoke test와 복구 체크리스트를 순서대로 따른다. 이 문서에는 경계의 핵심 원칙과 명령만 요약한다.

안정 release tag를 candidate로 준비하는 명령은 다음과 같다. branch나 `main`은 기본 업데이트
대상이 될 수 없으며 tag를 반드시 명시한다.

```sh
pnpm upstream:update -- vX.Y.Z
```

이 명령은 submodule checkout, vendored WASM, desktop과 Quick Look Cargo lockfile,
`config/rhwp-upstream.json`, WASM provenance를 함께 정렬한다. candidate 생성 후에는 다음을 실행한다.
실행 전 submodule `origin`이 기준선의 공식 source와 일치하고 보호 산출물이 clean인지 확인하며,
WASM 재생성은 생략할 수 없다.

```sh
pnpm upstream:verify
pnpm test
```

기존 shell entrypoint는 호환 목적으로만 남아 있으며 `UPSTREAM_REF`가 필수다.

```sh
UPSTREAM_REF=v0.7.19 scripts/update-upstream.sh
```

업데이트 도구는 submodule release에서 WASM package를 임시 디렉터리에 생성한 뒤
`apps/studio-host/vendor/rhwp-core`에 반영한다. 수동 복구가 필요할 때만 다음 명령을 사용한다.

```sh
(cd third_party/rhwp && wasm-pack build --target web --out-dir ../../apps/studio-host/vendor/rhwp-core --release)
```

업데이트 후에는 다음을 확인한다.

* submodule pointer diff
* `apps/studio-host/vendor/rhwp-core`의 package/provenance/hash와 upstream lock 정합
* desktop과 Quick Look Cargo.lock의 `rhwp` 버전 및 HOP-owned Cargo patch 정합
* `apps/studio-host` override의 타입/import 깨짐
* `apps/desktop/src-tauri`의 native Rust API 깨짐
* HOP가 별도로 보정하던 UI/파일/인쇄/창 이벤트 동작

HOP에 필요한 동작을 upstream이 아직 노출하지 않는다면 먼저 HOP adapter에서 해결한다. 필요한 엔진 API나 버그 수정이 upstream에서 제때 소비될 수 없을 때만 forked upstream 의존성을 고려한다.

## 검증 기준

upstream 갱신은 최소한 다음 검증을 통과해야 한다.

* repo root에서 `pnpm install --frozen-lockfile`
* repo root에서 `pnpm run build:studio`
* `apps/desktop/src-tauri/`에서 `cargo test`
* `apps/desktop/src-tauri/`에서 `cargo clippy -- -D warnings`
* repo root에서 `pnpm --filter hop-desktop tauri build --debug --bundles app`

public beta 빌드는 여기에 더해 macOS와 Windows 또는 Linux 최소 1개 환경에서 HWP/HWPX 열기, 저장, PDF 내보내기, 인쇄, drag/drop, 다중 창 동작을 smoke test한다.
