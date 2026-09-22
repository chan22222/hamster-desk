# Hamster Desk

[![최신 버전](https://img.shields.io/github/v/release/chan22222/hamster-desk?label=%EC%B5%9C%EC%8B%A0%20%EB%B2%84%EC%A0%84)](https://github.com/chan22222/hamster-desk/releases/latest) · [English](README.en.md)

Claude Code CLI 를 그대로 쓰면서, 지금 누가(메인·서브에이전트) 무슨 파일을 고치고 있는지 복셀 햄스터로 보여 주고, 사용량·버전을 한 화면에서 다루는 Windows 데스크톱 앱. 한 창 안에 **내장 터미널 탭**과 **햄스터 책상**이 함께 있고, 터미널에서 평소처럼 `claude` 를 실행하면 된다. 훅도, 프록시도, API 키도 없다 — Claude Code 가 이미 디스크에 쓰는 파일만 읽으므로 CLI 속도에 영향이 없고, Max/Pro 구독 로그인이 그대로다.

![메인 창 — 사이드바, 사무실에 앉은 햄스터들, 터미널](docs/images/main-window.png)

![알림 창 — 권한 요청·질문·턴 완료 카드](docs/images/notify-window.png)

## 내려받기 (Windows)

**[⬇ 설치 프로그램 받기 — 최신 릴리스](https://github.com/chan22222/hamster-desk/releases/latest)** → `Hamster-Desk-Setup-<버전>.exe` 를 받아 실행하면 된다. git·node 가 필요 없고, 관리자 권한도 묻지 않는다.

- 서명이 없는 앱이라 처음 실행할 때 "Windows의 PC 보호" 창이 뜬다: **추가 정보 → 실행**.
- 한 번 설치하면 새 버전은 앱이 켤 때 알려 준다 — `업데이트 받기` 를 누르면 받고, **다시 시작해서 업데이트** 로 끝난다. 다시 설치할 일은 없다.
- 터미널에서 쓸 [Claude Code](https://claude.com/claude-code) 는 따로 설치되어 있어야 한다.
- 바뀐 내용은 [CHANGELOG.md](CHANGELOG.md).

## 주요 기능

자세한 것은 전부 [docs/features.md](docs/features.md) 에 있다.

- **내장 터미널** — node-pty + xterm.js 탭 여러 개. Windows Terminal 과 같은 복사·붙여넣기, `Ctrl+F` 검색, 글꼴 크기, 단축키 한 벌. → [터미널](docs/features.md#터미널)
- **햄스터 책상** — 복셀 섬 위의 사무실. 메인은 사장 자리, 서브에이전트는 문으로 걸어 들어와 직원 자리에 앉고, 머리 위 말풍선이 지금 하는 말과 일을 보여 준다. 모델별 스킨, 자동 카메라, 사장의 순찰. → [책상](docs/features.md#책상-복셀-스튜디오)
- **말풍선 요약** — 긴 문장을 Haiku 가 한 줄로 줄여 설정 언어로 옮긴다(기본 꺼짐, 구독으로 회당 $0.0007). → [말풍선 요약](docs/features.md#말풍선-요약)
- **사용량 게이지** — 5시간·주간(모델별 주간까지) 창의 퍼센트와 초기화까지 남은 시간이 상단 칩 하나에. → [사용량](docs/features.md#사용량)
- **세션 컨트롤 바** — 모델·effort 바꾸기, 컨텍스트 미터, `/compact`·`/clear`, 멀티 에이전트 지시 스위치. → [세션 컨트롤 바](docs/features.md#세션-컨트롤-바)
- **여러 계정** — 계정 = `CLAUDE_CONFIG_DIR` 폴더. 추가하면 바로 로그인 탭이 열리고, 같은 폴더를 두 계정으로 나란히 연다. → [여러 계정](docs/features.md#여러-계정)
- **5시간 창 자동 시작** — 한도가 초기화되면 1분 뒤 짧은 메시지를 보내 다음 창을 곧바로 연다(계정별, 기본 꺼짐). → [5시간 창 자동 시작](docs/features.md#5시간-창-자동-시작)
- **알림** — 창이 뒤에 있을 때 권한 요청·질문·턴 완료를 앱의 알림 창으로, 작업 표시줄 깜빡임과 함께. → [알림](docs/features.md#알림)
- **사이드바** — 바뀐 파일(마지막 편집 미리보기와 `git diff`), 말풍선 로그, 파일 탐색, 프로젝트를 알아보는 실행 메뉴. → [사이드바](docs/features.md#사이드바)
- **지난 대화** — 그 폴더의 대화 목록에서 골라 `claude --resume` 으로 새 탭에서 잇는다. → [지난 대화](docs/features.md#지난-대화-이어서-열기)
- **Git 칩** — 탭에 브랜치와 바뀐 경로 수. 읽기 전용 명령만 쓴다. → [Git](docs/features.md#git)
- **미니 모드** — 항상 위 480×360 창에 스튜디오와 상태줄만. → [미니 모드](docs/features.md#미니-모드)
- **탭·창 복원**, 라이트·다크 테마, 책상 위치(위·오른쪽). → [탭·창 복원](docs/features.md#탭창-복원) · [레이아웃](docs/features.md#레이아웃)

## 소스에서 실행

```bash
npm install                # .npmrc 가 legacy-peer-deps 를 켜 둔다
npm run build:vite         # out/ 만 만든다(패키징 없음)
npx electron .             # 또는 npm run dev (HMR)
```

설치 프로그램 빌드, 검증 명령, 캡처 실행, 릴리스는 [docs/development.md](docs/development.md).

## 문서

- [docs/features.md](docs/features.md) — 화면과 기능, 전부
- [docs/architecture.md](docs/architecture.md) — 무엇을 읽고 쓰는지, 파일 지도, 설정 파일, 업데이트·릴리스 파이프라인, 디자인 토큰
- [docs/development.md](docs/development.md) — 실행·빌드·검증·캡처 실행·릴리스
- [docs/design-notes.md](docs/design-notes.md) — 왜 이렇게 만들었는지
- [CONTRIBUTING.md](CONTRIBUTING.md) — 고칠 때 지킬 것
- [CHANGELOG.md](CHANGELOG.md) — 버전별 변화

## 라이선스

[Apache-2.0](LICENSE)
