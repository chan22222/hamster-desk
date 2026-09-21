// Several Claude Code accounts, one config folder each (electron/profiles.ts).
//
// Three small pieces, all invisible until there is a second account:
//   AccountPicker   — "which account do new terminals open under", at the top of the `+` menu
//   AccountBadge    — the account's name on a tab, so two tabs of one folder can be told apart
//   AccountsSection — add / rename / forget, in the `⋯` menu (the only one that shows with one account)
//
// A tab keeps the account it was opened under for as long as it lives: the shell was started with
// that `CLAUDE_CONFIG_DIR`, and nothing can change it afterwards.

import { useRef, useState } from 'react'
import { DEFAULT_PROFILE_ID, type Profile, type ProfilesState } from '@shared/events'
import { useDesk } from '../store'
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

export function setCurrentAccount(id: string): void {
  const s = useDesk.getState()
  if (s.currentProfileId === id) return
  // paint first: the very next click is usually "open a terminal", and it must land on this account
  s.setProfiles({ list: s.profiles, currentId: id })
  void change((p) => p.setCurrent(id))
}

/** The account new terminals open under. Hidden while there is only one. */
export function AccountPicker() {
  const profiles = useDesk((s) => s.profiles)
  const current = useDesk((s) => s.currentProfileId)
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

function Row({ p, current, inUse }: { p: Profile; current: boolean; inUse: number }) {
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

  if (asking) {
    return (
      <div className="acct-row is-asking">
        <span className="acct-ask">
          <b>{p.name}</b> 계정을 목록에서 뺄까요? 로그인과 대화 기록 폴더는 지우지 않아요.
          {inUse > 0 && ` 열려 있는 탭 ${inUse}개는 닫을 때까지 그대로 동작해요.`}
        </span>
        <button className="acct-btn is-danger" onClick={() => void change((b) => b.remove(p.id))}>
          빼기
        </button>
        <button className="acct-btn" onClick={() => setAsking(false)}>
          취소
        </button>
      </div>
    )
  }

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
            <span className="acct-sub">{p.email ?? (p.dir ? '아직 로그인 전' : 'CLI 기본 계정')}</span>
          </span>
        </button>
      )}
      {!editing && (
        <span className="acct-tools">
          <button className="acct-tool" title="이름 바꾸기" aria-label={`${p.name} 이름 바꾸기`}
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
            <button className="acct-tool" title="목록에서 빼기 (폴더는 남아요)" aria-label={`${p.name} 목록에서 빼기`} onClick={() => setAsking(true)}>
              <IconClose size={13} />
            </button>
          )}
        </span>
      )}
    </div>
  )
}

/** Add / rename / forget accounts. Lives in the `⋯` menu. */
export function AccountsSection() {
  const profiles = useDesk((s) => s.profiles)
  const current = useDesk((s) => s.currentProfileId)
  const workspaces = useDesk((s) => s.workspaces)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const add = (): void => {
    const n = name.trim()
    setAdding(false)
    setName('')
    if (!window.desk) return
    void change(async (b) => {
      const before = new Set(useDesk.getState().profiles.map((p) => p.id))
      const state = await b.add(n)
      // a new account is added to be used: make it the current one straight away
      const added = state.list.find((p) => !before.has(p.id))
      return added ? b.setCurrent(added.id) : state
    })
  }

  return (
    <>
      <div className="pop-head">계정</div>
      {profiles.map((p) => (
        <Row key={p.id} p={p} current={p.id === current} inUse={workspaces.filter((w) => w.profileId === p.id).length} />
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
            추가
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
      {profiles.length > 1 && (
        <p className="pop-note">
          새 계정은 그 계정으로 터미널을 열어 <code>claude</code> 실행 후 <code>/login</code> 한 번이면 돼요. 설정·MCP·메모리는 계정마다 따로예요.
        </p>
      )}
    </>
  )
}
