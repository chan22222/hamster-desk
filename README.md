# Hamster Desk

Claude Code CLI 를 그대로 쓰면서, 지금 누가(메인·서브에이전트) 무슨 파일을 고치고 있는지 복셀 햄스터로 보여 주고, 사용량·버전·협업 모드를 한 화면에서 다루는 Electron 앱.

- 한 창 안에 **내장 터미널 탭 여러 개**(node-pty + xterm.js) 와 **햄스터 책상**이 함께 있다. 터미널에서 평소처럼 `claude` 를 실행하면 된다.
- **CLI 속도 영향 0.** 훅도, 프록시도, API 키도 없다. Claude Code 가 이미 디스크에 쓰는 파일만 읽는다.
  - `~/.claude/sessions/<pid>.json` — 살아있는 세션, busy/idle
  - `~/.claude/projects/<cwd 슬러그>/<sessionId>.jsonl` — 메인 대화(툴 호출, 편집 내용, 제목, 줄 수, 모델·effort)
  - `.../<sessionId>/subagents/agent-*.jsonl` + `.meta.json` — 서브에이전트별 기록(종류·설명)
  - `~/.hamster-desk/status/<sessionId>.json` — (선택) 상태줄 스크립트가 남기는 사용량·컨텍스트 스냅샷
- Max/Pro 구독 로그인 그대로. 앱은 모델을 직접 호출하지 않는다(Claude Code 자체가 돈다).

## 실행

```bash
npm install --legacy-peer-deps
npm run build
npx electron .          # 또는 npm run dev (HMR)
```

포터블 exe: `npm run dist` → `release/Hamster Desk 0.1.0.exe`.

프로필은 실행 모드별로 나뉜다: 포터블 `%APPDATA%\hamster-desk`, 개발 실행 `%APPDATA%\hamster-desk-dev`, 스모크 `%TEMP%\hamster-desk-smoke`. 그래서 포터블을 켜 둔 채 `npm run dev` 를 띄워도 캐시(`Unable to move the cache`)나 설정·최근 폴더가 서로 충돌하지 않는다. 포터블은 단일 인스턴스라 두 번째로 실행하면 이미 떠 있는 창을 앞으로 가져온다.

## 화면

화면은 세 덩어리다. 40px 상단 바, 접었다 펴는 왼쪽 사이드바(240px), 그리고 가운데의 복셀 스튜디오 + 터미널. 상태는 상단 바에서 한눈에 보이고, 자세한 건 전부 그 칩을 눌러 여는 팝오버 안에 있다.

**상단 바** (한 줄)
- 맨 왼쪽 `≡` = 사이드바 열고 닫기(`Ctrl+B`). 그 옆 🐹 는 앱 표시.
- 터미널 탭: 각 탭에서 띄운 `claude` 세션은 프로세스 계보로 그 탭에 묶인다(초록 점 = 작업 중, 빨강 = 입력 대기, 🐹×N = 서브에이전트 수). 다른 터미널에서 돌아가는 세션은 기울임체 탭으로 붙고 책상만 볼 수 있다. Claude 가 실행 중인 탭의 `×` 는 바로 닫지 않고 "그래도 닫기" 를 한 번 묻는다.
- `+` 는 팝오버다: **최근 프로젝트 6개**(클릭 = 그 폴더에서 터미널 열기) · `폴더 찾아보기…`(시스템 폴더 선택 창) · `사이드바에서 고르기`.
- 오른쪽 상태 칩(순서 고정, 전부 팝오버):
  - **사용량** `5h 63% · 주 15%` 와 5시간 창 미니 막대(70%↑ 모래색, 90%↑ 주황). 팝오버에 두 창의 막대·퍼센트·초기화 시각·남은 시간과 `연동 해제`. 아직 연동 전이면 칩이 `사용량 연동` 이고, 팝오버의 설명 아래 `연동하기`(다른 상태줄이 이미 있으면 `기존 상태줄 교체하기`)를 누르면 `~/.claude/settings.json` 에 `statusLine` 항목을 넣고 `~/.hamster-desk/statusline.cjs` 를 설치한다. Claude Code 가 대화가 갱신될 때마다 이 스크립트를 **비동기로**(300ms 디바운스, 모델 호출을 막지 않음) 실행해 JSON 을 남기고, 터미널 하단에도 `Fable 5.1 · high · 5h 63% (18:20) · 7d 15% (9/21 10:00)` 한 줄이 표시된다. 첫 메시지 전에는 칩이 `사용량 대기 중`.
  - **협업**: 점이 초록이면 켜진 상태. 팝오버에 설명 세 줄, 구현 강도 select, `켜기`/`끄기`.
  - **바뀐 파일 N**: 활성 세션이 파일을 고쳤을 때만 나온다. 누르면 오른쪽 패널이 열리고 닫힌다.
  - **업데이트**: 설치된 Claude Code 보다 새 버전이 npm 에 있을 때만(1시간마다 확인). 누르면 새 터미널 탭에서 `claude update`.
  - **⋯**: `사이드바 (Ctrl+B)` · `책상 펼치기` · `바뀐 파일 패널` · `항상 위` 체크 항목, **말풍선** 의 `요약해서 말하기`(요약기를 쓸 수 없으면 비활성 + 이유)와 언어(자동/한국어/English/日本語/中文/…), **Claude Code** 의 현재 버전·`다시 확인`·업데이트 설치.

**사이드바** (`≡` 또는 `Ctrl+B`, 기본 숨김)
- **최근**: Claude Code 가 기억하는 최근 프로젝트와 이 앱에서 연 폴더를 합쳐 최신순으로 보여 준다(아이콘 · **이름** · 흐린 경로 · "12분 전" 같은 상대 시간). **행을 클릭하면 그 폴더에서 터미널이 바로 열린다.** ★ 즐겨찾기는 맨 위에 고정. 처음엔 12개까지 보이고 `N개 더 보기` 로 나머지를 편다.
- **탐색**: 드라이브 · 경로 조각 · 하위 폴더에 이어 **파일**도 보인다. 폴더는 클릭 = 들어가기, 더블클릭 또는 `열기` = 터미널 열기. 파일은 더블클릭 = 기본 앱으로 열기, 우클릭 = 경로 복사 · 탐색기에서 보기 · 기본 앱으로 열기. 아래 줄에 `여기서 터미널 열기` · `↑` · `☆` · `…`(시스템 폴더 선택 창). `.git` 이 있으면 ⎇, `CLAUDE.md`/`.claude` 가 있으면 🐹 아이콘.
- 맨 위 입력 한 칸이 두 섹션을 같이 거른다.
- 파일 목록은 `fs:list`(이름순, 숨김 제외, 최대 500개, 크기·수정 시각·확장자). **최근 프로젝트**는 `~/.claude/history.jsonl` 의 끝 2MB 만 읽어 각 줄의 `project` 와 `timestamp` 만 집계한다(최신순·프롬프트 수·`.git`/`CLAUDE.md` 유무·폴더 존재 여부). 같은 줄에 들어 있는 프롬프트 본문(`display`, `pastedContents`)은 렌더러로 보내지 않는다. 파일 mtime 이 그대로면 결과를 캐시한다.

**터미널**
- 복사·붙여넣기는 Windows Terminal 과 같은 규칙이다. **선택이 있으면 `Ctrl+C` 가 복사**(선택이 풀리므로 한 번 더 누르면 평소처럼 `^C` 인터럽트), 선택이 없으면 그대로 `^C`. `Ctrl+Shift+C`·`Ctrl+Insert` 는 언제나 복사, `Ctrl+V`·`Ctrl+Shift+V`·`Shift+Insert` 는 붙여넣기(bracketed paste 라 Claude Code 가 한 번의 붙여넣기로 인식한다). **우클릭**은 선택이 있으면 복사, 없으면 붙여넣기.
- `Ctrl+B` 는 셸로 가지 않고 앱이 사이드바에 쓴다.

**책상 — 복셀 스튜디오(three.js)**
- 시드로 생성한 **복셀 섬** 하나 위에 **나무 데크 사무실**이 한 단(24) 올라앉아 있다. 섬은 `src/desk/vox/world.ts` 의 고정 시드(20260920) LCG 로 매번 똑같이 만들어진다: 12갈래 블롭 → 매끈화 2패스 → 사무실 자리 강제 육지 → 타일 바닥 상자(가려지는 옆면은 굽지 않음) → 흙기둥·해안 모래·거품 띠 → 나무·바위·그루터기·꽃·풀포기 배치(90° 랜덤 회전, 숨쉬기·살랑임). 물은 파도 셰이더, 하늘은 그라데이션 돔이다.
- 방은 처음부터 고정 크기(책상 12개, 4열×3줄)이고 햄스터 수에 따라 바뀌지 않는다. 자리는 `office-world.ts` 의 `reconcileSeats` 가 빈자리만 재사용하므로 동료가 늘거나 줄어도 이미 앉은 햄스터는 움직이지 않는다. 12마리를 넘으면 문 옆에서 "빈자리 대기".
- 데크의 **북쪽·서쪽 두 면에만 벽**이 선다(카메라가 남동쪽에서 북서쪽을 보므로 나머지 두 면은 트여 있다). 북쪽 벽의 창문 세 개는 **진짜 구멍**이라 방 안에서 바다와 해안의 나무가 그대로 보인다. 서쪽 벽에는 문·시계·포스터, 문 밖에는 계단 세 단과 데크 위 `STUDIO` 도트 글자.
- **카메라는 3D 궤도 리그**(`office-camera.ts`): 지면의 한 점을 `1200 / 배율` 거리에서 내려다본다. 드래그 = 지면 팬(커서 아래 지점이 손가락에 붙어 따라온다), 우클릭·Shift 드래그 = 회전(25°~70°), 휠 = 커서 기준 확대, 더블클릭 = 메인 햄스터. 처음 열릴 때와 `⌂` 는 모두 메인 햄스터 자리를 250% 로 잡는다(북서 모서리라 나머지 책상이 앞쪽 전경에 깔리고 벽·창·책장이 배경이 된다). `전체 보기`는 섬 전체가 들어오는 배율을 이분 탐색으로 찾는다. `지도`는 타일 색을 구운 미니맵 + 현재 시야 사각형.
- **햄스터는 직립 복셀 리그**(`src/desk/vox/hamster.ts`): 네발 좌표로 만든 몸통을 통째로 세워(`rotation.x = -π/2`) 등·머리 방향이 저절로 맞는다. 머리(볼주머니·둥근 귀·앞니·홍조)·팔 2·다리 2(같은 지오메트리 공유)·꼬리가 따로 움직이고, 앉기/타이핑/읽기/생각/통화/인사/잠 포즈는 절차적으로 만든다. 책상 앞판이 낮아 앉으면 머리와 팔이 상판 위로 올라온다.
- 책상의 **화면·키보드·상태등·상판 반사광**은 상태에 따라 색이 바뀌는 동적 파츠다(작성 중 파랑, 실행 중 초록 점멸, 확인 필요 빨강 등). 명패는 DOM(`.office-nameplate`)으로 책상 앞 모서리에 투영되며 이름 아래 **모델과 effort** 가 나온다. 말풍선과 생각 글리프(`···`, `!`, `z`, `♪`)도 DOM.
- **말풍선은 두 층**이다. 위는 햄스터가 *한 말*(어시스턴트가 쓴 문장, 서브에이전트가 받은 지시, `허락해 주세요!` 같은 고정 문구), 아래 흐린 한 줄은 지금 *하는 일*(`store.ts 읽는 중`, `App.tsx +42 −18`). 하는 일은 도구가 바뀔 때마다 갈리지만, **한 말은 시간이 지나도 사라지지 않는다** — ✓ 를 누르거나(말풍선 아무 데나 눌러도 된다) 다음 말이 올 때 바뀐다. 원문 전체는 말풍선에 마우스를 올리면 나온다. 요약 on/off 와 언어는 상단 `⋯` 메뉴에 있다.
- 햄스터 1마리 = 메인. `Agent`/`Workflow` 로 서브에이전트가 뜨면 문으로 걸어 들어와 앉고, 보고가 끝나면 나간다. 스카프 색 = 에이전트 종류. 모델별 스킨: Fable/Mythos 왕관, Opus 안경, Sonnet 헤드폰, Haiku 잎사귀, 미지 모델은 해시 색(`skins.ts`).
- 복셀 빌더·재질·소품 문법은 같은 소유자의 three.js 복셀 게임 `imjustawall_boxel`(`public/js/voxel.js`·`world.js`)에서 이식했다.
- 브라우저 미리보기: `npm run preview:studio` 후 `http://127.0.0.1:5186/?studio-demo=8`(가짜 8마리). 세계 규칙 테스트 `npm run test:office`, Electron 오프스크린 스모크 `npm run test:office:ui`.

**말풍선 요약**
- 어시스턴트가 실제로 쓴 문장은 대개 한 문단이고 도구 설명은 영어라("Peek at the hamster pixel frame design…") 말풍선에 그대로 담으면 잘린다. 그래서 Haiku 에게 **한 줄로 줄이고 설정 언어로 옮겨** 달라고 한 뒤 그 문장을 띄운다.
- API 키를 쓰지 않는다. 사용자의 구독으로 헤드리스 CLI 를 한 번 돌릴 뿐이다:
  `MAX_THINKING_TOKENS=0 claude -p --model haiku --no-session-persistence --disable-slash-commands --tools "" --strict-mcp-config --setting-sources "" --output-format json --system-prompt "…" "…"`
  - `MAX_THINKING_TOKENS=0` 이 없으면 Haiku 가 5,000 토큰씩 사고해 한 번에 44초가 걸린다. **절대 빼면 안 된다.**
  - `--no-session-persistence` 라 `~/.claude/sessions` 세션 파일도 트랜스크립트도 남지 않는다 → 감시기가 이 호출을 또 다른 햄스터로 오인하지 않는다.
  - `--tools "" --strict-mcp-config --setting-sources "" --disable-slash-commands` 로 사용자 설정·MCP·도구를 하나도 싣지 않아 입력이 550 토큰에 머문다. 실측 2.8초 / 회당 $0.0007.
  - 환경은 `cleanEnv()` 기반이다(앱이 다른 Claude Code 세션 안에서 떠 있으면 `CLAUDECODE` 등이 상속돼 중첩 세션으로 오인된다).
- 같은 내용은 캐시(최대 500개)에서 바로 꺼내고, 동시 실행은 2개까지, 한 햄스터(lane)의 대기 중인 요청은 새 요청이 오면 버린다. 20초를 넘기면 프로세스를 죽이고, 연속 3회 실패하면 5분간 쉰다.
- **끄는 법**은 상단 설정 메뉴. `claude` 명령을 PATH 에서 찾지 못하면 자동으로 비활성이고, 그때는 말풍선에 원문이 그대로 나온다.
- **사용량 카운터**: 설정(`⋯`) 메뉴의 말풍선 절에 `요약 N회 · 토큰 1.2k (입력 1.1k · 출력 80) · ≈ $0.01` 한 줄과 `초기화` 버튼이 있다. CLI 가 돌려주는 `usage`(입력 + 캐시 생성 + 캐시 읽기)와 `total_cost_usd` 를 `~/.hamster-desk/bubble-stats.json` 에 누적한다(캐시 히트·버려진 요청·실패는 안 셈). 실측 단가: **회당 입력 571 · 출력 34 토큰 · $0.0007**.
- 단독 검증: `npm run smoke:bubble` (가짜 실행기로 캐시·큐·회로 차단을 확인하고, 마지막에 실제 `claude` 를 딱 한 번 호출한다).

**협업 모드 (상단 `협업 모드 ON/OFF`)**
- 추론 강도는 사용자가 정한 대로 두고, 역할만 나눈다. **설계 담당** = 지금 쓰는 모델·effort 그대로인 메인 세션(예: Fable 5.1). 사용자와 대화하고 조사·설계·검토·보고를 맡되 `Edit/Write/MultiEdit/NotebookEdit` 가 금지돼 코드를 직접 못 고친다. **구현 담당** = `hd-implementer` 서브에이전트, `model: opus`(별칭이라 항상 최신 Opus), `effort` 는 선택한 값(xhigh / max; ultracode 를 고르면 max + 독립 작업 병렬 처리 지시). 코드 변경은 전부 여기로 위임된다.
- 구현: Claude Code 의 사용자 에이전트 정의 두 개(`~/.claude/agents/hd-architect.md`, `hd-implementer.md`)와 `settings.json` 의 `agent: "hd-architect"`(메인 세션을 이 에이전트로 실행). 끄면 항목을 되돌리고 파일을 지운다(기존에 다른 agent 설정이 있었으면 복원). 새로 시작하는 `claude` 세션부터 적용되며, 배너에 `@hd-architect` 가 붙는다.
- 검증(2026-09-19): "README 끝에 한 줄 추가" 요청에 설계 담당은 읽기만 하고 `Agent(subagent_type: hd-implementer)` 로 명세를 넘겼고, 구현 담당은 `claude-opus-5` 로 실행돼 파일을 고치고 sha256 검증까지 보고했다.
- 주의: 메인 세션이 에이전트로 돌면 Claude Code 기본 시스템 프롬프트가 에이전트 프롬프트로 **대체**된다. 그래서 설계 담당 프롬프트에 답변 언어·간결성·도구 사용·확인이 필요한 행동 등 기본 규칙을 함께 넣어 두었다(`electron/harness.ts`). `/effort` 로 바꾼 값은 Claude Code 가 그 모델의 기본값(`modelSettings`)에도 저장한다.

**오른쪽 "바뀐 파일"** (기본 숨김; 상단 `바뀐 파일 N` 칩이나 `⋯` 메뉴로 연다): 파일별 횟수·줄 수·누가·언제. 클릭하면 마지막 Edit 의 old/new 미리보기. 헤더의 `×` 로 닫는다.

## 개발·검증

```bash
npm run watch:cli                  # Electron 없이 감시기만: 모든 이벤트를 콘솔에 출력
npm run replay -- <session.jsonl>  # 지난 세션 → src/dev/replay.json (브라우저 미리보기용)
npm run typecheck
```

스모크 테스트(창을 보지 않고 스크린샷만). `HAMSTER_TYPE` 은 첫 셸에 자동 입력할 텍스트(`\r` = Enter, `|` 로 단계 구분, 단계 간격 `HAMSTER_TYPE_DELAY` ms), `HAMSTER_CWD` 는 셸 시작 폴더. 긴 문장은 Claude 입력창이 붙여넣기로 보므로 Enter(`
`)를 별도 단계로 보낸다:

```bash
HAMSTER_CWD=C:/proj HAMSTER_CAPTURE=/tmp/shot.png HAMSTER_CAPTURE_DELAY=18000 HAMSTER_CAPTURE_QUIT=1 HAMSTER_TYPE='claude\r|/effort high\r' HAMSTER_TYPE_DELAY=5000 npx electron .
```

캡처 모드에서는 렌더러 콘솔의 error/warning 도 stdout 에 찍힌다. `HAMSTER_PREFS='{"showSidebar":true,"demoAgents":6}'` 로 UI 설정을 강제하고 가짜 서브에이전트 6마리(모델·effort 제각각, 토큰 소비 없음)를 앉혀 사무실 배치를 확인할 수 있다.

내장 셸의 환경은 앱을 띄운 프로세스가 아니라 사용자의 터미널처럼 보이도록 정리한다(`electron/env.ts` `cleanEnv`): npm/npx 가 끼워 넣는 `node_modules\.bin` PATH 항목과 `npm_*` 변수, 그리고 다른 Claude Code 세션 안에서 띄웠을 때 상속되는 `CLAUDE_CODE_CHILD_SESSION` 같은 내부 표식을 제거하고, 네이티브 설치 경로 `~/.local/bin` 을 PATH 맨 앞에 둔다. 이 정리가 없으면 중첩 세션으로 오인돼 트랜스크립트·세션 파일이 생기지 않아 햄스터가 아무것도 못 본다.

창을 닫으면 셸과 그 안의 `claude` 까지 프로세스 트리째 종료한다(`taskkill /T`). 이 정리는 `before-quit` 에서 돈다 — `window-all-closed` 는 `app.quit()` 로 시작된 종료(캡처 스모크, 메뉴 종료)에서는 **아예 발생하지 않아서**, 거기에만 정리를 걸어 두면 pty 가 살아남고 node-pty 의 ConPTY 핸들이 `quit` 이벤트 뒤에도 프로세스를 붙잡아 창 없는 `electron.exe` 가 남는다. 강제 종료된 세션의 `~/.claude/sessions/<pid>.json` 은 남을 수 있는데, 감시기는 죽은 pid 의 파일을 무시한다. Claude Code 가 이런 강제 종료를 겪으면 다음 실행에서 "fullscreen renderer didn't finish starting last time" 이라며 한 번 클래식 렌더러로 뜰 수 있다(그다음 실행부터 정상).

## 구조

```
electron/main.ts        창, pty 스폰, 감시기·상태줄·버전 → 렌더러(순번 붙은 백로그로 늦게 붙어도 따라잡음)
electron/pty.ts         node-pty(ConPTY) + 권한/신뢰/MCP 프롬프트 감지(공백 무시 비교)
electron/env.ts         cleanEnv(환경 정리) · findClaude(claude 실행 파일 탐색, .cmd 는 cmd.exe 경유) — node-pty 를 안 물어서 tsx 로도 돈다
electron/summarize.ts   말풍선 요약: headless `claude -p --model haiku` 의 큐·캐시·회로 차단
electron/watcher/       sessions(세션 파일·pty 소유 판별) · project(프로젝트 폴더 재귀 감시) · tail(증분 읽기) · parse(JSONL → 이벤트)
electron/statusline.ts  상태줄 스크립트 설치/해제, 스냅샷 감시
electron/version.ts     claude --version / npm 최신 비교
electron/harness.ts     협업 모드: 에이전트 파일 생성/삭제 + settings.agent
shared/events.ts        이벤트 타입
src/store.ts            zustand: 세션·햄스터 상태기계(말풍선 = 한 말 + 하는 일)·작업 공간(터미널 탭)·사용량·버전·설정
src/App.tsx             상단 바·패널 배치 · src/widgets/ Popover(공용)·사용량·협업·버전·⋯ 메뉴·+ 메뉴
src/i18n.ts             고정 말풍선 문구(ko/en)와 효과 언어 판정 · src/bubbles/summarize.ts 요약 요청(lane 별 600ms 디바운스, 늦은 답 폐기)
src/desk/DeskStudio.tsx three.js 렌더러·씬·리그·라벨·UI(모듈 싱글턴 렌더러라 접었다 펴도 컨텍스트를 새로 만들지 않음)
src/desk/office-world.ts 타일 좌표·좌석 배정(reconcileSeats)·복도 경로(Walker) — DOM/three 없음
src/desk/office-camera.ts 3D 궤도 카메라 상태·광선/투영 수학(groundHit·focus·overview·pan·orbit·zoom)
src/desk/vox/            복셀 코어: builder.ts(상자→지오메트리) · material.ts(셰이더·물·하늘) · hamster.ts(직립 리그) · props.ts(사무실·자연 소품) · world.ts(시드 섬 생성)
src/desk/skins.ts        모델별 스킨 · src/desk/anim.ts 상태→애니메이션·화면색·에이전트 색
src/sidebar/            사이드바(Sidebar.tsx: 최근·탐색) · recent.ts(최근/즐겨찾기 병합·상대 시간)
src/dev/                브라우저 재생(replay-driver.ts) · 데모 햄스터(demo.ts)
src/Terminal.tsx        xterm 탭(복사·붙여넣기 키 처리) · src/log/FileLog.tsx 바뀐 파일 패널
```

트랜스크립트 JSONL 은 Claude Code 내부 형식이라 버전이 바뀌면 파서(`electron/watcher/parse.ts`)를 손봐야 할 수 있다. 모르는 레코드는 무시한다.

## 스튜디오 디자인 검증

```bash
npm run typecheck
npm run test:office       # 좌석·경로·카메라·햄스터 리그·섬 생성 회귀 테스트 11개
npm run build
npm run preview:studio   # http://127.0.0.1:5186/?studio-demo=8
# 미리보기 서버가 실행 중인 별도 터미널에서:
npm run test:office:ui   # 숨겨진 Electron 창에서 실제 렌더러 검사
npm run shot:studio      # 시각 검수용 장면 8컷 → work/shot-*.png
```

`test:office` 는 three 지오메트리만 쓰는 순수 모듈(`vox/*`, `office-camera`)을 node 에서 그대로 돌린다: 좌석 재사용·복도 경로, 줌이 커서 아래 지면점을 1e-6 이내로 유지하는지, `전체 보기`가 섬 네 귀퉁이를 뷰포트 안에 넣는지, 스킨 5종의 햄스터가 바닥에 서고 팔다리가 지오메트리를 공유하는지, 섬 생성이 두 번 호출해도 같은 결과인지(사무실 타일은 전부 높이 24, 나무는 사무실 밖).

`test:office:ui` 는 소프트웨어 WebGL(`enable-unsafe-swiftshader`)로 실제 렌더러를 띄워 컨텍스트 생성, 복셀 리그 구성, 인원 증감·재정렬 후 명패 위치 고정, 드래그·미니맵·휠·확대·전체 보기, 동료 찾기, 세션 전환 및 접기/펴기, 작은 창, 48마리일 때 대기석 표시, 빈 사무실과 렌더러 오류를 확인한다. 스튜디오 데모는 실제 셸이나 세션 감시기를 시작하지 않으며 저장된 설정을 덮어쓰지 않는다. 스크린샷(`work/studio-default.png`, `studio-overview.png`, `studio-compact.png`)과 결과 JSON은 무시되는 `work/`에 저장한다.

`shot:studio` 는 판정 대신 눈으로 볼 장면만 찍는다(`?studio-demo` 미리보기에서만 노출되는 `window.__studio` 훅으로 카메라·상태를 조작한다): `shot-main-focus`(기본 구도) · `shot-main-400`(메인 착석 근접) · `shot-back-view`·`shot-side-view`(뒤·옆에서 본 착석) · `shot-states-300`(8가지 상태의 포즈·글리프·화면색·상태등) · `shot-walk-a`/`walk-b`(복도를 걸어 들어오는 새 동료) · `shot-overview`(섬 전체).
