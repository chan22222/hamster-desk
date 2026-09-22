import { useEffect, useState } from 'react'
import type { FiveHourAccount, FiveHourState, Profile } from '@shared/events'
import { useDesk, type DeskSide, type ThemeMode } from '../store'
import { LANG_OPTIONS, type PrefLang } from '../i18n'
import { bubbleAvailability, resetBubbleStats, type BubbleAvailability } from '../bubbles/summarize'
import { Popover } from './Popover'
import { IconCheck, IconMore } from './icons'
import { VersionSection } from './Version'
import { AppUpdateSection } from './AppUpdate'
import { AccountsSection } from '../accounts/Accounts'
import { fmtReset } from './Usage'

function CheckRow({
  on,
  label,
  hint,
  disabled,
  debugClick,
  onClick,
}: {
  on: boolean
  label: string
  hint?: string
  disabled?: boolean
  /** debug/e2e: the name `HAMSTER_CLICK` presses this row by (src/dev/debug.ts) */
  debugClick?: string
  onClick: () => void
}) {
  return (
    <button
      className={`pop-check ${on ? 'is-on' : ''}`}
      role="menuitemcheckbox"
      aria-checked={on}
      data-debug-click={debugClick}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="pop-tick">{on && <IconCheck size={14} />}</span>
      <span className="pop-label">{label}</span>
      {hint && <span className="dim">{hint}</span>}
    </button>
  )
}

/** A short list of exclusive choices, side by side — a stack of radio rows would double the menu. */
function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="pop-field">
      <span>{label}</span>
      <span className="seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} className={`seg-btn ${value === o.value ? 'is-on' : ''}`} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </span>
    </div>
  )
}

const THEMES: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: '라이트' },
  { value: 'dark', label: '다크' },
  { value: 'system', label: '시스템' },
]
const SIDES: { value: DeskSide; label: string }[] = [
  { value: 'top', label: '위' },
  { value: 'right', label: '오른쪽' },
]
/** the sizes worth one click; anything else is still reachable with Ctrl+= / Ctrl+− */
const TERM_FONTS = ['12', '13', '14', '16'].map((v) => ({ value: v, label: v }))

/** 1234 → '1.2k'; small numbers stay exact so a first summary reads as '550', not '0.6k'. */
function compact(n: number): string {
  if (n < 1000) return String(Math.round(n))
  return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
}

function money(usd: number): string {
  if (usd <= 0) return '$0'
  return usd >= 0.01 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`
}

/** How much of the subscription the bubble summaries have used. Measured: ~550 in / ~30 out a call. */
function UsageRow({ stats, onReset }: { stats: BubbleAvailability['stats']; onReset: () => void }) {
  if (stats.calls === 0) return <p className="pop-note">아직 요약한 적이 없어요.</p>
  const since = stats.since ? new Date(stats.since) : null
  return (
    <div className="pop-usage" title={since ? `${since.getMonth() + 1}/${since.getDate()} 부터` : undefined}>
      <span>
        요약 {stats.calls}회 · 토큰 {compact(stats.inputTokens + stats.outputTokens)} (입력 {compact(stats.inputTokens)} · 출력{' '}
        {compact(stats.outputTokens)}) · ≈ {money(stats.costUSD)}
      </span>
      <button onClick={onReset} title="사용량 카운터 초기화">
        초기화
      </button>
    </div>
  )
}

/** What main says about every account's 5-hour start, kept current while the menu is open. */
function useFiveHour(): [FiveHourState | null, (id: string, on: boolean) => void] {
  const [state, setState] = useState<FiveHourState | null>(null)
  useEffect(() => {
    const api = window.desk?.fiveHour
    if (!api) return
    let alive = true
    void api.state().then((s) => alive && setState(s))
    const off = api.onChange((s) => alive && setState(s))
    return () => {
      alive = false
      off()
    }
  }, [])
  const set = (id: string, on: boolean): void => {
    void window.desk?.fiveHour.set(id, on).then(setState)
  }
  return [state, set]
}

/** `다음 14:02` — or why not, and when it tries again. Nothing while off. */
function fiveHourLine(a: FiveHourAccount): string | null {
  if (!a.on) return null
  if (a.sending) return '새 5시간을 시작하는 중…'
  const soon = !a.nextAt || a.nextAt <= Date.now() + 30_000
  if (a.error) return `${a.error} · ${soon ? '곧' : `${fmtReset(a.nextAt)} 에`} 다시 시도`
  const last = a.lastAt ? ` · 마지막 ${fmtReset(a.lastAt)}` : ''
  return `${soon ? '곧 시작' : `다음 시작 ${fmtReset(a.nextAt)}`}${last}`
}

/**
 * Per account: a one-word message right after each 5-hour reset, so the next window is already
 * running when the user comes back (electron/five-hour.ts). Off unless switched on.
 */
function FiveHourSection() {
  const profiles = useDesk((s) => s.profiles)
  const [state, set] = useFiveHour()
  if (!state) return null
  const many = profiles.length > 1
  const row = (p: Profile) => {
    const a = state[p.id]
    if (!a) return null
    const line = fiveHourLine(a)
    // no login, no window to start: the CLI would only answer "please /login"
    const out = !p.email && !a.on
    return (
      <div key={p.id}>
        <CheckRow
          on={a.on}
          label={many ? p.name : '초기화되면 바로 다시 시작'}
          hint={out ? '로그인 전' : undefined}
          disabled={out}
          onClick={() => set(p.id, !a.on)}
        />
        {line && <p className={`pop-note ${a.error ? 'warn-line' : ''}`}>{line}</p>}
      </div>
    )
  }
  return (
    <>
      <div className="pop-head">5시간 창 자동 시작</div>
      <p className="pop-note">초기화되자마자 Haiku 에게 한 단어를 보내 다음 5시간을 바로 시작해요. 앱이 켜져 있을 때만, 한 번에 토큰 400개쯤.</p>
      {profiles.map(row)}
    </>
  )
}

/** `C:\Users\me\.hamster-desk\ui.json` → `~\.hamster-desk\ui.json` */
function tilde(path: string, home: string): string {
  if (!home || !path.toLowerCase().startsWith(home.toLowerCase())) return path
  return `~${path.slice(home.length)}`
}

/** Where the settings actually live — one file, shared by every way of running the app. */
function SettingsFile() {
  const [where, setWhere] = useState<{ uiPath: string; home: string } | null>(null)
  useEffect(() => {
    void window.desk?.info().then((i) => setWhere({ uiPath: i.uiPath, home: i.home }))
  }, [])
  if (!where?.uiPath) return null
  return (
    <button className="pop-path" title={`${where.uiPath}\n클릭: 탐색기에서 보기`} onClick={() => window.desk?.fs.showInFolder(where.uiPath)}>
      설정 파일: {tilde(where.uiPath, where.home)}
    </button>
  )
}

function Body({ onUpdate, close }: { onUpdate: () => void; close: () => void }) {
  const prefs = useDesk((s) => s.prefs)
  const setPrefs = useDesk((s) => s.setPrefs)
  const mini = useDesk((s) => s.mini)
  const toggleMini = useDesk((s) => s.toggleMini)
  const notify = prefs.notify
  const [bubble, setBubble] = useState<BubbleAvailability | null>(null)

  useEffect(() => {
    void bubbleAvailability(true).then(setBubble)
  }, [])

  return (
    <div className="pop-body">
      <CheckRow on={prefs.showSidebar} label="사이드바" hint="Ctrl+B" onClick={() => setPrefs({ showSidebar: !prefs.showSidebar })} />
      <CheckRow on={!prefs.folded} label="책상 펼치기" onClick={() => setPrefs({ folded: !prefs.folded })} />
      <CheckRow on={prefs.restoreTabs} label="시작할 때 지난 탭 다시 열기" onClick={() => setPrefs({ restoreTabs: !prefs.restoreTabs })} />
      <CheckRow
        on={prefs.showSidebar && prefs.showLog}
        label="바뀐 파일"
        hint="사이드바"
        onClick={() => (prefs.showSidebar && prefs.showLog ? setPrefs({ showLog: false }) : setPrefs({ showSidebar: true, showLog: true }))}
      />
      <CheckRow on={prefs.onTop} label="항상 위" onClick={() => setPrefs({ onTop: !prefs.onTop })} />
      <CheckRow on={mini} label="미니 모드" hint="Ctrl+Shift+M" debugClick="mini-toggle" onClick={toggleMini} />
      <Segmented label="책상 위치" value={prefs.deskSide} options={SIDES} onChange={(v) => setPrefs({ deskSide: v })} />
      <Segmented label="테마" value={prefs.theme} options={THEMES} onChange={(v) => setPrefs({ theme: v })} />
      <Segmented label="터미널 글꼴" value={String(prefs.termFont)} options={TERM_FONTS} onChange={(v) => setPrefs({ termFont: Number(v) })} />

      <div className="pop-sep" />
      <AccountsSection onDone={close} />

      <div className="pop-sep" />
      <FiveHourSection />

      <div className="pop-sep" />
      <div className="pop-head">알림</div>
      <CheckRow on={notify.permission} label="권한 요청" debugClick="notify-permission" onClick={() => setPrefs({ notify: { ...notify, permission: !notify.permission } })} />
      <CheckRow on={notify.question} label="질문" debugClick="notify-question" onClick={() => setPrefs({ notify: { ...notify, question: !notify.question } })} />
      <CheckRow on={notify.turnEnd} label="턴 완료" debugClick="notify-turn" onClick={() => setPrefs({ notify: { ...notify, turnEnd: !notify.turnEnd } })} />
      <CheckRow on={notify.sound} label="소리" debugClick="notify-sound" onClick={() => setPrefs({ notify: { ...notify, sound: !notify.sound } })} />

      <div className="pop-sep" />
      <div className="pop-head">말풍선</div>
      <CheckRow
        on={prefs.bubbleSummary}
        label="요약해서 말하기"
        disabled={bubble ? !bubble.available : false}
        onClick={() => setPrefs({ bubbleSummary: !prefs.bubbleSummary })}
      />
      {bubble && !bubble.available && <p className="pop-note">{bubble.reason ?? '지금은 요약할 수 없어요.'}</p>}
      {bubble && <UsageRow stats={bubble.stats} onReset={() => void resetBubbleStats().then(setBubble)} />}
      <label className="pop-field">
        언어
        <select value={prefs.lang} onChange={(e) => setPrefs({ lang: e.target.value as PrefLang })}>
          {LANG_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <div className="pop-sep" />
      <div className="pop-head">Claude Code</div>
      <VersionSection onUpdate={onUpdate} />

      <div className="pop-sep" />
      <div className="pop-head">Hamster Desk</div>
      <AppUpdateSection />

      <div className="pop-sep" />
      <SettingsFile />
    </div>
  )
}

/** The quiet corner of the top bar: view toggles, theme, bubble settings and the CLI version. */
export function MoreMenu({ onUpdate }: { onUpdate: () => void }) {
  return (
    <Popover className="icon-btn" label={<IconMore />} ariaLabel="설정" title="설정" width={268} debugClick="more">
      {(close) => <Body onUpdate={onUpdate} close={close} />}
    </Popover>
  )
}
