# Windows File Association Launch 1-Pager

## Background

Windows 11에서 `.hwp` 또는 `.hwpx` 파일을 HOP 연결 프로그램으로 더블클릭하면 앱은 실행되지만 문서가 로드되지 않고 빈 편집 상태로 남는다. 같은 파일을 HOP를 먼저 실행한 뒤 `파일 열기`로 열면 정상적으로 표시된다.

## Problem

현재 데스크톱 셸은 이미 실행 중인 인스턴스로 전달되는 `single-instance` 인자와 macOS의 `RunEvent::Opened`만 처리한다. Windows에서 앱이 처음 실행될 때 전달되는 파일 경로 인자는 초기 큐에 넣지 않아 프런트엔드가 열 파일을 받지 못한다.

## Goal

앱 첫 실행이 파일 연결로 시작된 경우에도 전달된 문서 경로를 `pending_open_paths`에 넣어 기존 데스크톱 이벤트 흐름으로 정상 로드되게 한다.

## Non-goals

`third_party/rhwp` 변경, 파일 연결 메타데이터 재설계, 문서 파서 변경, 또는 다중 문서 탭 동작 추가는 이번 범위가 아니다.

## Constraints

`pnpm`만 사용하고, macOS/Windows/Linux 동작을 유지해야 한다. 기존 macOS `Opened` 이벤트, 이미 실행 중인 인스턴스 전달, drag/drop 파일 열기 흐름을 깨뜨리면 안 된다.

## Implementation outline

Rust 앱 `setup` 단계에서 프로세스 시작 인자를 읽어 지원 확장자만 추출하고 `pending_open_paths` 및 기존 `hop-open-paths` 이벤트 큐로 흘려보낸다. 인자 파싱은 기존 `document_path_from_arg` 로직을 재사용 가능한 OS 문자열 기반 helper로 정리하고, 상대 경로와 file URL 처리 테스트를 보강한다.

## Verification plan

Rust 단위 테스트와 스튜디오 호스트 데스크톱 이벤트 테스트를 실행한다. 이후 Windows에서 파일 연결 더블클릭, 앱 실행 후 `파일 열기`, 이미 실행 중인 앱으로의 재오픈을 수동 확인한다.

## Rollback or recovery notes

초기 인자 큐잉이 회귀를 만들면 해당 setup 훅만 되돌리면 된다. macOS `Opened`와 `single-instance` 경로는 그대로 유지되므로 롤백 범위는 데스크톱 셸 초기화 코드에 한정된다.
