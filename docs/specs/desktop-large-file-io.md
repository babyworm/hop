# Desktop Large File IO 1-Pager

## Background

HOP 데스크톱은 기존에 문서 열기, 저장, PDF 내보내기에서 큰 HWP 바이트를 한 번에 IPC로 전달하는 경로를 사용했다. 저장은 staging 파일 기반으로 바꿔 Windows 저장 손상 이슈를 줄였지만, 열기와 PDF 내보내기는 여전히 전체 바이트를 한 번에 다루고 있었다. print는 바이트 IPC는 없지만, 인쇄용 SVG를 배열로 전부 모은 뒤 DOM에 붙이는 구조였다.

## Problem

100MB, 300MB 같은 큰 파일에서는 전체 바이트 IPC와 중복 버퍼 생성이 메모리 피크와 실패 가능성을 키운다. 특히 기존 열기 경로는 Rust 버퍼, IPC 버퍼, JS 버퍼, WASM 버퍼가 겹칠 수 있었고, 기존 저장 경로도 `exportHwp()` 결과를 한 번에 `writeFile`로 넘겼다.

## Goal

`third_party/rhwp`를 수정하지 않고, 데스크톱 앱의 큰 파일 열기/저장/PDF 내보내기 경로에서 불필요한 대용량 IPC와 한 번에 큰 쓰기 호출을 줄인다. 열기는 프런트엔드 chunk read + native tracking-only session으로 바꾸고, 저장과 PDF 내보내기는 staged HWP 파일에 chunk write 후 Rust가 검증/commit 또는 export 하도록 한다. print는 바이트 IPC를 추가하지 않으면서 인쇄 준비 중 중복 메모리 사용을 줄인다.

## Non-goals

`rhwp`의 `loadDocument`/`exportHwp`를 streaming API로 바꾸지 않는다. HWP/HWPX 포맷 호환성 자체를 바꾸지 않는다. print를 네이티브 문서 코어 기반 경로로 다시 설계하지 않는다.

## Constraints

`pnpm`만 사용한다. `third_party/rhwp`는 read-only다. 기존 dirty 상태, revision guard, external modification 감지, atomic save semantics를 유지해야 한다. 열기/저장 실패가 기존 문서 세션을 누수시키면 안 된다.

## Implementation outline

프런트엔드 `TauriBridge`는 `plugin-fs`의 `stat/open/read`로 문서를 chunk 단위로 읽고, 읽는 중 동시에 FNV-1a 해시를 계산한다. 읽기 전후 `stat`를 비교해 파일이 바뀌지 않았을 때만 읽은 바이트와 fingerprint를 함께 `open_document_tracking`에 넘기고, WASM 로드 실패 시 해당 세션을 닫는다. 네이티브는 tracking-only 세션으로 시작하되, 기존 native query/render/mutate/export 경로가 필요하면 on-demand로 `DocumentCore`를 로드한다. 저장과 PDF 내보내기는 각각 전용 staged HWP 경로를 준비하고, 프런트가 `open/write/close`로 chunk 단위 기록한 뒤 Rust가 staged 파일을 다시 읽어 파싱 검증 후 저장 또는 PDF export를 수행한다. print는 인쇄용 SVG 문자열을 별도 배열에 쌓지 않고 DOM에 바로 추가해 중간 메모리 복제를 줄인다.

## Verification plan

브리지 테스트에서 chunk 기반 open/save/PDF export 호출이 맞는지 검증한다. Rust 테스트에서 tracking-only open과 staged save/PDF export 경로 회귀를 점검한다. `cargo test`, `cargo clippy -- -D warnings`, `pnpm run test:studio`, `pnpm run build:studio`, `pnpm --filter hop-desktop tauri build --debug --bundles app`를 다시 실행한다.

## Rollback or recovery notes

회귀가 생기면 `TauriBridge`의 chunk read/write helper와 `open_document_tracking`, staged PDF export 경로만 되돌리면 된다. staged save commit 자체는 유지하고, desktop-specific large-file optimization 범위만 롤백한다.
