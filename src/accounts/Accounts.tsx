// Several Claude Code accounts, one config folder each (electron/profiles.ts).
//
// Three small pieces, all invisible until there is a second account:
//   AccountPicker   — "which account do new terminals open under", at the top of the `+` menu
//   AccountBadge    — the account's name on a tab, so two tabs of one folder can be told apart
//   AccountsSection — add / rename / delete, in the `⋯` menu (the only one that shows with one account)
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
  s.setProfiles({ list: s.profiles, currentId: id })
  void change((p) => p.setCurrent(id))
}

// `claude auth login` goes straight to the browser; once it succeeds the same terminal carries on
// into claude itself. `$?` rather than `&&`: Windows PowerShell 5.1 has no `&&`.
const WINDOWS = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
const LOGIN_COMMAND = WINDOWS ? 'claude auth login; if ($?) { claude }' : 'claude auth login && claude'

/** A terminal of this account's own, with the login already running in it. */
export function openLogin(profileId: string): void {
  const s = useDesk.getState()
  const front = s.activeTab?.startsWith('ws:') ? s.workspaces.find((w) => `ws:${w.id}` === s.activeTab) : undefined
  // no folder at all → main falls back to the home folder
  const cwd = front?.cwd || s.workspaces[0]?.cwd || lastCwd()
  s.addWorkspace(cwd, undefined, undefined, profileId, LOGIN_COMMAND)
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
      <span className="acct-pick-label">계정</span>
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

function Row({ p, current, onDone }: { p: Profile; current: boolean; onDone: () => void }) {
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

  /** The account, its login and its terminals all go: main closes the shells, the tabs follow. */
  const remove = (): void => {
    const s = useDesk.getState()
    for (const w of s.workspaces.filter((x) => x.profileId === p.id)) s.removeWorkspace(w.id)
    void change((b) => b.remove(p.id))
  }

  if (asking) {
    return (
      <div className="acct-row is-asking">
        <span className="acct-ask">
          <b>{p.name}</b> 계정을 지울까요?
        </span>
        <button className="acct-btn is-danger" onClick={remove}>
          지우기
        </button>
        <button className="acct-btn" onClick={() => setAsking(false)}>
          취소
        </button>
      </div>
    )
  }

  const loggedOut = !!p.dir && !p.email

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
        <button className="acct-main" role="menuitemradio" aria-checked={current} title="새 터미널을 이 계정으로 열기" onClick={() => setCurrentAccount(p.id)}>
          <span className="pop-tick">{current && <IconCheck size={14} />}</span>
          <span className="acct-text">
            <span className="acct-name">{p.name}</span>
            <span className="acct-sub">{p.email ?? (p.dir ? '로그인 전' : 'CLI 기본 계정')}</span>
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
          {p.id !== DEFAULT_PROFILE_ID && (
            <button className="acct-tool" title="계정 지우기" aria-label={`${p.name} 계정 지우기`} onClick={() => setAsking(true)}>
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
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  // a login that finished since the list was last read shows up as soon as the menu opens
  useEffect(refreshAccounts, [])

  /** Name it, and the rest happens by itself: the account becomes current and its login opens. */
  const add = (): void => {
    const n = name.trim()
    setAdding(false)
    setName('')
    const bridge = window.desk
    if (!bridge) return
    void (async () => {
      try {
        const before = new Set(useDesk.getState().profiles.map((p) => p.id))
        const state = await bridge.profiles.add(n)
        const added = state.list.find((p) => !before.has(p.id))
        if (!added) {
          useDesk.getState().setProfiles(state)
          return
        }
        useDesk.getState().setProfiles(await bridge.profiles.setCurrent(added.id))
        openLogin(added.id)
        onDone()
      } catch {
        /* the list on screen is still the last one main confirmed */
      }
    })()
  }

  return (
    <>
      <div className="pop-head">계정</div>
      {profiles.map((p) => (
        <Row key={p.id} p={p} current={p.id === current} onDone={onDone} />
      ))}
      {adding ? (
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
      ) : (
        <button className="pop-item" onClick={() => setAdding(true)}>
          <span className="pop-item-ico">
            <IconPlus size={14} />
          </span>
          <span className="pop-item-text">계정 추가</span>
        </button>
      )}
    </>
  )
}
