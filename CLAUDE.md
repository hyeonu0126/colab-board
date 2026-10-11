# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 명령어

- `npm run dev` — Vite 개발 서버
- `npm run build` — `tsc -b && vite build` (타입체크 후 `dist/` 생성)
- `npm run lint` — ESLint
- `npm run preview` — 빌드 결과 미리보기
- 배포: Firebase Hosting (`firebase.json`이 `dist/`를 서빙, 모든 경로를 `/index.html`로 rewrite)

테스트 러너는 설정되어 있지 않다.

## 아키텍처

React 19 + TypeScript + Vite 기반의 실시간 협업 화이트보드 + 음성 회의 앱. 별도 백엔드 없이 클라이언트가 Firebase Realtime Database와 PeerJS를 직접 사용한다. 소스는 `src/` 아래 4개 파일이 핵심이다.

- `src/firebase.ts` — Firebase 초기화, `db`(Realtime Database) export
- `src/MeetingRoomLanding.tsx` — 방 생성/입장 화면. `rooms`를 구독해 방 목록을 보여주고, 방 이름·관리자 비밀번호·입장 비밀번호·닉네임을 검증
- `src/App.tsx` — `App`(방/닉네임 상태 및 닉네임 중복 검사)과 `WhiteboardCanvas`(캔버스, 도구, 음성, 관리 기능)를 모두 포함하는 큰 단일 파일
- `src/main.tsx` — 진입점

### Realtime Database 구조 (`rooms/{roomName}/...`)

- 방 루트: `roomName`, `adminPass`, `joinPass`, `creator`, `createdAt` — 비밀번호가 평문으로 저장되며 클라이언트에서 직접 비교한다 (추방/방 삭제 시 `prompt`로 입력받은 값과 비교)
- `lines/{pushId}` — 선분 하나 단위(`startX/Y`, `endX/Y`, `color`, `lineWidth`, `strokeId`, `userId`). 한 번의 드래그는 같은 `strokeId`를 공유하는 여러 선분이다
- `images/{id}` — 업로드된 이미지(`url`, `x`, `y`, `width`, `height`)
- `users/{userName}` — `{ userName, peerId }`. 사용자 키가 곧 닉네임이므로 중복 입장 방지와 추방(해당 노드 삭제)에 사용된다

### 캔버스 렌더링

`onValue`로 `lines`/`images`를 구독하고 `renderCanvas`가 캔버스를 매번 전부 지운 뒤 이미지 → 선 순서로 다시 그린다. 로컬에서 그리는 중에는 즉시 캔버스에 그리고 동시에 Firebase에 `push`/`set`한다. 도구 모드는 `draw | erase_partial | erase_stroke`이며, 지우개는 선분 키 또는 `strokeId` 단위로 삭제한다. Undo는 `HistoryAction`(`draw`는 `strokeId`로 삭제, `erase`는 `restoredLines`를 다시 push)으로 구현된다.

### 음성 통화 (WebRTC)

`WhiteboardCanvas`의 `useEffect`가 마이크 스트림을 얻고 `new Peer()`(PeerJS 기본 공개 서버)를 만든 뒤, 발급된 `peerId`를 `users/{userName}`에 기록한다. `users`를 구독하면서 새로 나타난 `peerId`로 `peer.call`을 걸고, `call` 이벤트는 자동 응답한다. 시그널링은 Firebase(`users`의 peerId)가 담당하며, 연결은 `currentCalls` ref에 보관하고 cleanup에서 `peer.destroy()`와 사용자 노드 삭제를 수행한다. 마이크 획득이 실패하면 `peerId: null`로 등록하고 청취 없이 입장한다.

## 규칙

- 코드 주석, 커밋 메시지, 문서는 한국어로 작성하고 변수명/함수명은 영어를 사용한다 (전역 사용자 지침).
