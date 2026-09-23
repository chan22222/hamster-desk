import { useEffect, useState } from 'react'
import type { FiveHourAccount, FiveHourState, Profile } from '@shared/events'
import { useDesk, type DeskSide, type ThemeMode } from '../store'
import { formatDate, langOptions, useUi, type PrefLang, type UiStrings } from '../i18n'
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
    // a checkbox, not a menuitemcheckbox: this panel is a dialog of settings, not a menu (there is no
    // role="menu" around it for a menu item to belong to)
    <button
      className={`pop-check ${on ? 'is-on' : ''}`}
      role="checkbox"
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

// The choices of the segmented rows are worded per render, so a language change applies live.
const themes = (u: UiStrings): { value: ThemeMode; label: string }[] => [
  { value: 'light', label: u.settings.themeLight },
  { value: 'dark', label: u.settings.themeDark },
  { value: 'system', label: u.settings.themeSystem },
]
const sides = (u: UiStrings): { value: DeskSide; label: string }[] => [
  { value: 'top', label: u.settings.sideTop },
  { value: 'right', label: u.settings.sideRight },
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
  const u = useUi()
  if (stats.calls === 0) return <p className="pop-note">{u.settings.noSummaryYet}</p>
  return (
    <div className="pop-usage" title={stats.since ? u.settings.since(formatDate(stats.since)) : undefined}>
      <span>{u.settings.summaryStats(stats.calls, compact(stats.inputTokens + stats.outputTokens), compact(stats.inputTokens), compact(stats.outputTokens), money(stats.costUSD))}</span>
      <button onClick={onReset} title={u.settings.resetCounterTip}>
        {u.settings.reset}
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

/** `다음 시작 14:02` — or why not, and when it tries again. Nothing while off. */
function fiveHourLine(a: FiveHourAccount, u: UiStrings): string | null {
  if (!a.on) return null
  if (a.sending) return u.fiveHour.starting
  const soon = !a.nextAt || a.nextAt <= Date.now() + 30_000
  if (a.error) return soon ? u.fiveHour.retrySoon(a.error) : u.fiveHour.retryAt(a.error, fmtReset(a.nextAt))
  const last = a.lastAt ? u.fiveHour.last(fmtReset(a.lastAt)) : ''
  return `${soon ? u.fiveHour.startSoon : u.fiveHour.nextStart(fmtReset(a.nextAt))}${last}`
}

/**
 * Per account: a one-word message right after each 5-hour reset, so the next window is already
 * running when the user comes back (electron/five-hour.ts). Off unless switched on.
 */
function FiveHourSection() {
  const u = useUi()
  const profiles = useDesk((s) => s.profiles)
  const [state, set] = useFiveHour()
  if (!state) return null
  const many = profiles.length > 1
  const row = (p: Profile) => {
    const a = state[p.id]
    if (!a) return null
    const line = fiveHourLine(a, u)
    // no login, no window to start: the CLI would only answer "please /login"
    const out = !p.email && !a.on
    return (
      <div key={p.id}>
        <CheckRow
          on={a.on}
          label={many ? p.name : u.fiveHour.autoStart}
          hint={out ? u.common.notLoggedIn : undefined}
          disabled={out}
          onClick={() => set(p.id, !a.on)}
        />
        {line && <p className={`pop-note ${a.error ? 'warn-line' : ''}`}>{line}</p>}
      </div>
    )
  }
  return (
    <>
      <div className="pop-head">{u.fiveHour.head}</div>
      <p className="pop-note">{u.fiveHour.note}</p>
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
  const u = useUi()
  const [where, setWhere] = useState<{ uiPath: string; home: string } | null>(null)
  useEffect(() => {
    void window.desk?.info().then((i) => setWhere({ uiPath: i.uiPath, home: i.home }))
  }, [])
  if (!where?.uiPath) return null
  return (
    <button className="pop-path" title={`${where.uiPath}\n${u.settings.settingsFileTip}`} onClick={() => window.desk?.fs.showInFolder(where.uiPath)}>
      {u.settings.settingsFile(tilde(where.uiPath, where.home))}
    </button>
  )
}

function Body({ onUpdate, close }: { onUpdate: () => void; close: () => void }) {
  const u = useUi()
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
      <CheckRow on={prefs.showSidebar} label={u.settings.sidebar} hint="Ctrl+B" onClick={() => setPrefs({ showSidebar: !prefs.showSidebar })} />
      <CheckRow on={!prefs.folded} label={u.settings.hamsterGui} onClick={() => setPrefs({ folded: !prefs.folded })} />
      <CheckRow on={prefs.restoreTabs} label={u.settings.restoreTabs} onClick={() => setPrefs({ restoreTabs: !prefs.restoreTabs })} />
      <CheckRow
        on={prefs.showSidebar && prefs.showLog}
        label={u.settings.changedFiles}
        hint={u.settings.sidebar}
        onClick={() => (prefs.showSidebar && prefs.showLog ? setPrefs({ showLog: false }) : setPrefs({ showSidebar: true, showLog: true }))}
      />
      <CheckRow on={prefs.onTop} label={u.settings.onTop} onClick={() => setPrefs({ onTop: !prefs.onTop })} />
      <CheckRow on={mini} label={u.settings.mini} hint="Ctrl+Shift+M" debugClick="mini-toggle" onClick={toggleMini} />
      <Segmented label={u.settings.deskSide} value={prefs.deskSide} options={sides(u)} onChange={(v) => setPrefs({ deskSide: v })} />
      <Segmented label={u.settings.theme} value={prefs.theme} options={themes(u)} onChange={(v) => setPrefs({ theme: v })} />
      <Segmented label={u.settings.termFont} value={String(prefs.termFont)} options={TERM_FONTS} onChange={(v) => setPrefs({ termFont: Number(v) })} />

      <div className="pop-sep" />
      <AccountsSection onDone={close} />

      <div className="pop-sep" />
      <FiveHourSection />

      <div className="pop-sep" />
      <div className="pop-head">{u.settings.notifyHead}</div>
      <CheckRow on={notify.permission} label={u.settings.notifyPermission} debugClick="notify-permission" onClick={() => setPrefs({ notify: { ...notify, permission: !notify.permission } })} />
      <CheckRow on={notify.question} label={u.settings.notifyQuestion} debugClick="notify-question" onClick={() => setPrefs({ notify: { ...notify, question: !notify.question } })} />
      <CheckRow on={notify.turnEnd} label={u.settings.notifyTurnEnd} debugClick="notify-turn" onClick={() => setPrefs({ notify: { ...notify, turnEnd: !notify.turnEnd } })} />
      <CheckRow on={notify.sound} label={u.settings.notifySound} debugClick="notify-sound" onClick={() => setPrefs({ notify: { ...notify, sound: !notify.sound } })} />

      <div className="pop-sep" />
      <div className="pop-head">{u.settings.bubbleHead}</div>
      <CheckRow
        on={prefs.bubbleSummary}
        label={u.settings.summarize}
        disabled={bubble ? !bubble.available : false}
        onClick={() => setPrefs({ bubbleSummary: !prefs.bubbleSummary })}
      />
      {bubble && !bubble.available && <p className="pop-note">{bubble.reason ?? u.settings.cannotSummarize}</p>}
      {bubble && <UsageRow stats={bubble.stats} onReset={() => void resetBubbleStats().then(setBubble)} />}
      <label className="pop-field">
        {u.settings.language}
        <select value={prefs.lang} onChange={(e) => setPrefs({ lang: e.target.value as PrefLang })}>
          {langOptions(u).map((o) => (
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
  const u = useUi()
  return (
    <Popover className="icon-btn" label={<IconMore />} ariaLabel={u.settings.title} title={u.settings.title} width={268} debugClick="more">
      {(close) => <Body onUpdate={onUpdate} close={close} />}
    </Popover>
  )
}
