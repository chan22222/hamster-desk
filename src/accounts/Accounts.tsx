// Several Claude Code accounts, one config folder each (electron/profiles.ts).
//
// Every account is registered the same way and one of them is *active*: the one new terminals open
// under. The CLI's own folder (~/.claude) is simply the first of them — it has no "default" label
// and logs in with the same button. The one difference: its × takes it *off the list* instead of
// deleting it. That folder is not this app's, and every other terminal's claude logs in from it;
// the accounts menu offers it back.
//
// Three small pieces, all invisible until there is a second account:
//   AccountPicker   — "which account is active", at the top of the `+` menu
//   AccountBadge    — the account's name on a tab, so two tabs of one folder can be told apart
//   AccountsSection — add / rename / delete, in the `⋯` menu (the only one that shows with one account)
//   AccountGate     — once per start: which account to work as, before anything else
//
// A tab keeps the account it was opened under for as long as it lives: the shell was started with
// that `CLAUDE_CONFIG_DIR`, and nothing can change it afterwards. That is why adding an account
// opens a terminal of its own and starts the login *there* — typing `/login` into a tab that was
// already open would sign the wrong account in.

import { useEffect, useRef, useState } from 'react'
import { DEFAULT_PROFILE_ID, type Profile, type ProfilesState } from '@shared/events'
import { useDesk } from '../store'
import { lastCwd } from '../sidebar/recent'
import { IconCheck, IconClose, IconFolder, IconPlus } from '../widgets/icons'
import { AccountUsageLine } from '../widgets/Usage'
import './accounts.css'

/** Ask main to change the accounts, then adopt whatever it says they are now. */
async function change(call: (p: NonNullable<typeof window.desk>['profiles']) => Promise<ProfilesState>): Promise<void> {
  const bridge = window.desk
  if (!bridge) return
  try {
    useDesk.getState().setProfiles(await call(bridge.profiles))
  } catch {
    /* the list on screen is still the last one main confirmed */
  }
}

/** Read the list again — the only way a login that just happened shows up as an email. */
export function refreshAccounts(): void {
  void change((p) => p.list())
}

export function setCurrentAccount(id: string): void {
  const s = useDesk.getState()
  if (s.currentProfileId === id) return
  // paint first: the very next click is usually "open a terminal", and it must land on this account
  s.setProfiles({ list: s.profiles, currentId: id, hiddenDefault: s.cliAccountHidden })
  void change((p) => p.setCurrent(id))
}

// `claude auth login` goes straight to the browser; once it succeeds the same terminal carries on
// into claude itself. `$?` rather than `&&`: Windows PowerShell 5.1 has no `&&`.
const WINDOWS = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
const LOGIN_COMMAND = WINDOWS ? 'claude auth login; if ($?) { claude }' : 'claude auth login && claude'

/** the folder a terminal opened for an account goes to: the front tab's, else any tab's, else the last one used (main falls back to home when there is none) */
function frontCwd(): string {
  const s = useDesk.getState()
  const front = s.activeTab?.startsWith('ws:') ? s.workspaces.find((w) => `ws:${w.id}` === s.activeTab) : undefined
  return front?.cwd || s.workspaces[0]?.cwd || lastCwd()
}

/** A terminal of this account's own, with the login already running in it. */
export function openLogin(profileId: string): void {
  useDesk.getState().addWorkspace(frontCwd(), undefined, undefined, profileId, LOGIN_COMMAND)
}

/** A plain terminal of this account's own, in the folder the front tab is in. */
export function openTerminalUnder(profileId: string): void {
  useDesk.getState().addWorkspace(frontCwd(), undefined, undefined, profileId)
}

/**
 * Add an account by name: it becomes current and its login terminal opens. False when main did
 * not add one (the list on screen is then whatever main last confirmed).
 */
export async function addAccount(name: string): Promise<boolean> {
  const bridge = window.desk
  if (!bridge) return false
  try {
    const before = new Set(useDesk.getState().profiles.map((p) => p.id))
    const state = await bridge.profiles.add(name)
    const added = state.list.find((p) => !before.has(p.id))
    if (!added) {
      useDesk.getState().setProfiles(state)
      return false
    }
    useDesk.getState().setProfiles(await bridge.profiles.setCurrent(added.id))
    openLogin(added.id)
    return true
  } catch {
    return false
  }
}

/** `계정 추가`: a name, and the rest happens by itself (`addAccount`); `onAdded` runs once it has. */
function AddAccount({ onAdded }: { onAdded: () => void }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const add = (): void => {
    const n = name.trim()
    setAdding(false)
    setName('')
    void addAccount(n).then((ok) => ok && onAdded())
  }
  if (!adding) {
    return (
      <button className="pop-item" onClick={() => setAdding(true)}>
        <span className="pop-item-ico">
          <IconPlus size={14} />
        </span>
        <span className="pop-item-text">계정 추가</span>
      </button>
    )
  }
  return (
    <div className="acct-add">
      <input
        className="acct-name-input"
        value={name}
        autoFocus
        maxLength={24}
        placeholder="계정 이름 (예: 회사)"
        aria-label="새 계정 이름"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') add()
          if (e.key === 'Escape') {
            setAdding(false)
            setName('')
          }
        }}
      />
      <button className="acct-btn is-primary" onClick={add}>
        추가 후 로그인
      </button>
    </div>
  )
}

/**
 * Keep the emails honest without polling: an account that shows no login yet is looked up again
 * whenever one of its sessions appears or changes — which is exactly what a finished login leads to.
 */
export function useAccountsRefresh(): void {
  useEffect(() => {
    let last = 0
    return useDesk.subscribe((s, prev) => {
      if (s.sessions === prev.sessions) return
      const waiting = s.profiles.filter((p) => p.dir && !p.email).map((p) => p.id)
      if (waiting.length === 0) return
      if (!Object.values(s.sessions).some((x) => waiting.includes(x.info.profileId ?? DEFAULT_PROFILE_ID))) return
      const now = Date.now()
      if (now - last < 10_000) return // an API-key login never gets an email; do not ask on every event
      last = now
      refreshAccounts()
    })
  }, [])
}

/** The account new terminals open under. Hidden while there is only one. */
export function AccountPicker() {
  const profiles = useDesk((s) => s.profiles)
  const current = useDesk((s) => s.currentProfileId)
  useEffect(refreshAccounts, [])
  if (profiles.length < 2) return null
  return (
    <div className="acct-pick" role="radiogroup" aria-label="새 터미널을 열 계정">
      <span className="acct-pick-label">활성 계정</span>
      <span className="acct-pick-list">
        {profiles.map((p) => (
          <button
            key={p.id}
            className={`acct-pill ${p.id === current ? 'is-on' : ''}`}
            role="radio"
            aria-checked={p.id === current}
            title={p.email ? `${p.name} · ${p.email}` : p.name}
            onClick={() => setCurrentAccount(p.id)}
          >
            {p.name}
          </button>
        ))}
      </span>
    </div>
  )
}

/**
 * Once per start, over everything: which account to work as. It asks when there is more than one
 * account, and when the only one has no login yet (a fresh install) — the way in is then the
 * `로그인` button, or `계정 추가`, or starting as is. A choice is required — there is no "later" —
 * because a terminal opened under the wrong account is a login to the wrong place, and the pills
 * in the `+` menu were easy to never notice. The tabs that came back from the last run are not
 * touched: each keeps the account it was opened under. The rows are the accounts list's own.
 */
export function AccountGate() {
  const profiles = useDesk((s) => s.profiles)
  const current = useDesk((s) => s.currentProfileId)
  // decided at mount (the list is read before the stored tabs come back): one logged-in account
  // means no question, and an account added later in the run must not raise it then
  const [done, setDone] = useState(() => {
    const p = useDesk.getState().profiles
    return p.length < 2 && !!p[0]?.email
  })
  if (done) return null
  /** the only account, and it has no login: the question is whether to log in first */
  const fresh = profiles.length < 2
  const pick = (id: string): void => {
    setCurrentAccount(id)
    setDone(true)
  }
  const login = (id: string): void => {
    setCurrentAccount(id)
    openLogin(id)
    setDone(true)
  }
  return (
    <div className="upd-veil acct-veil">
      <div className="upd-dialog acct-gate" role="dialog" aria-modal="true" aria-label="계정 고르기">
        <div className="upd-title">{fresh ? '먼저 로그인할까요?' : '어느 계정으로 시작할까요?'}</div>
        <p className="pop-note">
          {fresh
            ? '아직 로그인한 계정이 없어요. 로그인을 누르면 이 계정의 터미널에서 브라우저 로그인이 열리고, 끝나면 claude 가 이어서 떠요. 그냥 시작해도 돼요.'
            : '새 터미널이 이 계정으로 열려요. 돌아온 탭은 각자 열 때의 계정 그대로이고, 나중에 ⋯ › 계정에서 바꿀 수 있어요.'}
        </p>
        <div className="acct-gate-list" role="group" aria-label="계정">
          {profiles.map((p) => {
            const on = p.id === current
            return (
              <div key={p.id} className={`acct-row ${on ? 'is-on' : ''}`}>
                <button
                  className="acct-main"
                  // Enter goes to the login when the remembered account has none, to the account otherwise
                  autoFocus={on && !!p.email}
                  title={p.email ? `${p.name} · ${p.email}` : `${p.name} · 로그인 전 — 이대로 시작`}
                  onClick={() => pick(p.id)}
                >
                  <span className="pop-tick">{on && <IconCheck size={14} />}</span>
                  <span className="acct-text">
                    <span className="acct-name">
                      <span className="acct-name-text">{p.name}</span>
                      {on && !fresh && <span className="acct-active">지난번</span>}
                    </span>
                    <span className="acct-sub">{p.email ?? '로그인 전'}</span>
                  </span>
                </button>
                {!p.email && (
                  <button className="acct-btn is-primary acct-login" autoFocus={on} title="이 계정의 터미널을 열고 로그인을 시작합니다" onClick={() => login(p.id)}>
                    로그인
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <AddAccount onAdded={() => setDone(true)} />
      </div>
    </div>
  )
}

/** The account's name on a tab. Nothing while there is only one account. */
export function AccountBadge({ profileId }: { profileId: string | undefined }) {
  const profiles = useDesk((s) => s.profiles)
  if (profiles.length < 2) return null
  const p = profiles.find((x) => x.id === (profileId ?? DEFAULT_PROFILE_ID))
  if (!p) return null
  return (
    <span className="acct-badge" title={p.email ? `계정: ${p.name} · ${p.email}` : `계정: ${p.name}`}>
      {p.name}
    </span>
  )
}

function Row({ p, current, only, onDone }: { p: Profile; current: boolean; only: boolean; onDone: () => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(p.name)
  const [asking, setAsking] = useState(false)
  // Escape takes the input away, and some browsers blur an element on its way out: that blur must
  // not save the name Escape was pressed to throw away
  const cancelled = useRef(false)

  const commit = (): void => {
    setEditing(false)
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    const next = name.trim()
    if (next && next !== p.name) void change((b) => b.rename(p.id, next))
    else setName(p.name)
  }

  /** the CLI's own account: nothing of it is deleted, it only leaves the list */
  const cli = p.id === DEFAULT_PROFILE_ID

  /** The account and its terminals go — and, unless it is the CLI's own, its folder and login: main closes the shells, the tabs follow. */
  const remove = (): void => {
    const s = useDesk.getState()
    for (const w of s.workspaces.filter((x) => (x.profileId ?? DEFAULT_PROFILE_ID) === p.id)) s.removeWorkspace(w.id)
    void change((b) => b.remove(p.id))
  }

  if (asking) {
    return (
      <div className="acct-row is-asking">
        <span className="acct-ask">
          {cli ? (
            <>
              <b>{p.name}</b> 을(를) 목록에서 뺄까요? 로그인과 <code>~/.claude</code> 폴더는 그대로 두고, 이 계정으로 열린 탭만 닫습니다.
            </>
          ) : (
            <>
              <b>{p.name}</b> 계정을 지울까요?
            </>
          )}
        </span>
        <button className="acct-btn is-danger" onClick={remove}>
          {cli ? '빼기' : '지우기'}
        </button>
        <button className="acct-btn" onClick={() => setAsking(false)}>
          취소
        </button>
      </div>
    )
  }

  const loggedOut = !p.email

  return (
    <div className={`acct-row ${current ? 'is-on' : ''}`}>
      {editing ? (
        // not inside the button below: a space typed into an input nested in a button clicks the button
        <div className="acct-main">
          <span className="pop-tick">{current && <IconCheck size={14} />}</span>
          <input
            className="acct-name-input"
            value={name}
            autoFocus
            maxLength={24}
            aria-label="계정 이름"
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                cancelled.current = true
                setName(p.name)
                setEditing(false)
              }
            }}
          />
        </div>
      ) : (
        <button
          className="acct-main"
          role="menuitemradio"
          aria-checked={current}
          title={current ? '활성 계정 · 누르면 이 계정의 새 터미널을 엽니다' : '이 계정을 활성으로 하고, 이 계정의 새 터미널을 엽니다'}
          onClick={() => {
            // switching is for working as that account, so the terminal comes with it — picking the
            // account and then finding `+` was two steps for one intention
            setCurrentAccount(p.id)
            openTerminalUnder(p.id)
            onDone()
          }}
        >
          <span className="pop-tick">{current && <IconCheck size={14} />}</span>
          <span className="acct-text">
            <span className="acct-name">
              <span className="acct-name-text">{p.name}</span>
              {current && <span className="acct-active">활성</span>}
            </span>
            <span className="acct-sub">{p.email ?? '로그인 전'}</span>
            {/* the last numbers this account reported, however old — it says how old */}
            <AccountUsageLine profileId={p.id} />
          </span>
        </button>
      )}
      {!editing && loggedOut && (
        <button
          className="acct-btn is-primary acct-login"
          title="이 계정의 터미널을 열고 로그인을 시작합니다"
          onClick={() => {
            setCurrentAccount(p.id)
            openLogin(p.id)
            onDone()
          }}
        >
          로그인
        </button>
      )}
      {!editing && (
        <span className="acct-tools">
          <button
            className="acct-tool"
            title="이름 바꾸기"
            aria-label={`${p.name} 이름 바꾸기`}
            onClick={() => {
              cancelled.current = false
              setEditing(true)
            }}
          >
            ✎
          </button>
          <button className="acct-tool" title="계정 폴더 열기" aria-label={`${p.name} 폴더 열기`} onClick={() => void window.desk?.profiles.openFolder(p.id)}>
            <IconFolder size={13} />
          </button>
          {/* the last account stays: a list with nothing in it has nowhere to open a terminal */}
          {!only && (
            <button
              className="acct-tool"
              title={cli ? '목록에서 빼기 (로그인과 폴더는 그대로)' : '계정 지우기'}
              aria-label={cli ? `${p.name} 목록에서 빼기` : `${p.name} 계정 지우기`}
              onClick={() => setAsking(true)}
            >
              <IconClose size={13} />
            </button>
          )}
        </span>
      )}
    </div>
  )
}

/** Add / rename / delete accounts. Lives in the `⋯` menu; `onDone` closes it. */
export function AccountsSection({ onDone }: { onDone: () => void }) {
  const profiles = useDesk((s) => s.profiles)
  const current = useDesk((s) => s.currentProfileId)
  const cliHidden = useDesk((s) => s.cliAccountHidden)
  // a login that finished since the list was last read shows up as soon as the menu opens
  useEffect(refreshAccounts, [])

  return (
    <>
      <div className="pop-head">계정</div>
      <p className="pop-note">계정을 누르면 활성 계정이 되고 그 계정의 새 터미널이 열려요. 이미 열린 탭은 열 때의 계정 그대로예요.</p>
      {profiles.map((p) => (
        <Row key={p.id} p={p} current={p.id === current} only={profiles.length === 1} onDone={onDone} />
      ))}
      {/* name it, and the rest happens by itself: the account becomes current and its login opens */}
      <AddAccount onAdded={onDone} />
      {cliHidden && (
        <button className="pop-item" title="목록에서 뺐던 ~/.claude 계정을 다시 보이게 합니다" onClick={() => void change((b) => b.showDefault())}>
          <span className="pop-item-ico">
            <IconFolder size={14} />
          </span>
          <span className="pop-item-text">CLI 계정(~/.claude) 다시 표시</span>
        </button>
      )}
    </>
  )
}
