# 구조

앱이 무엇을 읽고 무엇을 쓰는지, 파일이 어디에 있는지, 설정·업데이트·릴리스가 어떻게 도는지. 화면에 보이는 것은 [화면과 기능](features.md), 검증은 [개발·검증](development.md), 왜 그렇게 되었는지는 [설계 노트](design-notes.md).

## 읽기만 한다

- 한 창 안에 **내장 터미널 탭 여러 개**(node-pty + xterm.js) 와 **햄스터 책상**이 함께 있다. 터미널에서 평소처럼 `claude` 를 실행하면 된다.
- **CLI 속도 영향 0.** 훅도, 프록시도, API 키도 없다. Claude Code 가 이미 디스크에 쓰는 파일만 읽는다.
  - `~/.claude/sessions/<pid>.json` — 살아있는 세션, busy/idle
  - `~/.claude/projects/<cwd 슬러그>/<sessionId>.jsonl` — 메인 대화(툴 호출, 편집 내용, 제목, 줄 수, 모델·effort)
  - `.../<sessionId>/subagents/agent-*.jsonl` + `.meta.json` — 서브에이전트별 기록(종류·설명)
  - `~/.hamster-desk/status/<sessionId>.json` — (선택) 상태줄 스크립트가 남기는 사용량·컨텍스트 스냅샷
- Max/Pro 구독 로그인 그대로. 앱은 모델을 직접 호출하지 않는다(Claude Code 자체가 돈다).
- 앱은 Claude Code 의 설정(`~/.claude`)을 바꾸지 않는다. 예외는 둘이다: 사용자가 직접 켜는 사용량 연동(statusLine)과, **기본으로 켜져 있는 `멀티 에이전트`**(세션 컨트롤 바) — 계정의 `CLAUDE.md` 끝에 표시된 블록 하나를 넣고, 끄면 그 블록만 지운다([멀티 에이전트](features.md#멀티-에이전트)). **단, 세션 컨트롤 바의 `/effort` 는 터미널에 그 명령을 대신 쳐 주는 것인데, 그 명령을 받은 Claude Code 가 스스로 값을 `~/.claude/settings.json` 의 새 세션 기본값으로도 저장한다** — 앱이 쓰는 파일이 아니라 CLI 의 동작이지만, 버튼 한 번에 그 파일이 바뀐다는 사실은 같으므로 여기 적어 둔다. 바의 **모델 드롭다운**이 쳐 주는 `/model <alias>` 도 같다 — CLI 가 `saved as your default for new sessions` 라고 답하며 저장된 기본 모델을 덮어쓴다(툴팁과 메뉴에 적혀 있다).
- 읽는 범위도 좁게 잡았다: 지난 대화 목록은 **트랜스크립트 파일만**(파일마다 앞 64KB + 꼬리 512KB), git 은 **읽기 전용 명령만**, `~/.claude/history.jsonl` 은 읽지 않는다.

## 세션과 에이전트를 알아보는 법

- `electron/watcher/` 가 위 파일들을 감시한다: `sessions`(세션 파일 → 살아있는 세션, 그리고 어느 pty 가 그 세션의 부모인지) · `project`(프로젝트 폴더 재귀 감시) · `tail`(증분 읽기) · `parse`(JSONL → 이벤트). 이벤트는 순번 붙은 백로그로 렌더러에 가므로 늦게 붙어도 따라잡는다(`electron/main.ts`).
  - `tail` 은 한 번에 1MB 까지 읽고 그 사이마다 이벤트 루프에 양보한다(8MB 따라잡기가 메인 프로세스를 통째로 잡지 않게). 파일이 줄어들면(다시 쓰였으면) 0 바이트부터가 아니라 처음 열 때와 같은 꼬리 규칙으로 다시 읽고, `open()` 이 위치를 잡기 전의 `poll()` 은 아무것도 하지 않는다.
  - `model` 이벤트는 값(모델, 또는 effort)이 바뀔 때만 나가고, 같은 값이어도 500 이벤트마다 한 번 되풀이된다 — 예전에는 어시스턴트 블록마다 나가서 이벤트의 절반 가까이가 같은 모델이었다. 끝난 서브에이전트와 끝난 세션은 잊어서, 다시 오면 다시 알린다(제목도 같다).
  - 아직 트랜스크립트가 없는 세션(첫 메시지 전)은 cwd 의 슬러그 폴더를 1초마다 한 번 보고, 모든 프로젝트 폴더를 뒤지는 것은 1초 → 30초로 간격을 늘려 가며 한다(상태가 바뀌면 곧바로 한 번). 전부 비동기다.
- 각 탭에서 띄운 `claude` 세션은 **프로세스 계보**로 그 탭에 묶인다 — 세션 파일의 pid 에서 부모를 거슬러 올라가 그 탭의 셸을 만나면 그 탭의 세션이다. 다른 터미널에서 돌아가는 세션은 기울임체 탭으로 붙고 책상만 볼 수 있다. 죽은 pid 의 세션 파일은 무시한다.
  - 부모 pid 표는 Windows 에서 PowerShell `Get-CimInstance Win32_Process` 한 번으로 얻는다(4초 캐시, 10초 타임아웃, 실패하면 30초 동안 다시 묻지 않고, 마지막 감시기가 멈출 때 돌던 조회는 죽인다). **"밖의 세션"이라는 판정은 한 번 내리면 그대로 둔다** — 이 창에 새 셸(탭)이 생길 때, 또는 그 판정을 내린 표에 그 pid 가 없었을 때만 다시 묻는다([설계 노트](design-notes.md#감시기는-조용해야-한다)).
- 서브에이전트는 트랜스크립트의 `Agent`/`Workflow` 호출과 `subagents/agent-*.jsonl` + `.meta.json` 으로 알아보고, 종류·설명·모델·effort 를 햄스터에 붙인다.
- 트랜스크립트 JSONL 은 Claude Code 내부 형식이라 버전이 바뀌면 파서(`electron/watcher/parse.ts`)를 손봐야 할 수 있다. 모르는 레코드는 무시한다.

## 파일 지도

```
electron/main.ts        창, pty 스폰, 감시기·상태줄·버전 → 렌더러(한 틱에 모아 한 번에) · 창은 앱의 페이지만(이동 차단·IPC 보낸 쪽 확인) · 렌더러가 죽으면 셸을 내리고 다시 읽기
electron/backlog.ts     이벤트 백로그: 순번 · 4000건 링 · 링이 밀어낸 세션·제목·모델·상태줄·버전을 따로 기억해 다시 보낼 때 앞에 — 단위 테스트
electron/pty.ts         node-pty(ConPTY) 스폰 · 종료(taskkill /T, 비동기)
electron/atomic-write.ts 사용자 파일(settings.json·CLAUDE.md) 바꾸기: 임시 파일 → fsync → rename, `.hamster-bak`, 심볼릭 링크는 가리키는 파일을
electron/boot-log.ts    boot.log(부팅 구간별 시간) · error.log(메인에서 아무도 못 본 오류)
electron/prompt.ts      "답을 기다린다" 감지: 화면 문구(공백 무시 비교, 선택지 질문 모양) + 트랜스크립트의 AskUserQuestion 을 합치는 WaitingGate — node-pty 없음
electron/env.ts         cleanEnv(환경 정리) · findClaude(claude 실행 파일 탐색, npm 의 .cmd 는 그것이 띄우는 프로그램을 직접 — 못 읽을 때만 cmd.exe, 그때는 cmd 가 바꿀 인자는 거부) · stopTree(트리째 종료) — node-pty 를 안 물어서 tsx 로도 돈다
electron/summarize.ts   말풍선 요약: headless `claude -p --model haiku` 의 큐·캐시·회로 차단
electron/five-hour.ts   5시간 창 자동 시작: 계정별 예약 · stream-json 의 rate_limit_event 파싱 · 재시도 — electron 의존 없음
electron/delegation.ts  멀티 에이전트: 계정별 CLAUDE.md 의 표시된 블록 넣기/빼기 · 프리셋 문안 — electron 의존 없음
electron/usage-query.ts 모델별 주간 창: 헤드리스 claude 에 SDK 제어 요청 get_usage 를 보내 model_scoped 를 읽는다(토큰 0) — electron 의존 없음
electron/watcher/       sessions(세션 파일·pty 소유 판별) · project(프로젝트 폴더 재귀 감시) · tail(증분 읽기) · parse(JSONL → 이벤트)
electron/legacy.ts      예전 협업 모드가 남긴 파일 정리(첫 실행 1회)
electron/statusline.ts  상태줄 스크립트 설치/해제, 스냅샷 감시
electron/ui-store.ts    ~/.hamster-desk/ui.json 읽기/쓰기(디바운스·원자적 쓰기·손상 복구) — electron 의존 없음
electron/notify.ts      알림 입구: flashFrame + 알림 창(toast-window) · 못 만들면 'failed' 로 답해 렌더러가 배너로 · 알림 클릭 → 창 앞으로 + notify:click
electron/toast-window.ts 앱의 알림 창(투명·항상 위·포커스 없음, 주 모니터 오른쪽 아래): 카드 스택 · 만료 타이머 · 포인터 폴링으로 정지 · 페이지는 src/toast/
electron/toast-stack.ts  알림 창의 순수 부분: 카드 최대 3·수명(15초/8초)·정지/재개·창 위치(toastBounds, 미니 창 피하기) — 단위 테스트
electron/toast-preload.ts 알림 창 페이지의 브리지(ready·state·click·close) — 앱 브리지(preload.ts)는 넘기지 않는다
electron/window-state.ts 창 위치 저장·복원(fitBounds) · 미니 모드(setMini·miniPlacement) — 순수 함수는 단위 테스트
electron/transcripts.ts 지난 대화 목록: 트랜스크립트 앞 64KB + 꼬리 512KB 만, `경로:크기:mtime` 캐시
electron/project-actions.ts 사이드바 실행 메뉴의 판정: 폴더 맨 윗단의 표식 파일(package.json · pyproject · Cargo.toml · go.mod · Makefile …)로 종류·배지·명령을 정하고 표식의 mtime 으로 캐시 — electron 의존 없음
electron/git.ts         읽기 전용 git: info(브랜치·바뀐 수·ahead/behind) · diff(작업 트리 → staged → untracked), 5초 타임아웃
electron/version.ts     claude --version / npm 최신 비교
shared/events.ts        이벤트 타입
shared/i18n/            UI 문구 사전, 언어마다 한 파일(ko 가 기준 타입) · lang.ts(언어 코드·codeOfLanguage) — 렌더러·메인 공용
electron/lang.ts        메인의 언어 판정(ui.json 의 lang → Claude Code language → 시스템 로캘, HAMSTER_LANG 으로 고정) · tr()
src/store.ts            zustand: 세션·햄스터 상태기계(말풍선 = 수명이 있는 채팅 피드)·작업 공간(터미널 탭)·사용량·버전·설정
src/App.tsx             상단 바(탭 줄: 탭마다 자기 세션만 구독)·레이아웃(책상 위/오른쪽, 스플리터, 터미널 최소 크기)·부팅 순서 · src/widgets/ Popover(공용)·사용량 게이지 둘·버전·⋯ 메뉴·+ 메뉴(새 터미널)·RecentList·theme.ts(라이트/다크 판정)·icons.tsx(인라인 SVG 아이콘 한 벌)·focus.ts(팝오버·메뉴·모달의 키보드: Tab 가두기, 메뉴 ↑↓, 포커스 돌려주기)·hscroll.ts(넘치는 한 줄: 휠 → 가로 스크롤, 가려진 끝 흐림)
src/styles.css          라이트/다크 토큰 두 벌(`:root` · `:root[data-theme='dark']`)과 모든 크롬 스타일, 3D 오버레이용 공용 토큰
src/i18n.ts             사전 선택(useUi()/ui()/t(), 언어 변경 구독) · 효과 언어 판정(codeOfLanguage: 원어 이름·영어 이름·로캘 코드) · formatDuration · src/bubbles/summarize.ts 요약 요청(lane 별 600ms 디바운스, 늦은 답 폐기)
src/desk/DeskStudio.tsx three.js 렌더러·씬·리그·라벨·UI(모듈 싱글턴 렌더러라 접었다 펴도 컨텍스트를 새로 만들지 않음)
src/desk/office-world.ts 타일 좌표·좌석 배정(reconcileSeats)·복도 경로(Walker, 의자 뒤 통로로 도는 corridorRoute)·문 옆 대기 줄(LOBBY)·사장 순찰의 지름길(directRoute) — DOM/three 없음
src/desk/declutter.ts   말풍선끼리 겹치지 않게 비켜 세우기(가까운 햄스터 먼저, 가장 짧은 쪽으로, 헤더·캔버스 밖으로는 안 밀기) — 순수
src/desk/pace.ts        그리는 속도와 화질: 움직임·입력·포커스·미니 창에 따른 fps 표, 절전 화질 단계(픽셀 비율·그림자·바다 격자) — 순수
src/desk/patrol.ts      사장의 순찰 상태기계(idle → going → scolding → returning): 언제 일어나고 누구에게 가고 무엇이 되돌리는지 — 스토어를 건드리지 않는 순수 모듈, 시계·주사위는 입력
src/desk/office-camera.ts 3D 궤도 카메라 상태·광선/투영 수학(groundHit·focus·overview·pan·orbit·zoom)
src/desk/vox/            복셀 코어: builder.ts(상자→지오메트리) · material.ts(셰이더·물·하늘) · hamster.ts(직립 리그) · props.ts(사무실·자연 소품) · world.ts(시드 섬 생성)
src/desk/skins.ts        모델별 스킨 · src/desk/anim.ts 상태→애니메이션·화면색·에이전트 색
src/desk/signs.ts        북쪽·서쪽 벽의 Spritfy 액자: 로고 PNG(src/assets/spritfy-logo.png) + 캡션을 캔버스에 그려 텍스처 평면으로 거는 것, 올리면 버튼처럼(떠오름·빛·캡션, 120ms), 클릭 = 사이트 열기
src/sidebar/            사이드바(Sidebar.tsx: 바뀐 파일·탐색·실행 메뉴·폭 핸들) · recent.ts(ui.json 의 최근/즐겨찾기·상대 시간)
src/dev/                브라우저 재생(replay-driver.ts) · 데모 햄스터(demo.ts) · debug.ts(HAMSTER_EVENTS 재생 · HAMSTER_CLICK)
src/Terminal.tsx        xterm 탭(복사·붙여넣기 키 처리, 파일 끌어 놓기, OSC 8 링크, 앞 탭만 WebGL, 테마 연동, 검색 애드온, 글꼴 크기, 앱 단축키는 셸로 안 보냄)
src/term/               TermSearch.tsx(검색 오버레이) · search.ts(검색 옵션, 캡처 실행용 꼬리표 로그) · paste.ts(붙여넣기 거르기·끌어 놓은 파일 경로, 순수)
src/shortcuts.ts        전역 단축키 전부(창 keydown 한 곳)
src/session/            SessionBar.tsx(컨트롤 바) · ContextMeter.tsx(탭의 % · 바의 미터) · TranscriptList.tsx(지난 대화)
src/log/                FileLog.tsx(바뀐 파일) · FeedLog.tsx(말풍선 로그) · TurnToast.tsx(턴 요약 토스트) · turn.ts(summarizeTurn, 순수)
src/git/                GitChip.tsx(탭 칩) · useGit.ts(10초 폴링 + 편집 디바운스) · DiffView.tsx · diff.ts(줄 분류, 순수)
src/notify/             notifier.ts(store 구독 → 알림, 네 겹 게이트, 칠해진 테마를 실어 보냄) · Banner.tsx(알림 창을 못 만들 때의 배너) · kind.ts(권한·질문·완료 세 종류와 그 아이콘 경로 — 알림 창 페이지와 배너가 같이 쓴다) · src/assets/notify.wav
src/toast/              알림 창 페이지(toast.html · toast.ts · toast.css): 배너와 같은 토큰, styles.css 를 같이 읽어 라이트/다크가 같다 — React 없음
src/mini/               MiniShell.tsx(미니 모드: 스튜디오 + 상태줄)
src/workspaces-persist.ts 터미널 탭 저장·복원(ui.json 의 workspaces)
scripts/unit/           단위 테스트(app-update · atomic-write · backlog · contracts · declutter · delegation · env · five-hour · focus · i18n · layout · model-choices · pace · paste · patrol · profiles · project-actions · prompt · recent · shortcuts · statusline · store · toast-stack · transcripts · turn-git · ui-store · usage-query · walk · watcher · window-state) · furniture.ts(걷기 테스트가 쓰는 사무실 가구 배치) · temp-home.ts(로드할 때 경로를 고정하는 모듈 앞에 `HAMSTER_HOME` 을 임시 폴더로)
```

## 앱이 쓰는 파일

`~/.hamster-desk`(검증에서는 `HAMSTER_HOME` 으로 옮긴다):

| 파일 | 내용 |
|---|---|
| `ui.json` · `ui.bak.json` · `ui.corrupt.json` | 설정 전부(아래). 직전의 온전한 파일과 깨진 파일 |
| `profiles/acc-N/` | 추가한 계정의 `CLAUDE_CONFIG_DIR` — 로그인·설정·대화 기록은 CLI 가 쓴다 |
| `status/<sessionId>.json` · `statusline.cjs` | 사용량 연동을 켰을 때 상태줄 스크립트가 남기는 스냅샷과 그 스크립트. 7일 넘은 스냅샷은 앱이 지운다(앱 밖의 세션 것도 쌓이기만 했다) |
| `bubble-stats.json` | 말풍선 요약의 누적 사용량 |
| `update.log` · `boot.log` · `error.log` | 앱 업데이트의 확인·다운로드·설치·오류(최근 200줄), 부팅 구간별 시간(최근 50줄, [설계 노트](design-notes.md#새로-빌드한-뒤의-첫-실행만-느리다)), 메인 프로세스에서 아무도 못 본 오류 — 잡히지 않은 예외, 실패한 시작 단계, 죽은 렌더러(최근 200줄) |

`~/.claude` 쪽에 쓰는 것은 위의 두 예외뿐이다: `settings.json` 의 `statusLine`(사용자가 연동을 켤 때)과 `CLAUDE.md` 끝의 표시된 블록(멀티 에이전트, 기본 켜짐). 둘 다 `electron/atomic-write.ts` 로 쓴다 — 임시 파일 → fsync → rename, 심볼릭 링크면 가리키는 파일을. `settings.json` 은 **읽을 수 없으면 쓰지 않고**(없는 파일만 빈 설정이다), 바꾸기 직전의 파일을 `settings.json.hamster-bak` 으로 남긴다([설계 노트](design-notes.md#설정-파일을-앱이-스스로-날리지-않게-한다)). Electron 프로필(`%APPDATA%\hamster-desk`)에는 Chromium 캐시만 있다.

## 프로필

프로필은 실행 모드별로 나뉜다: 패키지 빌드 `%APPDATA%\hamster-desk`, 개발 실행 `%APPDATA%\hamster-desk-dev`, 캡처 실행(`HAMSTER_CAPTURE`) `%TEMP%\hamster-desk-smoke-<pid>`. 캡처 실행의 프로필은 **실행마다 따로**다 — 예전에는 `hamster-desk-smoke` 하나를 같이 써서, 캡처 둘을 나란히 돌리면 뒤에 뜬 쪽이 `Unable to move the cache` 로 부팅이 늦어지고 자기 `HAMSTER_CLICK` 타이머를 놓쳤다. 폴더는 종료할 때 지우고(best-effort), Chromium 이 아직 쥐고 있어 못 지운 것은 다음 캡처 실행이 시작하면서 치운다(그 pid 의 프로세스가 더는 없을 때만). `test:office:ui`·`shot:studio` 는 따로 `%TEMP%\hamster-desk-smoke` 를 쓴다. 그래서 패키지 빌드를 켜 둔 채 `npm run dev` 를 띄워도 캐시(`Unable to move the cache`)가 충돌하지 않는다. 패키지 빌드는 단일 인스턴스라 두 번째로 실행하면 이미 떠 있는 창을 앞으로 가져온다.

## 설정 파일: ui.json

**설정은 프로필 밖 파일 하나에 저장된다**: `~/.hamster-desk/ui.json`(언어·테마·패널·책상 위치와 크기·사이드바 폭·최근 프로젝트·즐겨찾기·마지막 폴더). 예전에는 `localStorage` 에 있었는데 그건 Electron **프로필** 소유라, 패키지 빌드에서 바꾼 언어가 `npm run dev` 에는 안 보이고 캐시를 지우면 같이 날아갔다. 메인 프로세스가 300ms 디바운스로 원자적 쓰기(`.tmp` → rename)를 하고, 종료 시 남은 변경을 flush 한다(`electron/ui-store.ts`). 파일이 없으면 첫 실행 때 옛 `localStorage` 키(`hd.prefs`·`hd.recentDirs`·`hd.recentMeta`·`hd.favDirs`·`hd.lastCwd`)에서 **파일에 아직 없는 키만** 한 번 옮기고 지운다. 파일이 깨져 있으면 `ui.corrupt.json` 으로 치워 두고 기본값으로 뜬다. `prefs` 에는 **버전 표식 `v`** 가 붙는다(`PREFS_VERSION`, 지금 2): 이름이 바뀐 키는 이름으로 옮기면 되지만(`showFolders` → `showSidebar`) **뜻이 바뀐 키**는 옛 값이 새 값으로도 멀쩡해서 구분할 길이 없다. 표식이 없는 파일(v1)은 `showLog`(예전 "오른쪽 패널 표시", 지금 "사이드바의 바뀐 파일 섹션 펼침")를 버리고 새 기본값을 쓰며, 나머지는 그대로 병합해 `v: 2` 로 한 번 다시 쓴다. 다음에 또 뜻이 바뀌면 `PREFS_VERSION` 을 올리고 `adoptPrefs` 의 같은 자리에 규칙 한 줄을 더한다. 경로는 `⋯` 메뉴 맨 아래 줄에 있고, 누르면 탐색기에서 열린다. 검증은 `npm run smoke:ui`.

이 파일이 통째로 사라질 수 있던 네 가지 경로(못 읽은 파일을 빈 설정으로 덮어씀 · fsync 없는 rename · 깨진 파일 · 두 프로세스가 한 파일을 나눠 씀)와 각각의 수정은 [설계 노트](design-notes.md#설정-파일을-앱이-스스로-날리지-않게-한다)에 있다. 지금의 규칙만 적으면: **있는데 못 읽은 파일에는 아무것도 쓰지 않는다**(60ms 간격 8번 재시도, 쓰는 순간에도 다시 읽어 안 읽히면 2초 뒤 최대 5번), rename 전에 fsync 한다, 깨진 파일은 `ui.bak.json` 에서 읽는다, 쓰기 직전에 파일을 다시 읽어 **이 프로세스가 바꾼 키만** 얹고 목록(`recents`·`favs`)은 차이만 적용한다, 목록에 없지만 로그인이 남은 `profiles/acc-N` 은 시작할 때 되돌린다(`adoptOrphanProfiles`).

기능 확장으로 늘어난 키는 전부 **추가**라 버전을 올리지 않았다. `PREFS_VERSION` 3 은 `bubbleSummary` 의 기본값이 켜짐 → 꺼짐으로 바뀐 것: 그전 파일의 `true` 는 사용자가 고른 값이 아니라 옛 기본값이라 한 번 버리고 새 기본값을 쓴다(그 뒤에 켠 것은 남는다).

| 키 | 모양 | 쓰는 쪽 |
|---|---|---|
| `workspaces` | `{ tabs: [{ cwd, title }], active }` | 마지막 터미널 탭들과 활성 탭. 렌더러가 400ms 디바운스로 쓴다(`src/workspaces-persist.ts`). 업데이트 탭은 빠진다. **저장은 늘 하지만 되살리는 것은 `prefs.restoreTabs` 가 켜져 있을 때뿐이다** |
| `window` | `{ x, y, width, height, maximized }` | 창 위치. 메인이 resize/move 500ms 디바운스 + 닫는 순간에 쓴다(`electron/window-state.ts`) |
| `prefs.notify` | `{ permission, question, turnEnd, sound }` | 알림 종류별 on/off. 기본 `true, true, false, false`(턴 완료는 꺼짐 — `PREFS_VERSION` 4 에서 옛 파일의 `true` 를 한 번 버린다). 옛 파일에 일부만 있어도 기본값과 깊은 병합 |
| `prefs.bubbleSummary` | 기본 `false` | `⋯ > 말풍선 > 요약해서 말하기`. 요약 한 번이 구독으로 Haiku 를 한 번 부르는 것이라 켤 때만 돈다 |
| `prefs.termFont` | 10~24, 기본 14 | 터미널 글꼴 크기 |
| `prefs.showFeedLog` | 기본 `true` | 사이드바 `말풍선 로그` 섹션 펼침 |
| `prefs.restoreTabs` | 기본 `false` | `⋯ > 시작할 때 지난 탭 다시 열기`. 꺼져 있으면 앱은 **아무 터미널도 열지 않고** 시작 카드(최근 프로젝트·활성 계정·폴더 찾아보기)로 뜬다 — 스스로 터미널을 여는 앱은 아무도 고르지 않은 폴더에서, 아무도 고르지 않은 계정으로 연다. 켜면 지난 실행의 탭들이 각자의 계정으로 되돌아온다 |
| `prefs.sideChangedH` · `sideFeedH` | 기본 `null` | 사이드바 두 섹션의 끌어 둔 높이(px). `null` = 자동 배치 |

`HAMSTER_PREFS` 로 설정을 강제한 실행은 새 키도 같이 잠기고, 캡처 실행(`HAMSTER_CAPTURE`)은 이 파일을 **읽기만** 한다 — `workspaces`·`window` 만이 아니라 **어느 키도** 쓰지 않는다(`setUiReadOnly`, [설계 노트](design-notes.md#설정-파일을-앱이-스스로-날리지-않게-한다)). 복원은 찍어야 하니까 하되, 되쓰지 않는다. 예전에는 탭과 창만 막혀 있어서, 캡처 실행이 `prefs` 의 버전 이관이나 스크립트 클릭으로 연 폴더(`recents`·`lastCwd`)를 사용자의 진짜 파일에 써 넣었다.

## 디자인 토큰과 스튜디오 오버레이

테마 고르기(`⋯ > 테마`)는 [기능 › 테마](features.md#테마). 토큰 이름은 두 테마가 똑같아서 규칙은 한 벌만 있으면 된다 — `:root` 가 라이트, `:root[data-theme='dark']` 가 다크 값을 덮는다. 라이트는 종이 같은 흰 표면(`--surface`)에 회녹색 배경(`--bg`)과 **클로드의 테라코타 주황**을 강조색으로 쓴다 — `--accent #b04f2c`. 클로드의 `#d97757` 그대로가 아닌 이유는 이 토큰이 버튼 바탕만이 아니라 흰 바탕 위의 11px 배지 글자와 아이콘 색이기도 해서다: `#d97757` 은 흰 바탕에서 3.1:1 밖에 안 나오므로 색상·채도는 그대로 두고 명도만 내렸다(흰 바탕 5.3:1, `--accent-soft #faede8` 위 4.6:1). 다크는 이끼색 표면(`--surface #161b18`)에 한 단 밝은 주황(`--accent #e0855f`, 표면 위 6.5:1)이다. 강조색 **위에** 얹는 글자는 `--on-accent` 로, 라이트에서는 흰색(5.3:1)이지만 다크에서는 따뜻한 검정 `#2a1710`(6.3:1)이다(밝은 주황 위의 흰 글자는 2.6:1 밖에 안 나온다). **초록은 상태색으로만 남았다**(`--ok`, 라이트 `#559a70` · 다크 `#6dbb8c`): 사용량·컨텍스트 게이지의 `<70%` 칸과 바뀐 파일의 `+N`, 알림 카드의 `턴 완료` 띠가 그것이다 — "괜찮다"는 뜻이지 앱의 표식이 아니고, 이것까지 주황이면 바로 옆 단계의 주의색(호박색)과 구분이 안 된다. `--ok` 는 **채움 색**이다(흰 바탕 3.4:1, 호버한 행 위 3.0:1 — 칸·띠에는 충분하지만 글자에는 모자란다). `+12` 같은 **글자**와 작은 아이콘은 글자용 짝 `--ok-text` 로 쓴다(라이트 `#36704f` — 흰 바탕 5.9:1 · `--surface-2` 5.2:1 · `--surface-3` 4.8:1, 다크는 `--ok` 그대로 7.6:1). diff 의 초록 바탕(`--diff-new-*`)도 그대로다. 작업 중을 뜻하는 점(탭·스튜디오 헤더·명패)은 강조색 주황이다. 본문 글자는 자기 표면에서 최소 4.5:1 — 라이트 `--text` 16.7:1 · `--text-2` 6.6:1 · `--text-3` 4.8:1, 다크 `--text` 15.3:1 · `--text-2` 9.3:1 · `--text-3` 5.7:1. 색만으로 상태를 말하는 곳은 없다(게이지에는 늘 숫자가 붙는다). 타이포는 11/12/13/15px 네 단만 쓰고, 숫자는 `tnum` 으로 폭을 고정한다. 한글이 들어가는 좁은 상자(환영 카드·말풍선)는 `word-break: keep-all` 이라 어절 단위로만 끊는다 — 기본값이면 214px 카드에서 `실행 / 하거나` 처럼 낱말 가운데가 갈라진다. 긴 경로·URL 은 같이 준 `overflow-wrap: anywhere` 가 받아 낸다. 폰트는 CSP(`font-src 'self' data:`)가 외부 폰트를 막으므로 시스템 폰트(Pretendard → system-ui → Malgun Gothic)만 쓴다.

**3D 씬은 두 테마 모두 밝다** — 모래와 바다를 어둡게 칠할 수는 없으니까. 그래서 그 위에 뜨는 DOM 오버레이는 표면 토큰이 아니라 **전용 토큰 한 벌**을 쓴다: `--overlay-bg`/`--overlay-bg-strong`(반투명 패널·헤더 그라데이션) · `--overlay-line` · `--overlay-shadow`(그림자 **색**) · `--overlay-text`/`--overlay-text-2` · `--bubble-bg`/`--bubble-text`/`--bubble-dim`/`--bubble-warn-bg`/`--bubble-name-bg` · `--plate-bg`/`--plate-line`. 라이트에서는 흰 반투명 + 크림색 말풍선, 다크에서는 **어두운 반투명 + 밝은 글자**다(반전이 아니라 밝은 배경 위의 어두운 칩). 실측으로 하늘·모래·데크 어느 배경에 얹혀도 본문은 5.7:1 이상 나온다.

**아이콘은 전부 인라인 SVG**(`src/widgets/icons.tsx`): 16×16 viewBox, `currentColor` 스트로크 1.5px 라인 아이콘 한 벌(`IconSidebar` `IconPlus` `IconClose` `IconHome` `IconCheck` `IconStar` `IconSearch` `IconFolder` `IconFile` `IconChevron` `IconMore` `IconMinus` `IconTarget` `IconMap` `IconExternal` `IconRefresh` `IconDownload` `IconBranch`). 버튼은 글자색만 정하면 되고, 아이콘은 `aria-hidden` 이라 이름표는 `aria-label` 이 갖는다. 예외는 제품의 표식인 🐹 둘 — 앱 브랜드와 "Claude Code 가 아는 폴더" 표시 — 뿐이다.

## 부팅

창은 페이지가 그려지기를 기다리지 않고 **바로 뜬다**. 첫 화면은 `src/index.html` 에 마크업과 인라인 CSS 로 들어 있는 로딩 화면(햄스터 + 점 셋)이라 번들을 받기도 전에 그려지고, 설정과 저장된 탭을 다 읽으면(`App.tsx` 의 `booting`) 0.22초 페이드로 사라진다. 애니메이션은 transform·opacity 만 써서 앱을 띄우느라 메인 스레드가 바빠도 멈추지 않는다. 색은 OS 의 밝게/어둡게를 따르다가 `<html data-theme>` 가 정해지면 그쪽을 따른다.

새로 빌드한 exe 의 첫 실행이 느린 이유와 `boot.log` 읽는 법은 [설계 노트](design-notes.md#새로-빌드한-뒤의-첫-실행만-느리다).

## 셸 환경과 종료

내장 셸의 환경은 앱을 띄운 프로세스가 아니라 사용자의 터미널처럼 보이도록 정리한다(`electron/env.ts` `cleanEnv`): npm/npx 가 끼워 넣는 `node_modules\.bin` PATH 항목과 `npm_*` 변수, 그리고 다른 Claude Code 세션 안에서 띄웠을 때 상속되는 `CLAUDE_CODE_CHILD_SESSION` 같은 내부 표식을 제거하고, 네이티브 설치 경로 `~/.local/bin` 을 PATH 맨 앞에 둔다. 이 정리가 없으면 중첩 세션으로 오인돼 트랜스크립트·세션 파일이 생기지 않아 햄스터가 아무것도 못 본다.

창을 닫으면 셸과 그 안의 `claude` 까지 프로세스 트리째 종료한다(`taskkill /T` — 비동기로, 셸마다 동시에; 탭 하나를 닫는 동안 다른 터미널의 출력이 멈추지 않고, 종료는 전부 끝나기를 최대 3초 기다린다). 이 정리는 `before-quit` 에서 돈다 — `window-all-closed` 는 `app.quit()` 로 시작된 종료(캡처 스모크, 메뉴 종료)에서는 **아예 발생하지 않아서**, 거기에만 정리를 걸어 두면 pty 가 살아남고 node-pty 의 ConPTY 핸들이 `quit` 이벤트 뒤에도 프로세스를 붙잡아 창 없는 `electron.exe` 가 남는다. 강제 종료된 세션의 `~/.claude/sessions/<pid>.json` 은 남을 수 있는데, 감시기는 죽은 pid 의 파일을 무시한다. Claude Code 가 이런 강제 종료를 겪으면 다음 실행에서 "fullscreen renderer didn't finish starting last time" 이라며 한 번 클래식 렌더러로 뜰 수 있다(그다음 실행부터 정상).

페이지가 셸에 다시 붙을 길은 없으므로, 렌더러가 죽거나(`render-process-gone` — 페이지를 다시 읽어 시작할 때처럼 띄운다: `시작할 때 지난 탭 다시 열기` 를 켰으면 탭도 돌아온다, 1분에 3번까지) 페이지가 무엇으로든 바뀌면(`did-navigate`) 그 페이지의 셸도 트리째 내린다. 창이 앱의 페이지를 떠나는 일 자체는 막혀 있다 — 모든 창의 `will-navigate`·`will-redirect` 는 앱의 페이지(`out/renderer` 파일, 개발 실행이면 dev 서버의 출처)가 아니면 취소, `window.open` 은 http(s) 만 브라우저로, 브라우저 권한 요청은 거절, IPC 는 보낸 프레임이 앱의 페이지일 때만 답한다([설계 노트](design-notes.md#창은-앱의-페이지를-떠나지-않는다)).

## 업데이트와 릴리스

### 설치판: GitHub Releases 와 electron-updater

**설치한 앱은 스스로 새 버전이 된다**(`electron/app-release.ts`, electron-updater). 설치판은 커밋이 아니라 **GitHub Releases** 를 본다: **켤 때 한 번**(그리고 `⋯` 메뉴의 `다시 확인` 을 누를 때) 확인하고, 자기 버전보다 높은 릴리스가 있으면 **켜자마자 팝업**이 묻는다(시작마다·버전마다 한 번, `나중에` 를 누르면 상단의 **앱 업데이트** 버튼만 남는다). **묻기 전에 받지는 않는다**: `업데이트 받기` 를 눌러야 받기 시작하고(설치 파일 옆에 올리는 `.blockmap` 덕에 바뀐 블록만), `나중에` 는 아무것도 받지 않는다. 받는 동안은 진행 막대가, 다 받으면 **다시 시작해서 업데이트** 가 켜진다 — 누르면 **설치 창이 보이는 채로** 설치가 돌고 앱이 스스로 다시 열린다. 다시 설치할 일은 없다. 최신 버전은 두 곳에 묻는다: 먼저 릴리스 피드(`releases.atom` — electron-updater 의 GitHub 제공자가 쓰는 유일한 길이고, 이전 릴리스의 blockmap 을 찾아 **바뀐 블록만** 받게 해 준다), 그것이 실패하면 `releases/latest/download/latest.yml`(GitHub 이 최신 릴리스의 파일로 돌려준다 — 이 길로는 120MB 를 통째로 받는다). 그래도 실패하면 20초·1분·3분 뒤에 스스로 다시 해 보고, `⋯` 메뉴에는 `확인 실패` 아래에 **이유**가 나온다. 확인·다운로드·설치·오류는 전부 `~/.hamster-desk/update.log` 에 한 줄씩 남는다(최근 200줄). 어떤 빌드인지는 exe 옆을 보고 가른다: `Uninstall Hamster Desk.exe` 가 있으면 설치판(릴리스), 저장소 안의 `release/win-unpacked` 면 커밋 비교 + 닫고 업데이트, 둘 다 아니면 링크만. electron-updater 는 설치판에서만, 시작 경로 밖에서 늦게 불러온다. 설치를 보이는 채로 하는 이유, 피드가 죽었던 밤, 0.1.1~0.1.8 이 스스로 업데이트하지 못한 버그는 [설계 노트](design-notes.md#설치판-업데이트의-세-가지-사연).

### 저장소 빌드: 커밋 비교와 닫고 업데이트

**앱 업데이트 확인**(`electron/app-update.ts`). 릴리스가 없는 앱이라 "새 버전" = GitHub `main` 에 이 빌드에 없는 커밋이 있다는 뜻이다. 빌드가 자기 커밋을 메인 번들에 박아 두고(`__BUILD_COMMIT__`, `electron.vite.config.ts`), 켤 때 한 번(그리고 `다시 확인` 을 누를 때) 몇 개 뒤처졌는지와 그 제목들을 알아낸다. 저장소 안에서 도는 빌드는 **git 에게 묻는다**(`git fetch origin main` 뒤 `<그 커밋>..FETCH_HEAD` 를 세고 나열 — API 가 아니라서 호출 한도가 없다. GitHub 의 익명 API 는 주소 하나에 시간당 60회이고 사무실은 주소가 하나다). 그 밖의 빌드, 또는 git 이 실패한 경우에는 `GET /repos/chan22222/hamster-desk/compare/<그 커밋>...main` 한 번으로 같은 답을 받는다. 뒤처져 있으면 상단에 **앱 업데이트** 버튼이 뜨고, 누르면 바뀐 내용과 함께 묻는다 — `claude update` 와 달리 앱을 닫아야 하기 때문이다. 앱이 자기 저장소 안(`<repo>/release/win-unpacked`)에서 돌고 있으면 **닫고 업데이트**: 앱이 꺼지고 콘솔 창 하나가 `git pull --ff-only` → `npm install --legacy-peer-deps` → `npm run build:dir` 를 돌린 뒤 앱을 다시 연다(실패하면 오류를 보여 주고 기존 버전을 다시 연다). 옵션 없이 `npm install` 을 해서 `package-lock.json` 만 바뀌어 있는 경우에는 pull 이 거부되지 않도록 그 파일을 먼저 되돌린다. 빌드는 앱이 도는 바로 그 폴더를 새로 만들기 때문에 **그동안은 실행 파일이 없다** — 창 첫 줄에 "끝나면 스스로 다시 열리니 작업 표시줄 아이콘을 누르지 말라"고 적어 둔다. 폴더만 복사해 온 경우에는 GitHub 의 변경 내역을 연다. 푸시하지 않은 커밋으로 만든 빌드(GitHub 이 모르는 커밋)와 git 밖에서 만든 빌드는 비교하지 않는다. `⋯` 메뉴의 Hamster Desk 줄에 빌드 커밋과 상태, `다시 확인`이 있다. 캡처 실행은 확인하지 않는다(네트워크에 따라 달라지는 버튼은 사진을 비교할 수 없게 만든다). 한 시간마다 하던 확인을 뺀 이유는 [설계 노트](design-notes.md#앱-업데이트-확인은-켤-때만).

### 릴리스 스크립트

릴리스를 올리는 절차는 [개발·검증 › 릴리스 올리기](development.md#릴리스-올리기). 스크립트가 하는 일: `scripts/release.ts` 가 작업 폴더가 깨끗하고 `HEAD` 가 `origin/main` 과 같은지, 그 버전이 이미 나가지 않았는지 확인한 뒤, 설치 파일을 빌드하고(`--publish never`) 세 파일(`Hamster-Desk-Setup-<버전>.exe` · `.blockmap` · `latest.yml`)이 다 있는지 본 다음 `gh release create` 로 올린다 — gh 는 초안에 전부 올린 뒤에야 공개하므로 반만 올라간 릴리스를 설치된 앱이 보는 일이 없다. 태그 `v<버전>` 은 빌드한 그 커밋에 찍힌다. 릴리스 노트는 `CHANGELOG.md` 의 그 버전 절이다(없으면 이전 태그 이후의 커밋 제목). GitHub CLI 로그인(`gh auth login`)이 필요하다. 버전을 올리지 않으면 설치된 앱은 새 릴리스로 보지 않는다(semver 비교). electron-builder 의 자체 게시를 쓰지 않는 이유는 [설계 노트](design-notes.md#electron-builder-의-자체-게시를-쓰지-않는-이유).

### 작업 표시줄 고정

`electron/shortcuts.ts`. 작업 표시줄은 고정된 바로가기와 창의 AUMID(`kr.amag.hamsterdesk`)가 같아야 한 버튼으로 합친다. 설치 프로그램의 바로가기에는 처음부터 이 ID 가 들어 있고, 패키지 빌드는 시작 2초 뒤 시작 메뉴·작업 표시줄의 낡은 바로가기를 고친다. 무엇을 왜 고치는지, 한계는 [설계 노트](design-notes.md#작업-표시줄-고정과-aumid).
