// Every fixed word the app shows, in Korean — the source of truth the other languages are typed
// against (`UiStrings = typeof ko`). Grouped by the part of the app that says it. A string with a
// hole in it is a function, so word order can differ between languages. Strings that hold `<b>`,
// `<code>` or `<br>` are rendered through `rich()` (src/rich.tsx); everything else is plain text.
//
// Shared by the renderer and main (electron/lang.ts): no DOM, no electron, no React.

export const ko = {
  /** the `자동` row of the language picker */
  langAuto: '자동',

  common: {
    close: '닫기',
    cancel: '취소',
    copy: '복사',
    copied: '복사됨',
    later: '나중에',
    recheck: '다시 확인',
    open: '열기',
    terminal: '터미널',
    loading: '불러오는 중…',
    reading: '읽는 중…',
    noResults: '검색 결과가 없어요.',
    empty: '비어 있어요.',
    /** the main hamster's name on its nameplate and in the log */
    mainHamster: '메인',
    settings: '설정',
    unknown: '알 수 없음',
    desktopOnly: '데스크톱 앱에서만 쓸 수 있어요.',
    soon: '곧',
    notLoggedIn: '로그인 전',
    failed: '실패',
    none: '없음',
  },

  /** relative times and countdowns: "3분 전", "2시간 10분" */
  time: {
    justNow: '방금',
    minutesAgo: (n: number) => `${n}분 전`,
    hoursAgo: (n: number) => `${n}시간 전`,
    daysAgo: (n: number) => `${n}일 전`,
    yesterday: '어제',
    days: (d: number) => `${d}일`,
    daysHours: (d: number, h: number) => `${d}일 ${h}시간`,
    hoursMinutes: (h: number, m: number) => `${h}시간 ${m}분`,
    minutes: (m: number) => `${m}분`,
  },

  /** what a hamster says, and the OS notifications that repeat it */
  bubble: {
    reportDone: '보고 완료, 퇴근!',
    failed: '어라, 실패했다…',
    needPermission: '허락해 주세요!',
    haveQuestion: '질문 있어요!',
    compacting: '기억 정리 중',
    reading: (l: string) => `${l} 읽는 중`,
    searching: (l: string) => `찾는 중: ${l}`,
    running: (l: string) => `실행: ${l}`,
    hiring: (l: string) => `햄스터 고용: ${l}`,
    browsing: (l: string) => `브라우저: ${l}`,
    newlyWritten: '새로 씀',
    overwritten: '덮어씀',
    /** OS notification titles; `tab` is the terminal tab the notification points at */
    notifyPermission: (tab: string) => `허락해 주세요 · ${tab}`,
    notifyQuestion: (tab: string) => `질문 있어요 · ${tab}`,
    notifyTurnEnd: (tab: string) => `턴 완료 · ${tab}`,
    /** notification bodies, for when there is nothing more specific to say */
    notifyWaitingBody: '터미널에서 답을 기다리고 있어요.',
    notifyTurnBody: '작업이 끝났어요.',
    /** the one line a finished turn comes to: '파일 3 · +120 −40 · 2분 10초' */
    turnSummary: (files: number, added: number, removed: number, dur: string) => `파일 ${files} · +${added} −${removed} · ${dur}`,
    /** what `formatDuration` puts after each number */
    durationUnits: { hour: '시간', minute: '분', second: '초' },
  },

  /** the tab strip and the panes (src/App.tsx) */
  tabs: {
    closeTerminal: '터미널 닫기',
    closeRunningNote: '이 터미널에서 Claude 가 실행 중이에요. 닫으면 하던 일이 멈춥니다.',
    closeAnyway: '그래도 닫기',
    noFrontTerminal: '앞에 열린 터미널이 없어요',
    cannotMoveRunning: 'claude 가 실행 중인 터미널은 옮길 수 없어요. 새 탭으로 여세요.',
    /** the title of the tab `claude update` runs in */
    updateTab: '업데이트',
    /** the title of the tab `claude --continue` runs in */
    continueTab: '이어서',
    deskSize: '책상 크기',
    deskResizeTip: '끌어서 크기 조절 · 더블클릭: 기본값',
    sidebar: '사이드바',
    sidebarTip: '사이드바 (Ctrl+B)',
    externalTab: (cwd: string) => `${cwd} (다른 터미널에서 실행 중)`,
    externalPane: '이 세션은 다른 터미널에서 실행 중입니다. 위 책상에서 지켜볼 수만 있고, 입력은 그 터미널에서 하세요.',
    studioPreview: '스튜디오 미리보기 · 터미널은 데스크톱 앱에서 사용할 수 있어요.',
    /** the tab strip, to a screen reader */
    stripLabel: '터미널 탭',
    /** a tab's state in words — its tooltip and what a screen reader says; on screen it is the mark before the title */
    stateBusy: 'claude 작업 중',
    stateIdle: 'claude 대기 중',
    waitPermission: '권한 요청에 답을 기다려요',
    waitQuestion: '질문에 답을 기다려요',
  },

  /** the `+` menu (src/widgets/PlusMenu.tsx) */
  plus: {
    newTerminal: '새 터미널',
    openNewTerminal: '새 터미널 열기',
    browseFolder: '폴더 찾아보기…',
    pickInSidebar: '사이드바에서 고르기',
  },

  /** the `⋯` menu (src/widgets/MoreMenu.tsx) */
  settings: {
    title: '설정',
    themeLight: '라이트',
    themeDark: '다크',
    themeSystem: '시스템',
    sideTop: '위',
    sideRight: '오른쪽',
    sidebar: '사이드바',
    /** the studio on/off switch — off blows the office up, on builds it again */
    hamsterGui: '햄스터 GUI',
    restoreTabs: '시작할 때 지난 탭 다시 열기',
    changedFiles: '바뀐 파일',
    onTop: '항상 위',
    mini: '미니 모드',
    deskSide: '책상 위치',
    theme: '테마',
    termFont: '터미널 글꼴',
    notifyHead: '알림',
    notifyPermission: '권한 요청',
    notifyQuestion: '질문',
    notifyTurnEnd: '턴 완료',
    notifySound: '소리',
    bubbleHead: '말풍선',
    summarize: '요약해서 말하기',
    cannotSummarize: '지금은 요약할 수 없어요.',
    noSummaryYet: '아직 요약한 적이 없어요.',
    since: (date: string) => `${date} 부터`,
    /** `요약 12회 · 토큰 7.1k (입력 6.6k · 출력 480) · ≈ $0.01` */
    summaryStats: (calls: number, total: string, input: string, output: string, cost: string) => `요약 ${calls}회 · 토큰 ${total} (입력 ${input} · 출력 ${output}) · ≈ ${cost}`,
    resetCounterTip: '사용량 카운터 초기화',
    reset: '초기화',
    language: '언어',
    settingsFile: (path: string) => `설정 파일: ${path}`,
    settingsFileTip: '클릭: 탐색기에서 보기',
  },

  /** `5시간 창 자동 시작` (src/widgets/MoreMenu.tsx) */
  fiveHour: {
    head: '5시간 창 자동 시작',
    note: '초기화되자마자 Haiku 에게 한 단어를 보내 다음 5시간을 바로 시작해요. 앱이 켜져 있을 때만, 한 번에 토큰 400개쯤.',
    autoStart: '초기화되면 바로 다시 시작',
    starting: '새 5시간을 시작하는 중…',
    retrySoon: (err: string) => `${err} · 곧 다시 시도`,
    retryAt: (err: string, time: string) => `${err} · ${time} 에 다시 시도`,
    last: (time: string) => ` · 마지막 ${time}`,
    startSoon: '곧 시작',
    nextStart: (time: string) => `다음 시작 ${time}`,
  },

  /** accounts (src/accounts/Accounts.tsx) */
  accounts: {
    head: '계정',
    note: '계정을 누르면 활성 계정이 되고 그 계정의 새 터미널이 열려요. 이미 열린 탭은 열 때의 계정 그대로예요.',
    add: '계정 추가',
    namePlaceholder: '계정 이름 (예: 회사)',
    newNameLabel: '새 계정 이름',
    nameLabel: '계정 이름',
    addAndLogin: '추가 후 로그인',
    pickerLabel: '새 터미널을 열 계정',
    active: '활성',
    activeAccount: '활성 계정',
    lastTime: '지난번',
    login: '로그인',
    loginTip: '이 계정의 터미널을 열고 로그인을 시작합니다',
    gateLabel: '계정 고르기',
    gateTitleFresh: '먼저 로그인할까요?',
    gateTitlePick: '어느 계정으로 시작할까요?',
    gateNoteFresh: '아직 로그인한 계정이 없어요. 로그인을 누르면 이 계정의 터미널에서 브라우저 로그인이 열리고, 끝나면 claude 가 이어서 떠요. 그냥 시작해도 돼요.',
    gateNotePick: '새 터미널이 이 계정으로 열려요. 돌아온 탭은 각자 열 때의 계정 그대로이고, 나중에 ⋯ › 계정에서 바꿀 수 있어요.',
    gateRowTipFresh: (name: string) => `${name} · 로그인 전 — 이대로 시작`,
    badgeTip: (name: string) => `계정: ${name}`,
    rowTipActive: '활성 계정 · 누르면 이 계정의 새 터미널을 엽니다',
    rowTip: '이 계정을 활성으로 하고, 이 계정의 새 터미널을 엽니다',
    rename: '이름 바꾸기',
    renameOf: (name: string) => `${name} 이름 바꾸기`,
    openFolder: '계정 폴더 열기',
    openFolderOf: (name: string) => `${name} 폴더 열기`,
    removeCliTip: '목록에서 빼기 (로그인과 폴더는 그대로)',
    removeCliOf: (name: string) => `${name} 목록에서 빼기`,
    deleteTip: '계정 지우기',
    deleteOf: (name: string) => `${name} 계정 지우기`,
    /** rich: the question under the × of the CLI's own account */
    askRemoveCli: (name: string) => `<b>${name}</b> 을(를) 목록에서 뺄까요? 로그인과 <code>~/.claude</code> 폴더는 그대로 두고, 이 계정으로 열린 탭만 닫습니다.`,
    /** rich */
    askDelete: (name: string) => `<b>${name}</b> 계정을 지울까요?`,
    removeCli: '빼기',
    delete: '지우기',
    showCli: 'CLI 계정(~/.claude) 다시 표시',
    showCliTip: '목록에서 뺐던 ~/.claude 계정을 다시 보이게 합니다',
    /** the CLI's own account is folded into another one with the same login (electron/profiles.ts) */
    mergedNote: (name: string) => `~/.claude 도 같은 로그인이라 <b>${name}</b> 하나로 보여요. 이 계정을 지우면 다시 나타나요.`,
    /** main did not add the account: the name stays in the box, and this goes under it */
    addFailed: '계정을 추가하지 못했어요. 다시 해 보세요.',
    /** main turned a rename or a removal down */
    changeFailed: '바꾸지 못했어요. 다시 해 보세요.',
  },

  /** the usage gauge and its popover (src/widgets/Usage.tsx) */
  usage: {
    head: '사용량',
    perAccount: '계정별 사용량',
    linkTip: '이 계정의 settings.json 에 상태줄을 추가합니다',
    link: '연동하기',
    noRecord: '아직 기록 없음',
    perAccountNote: '사용량은 그 계정으로 Claude 를 쓰는 동안에만 갱신돼요.',
    resetAt: (time: string) => `${time} 초기화`,
    remaining: (dur: string) => ` · ${dur} 남음`,
    /** the weekly chip: `주 42%`, `주·Fable 88%` */
    week: '주',
    weekOf: (who: string) => `주·${who}`,
    wasReset: (label: string) => `${label} 초기화됨`,
    /** `5시간 사용량 81% · 18:20 초기화 (2시간 10분 남음)` */
    windowWords: (name: string, pct: string) => `${name} 사용량 ${pct}%`,
    windowReset: (time: string, remaining: string) => ` · ${time} 초기화 (${remaining} 남음)`,
    asOf: (ago: string) => `${ago} 기준 · 모델별 주간 창은 10분마다 CLI 에 물어봐요`,
    refreshTip: '지금 다시 물어봅니다',
    unlink: '연동 해제',
    linkPill: '사용량 연동',
    linkPillTip: '5시간·주간 사용량을 상단에 표시합니다',
    /** rich: `{file}` is `<code>~/.claude/settings.json</code>` or `이 계정(<b>회사</b>)의 <code>settings.json</code>` */
    linkNote: (file: string) => `5시간·주간 사용량과 초기화 시각을 여기에 보여 드려요. ${file} 에 상태줄 한 줄을 추가하면, Claude Code 가 대화가 갱신될 때마다 작은 스크립트를 비동기로 실행해 사용량을 파일로 남깁니다(응답 속도에는 영향이 없어요).`,
    /** rich: the account's own settings file */
    accountFile: (name: string) => `이 계정(<b>${name}</b>)의 <code>settings.json</code>`,
    foreignWarn: '이미 다른 상태줄이 설정돼 있어요. 기존 설정은 보관했다가 연동을 해제할 때 되돌립니다.',
    replaceForeign: '기존 상태줄 교체하기',
    waitingPill: '사용량 대기 중',
    waitingPillTip: '새 세션에서 첫 메시지를 보내면 표시됩니다',
    waitingNote: '연동은 끝났어요. 새 세션에서 첫 메시지를 보내면 사용량이 나타납니다.',
    waitingNoteAccount: '연동은 끝났어요. 이 계정으로 새 세션에서 첫 메시지를 보내면 사용량이 나타납니다.',
    fiveHourName: '5시간',
    weekAll: '주간 (전체)',
    weekModel: (model: string) => `주간 (${model})`,
    accountTip: (name: string) => `${name} 계정의 사용량`,
    /** settings.json was there but could not be read or replaced: nothing changed. `why` is technical (`EBUSY`, a JSON error) */
    settingsError: (why: string) => `settings.json 을 읽거나 저장하지 못해서 그대로 두었어요 (${why}). 파일을 확인하고 다시 눌러 보세요.`,
    /** the pill that stays up after such a failure, until the next try */
    settingsErrorPill: '설정 파일 오류',
  },

  /** Claude Code and Hamster Desk updates (src/widgets/Version.tsx, AppUpdate.tsx) */
  update: {
    /** the pill: `claude update` in a new tab */
    claudeUpdate: '업데이트',
    claudeUpdateTip: (latest: string) => `claude update 를 새 터미널 탭에서 실행 (→ ${latest})`,
    checkFailed: ' · 확인 실패',
    newVersion: (v: string) => ` · 새 버전 ${v}`,
    upToDate: ' · 최신',
    checking: ' · 확인 중…',
    installClaude: (v: string) => `업데이트 v${v} 설치`,
    now: (v: string) => ` · 지금 ${v}`,
    readyNote: '새 버전을 받아 두었어요. 다시 시작하면 설치 창이 잠깐 떴다가 앱이 스스로 다시 열립니다.',
    availableNote: '누르면 새 버전을 받기 시작해요. 받는 동안에도 앱은 그대로 쓸 수 있고, 다 받으면 다시 시작할지 한 번 더 묻습니다.',
    downloadingNote: '새 버전을 받는 중이에요. 다 받으면 아래 버튼이 켜집니다.',
    /** rich */
    errorNote: (err: string) => `${err} — 다시 눌러 보세요. 기록: <code>~/.hamster-desk/update.log</code>`,
    restartWarn: '다시 시작할 때 열려 있는 터미널과 그 안의 Claude 는 모두 종료됩니다. 설치가 끝날 때까지 작업 표시줄 아이콘은 누르지 마세요.',
    restartToUpdate: '다시 시작해서 업데이트',
    download: '업데이트 받기',
    downloading: (pct: number) => `받는 중 ${pct}%`,
    devHead: (n: number) => `Hamster Desk 새 버전 · 변경 ${n}개`,
    moreCommits: (n: number) => `… 외 ${n}개`,
    devSelfNote: '앱을 닫고 받아서 다시 빌드한 뒤 스스로 다시 엽니다(1분쯤). 진행 상황은 검은 창에 나옵니다.',
    devNoGitNote: '이 실행 파일은 git 저장소 밖에 있어 스스로 업데이트할 수 없어요. 변경 내역을 열어 드릴게요.',
    devSelfWarn: '열려 있는 터미널과 그 안의 Claude 는 모두 종료됩니다. 끝날 때까지 작업 표시줄 아이콘은 누르지 마세요.',
    closeAndUpdate: '닫고 업데이트',
    viewOnGitHub: 'GitHub 에서 보기',
    pillDownloading: (pct: number) => `업데이트 받는 중 ${pct}%`,
    pill: '앱 업데이트',
    appUpdate: 'Hamster Desk 업데이트',
    pillTipDev: (n: number) => `Hamster Desk 새 버전 (변경 ${n}개)`,
    dialogTitle: '새 버전이 나왔어요',
    localBuild: '로컬 빌드',
    ready: (v: string) => ` · 새 버전 ${v} 준비됨`,
    downloadingVersion: (v: string, pct: number) => ` · 새 버전 ${v} 받는 중 ${pct}%`,
    available: (v: string) => ` · 새 버전 ${v} 있음`,
    newChanges: (n: number) => ` · 새 변경 ${n}개`,
    /** rich */
    autoRetry: (err: string) => `${err} — 잠시 뒤 자동으로 다시 확인해요. 기록: <code>~/.hamster-desk/update.log</code>`,
  },

  /** the sidebar (src/sidebar/Sidebar.tsx, src/widgets/RecentList.tsx) */
  sidebar: {
    changedFiles: '바뀐 파일',
    feedLog: '말풍선 로그',
    explore: '탐색',
    searchHere: '이 폴더에서 검색',
    searchLabel: '폴더·파일 검색',
    drive: '드라이브',
    moveTerminal: '터미널 이동',
    moveTip: (path: string) => `${path}\n앞에 있는 터미널을 이 폴더로 옮겨요 (cd)`,
    newTab: '터미널 새 탭',
    newTabTip: (path: string) => `${path}\n이 폴더의 터미널을 새 탭으로 열어요`,
    parent: '상위 폴더',
    favorite: '즐겨찾기',
    unfavorite: '즐겨찾기 해제',
    browse: '폴더 찾아보기',
    dirTip: (path: string) => `${path}\n클릭: 들어가기 · 더블클릭: 터미널 열기`,
    fileTip: (path: string) => `${path}\n더블클릭: 기본 앱으로 열기 · 우클릭: 메뉴`,
    width: '사이드바 폭',
    widthTip: '끌어서 폭 조절 · 더블클릭: 기본값',
    heightOf: (title: string) => `${title} 높이`,
    heightTip: '끌어서 높이 조절 · 더블클릭: 자동',
    copyPath: '경로 복사',
    showInExplorer: '탐색기에서 보기',
    openDefault: '기본 앱으로 열기',
    /** recent projects */
    searchProjects: '프로젝트 검색',
    searchProjectsLabel: '최근 프로젝트 검색',
    noProjects: '아직 이 앱에서 연 프로젝트가 없어요. 아래에서 폴더를 고르면 여기에 쌓입니다.',
    folderGone: '폴더를 찾을 수 없어요.',
    recentTip: (path: string) => `${path}\n클릭: 여기서 터미널 열기`,
    removeFromList: '목록에서 지우기',
  },

  /** the `실행` menu (src/sidebar/Sidebar.tsx, labels from electron/project-actions.ts) */
  run: {
    run: '실행',
    tip: (badge: string) => `이 폴더에서 실행할 명령 · ${badge}`,
    rowTip: (command: string) => `${command}\n새 터미널 탭에서 실행해요.`,
    groups: { dev: '개발', build: '빌드', test: '테스트', install: '설치', other: '기타' },
    /** the known commands; a script the app does not know keeps its own name */
    actions: {
      dev: '개발 서버',
      start: '시작',
      serve: '서버',
      preview: '미리보기',
      build: '빌드',
      test: '테스트',
      lint: '린트',
      install: '의존성 설치',
      run: '실행',
      check: '검사',
      package: '패키지',
      up: '컨테이너 올리기',
      down: '컨테이너 내리기',
    },
  },

  /** the voxel studio (src/desk/DeskStudio.tsx, signs.ts) */
  studio: {
    label: '햄스터 스튜디오',
    canvasLabel: (desks: number) => `복셀 스튜디오, 책상 ${desks}개`,
    /** rich */
    noGl: '3D 화면을 열 수 없어요.<br>그래픽 드라이버나 하드웨어 가속 설정을 확인해 주세요.',
    state: {
      idle: '쉬는 중',
      thinking: '생각 중',
      reading: '읽는 중',
      searching: '찾는 중',
      writing: '작성 중',
      running: '실행 중',
      hiring: '동료 호출',
      browsing: '조사 중',
      talking: '이야기 중',
      waiting: '확인 필요',
      arriving: '출근 중',
      leaving: '퇴근 중',
    },
    newColleague: '새 동료',
    feedTip: (raw: string) => `${raw}\n\n클릭: 말풍선 로그에서 자세히 · 우클릭: 닫기`,
    defaultTitle: '작은 동료들의 작업실',
    working: '작업',
    resting: '휴식',
    attention: '확인',
    colleagues: '동료',
    occupancyTip: '사장 자리를 뺀 동료 자리',
    welcomeReady: '자리는 준비되어 있어요',
    /** rich */
    welcomeHow: '터미널에서 <code>claude</code>를 실행하거나<br>아래 버튼을 누르세요.',
    runClaude: 'claude 실행',
    runClaudeTip: '이 터미널에서 claude 시작',
    history: '지난 대화',
    historyHereTip: '이 폴더에서 나눈 지난 대화를 이 터미널에서 이어서',
    findLabel: '햄스터 위치 찾기',
    findPlaceholder: '동료 위치 찾기',
    mainHamster: '메인 햄스터',
    waitingSeat: '빈자리 대기',
    overflow: (n: number) => `${n}마리 빈자리 대기`,
    home: '메인 햄스터로 이동',
    homeTip: '메인 햄스터로 이동 (자동 카메라 켜기)',
    auto: '자동',
    autoTip: '있는 햄스터들만 화면에 담는 자동 카메라',
    zoomOut: '축소',
    zoomIn: '확대',
    overview: '전체 보기',
    map: '지도',
    mapHint: '클릭하여 이동',
    mapLabel: '사무실 지도',
    helpLeft: '좌클릭 선택, 끌어서 던지기',
    helpRight: '우클릭 회전',
    helpWheel: '휠 확대',
    helpMiddle: '휠클릭 이동',
    /** read out for the focused studio (its keys work only while it has the focus) */
    keysHelp: '방향키 이동 · + / − 확대·축소 · Home 자동 카메라 · Esc 고정 해제',
    /** the hamster card: the hint under it while it follows the pointer, and the pinned card's button */
    cardHint: '클릭: 고정 · 더블클릭: 가까이 보기',
    cardLog: '말풍선 로그에서 보기',
    /** the studio's bottom-right counters */
    edits: (n: number) => `편집 ${n}`,
    turns: (n: number) => `턴 ${n}`,
    signTip: 'spritfy.xyz 열기 ↗',
    signCaption: '3D & 스프라이트 생성 툴',
  },

  /** mini mode (src/mini/MiniShell.tsx) */
  mini: {
    working: '작업',
    workingTip: '일하는 중인 햄스터',
    waiting: '확인',
    waitingTip: '답을 기다리는 터미널',
    contextTip: '컨텍스트 사용률',
    soundOff: '알림 소리 끄기',
    soundOn: '알림 소리 켜기',
    restore: '복귀',
    restoreTip: '원래 크기로 (Ctrl+Shift+M)',
    restoreLabel: '원래 크기로',
  },

  /** the session bar (src/session/SessionBar.tsx, ContextMeter.tsx, models.ts) */
  session: {
    waiting: '프롬프트에 답한 뒤 쓸 수 있어요.',
    nextTurn: '지금은 작업 중이라 다음 턴부터 적용돼요.',
    noStatus: '사용량 연동 시 컨텍스트가 보여요.',
    effortTip: '노력 수준 (/effort)\n새 세션의 기본값으로도 저장돼요 (Claude Code 동작).',
    savedDefault: '새 세션의 기본값으로도 저장돼요 (Claude Code 동작).',
    effortLabel: '노력 수준',
    model: '모델',
    modelTip: (model: string) => `모델: ${model} (/model)`,
    changeModel: '모델 바꾸기',
    modelHead: '모델 (/model)',
    modelHints: { fable: '가장 어렵고 긴 작업', opus: '복잡한 일상 작업', sonnet: '단순 작업에 효율적', haiku: '짧은 질문에 가장 빠름' },
    compactHint: '압축 권장',
    compactTipFull: (pct: number) => `컨텍스트가 ${pct}% 찼어요. 대화를 압축합니다.`,
    compactTip: '대화를 압축해 컨텍스트를 비웁니다.',
    clearTip: '대화를 지우고 새로 시작합니다',
    clearLabel: '대화 지우기',
    clearNote: '지금까지의 대화를 지우고 새로 시작해요. 되돌릴 수 없지만, 지난 대화는 파일로 남아 있어 다시 열 수 있어요.',
    clear: '대화 지우기',
    history: '지난 대화',
    historyTip: '이 폴더에서 나눈 지난 대화 열기',
    contextUsed: (pct: number) => `컨텍스트 ${pct}% 사용`,
    contextSoon: ' · 곧 압축이 필요해요',
    contextWindow: (size: string) => ` · 창 ${size}`,
    compacting: '정리 중…',
    /** the dropdown the effort segments fold into when the terminal's column is narrow */
    effortHead: '노력 수준 (/effort)',
    /** `⋯`: /compact · /clear · 지난 대화 folded into one when the column is narrower still */
    more: '더 보기',
    /** the bar over a terminal with no claude in it: the ways to start one, typed into that terminal */
    runTip: '이 터미널에서 claude 시작',
    historyHereTip: '이 폴더에서 나눈 지난 대화를 이 터미널에서 이어서',
    continueLabel: '이어서',
    continueTip: 'claude --continue\n이 폴더의 마지막 대화를 이 터미널에서 이어서 열어요',
  },

  /** past conversations (src/session/TranscriptList.tsx) */
  history: {
    empty: '이 폴더의 대화 기록이 없어요.',
    live: '이미 실행 중인 대화예요.',
    search: '지난 대화 검색',
    running: '실행 중',
    inThisTerminal: '이 터미널에서',
    inNewTerminal: '새 터미널에서',
    rowTip: (title: string, path: string, where: string) => `${title}\n${path}\n클릭: ${where} 이어서`,
    continueLast: '이 폴더의 마지막 대화 이어서 (--continue)',
  },

  /** `멀티 에이전트` (src/session/Delegation.tsx, electron/delegation.ts) */
  delegation: {
    label: '멀티 에이전트',
    tip: '멀티 에이전트: 작업을 서브에이전트에게 나눠 맡기라는 지시를 이 계정의 CLAUDE.md 에 넣어 둬요.\n다음에 여는 claude 부터 적용돼요.',
    note: '이 계정의 CLAUDE.md 에 표시된 블록으로 들어가요 (끄면 블록만 사라져요). 다음에 여는 claude 부터 적용돼요.',
    writeFailed: (file: string, err: string) => `${file} 에 쓰지 못했어요: ${err}`,
    modeTip: '어떤 방식으로 나눠 맡길지',
    modeLabel: '멀티 에이전트 방식',
    mode: '방식',
    presets: {
      'when-needed': { label: '필요할 때만', hint: '독립적인 부분으로 나뉠 때만 병렬로' },
      eager: { label: '적극 분담', hint: '부분이 둘 이상이면 언제나 나눠서' },
      'plan-review': { label: '계획 → 분담 → 검토', hint: '나눠 맡긴 뒤 검토 에이전트가 확인' },
      custom: { label: '직접 입력', hint: '내가 쓴 지시문 그대로' },
    },
    customPlaceholder: '예: 부분이 셋 이상이면 서브에이전트로 나눠서 병렬로 하고, 끝나면 합쳐서 보고해',
    customLabel: '직접 쓴 지시문',
    /** what the sub-agents run with — the Agent tool's `model` and `effort` options, spelled out in the block */
    model: '서브에이전트 모델',
    modelInherit: '메인과 같게',
    modelLower: '한 단계 아래',
    effort: '노력 수준',
    effortInherit: '같게',
    /** the block written into CLAUDE.md */
    block: {
      owner: 'Hamster Desk 의 `멀티 에이전트` 설정이 관리하는 블록이에요. 앱에서 끄면 통째로 사라지니 손으로 고치지 마세요.',
      heading: '## 작업 분담 (Hamster Desk)',
      lines: {
        'when-needed': '독립적으로 나뉘는 작업은 서브에이전트(Agent 도구)로 나눠 병렬로 처리해.',
        eager: '가능하면 언제나 서브에이전트(Agent 도구)로 나눠 병렬로 처리해.',
        'plan-review': '서브에이전트(Agent 도구)로 나눠 병렬로 처리하고, 끝나면 검토 서브에이전트에게 한 번 확인시켜.',
      },
      /** the CLI has no word for "one tier below", so the line spells the mapping out */
      modelLower: '서브에이전트는 메인보다 한 단계 낮은 모델로 띄워 (Agent 도구의 model 옵션: fable→opus, opus→sonnet, sonnet→haiku).',
      model: (m: string) => `서브에이전트는 model: ${m} 으로 띄워 (Agent 도구의 model 옵션).`,
      effort: (e: string) => `서브에이전트의 노력 수준은 effort: ${e} 로 (Agent 도구의 effort 옵션).`,
    },
  },

  /** the bubble log (src/log/FeedLog.tsx) */
  feed: {
    all: '전체',
    say: '말',
    act: '활동',
    noSession: '아직 세션이 없어요.',
    search: '말풍선 검색',
    searchLabel: '말풍선 로그 검색',
    kind: '종류',
    noLog: '아직 기록이 없어요.',
    noMatch: '찾는 말이 없어요.',
    fold: '접기',
    unfoldTip: '클릭: 자세히 보기',
    times: (n: number) => ` · ${n}번`,
    gone: ' · 퇴근한 동료',
    goneTip: '이미 퇴근한 동료예요',
    focusTip: '스튜디오 카메라를 이 햄스터에게',
    showHamster: '햄스터 보기',
  },

  /** changed files and diffs (src/log/FileLog.tsx, src/git/*) */
  files: {
    noSession: '아직 세션이 없어요.',
    noFiles: '아직 수정한 파일이 없습니다.',
    rowTip: (file: string, added: number, removed: number, count: number, who: string, time: string) => `${file}\n+${added} −${removed} · ${count}회 · ${who} · ${time}`,
    lastWrite: '마지막 Write',
    lastEdit: '마지막 Edit',
    diffTip: '이 파일의 실제 git diff',
    changed: (n: number) => `바뀐 파일 ${n}`,
    noChanges: '바뀐 파일 없음',
    desktopOnly: '데스크톱 앱에서만 볼 수 있어요.',
    diffLoading: 'git diff 읽는 중…',
    diffFailed: (err: string) => `git diff 를 읽지 못했어요. (${err})`,
    untracked: '아직 git 에 없는 파일이에요.',
    noDiff: 'git 에 남은 변경이 없어요.',
    truncated: '너무 길어서 앞부분만 보여 줘요.',
  },

  /** the embedded terminal itself (src/Terminal.tsx) */
  terminal: {
    /** written into the pane when its shell ends */
    shellExited: (code: number) => `[셸 종료 ${code}]`,
    /** written into the pane when the shell could not be started at all */
    startFailed: (why: string) => `[터미널을 열지 못했어요: ${why}]`,
    /** the tooltip over a link a program printed (OSC 8) */
    linkTip: (url: string) => `Ctrl+클릭으로 열기 · ${url}`,
  },

  /** find in terminal (src/term/TermSearch.tsx) */
  search: {
    placeholder: '터미널에서 찾기',
    prev: '이전 결과',
    prevTip: '이전 (Shift+Enter)',
    next: '다음 결과',
    nextTip: '다음 (Enter)',
    caseSensitive: '대소문자 구분',
    close: '찾기 닫기',
    closeTip: '닫기 (Esc)',
  },

  /** the turn card and the notification banner / window (src/log/TurnToast.tsx, src/notify/*, src/toast/*) */
  toast: {
    showFiles: '이 턴이 바꾼 파일 보기',
    close: '닫기',
    closeNotification: '알림 닫기',
    goToTab: '누르면 그 탭으로 가요',
    windowTitle: 'Hamster Desk 알림',
    unsupported: '이 PC 에서는 알림 창을 띄울 수 없어요',
    failed: '알림 창을 띄우지 못했어요',
  },

  /** things main says (electron/*) */
  main: {
    pickFolder: '터미널을 열 폴더',
    /** the CLI's own account before anyone named it, and a new account's fallback name */
    accountN: (n: number) => `계정 ${n}`,
    noClaude: 'claude 명령을 찾을 수 없어요',
    noReply: '응답을 읽지 못했어요',
    rateLimited: '사용 한도에 걸려 있어요',
    noLimits: '5시간 한도 정보가 오지 않았어요 — 구독(Pro/Max) 로그인인지 확인해 주세요',
    timedOut: '응답이 없어요 (시간 초과)',
    githubLimit: (status: number) => `GitHub 호출 한도 초과(${status}) — 한 시간 뒤에 다시 됩니다`,
    noAutoUpdater: 'electron-updater 를 불러왔지만 autoUpdater 가 없습니다',
    /** the self-update console (no apostrophes: these go into single-quoted PowerShell strings) */
    updWindowTitle: 'Hamster Desk 업데이트',
    updIntro: 'Hamster Desk 를 업데이트합니다. 끝나면 앱이 스스로 다시 열립니다.',
    updNoTaskbar: '그동안 작업 표시줄 아이콘은 누르지 마세요 - 실행 파일을 새로 만드는 중이라 "경로가 존재하지 않습니다" 가 나옵니다.',
    updWaiting: 'Hamster Desk 가 닫히기를 기다리는 중...',
    updLockNote: '(npm 이 바꿔 놓은 것을 되돌림)',
    updDone: '업데이트 완료. 앱을 다시 엽니다.',
    updFailed: '업데이트에 실패했습니다. 위 오류를 확인하세요.',
    updPressEnter: 'Enter 를 누르면 앱을 다시 열고 이 창을 닫습니다',
  },
}

export type UiStrings = typeof ko
