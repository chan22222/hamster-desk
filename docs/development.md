# 개발·검증

소스에서 실행하고, 빌드하고, 창을 보지 않고 검증하는 방법. 구조는 [구조](architecture.md), 화면은 [화면과 기능](features.md).

## 실행

```bash
npm install                # .npmrc 가 legacy-peer-deps 를 켜 둔다(옵션을 붙여도 같다)
npm run build:vite      # out/ 만 만든다(패키징 없음)
npx electron .          # 또는 npm run dev (HMR)
```

**빌드**: `npm run build` 하나가 둘 다 만든다 — 설치 프로그램 `release/Hamster-Desk-Setup-<버전>.exe` 와 압축 없는 폴더 `release/win-unpacked`(`npm run dist` 는 같은 명령의 별칭). 폴더만 빠르게 필요하면 `npm run build:dir`(설치 파일을 건너뛴다, 앱의 "닫고 업데이트"가 쓰는 것). **설치 프로그램**(git·node 없이 쓰는 사람용): `release/Hamster-Desk-Setup-<버전>.exe`(약 120MB, NSIS 원클릭, 사용자 단위 설치라 관리자 권한 없음). `%LOCALAPPDATA%\Programs` 아래에 풀어 두고 시작 메뉴·바탕 화면 바로가기를 만든다 — 그 바로가기에 앱의 AUMID 가 처음부터 들어 있어서, 어떻게 고정하든 작업 표시줄 버튼이 하나다. 제거는 Windows 의 앱 제거에서 하고, 설정(`~/.hamster-desk`, `%APPDATA%\hamster-desk`)은 남긴다. 서명이 없어서 내려받은 파일을 처음 실행하면 SmartScreen 경고("Windows의 PC 보호" → 추가 정보 → 실행)가 뜬다.

아이콘은 `npm run icon`(`scripts/make-icon.ts`)이 16×16 픽셀 그림 하나에서 `build/icon.ico`(exe·작업 표시줄) · `build/icon.png`(개발 실행의 창 아이콘) · `src/assets/hamster.png`(로딩 화면)를 만든다. 결과물은 커밋되어 있으므로 그림을 바꿨을 때만 다시 돌린다.

## 검증 명령

```bash
npm run watch:cli                  # Electron 없이 감시기만: 모든 이벤트를 콘솔에 출력
npm run replay -- <session.jsonl>  # 지난 세션 → src/dev/replay.json (브라우저 미리보기용)
npm run typecheck
npm run test:unit                  # scripts/unit/*.test.ts — 아래 표
npm run smoke:ui                   # ~/.hamster-desk/ui.json: 병합·null 삭제·디바운스·원자적 쓰기·손상 복구
```

`npm run test:unit`(`tsx --test`)은 창 없이 도는 순수 로직만 본다 — 틀려도 조용한 곳들이다.

| 파일 | 지키는 것 |
|---|---|
| `i18n.test.ts` | `'한국어'`·`'korean'`·`'ko-KR'`·`'한국어 (Korean)'` → ko, `'Klingon'`·`'Kotava'`·`'it-IT'` → 추측하지 않고 브라우저 언어로, 명시한 언어가 둘 다 이김, 요약기에는 사용자가 쓴 그대로(`한국어`) 넘김, `formatDuration` ko/en, 모든 언어의 문구 함수가 한국어와 같은 수의 인자를 받고 같은 인자를 찍는지(tsc 는 인자가 적은 함수를 통과시킨다), 1 이면 단수(`1 summary`·`1 resumen`), `formatDate`(달은 이름으로 — ko `9월 12일`·en `Sep 12`·de `12. Sept.`, 24시간제, 다른 해면 연도) |
| `transcripts.test.ts` | 첫 줄이 `last-prompt` 인 파일, `ai-title` 이 여럿이면 마지막, 프롬프트 없는 파일·슬래시 명령뿐인 세션은 제외, 제목 우선순위, 앞 64KB 를 넘는 첫 프롬프트 |
| `turn-git.test.ts` | `summarizeTurn` 이 그 턴의 편집만 세는지(프롬프트 없이 시작한 턴은 CLI 가 잰 길이만큼 거슬러), `parseStatus`(`## main...origin/main [ahead 1]`, CRLF, detached, 새 저장소), `classifyDiffLine` |
| `window-state.test.ts` | `fitBounds`(화면 밖·과소·정상·최대화), `miniPlacement`(보조 모니터 포함), 탭 직렬화(업데이트 탭 제외, 외부 세션이 앞일 때) |
| `contracts.test.ts` | 새 prefs 기본값과 `adoptPrefs` 의 `notify` 깊은 병합 |
| `store.test.ts` | 렌더러 스토어(`src/store.ts`)를 가짜 시계로: 대기 중이 아닌 터미널의 `waiting_clear` 는 새 객체를 안 만듦, 대기는 답·세션 종료·탭 닫기에 풀림, 다른 햄스터가 계속 말해도 만료된 말풍선이 제때 빠짐, 같은 모델이 또 와도 `sessions` 가 그대로, compact 는 시각으로 남음, 세션보다 먼저 온 상태 스냅샷은 기다리되 5분 넘으면 버림, 합쳐진 CLI 계정의 탭은 쌍둥이 계정으로(그냥 감춘 것은 활성 계정으로), 닫거나 옮긴 탭의 git 칩 정리 |
| `paste.test.ts` | 붙여넣기 거르기(`src/term/paste.ts`): 글 안의 `ESC[201~` 가 붙여넣기를 끝내지 못함, 탭·줄바꿈 말고 C0·DEL·C1 제거, 한글·이모지는 그대로, 끌어 놓은 파일 경로(빈칸이면 큰따옴표, 경로 없는 파일은 무시) |
| `watcher.test.ts` | 감시기(`electron/watcher/`)를 임시 폴더로: `open()` 전의 `poll()` 은 아무것도 안 읽고 함께 불려도 줄이 두 번 안 나옴, 1MB 경계에 걸친 줄·2.5MB 한 줄·멀티바이트·CRLF, 다시 쓰인(줄어든) 파일은 꼬리부터, `model` 은 바뀔 때만(effort 없는 줄은 이어받음 · N 이벤트마다 되풀이 · 끝난 에이전트·세션은 잊음), 다시 추적한 세션은 제목·모델을 다시 받음, 슬러그 폴더 → 전체 탐색, 밖의 세션은 한 번만 묻고 새 셸이 생기면 다시(부모 표는 가짜로 넘김 — PowerShell 안 씀), 표가 pid 를 모르면 다시 물음, 트랜스크립트 없는 세션의 전체 탐색 간격, `start()` 중의 `stop()` 이 타이머를 안 남김, 읽는 중에 부른 `poll()` 은 그때까지 파일에 있던 줄을 다 읽은 뒤에 끝남, 부모의 `<task-notification>` 이 끝났다고 한 에이전트의 퇴근(붙을 때 알림을 먼저 읽어도 · 실시간이면 마지막 말 다음에 · 알림 뒤에 다시 일하면 복귀 · 에이전트가 아닌 task id 와 도구 결과에 인용된 알림은 무시), 워크플로 에이전트는 `StructuredOutput` 이 통과할 때 퇴근하고 검증 실패로는 안 함, 쓰는 중에 읽힌(비었거나 잘린) `<pid>.json` 은 세션을 끝내지 않고 지워진 파일·죽은 pid 는 끝냄, `scanLines`(청크 경계에 걸친 표시 · 1MB 넘는 줄 건너뜀 · `to` 가 자른 줄까지), 8MB 따라잡기보다 앞의 알림도 붙은 뒤에 퇴근시키고 그 전에 세션이 끝나면 멈춤, 사람이 친 것만 `prompt`(알림·슬래시 명령·셸 줄·중단·compact 요약은 아님, `<` 로 시작하는 붙여 넣은 글·이미지 배열·옛 CLI 형식은 맞음) |
| `log-window.test.ts` | 사이드바 목록 윈도잉(`src/log/window.ts`의 `rowSpan`·`typicalHeight`): 500줄 로그에서 보이는 줄만, 펼친 줄의 잰 높이가 뒤 줄을 밀어냄, 끝을 지난 보기·빈 목록, 스크롤해 가는 줄은 보기와 상관없이 그림, 안 잰 줄은 가장 흔한 높이로 · `DiffCache`(`src/git/diff-cache.ts`): 한 편집에 읽은 diff 는 그 편집에만, 실패한 읽기는 안 남김, 최근 것부터 정해진 개수만, 30초가 지나면 보여 주되 다시 읽음 · `changedFiles`(`src/log/changed.ts`): 파일당 한 줄·최신이 위, 다른 파일이 편집돼도 그대로인 파일은 숫자와 마지막 편집이 같은 값(memo 된 줄이 다시 안 그려지게) |
| `term-fit.test.ts` | 터미널 크기 맞추기의 스로틀(`src/term/fit.ts`)을 가짜 시계로: 크기 바꾸기가 이어지는 동안 100ms 에 한 번까지 맞추고 마지막 변화 뒤에 한 번 더, 한동안 조용하다가 온 변화는 곧바로, 사라진 창은 기다리던 맞추기를 가져감 |
| `model-choices.test.ts` | 모델 드롭다운의 별칭이 `fable·opus·sonnet·haiku` 넷뿐인지, 각 별칭이 가리키는 id 를 스킨이 알아 `Fable 5.1·Opus 5·Sonnet 5·Haiku 4.5` 로 이름 붙는지, 날짜 붙은 id·옛 세대는 가족으로 체크되고 `mythos`·없음은 체크되지 않는지 |
| `ui-store.test.ts` | 못 읽는 파일은 덮어쓰지 않음, 첫 실행, 깨진 파일 → `ui.bak.json`, **다른 프로세스가 파일에 더한 키·목록이 이쪽의 쓰기에 살아남음**(목록은 차이만 적용, 지운 것은 지워짐, 같은 폴더의 다른 표기는 하나), 캡처 실행은 읽기 전용, 쓰는 순간 못 읽는 파일은 나중에 씀 |
| `recent.test.ts` | `explorerDir`(탐색이 따라가는 폴더: 활성 탭 → `lastCwd` → 홈, 프로세스 작업 폴더는 아님), `baseName`·`dirKey` |
| `layout.test.ts` | 책상 크기(`src/layout.ts`): 저장된 크기는 들어갈 때만, 아니면 터미널 최소(옆 360 · 아래 180 + 스플리터 8)를 남긴 만큼, 바닥(200 · 120) 아래로는 안 줄어듦, 재기 전(0)은 그대로; 스플리터 범위가 그 여유에서 멈추고 뒤집히지 않음 |
| `focus.test.ts` | 키가 포커스를 보내는 곳(`src/widgets/focus.ts`): 메뉴·탭 줄은 끝에서 돌아가고(메뉴는 ↑↓, 탭은 ←→), 검색 칸 아래 목록은 끝에서 멈추며 첫 행의 ↑ 는 -1(검색 칸으로), 가둔 패널의 Tab·Shift+Tab 은 돌아감, 밖(-1)에서 들어오면 끝에서 시작 |
| `delegation.test.ts` | 멀티 에이전트 블록: 사용자의 글은 한 글자도 안 바뀜, 켜기/끄기/프리셋 바꾸기가 블록 하나만 넣고 빼고 바꿈, CRLF 유지, 빈 파일은 지움, 캡처 실행(읽기 전용)은 쓰지 않음 |
| `usage-query.test.ts` | CLI 의 `get_usage` 답(실제 응답에서 잘라 옴)에서 5시간·주간(전체)·모델별 주간 창을 읽음, 오류 답·쓰레기는 null, 로그인된 계정만 묻고 실패한 계정은 답에서 빠짐 |
| `patrol.test.ts` | 사장의 순찰(`src/desk/patrol.ts`)을 가짜 시계와 실제 `Walker` 로 돌린다: 직원이 없으면 10분을 돌려도 안 일어남, 첫 순찰이 12~25초 안에 시작되고 의자 옆·뒤에 서며 2~4초 뒤 돌아와 45~120초 쉼, 주사위가 직원 아무나 고름, `waiting`·새 `say` 줄·그 직원의 퇴근이 도중에 되돌림(다른 직원의 퇴근은 무관), 사무실이 비면 첫 지연이 다시 적용, `off` 는 자리에 묶어 두고 `hurry` 는 즉시·3초·6초. 지름길(`directRoute`): 열두 자리 전부에 대해 **실제 소품 크기**(책상·의자·화분·정수기·커피 테이블·프린터)의 어느 것에도 닿지 않고 왕복하며 갈 때와 올 때 길이가 같고, 첫 줄 가운데 두 자리는 복도 경로의 40% 이하; 차선·통로 자체가 비어 있고, 도중에 끊긴 길은 허브를 거치지 않고 그 자리에서 돌아선다 |
| `grab.test.ts` | 잡아서 던지기(`src/desk/grab.ts`)를 장난감 섬(데크·잔디·바다)에서: 손과의 오프셋 유지와 들어 올리기, 멈춘 손은 그 자리에 떨어뜨림(0.32초 뒤 데크 높이), 한참 전에 멈춘 손도 떨어뜨림, 느린 이동은 떨어뜨림 · 빠른 튕김은 방향 그대로 상한 속도에 포물선, 세게 던지면 해안을 넘어 물보라 → 가라앉음 → 사라짐(0.45초), 살짝 던지면 데크에 · 가장자리 밖이면 잔디에 착지, 열세 자리 전부에서 책상·의자 위 착지는 가구 밖으로 짧게 밀려남, `worldToTile` 역변환, 안에서는 `directRoute`, 밖에서는 건물을 돌아 계단 → 문 → 복도(사무실 바닥을 가로지르지 않음) |
| `toast-stack.test.ts` | 알림 창의 카드 스택: 태그 셋이 종류 셋(권한·질문·완료, `src/notify/kind.ts`)으로 갈리고 저마다 수명과 아이콘이 있음, 질문·권한이 턴 완료보다 오래 남음, 넷째 카드가 오면 가장 오래된 것이 빠짐, 만료 순서, 호버 정지가 시간을 돌려줌(정지 중 들어온 카드는 풀린 뒤 제 수명 전부), `toastBounds`(오른쪽 아래 16px, 아래 고정으로 위로 자람, 보조 모니터 오프셋, 미니 창 위로 비킴) |
| `release-guard.test.ts` | 버전을 올리지 않은 푸시의 검사(`scripts/release-guard.ts`): `0.1.18: …` · `v0.1.19: …` 는 릴리스 커밋이고 `알림: …` 이나 제목 가운데의 버전은 아님, 이미 나간 버전을 다시 단 커밋(0.1.18 의 `ae0d2f8`)과 package.json 과 다른 버전을 단 커밋은 걸리고 릴리스 커밋 자신(워크플로 재실행)은 안 걸림, 밀린 커밋 목록은 20개까지와 나머지 수, GitHub Actions 명령의 `%`·줄바꿈·제목의 `:` `,` 이스케이프 |
| `project-actions.test.ts` | 실행 메뉴의 판정을 임시 폴더로: pnpm 잠금의 Vite/React 앱(아는 스크립트 먼저 · `test:unit` 은 테스트 묶음 · `node_modules` 가 없을 때만 설치), `packageManager` 가 잠금 파일을 이김 · npm/yarn/bun 의 명령 꼴, `.venv` 가 있는 Django(Windows 는 `Activate.ps1;` · 그 밖은 `source … &&`, `tests` 가 있으면 pytest), uv·poetry, Cargo · Go · .NET, `.PHONY`·변수·패턴·레시피를 뺀 Makefile 타깃 12개 상한과 `make` 없으면 없음, 아무것도 아닌 폴더·없는 폴더·파일 → 빈 답, Node + Makefile + compose 는 셋 다, 표식이 바뀌기 전까지 같은 객체를 돌려주는 캐시, Maven · Gradle · Rails |

## 스모크·캡처 실행

스모크 테스트(창을 보지 않고 스크린샷만). `HAMSTER_TYPE` 은 첫 셸에 자동 입력할 텍스트(`\r` = Enter, `|` 로 단계 구분, 단계 간격 `HAMSTER_TYPE_DELAY` ms), `HAMSTER_CWD` 는 셸 시작 폴더. 긴 문장은 Claude 입력창이 붙여넣기로 보므로 Enter(`\r`)를 별도 단계로 보낸다:

```bash
HAMSTER_CWD=C:/proj HAMSTER_CAPTURE=/tmp/shot.png HAMSTER_CAPTURE_DELAY=18000 HAMSTER_CAPTURE_QUIT=1 HAMSTER_TYPE='claude\r|/effort high\r' HAMSTER_TYPE_DELAY=5000 npx electron .
```

캡처 모드에서는 렌더러 콘솔의 error/warning 도 stdout 에 찍힌다. `HAMSTER_PREFS='{"showSidebar":true,"demoAgents":6}'` 로 UI 설정을 강제하고 가짜 서브에이전트 6마리(모델·effort 제각각, 토큰 소비 없음)를 앉혀 사무실 배치를 확인할 수 있다. `HAMSTER_PREFS` 가 있으면 설정이 **읽기 전용으로 잠긴다** — 강제한 값이 사용자의 `ui.json` 에 흘러 들어가지 않는다. 테마와 배치도 같은 방법으로 찍는다:

```bash
HAMSTER_CAPTURE=work/ui-dark.png HAMSTER_CAPTURE_DELAY=8000 HAMSTER_CAPTURE_QUIT=1 \
  HAMSTER_PREFS='{"showSidebar":true,"theme":"dark","deskSide":"right"}' npx electron .
```

## 디버그 훅

**디버그 훅** — 전부 `app.isPackaged` 로 막혀 있어 패키지 빌드에서는 환경변수가 있어도 아무 일도 하지 않는다. 목적은 하나다: 창을 보지 않는 실행이 "그 버튼이 정말 그 일을 한다"를 `claude` 세션 없이(토큰 0) 증명하게 하는 것.

| 환경변수 | 동작 |
|---|---|
| `HAMSTER_CAPTURE=<png>` `HAMSTER_CAPTURE_DELAY=<ms>[,<ms>…]` `HAMSTER_CAPTURE_QUIT=1` | 스크린샷. 지연을 쉼표로 여럿 주면 **한 실행에서 여러 장**(`shot.png` → `shot-1.png`, `shot-2.png` …; 하나면 이름 그대로). 전/후 비교가 한 번에 된다 |
| `HAMSTER_EVENTS='[…]'` | desk 이벤트를 부팅 뒤 store 에 그대로 흘린다(`src/dev/debug.ts`). `"$sid"` → `debug-session`, `"$pty"` → 첫 터미널 id, `"$now"` → `Date.now()`. 첫 이벤트 앞에 `session{mine:true, ptyId:$pty, sessionId:$sid, cwd}` 가 자동으로 들어간다. desk 이벤트가 아닌 `{"kind":"debug:search","q":"needle"}` 은 터미널 검색을 연다 |
| `HAMSTER_CLICK='more@4000\|mini-toggle@5000'` | `[data-debug-click="<이름>"]` 을 그 시각(ms)에 누른다. 500ms 폴링이라 아직 없는 버튼은 생길 때까지 기다리고, 끝내 없으면 `[debug] click <이름> missing`. 이름만 쓰면 `@3000` |
| `HAMSTER_KEYS='ctrl+f@6000\|ctrl+shift+m@9000'` | 메인이 `webContents.sendInputEvent` 로 **진짜 키 이벤트**를 넣는다 — 핸들러를 직접 부르는 게 아니라 단축키가 실제로 타는 경로다 |
| `HAMSTER_MOUSE='412,236@6000\|…'` | 메인이 `sendInputEvent` 로 **진짜 마우스 이동**을 콘텐츠 영역의 그 픽셀에 넣는다 — 올려서 반응하는 것(스튜디오의 Spritfy 액자: 커서·떠오름·캡션)을 훅이 아니라 사용자의 마우스가 타는 경로로 찍는다. 좌표는 캡처 PNG 의 좌표와 같다 |
| `HAMSTER_UNFOCUSED=1` | 창을 `showInactive()` 로 띄운다. 알림은 포커스 밖에서만 울리므로 이게 없으면 그 경로에 닿을 수 없다 |
| `HAMSTER_CAPTURE_TOAST=<png>` | `HAMSTER_CAPTURE` 의 각 시각에 **알림 창**도 찍는다(카드가 없으면 안 찍는다; 이름 규칙은 같다). 화면 전체를 PowerShell `CopyFromScreen` 으로 찍으면 이 창은 안 보인다 — DirectComposition 표면(`WS_EX_NOREDIRECTIONBITMAP`)이라 GDI `BitBlt` 에 `CAPTUREBLT` 가 있어야 찍힌다 |
| `HAMSTER_NOTIFY_FAIL=1` | 모든 알림 요청에 `failed` 로 답한다(알림 창 없음) → 배너 폴백 경로를 찍을 수 있다 |
| `HAMSTER_PATROL=1` | 사장의 순찰(`src/desk/patrol.ts`)을 **서두르게** 한다: 직원이 앉자마자 일어나고, 3초 혼내고, 6초 쉬고 또 간다. 주사위도 고정(직원 목록의 가운데)이라 캡처 지연을 계산해 걷는 중·혼내는 중을 찍을 수 있다. 예: `HAMSTER_PREFS='{"demoAgents":2,"autoCam":true}' HAMSTER_EVENTS='[{"kind":"thinking","sessionId":"$sid","agentId":null,"ts":"$now"}]' HAMSTER_PATROL=1 HAMSTER_CAPTURE=work/patrol.png HAMSTER_CAPTURE_DELAY=8000,8500,9500` — 첫 직원이 앉는 것이 세션 뒤 3초쯤, 걷기 1.5초, 그다음 3초가 혼내는 중이다. 브라우저 미리보기에서는 `window.__studio.patrol('hurry' \| 'off' \| 'on')` |
| `HAMSTER_PTY_LOG=<파일>` | 셸이 찍은 것을 그대로, **셸에 써 넣은 것**은 `>> ` 로 시작하는 한 줄씩 남긴다. 제어문자는 풀어 쓴다: 컨트롤 바의 `/compact` 는 `>> \x15/compact` 와 `>> \r` **두 줄**(= 두 청크)로 남는다. 친 글이 전부 남으므로(비밀번호 포함) 패키지 빌드에는 없다 |
| `HAMSTER_TYPE` `HAMSTER_TYPE_DELAY` `HAMSTER_TYPE_VIA=renderer` `HAMSTER_CWD` `HAMSTER_PREFS` | [스모크·캡처 실행](#스모크캡처-실행) 참고 |
| `HAMSTER_HOME=<폴더>` | `~/.hamster-desk` 대신 쓸 폴더. 검증은 늘 임시 폴더로 돌려 사용자의 `ui.json` 을 건드리지 않는다 |

## 캡처 실행 읽는 법

캡처 실행은 stdout 에 **꼬리표 달린 줄**을 남긴다 — 스크린샷에 안 찍히는 사실을 말하는 길이다: `[capture]` `[keys]` `[pty]`(create/exit) `[debug]`(events·click) `[notify]` `[mini]` `[bounds]` `[restore]` `[git]` `[transcripts]` `[bar]`(보낸 바이트) `[history]` `[shortcut]` `[term]`(search N/M · font) 그리고 렌더러의 `[renderer:error]`·`[renderer:warning]`. 렌더러 쪽 꼬리표(`[`로 시작하는 콘솔 줄)는 캡처 실행에서만 stdout 으로 넘어온다.

`data-debug-click` 이름: `welcome-run` · `more` · `plus`(새 터미널 `+`) · `usage`(사용량 칩) · `mini-toggle` · `mini-exit` · `mini-sound` · `notify-permission` · `notify-question` · `notify-turn` · `notify-sound` · `notify-banner` · `bar-model` · `bar-model-<fable|opus|sonnet|haiku>` · `bar-effort-<low|medium|high|xhigh|max>` · `bar-compact` · `bar-clear` · `bar-clear-yes` · `bar-history` · `history-<n>` · `history-continue` · `toast` · `log-<n>` · `file-<n>` · `file-<n>-diff` · `term-search-close` · `run`(사이드바의 실행 알약) · `run-<n>`(그 메뉴의 n번째 행, 머리줄 순서로 0부터). (`⋯` 메뉴 안의 항목은 `more` 를 먼저 눌러 팝오버를 열어야 존재한다.) · `overview`(스튜디오의 `전체 보기`) · `term-search-close`. (`⋯` 메뉴 안의 항목은 `more` 를 먼저 눌러 팝오버를 열어야 존재한다.) `log-<n>`·`file-<n>`·`file-<n>-diff` 는 사이드바 목록이 보이는 줄만 그리므로 **그려진 줄에만** 있다 — 스크롤하지 않으면 `log-300` 은 없다.

읽을 때 알아 둘 것:
- **캡처 PNG 는 창이 아니라 콘텐츠 영역 크기다.** Windows 에서 창보다 16×39 작다 — 1280×880 창은 1264×841, 미니 480×360 은 464×321. `[mini] on 480x360` 같은 stdout 의 숫자가 창 크기다.
- **`HAMSTER_CLICK` 의 시각은 렌더러가 뜬 뒤부터 잰다.** 메인의 캡처 타이머(`HAMSTER_CAPTURE_DELAY`)는 프로세스 시작부터 재므로, 부팅이 느린 실행에서는 클릭이 캡처보다 뒤로 밀릴 수 있다. 클릭과 캡처 사이를 1.5초 이상 띄우고, `[debug] click … ok` 가 `[capture]` 보다 먼저 찍혔는지 본다.
- **캡처는 한 번에 하나씩** 돌린다. 프로필은 실행마다 따로지만(`hamster-desk-smoke-<pid>`) 알림·포커스·항상 위는 데스크톱 하나를 같이 쓴다.
- 창을 보지 않는 실행(`HAMSTER_CAPTURE`/`EVENTS`/`CLICK`/`KEYS`/`UNFOCUSED` 중 하나라도 있으면)은 `backgroundThrottling: false` 와 `--disable-features=CalculateNativeWinOcclusion` 으로 뜬다. 가려졌거나 뒤에 있는 창은 Chromium 이 그리기를 멈추고 타이머를 늦추는데, 그러면 스크린샷이 한두 프레임 전 화면이 된다.
- 검색 검수의 기대값은 **`2/4`** 다: `HAMSTER_TYPE='echo needle-1\r|echo needle-2\r'` 은 `needle` 을 네 번 남기고(친 줄 둘 + 출력 둘) 검색을 열면 `[term] search 2/4` 가 찍힌다. `2/2` 가 아니다.

## 기능별 캡처

기능별 캡처(전부 임시 `HAMSTER_HOME`, 한 번에 하나씩):

```bash
# 알림: 포커스 없이 띄우고 권한 요청·턴 완료·질문을 흘린다 → 알림 창에 카드 셋, 17초에는 턴 완료가 사라져 둘.
# stdout 에 [notify] popup show tag=… n=3 · [notify] popup window 392x336 at 1528,696 theme=light · [notify] popup expire tag=turn
# (HAMSTER_CWD 가 없으면 셸이 없어 $pty 가 null 이고 재생이 12초 늦다. 테마는 HAMSTER_PREFS='{"theme":"dark"}')
HAMSTER_UNFOCUSED=1 HAMSTER_CWD=C:/proj HAMSTER_EVENTS='[{"kind":"waiting","ptyId":"$pty","reason":"permission","ts":"$now"},{"kind":"prompt","sessionId":"$sid","agentId":null,"text":"t","ts":"$now"},{"kind":"turn_end","sessionId":"$sid","durationMs":130000,"ts":"$now"},{"kind":"waiting","ptyId":"$pty","reason":"question","ts":"$now"}]' \
  HAMSTER_CAPTURE=work/f-notify.png HAMSTER_CAPTURE_TOAST=work/f-toast.png HAMSTER_CAPTURE_DELAY=9000,17000 HAMSTER_CAPTURE_QUIT=1 npx electron .

# 컨트롤 바 + 지난 대화: 컨텍스트 92% → 탭의 빨간 92%, 강조된 /compact, 모델 드롭다운 `Fable 5.1 ▾`. 그다음 지난 대화 목록
HAMSTER_CWD=C:/proj HAMSTER_EVENTS='[{"kind":"status","sessionId":"$sid","ts":"$now","model":{"id":"claude-fable-5-1","displayName":"Fable 5.1"},"effort":"high","contextUsedPct":92,"contextSize":200000,"costUSD":null,"linesAdded":null,"linesRemoved":null,"fiveHour":null,"sevenDay":null,"otherWindows":{}}]' \
  HAMSTER_CLICK='bar-history@7000' HAMSTER_CAPTURE=work/f-bar.png HAMSTER_CAPTURE_DELAY=6000,9000 HAMSTER_CAPTURE_QUIT=1 npx electron .

# 모델 드롭다운: 열어서(Fable 5.1 에 체크) Sonnet 을 고른다 → stdout 에 [bar] send "\u0015/model sonnet", HAMSTER_PTY_LOG 에 `>> \x15/model sonnet` 과 `>> \r`,
# 바와 햄스터가 바로 Sonnet 5 로. claude 없는 셸이라 /model 은 셸 오류로 끝난다 — 토큰도, 저장되는 기본 모델도 없다
HAMSTER_CWD=C:/proj HAMSTER_EVENTS='[{"kind":"status","sessionId":"$sid","ts":"$now","model":{"id":"claude-fable-5-1","displayName":"Fable 5.1"},"effort":"high","contextUsedPct":42,"contextSize":200000,"costUSD":null,"linesAdded":null,"linesRemoved":null,"fiveHour":null,"sevenDay":null,"otherWindows":{}}]' \
  HAMSTER_CLICK='bar-model@6000|bar-model-sonnet@8500' HAMSTER_PTY_LOG=work/f-model.log HAMSTER_CAPTURE=work/f-model.png HAMSTER_CAPTURE_DELAY=7500,10500 HAMSTER_CAPTURE_QUIT=1 npx electron .

# 토스트 → 바뀐 파일 → git diff (file 은 작업 트리에서 실제로 바뀐 파일이어야 diff 가 나온다)
HAMSTER_CWD=C:/proj HAMSTER_EVENTS='[{"kind":"prompt","sessionId":"$sid","agentId":null,"text":"t","ts":"$now"},{"kind":"edit","sessionId":"$sid","agentId":null,"toolUseId":"t1","file":"C:/proj/README.md","op":"edit","added":12,"removed":3,"preview":{"old":"a","new":"b"},"ts":"$now"},{"kind":"text","sessionId":"$sid","agentId":null,"text":"정리를 마쳤어요","ts":"$now"},{"kind":"turn_end","sessionId":"$sid","durationMs":130000,"ts":"$now"}]' \
  HAMSTER_CLICK='toast@7000|file-0@8500|file-0-diff@10000' HAMSTER_CAPTURE=work/f-toast.png HAMSTER_CAPTURE_DELAY=6000,9500,11500 HAMSTER_CAPTURE_QUIT=1 npx electron .

# 미니 모드: 들어갔다 나온다 → [mini] on 480x360 saved=1280x880, [mini] off 1280x880
HAMSTER_CLICK='more@4000|mini-toggle@5000|mini-exit@9000' \
  HAMSTER_CAPTURE=work/f-mini.png HAMSTER_CAPTURE_DELAY=3500,7500,11000 HAMSTER_CAPTURE_QUIT=1 npx electron .

# 실행 메뉴: 셸을 프로젝트 폴더에 고정하고 알약을 열어 찍은 뒤, 첫 행을 눌러 새 탭에서 명령이 쳐진 것을 찍는다
# (work/sample-react 는 dev/build/test 스크립트와 pnpm-lock.yaml 이 있는 package.json 하나면 된다) → [pty] create 2 … 가 두 번째 탭
HAMSTER_CWD=work/sample-react HAMSTER_PREFS='{"showSidebar":true}' HAMSTER_CLICK='run@5000|run-0@9500' \
  HAMSTER_CAPTURE=work/f-run.png HAMSTER_CAPTURE_DELAY=8500,14500 HAMSTER_CAPTURE_QUIT=1 npx electron .
```

사람이 한 번 봐야 하는 것(캡처 실행은 저장을 막아 두었거나 실제 세션이 필요해서 자동으로는 못 본다): **패키지 빌드에서 알림 창이 뜨는지**, **창 크기를 바꾸고 종료한 뒤 `ui.json` 의 `window` 가 바뀌었는지**, **`지난 대화` 의 행을 눌렀을 때 실제로 `claude --resume` 이 그 대화를 이어 여는지**.

## 스튜디오 디자인 검증

```bash
npm run typecheck
npm run test:office       # 좌석·경로·카메라·자동 프레이밍·햄스터 리그·섬 생성·벽 액자 회귀 테스트 20개
npm run build:vite
npm run preview:studio   # http://127.0.0.1:5186/?studio-demo=8
# 미리보기 서버가 실행 중인 별도 터미널에서:
npm run test:office:ui   # 숨겨진 Electron 창에서 실제 렌더러 검사
npm run shot:studio      # 시각 검수용 장면 21컷 → work/shot-*.png
```

`test:office` 는 three 지오메트리만 쓰는 순수 모듈(`vox/*`, `office-camera`)을 node 에서 그대로 돌린다: 좌석 재사용·복도 경로(사장 자리 포함), 사장 자리가 slot 0 이고 에이전트가 절대 앉지 않는지, 줌이 커서 아래 지면점을 1e-6 이내로 유지하는지, `전체 보기`가 섬 네 귀퉁이를 뷰포트 안에 넣는지, `frameCamera` 가 한 마리면 340% 로 좌석을 담고 12석 전부면 모두 뷰포트 안이거나 하한 75% 에 멈추는지, **비운 픽셀이 `frameHeadPad(높이, feedLines(s0))` 와 정확히 같은지**(결과 구도에서 역산해 재므로 구현을 믿지 않는다 — 4·3·2·1·0줄 다섯 구간 전부), 0줄 구간에서는 여백이 0 이고 1패스 배율을 그대로 쓰는지, 그리고 **사장 주변 넷이 예전 104% 보다 가깝고(117%) 그 배율에서 말풍선이 2줄 보이는지**, **책상 높이 420·520·700 어디서도 말풍선 스택 꼭대기가 헤더(56px) 아래에 있고 햄스터와 책상이 화면 안인지**, 스킨 5종의 햄스터가 발바닥을 정확히 y 0 에 두고 서는지·팔다리가 지오메트리를 공유하는지·`HAMSTER_H` 가 실제 귀 끝과 같은지, 섬 생성이 두 번 호출해도 같은 결과인지(사무실 타일은 전부 높이 24, 나무는 사무실 밖), 그리고 Spritfy 액자 둘이 각자 벽 안쪽 면에(방 안에 서 있지 않고) 걸리는지 — 북쪽 것은 창문·화이트보드와 겹치지 않고 사장 자리 동쪽에, 서쪽의 더 큰 것은 문·포스터·시계·책장과 겹치지 않고 복도에서 한 타일 떨어져.

`test:office:ui` 는 소프트웨어 WebGL(`enable-unsafe-swiftshader`)로 실제 렌더러를 띄워 컨텍스트 생성, 복셀 리그 구성(넥타이 그룹), 말풍선 피드 회귀(두 문장이 쌓이고 마지막이 맨 아래 · 같은 활동 3번은 `×3` 한 줄 · 수명이 지나면 사라짐 · 우클릭 = 그 줄만 제거; `window.__studio.feedLife` 로 수명을 줄여 9초를 기다리지 않는다), 말풍선 로그(줄 클릭은 그 자리에서 펼쳐 원문과 `햄스터 보기` 를 보이고 카메라는 그대로 · `햄스터 보기` 가 그 햄스터를 250% 로 — 먼저 다른 동료를 보고 있다가 확인하므로 아무 일도 안 해도 통과하지 않는다), 인원 증감·재정렬 후 명패 위치 고정, 드래그·미니맵·휠·확대·전체 보기, 동료 찾기(자동 카메라 해제), 세션 전환 및 접기/펴기, 작은 창, 48마리일 때 대기석·`동료 12 / 12` 표시, 빈 사무실과 렌더러 오류를 확인한다. 스튜디오 데모는 실제 셸이나 세션 감시기를 시작하지 않으며 저장된 설정을 덮어쓰지 않는다. 스크린샷(`work/studio-default.png`, `studio-overview.png`, `studio-compact.png`)과 결과 JSON은 무시되는 `work/`에 저장한다. 실패하면 종료 코드 1 로 끝난다(`app.quit()` 은 `process.exitCode` 를 무시하고 0 으로 끝내서, 예전에는 단언이 깨져도 성공으로 보였다).

`shot:studio` 는 판정 대신 눈으로 볼 장면만 찍는다(`?studio-demo` 미리보기에서만 노출되는 `window.__studio` 훅 — `focus`·`zoom`·`orbit`·`setStates`·`addArriving`·`say`·`act`·`feedLife`·`autoFrame`·`patrol`·`hoverSign`·`pin`(햄스터 카드 고정)·`fold`(핵폭발/공사 연출) — 으로 카메라·상태를 조작한다; 첫 장면 전에 `patrol('off')` 로 사장을 자리에 묶어 두므로 일곱 직원이 일하는 프레이밍 컷 중간에 순찰이 끼어들지 않는다): `shot-main-focus`(사장 자리 250%) · `shot-main-400`(메인 착석 근접) · `shot-back-view`·`shot-side-view`(뒤·옆에서 본 착석) · `shot-states-300`(8가지 상태의 포즈·글리프·화면색·상태등) · `shot-walk-a`/`walk-b`(복도를 걸어 들어오는 새 동료) · `shot-overview`(섬 전체) · `shot-autoframe-8`(자동 카메라가 9마리를 담은 구도) · `shot-autoframe-4`(사장 주변 세 자리만 찼을 때의 구도 117% — 배율이 허용하는 2줄까지 말풍선이 떠 있고 명패도 함께 붙는다) · `shot-autoframe-1`(메인만 남았을 때 사장 자리 300% 근접) · `shot-feed`(그 구도 위로 말풍선 네 줄이 쌓이고 맨 아래가 `×3`) · `shot-feed-420`/`shot-feed-700`(같은 네 줄을 앱 기본 책상 높이 420 과 최대 700 에서 — 자동 카메라가 머리 끝 기준으로 내려 잡는지 보는 컷) · `shot-patrol-walk`/`shot-patrol-scold`(직원 둘이 들어와 앉은 뒤 `patrol('hurry')` — 자기 책상을 돌아 화분 옆 차선으로 내려가는 사장과 머리 위 💢, 그리고 직원 옆·뒤에 서서 혼내는 장면: 직원의 💦 와 움츠린 포즈, 직원의 말풍선은 그대로) · `shot-sign-west`/`shot-sign-hover`(서쪽 벽의 더 큰 Spritfy 액자를 복도 쪽 220% 에서, 그리고 `hoverSign(1)` 로 포인터를 올린 상태 — 떠오르고 빛나는 그림과 아래 캡션 `spritfy.xyz 열기 ↗`; 오프스크린 창은 마우스를 못 움직이므로 훅이 대신한다. 앱에서는 `HAMSTER_MOUSE` 가 진짜 마우스로 같은 것을 찍는다) · `shot-queue`(책상보다 많은 동료: 열두 자리가 차고 나머지가 문 옆 정수기 앞에 한 줄로 선 모습, 명패 대신 말풍선이 이름을 댄다) · `shot-crowd`(같은 방의 자동 구도 75% — 명패가 꺼진 배율이라 말풍선마다 넥타이 색 점과 이름, 겹치던 말풍선은 헤더 아래로 비켜서고 머리까지 꼬리선) · `shot-card`(`pin` 으로 고정한 햄스터 카드 — 이름·종류·모델·effort·하는 일과 경과 시간·마지막 말·`말풍선 로그에서 보기`).

## 릴리스 올리기

릴리스 올리기: **`package.json` 의 `"version"` 을 올려서 `main` 에 푸시하면 끝이다.** 누가 어느 PC 에서 푸시하든 GitHub Actions(`.github/workflows/release.yml`)가 Windows 러너에서 타입 검사 → 단위 테스트 → `npm run release -- --ci` 를 돌려 그 버전을 빌드·게시한다. 버전을 올리지 않은 푸시는 태그가 이미 있으므로 아무것도 릴리스하지 않는다 — 그런데 **설치된 앱은 버전 번호만 비교하므로 그 푸시의 변경은 다음 버전까지 아무에게도 가지 않고, 앱은 "최신" 이라고 한다.** 그래서 그런 푸시는 두 가지를 본다(`scripts/release-guard.ts`): 이 푸시의 커밋 가운데 **제목이 버전인 것**(`0.1.19: …`)이 있으면 버전을 올리려다 잊은 것이므로 **실패**하고(빨간 X, GitHub 메일), 마지막 릴리스 이후 앱 코드(`src` · `electron` · `shared` · `build` · 의존성)를 바꾼 커밋이 있으면 그 목록이 실행 요약과 경고로 남는다. 왜 생겼는지는 [설계 노트](design-notes.md#버전을-올리지-않은-릴리스-커밋). 검사나 테스트가 깨진 커밋은 릴리스되지 않는다. 같은 스크립트를 손으로도 돌릴 수 있다(Actions 가 막혔을 때):

```bash
npm run release            # 검사만: npm run release -- --check
```

스크립트가 확인하는 것과 올리는 파일은 [구조 › 릴리스 스크립트](architecture.md#릴리스-스크립트). 릴리스 노트는 `CHANGELOG.md` 의 그 버전 절이므로 버전을 올릴 때 그 절을 함께 쓴다.
