# 기여하기

## 준비

Windows 11, Node 24, git. `npm install`(`.npmrc` 가 `legacy-peer-deps` 를 켜 둔다) → `npm run build:vite` → `npx electron .`. 터미널에서 쓸 Claude Code 는 따로 설치한다. 자세한 것은 [docs/development.md](docs/development.md).

## 바꾸기 전에, 바꾼 뒤에

- `npm run typecheck` 와 `npm run test:unit` 은 항상. 릴리스 워크플로가 같은 둘을 돌리고, 깨지면 릴리스되지 않는다.
- 3D 스튜디오를 건드렸으면 `npm run test:office`, 렌더러까지 보려면 `npm run preview:studio` 를 띄운 뒤 `npm run test:office:ui` · `npm run shot:studio`.
- 화면·알림·세션 바처럼 창을 봐야 하는 것은 캡처 실행으로 증명한다 — `HAMSTER_CAPTURE` · `HAMSTER_EVENTS` · `HAMSTER_CLICK` …([디버그 훅](docs/development.md#디버그-훅)). 검증은 늘 임시 `HAMSTER_HOME` 으로 돌려 사용자의 `~/.hamster-desk` 를 건드리지 않는다.
- 새 의존성은 넣지 않는 것을 기본으로 한다.

## 커밋

`git log` 의 꼴을 따른다. 제목은 한국어로 `영역: 무엇을 어떻게` — `알림: 윈도우 토스트 대신 앱의 알림 창`, `책상: 사장이 가끔 돌아다니며 직원을 혼낸다`. 본문에는 **왜** 그렇게 했는지를 적는다(무엇을 바꿨는지는 diff 가 말한다). 버전을 올리는 커밋은 `0.1.15: 두 줄 탭, 바뀐 파일 칩 제거` 처럼 버전이 제목이다 — 그 제목은 **`package.json` 의 version 을 실제로 올린 커밋에만** 단다. 한 번 나간 버전은 다시 릴리스되지 않으므로, 이미 나간 버전을 제목에 다시 단 커밋은 CI 가 실패로 알린다([개발·검증 › 릴리스 올리기](docs/development.md#릴리스-올리기)).

## 문서

- 동작을 바꿨으면 문서도 같은 커밋에서 바꾼다: 화면에 보이는 것은 `docs/features.md`, 파일·설정·파이프라인은 `docs/architecture.md`, 검증 방법·디버그 훅은 `docs/development.md`. 왜 그렇게 했는지의 긴 이야기(겪은 사고, 재 본 숫자, 버린 대안)는 `docs/design-notes.md` 에 한 절로 두고, 기능 문서에서는 한 줄로 가리킨다.
- `CHANGELOG.md` 는 릴리스 때 쓴다 — 버전을 올리는 커밋에서 그 버전 절을 더한다. 사용자가 체감하는 변화만 적고, 릴리스 노트는 그 절이 그대로 나간다(`scripts/release.ts`).
- 코드 주석이 문서를 가리킬 때는 파일과 절 이름으로 적는다(예: `docs/development.md` 의 디버그 훅).
- README 는 설치할지 정하는 사람을 위한 것이다 — 짧게 두고, 자세한 것은 `docs/` 로.

## 릴리스

`package.json` 의 `"version"` 을 올리고 `CHANGELOG.md` 에 그 버전 절을 쓴 뒤 `main` 에 푸시하면 끝이다. GitHub Actions(`.github/workflows/release.yml`)가 타입 검사 → 단위 테스트 → `npm run release -- --ci` 로 빌드·게시하고, 설치된 앱은 켤 때 그 릴리스를 본다. 자세한 것은 [릴리스 올리기](docs/development.md#릴리스-올리기).
