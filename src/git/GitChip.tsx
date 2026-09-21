// `⎇ main · 3` on a workspace tab: which branch that terminal is sitting in, and how many paths
// are dirty. It is a `<span>`, not a button — the tab itself is the button it lives inside.

import { gitKey, useDesk } from '../store'
import { IconBranch } from '../widgets/icons'
import { useGit } from './useGit'
import './git.css'

export function TabGit({ cwd }: { cwd: string }) {
  const activeTab = useDesk((s) => s.activeTab)
  const workspaces = useDesk((s) => s.workspaces)
  const active = workspaces.some((w) => `ws:${w.id}` === activeTab && gitKey(w.cwd) === gitKey(cwd))
  const info = useGit(cwd, active)

  // not a repo, no git, or git took too long: the tab says nothing rather than something wrong
  if (!info || !info.repo || !info.branch || info.error) return null

  const tip = [
    `⎇ ${info.branch}`,
    info.changed > 0 ? `바뀐 파일 ${info.changed}` : '바뀐 파일 없음',
    info.ahead > 0 ? `↑${info.ahead}` : '',
    info.behind > 0 ? `↓${info.behind}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <span className="tab-git" title={tip}>
      <IconBranch size={11} />
      <span className="tg-branch">{info.branch}</span>
      {info.changed > 0 && (
        <span className="tg-n">
          {/* its own span so a narrow window can drop it along with the branch name (git.css) */}
          <span className="tg-dot">· </span>
          {info.changed}
        </span>
      )}
    </span>
  )
}
