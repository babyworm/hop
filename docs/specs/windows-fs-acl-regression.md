# Windows FS ACL Regression 1-Pager

## Background

v0.1.7 저장 손상 대응 이후 HOP는 큰 HWP 바이트를 Tauri invoke로 직접 넘기지 않고 `tauri-plugin-fs` chunk IO를 사용한다. 이후 이슈 `#10` 댓글과 `#23`에서 Windows 사용자가 기존 HWP 파일 열기 실패와 새 문서 저장 실패를 보고했고, 오류 로그가 ACL plugin 문제를 가리켰다.

## Problem

프런트엔드는 `stat/open/read/write/remove`를 호출하지만 capability에는 `write-file/remove`만 추가되어 있고, 열기 대상 파일은 동적 fs scope에 등록되지 않는다. 저장 staging 파일은 Rust에서 scope에 추가하지만 `open()` 기반 쓰기는 `write-file` 권한이 아니라 `open/write/stat` 권한도 필요하다.

## Goal

프런트엔드가 chunk IO를 수행하기 전에 Rust가 HOP 문서 파일 또는 staging 파일을 명시적으로 fs scope에 등록하고, capability가 실제 사용하는 fs 명령을 허용하게 한다. Windows, macOS, Linux에서 같은 코드 경로를 유지한다.

## Non-goals

`third_party/rhwp` 파서나 직렬화 로직 변경, 저장 파일 포맷 변경, HWPX 직접 저장 지원은 이번 범위가 아니다.

## Constraints

`third_party/rhwp`는 read-only로 유지한다. scope는 부모 디렉터리가 아니라 exact file 경로만 허용한다. 사용자가 선택하거나 OS가 전달한 `.hwp/.hwpx` 문서만 열기 scope에 추가한다.

## Implementation outline

`prepare_document_open` Tauri command를 추가해 문서 확장자와 기존 파일 여부를 검증한 뒤 `fs_scope().allow_file()`을 호출한다. `TauriBridge.openDocumentByPath`는 `stat/open` 전에 이 명령을 먼저 호출한다. capability에는 실제 chunk I/O에서 쓰는 `fs:allow-open`, `fs:allow-stat`, `fs:allow-read`, `fs:allow-write`만 추가한다. chunk read/write와 fingerprint hashing은 별도 `chunked-fs` helper로 분리해 브리지 상태 관리와 파일 I/O 책임을 나눈다.

## Verification plan

브리지 테스트에서 문서 열기 전에 `prepare_document_open`이 호출되는지, 파일 변경 감지 실패 시 native tracking을 만들지 않는지 확인한다. `chunked-fs` 테스트로 부분 쓰기, 0-byte 쓰기, 크기 정규화, 해시 일관성을 확인한다. Rust 테스트로 열기 대상 검증을 확인한다. 이후 `pnpm test`, `pnpm run build:studio`, `cargo clippy -- -D warnings`, `cargo fmt --check`를 실행한다.

## Rollback or recovery notes

회귀가 생기면 `prepare_document_open` 호출과 capability 권한 추가만 되돌리면 된다. staged save 커밋 구조와 large-file chunk IO 구조는 유지한다.
