import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CornerDownLeft, Music, Search, Video } from 'lucide-react'
import type { LibraryItem } from '@shared/types'
import { findYouTubeUrl } from '../lib/format'
import { hideBroken } from './common'

export interface PaletteCommand {
  id: string
  group: string
  label: string
  icon: ReactNode
  /** Extra words that should find it. */
  keywords?: string
  /** Shown on the right (a shortcut or a detail). */
  meta?: ReactNode
  run: () => void
}

interface Props {
  commands: PaletteCommand[]
  /** Commands for a link typed or pasted into the box. */
  linkCommands: (url: string) => PaletteCommand[]
  library: LibraryItem[]
  onPlayItem: (item: LibraryItem) => void
  onClose: () => void
}

function matches(text: string, words: string[]): boolean {
  const hay = text.toLowerCase()
  return words.every((w) => hay.includes(w))
}

/** Ctrl+K: jump anywhere, run any action, find anything in the library, or act on a pasted link. */
export default function CommandPalette({ commands, linkCommands, library, onPlayItem, onClose }: Props): ReactNode {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  const results = useMemo(() => {
    const link = findYouTubeUrl(query)
    if (link) return linkCommands(link)
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    // Best first: the label starts with the query, then the label has every word, then keywords do.
    const score = (c: PaletteCommand): number => {
      const label = c.label.toLowerCase()
      if (label.startsWith(words.join(' '))) return 3
      if (matches(label, words)) return 2
      return matches(c.label + ' ' + (c.keywords ?? '') + ' ' + c.group, words) ? 1 : 0
    }
    const found = words.length
      ? commands
          .map((c) => ({ c, s: score(c) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s)
          .map((x) => x.c)
      : commands
    if (words.length) {
      const items = library
        .filter((item) => matches((item.title ?? item.name) + ' ' + (item.uploader ?? '') + ' ' + (item.folder ?? ''), words))
        .slice(0, 8)
        .map<PaletteCommand>((item) => ({
          id: 'item:' + item.key,
          group: 'In your library',
          label: item.title ?? item.name,
          icon: item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" onError={hideBroken} /> : item.kind === 'audio' ? <Music size={16} /> : <Video size={16} />,
          meta: item.uploader ?? item.ext.toUpperCase(),
          run: () => onPlayItem(item),
        }))
      return [...found, ...items]
    }
    return found
  }, [query, commands, linkCommands, library, onPlayItem])

  useEffect(() => setActive(0), [query])

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]')
    if (el) (el as HTMLElement).scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = (command: PaletteCommand | undefined): void => {
    if (!command) return
    onClose()
    command.run()
  }

  let lastGroup = ''
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="palette-input">
          <Search size={18} />
          <input
            autoFocus
            placeholder="Type a command, search your library, or paste a YouTube link…"
            value={query}
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
              else if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((i) => Math.min(results.length - 1, i + 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((i) => Math.max(0, i - 1))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                run(results[active])
              }
            }}
          />
        </div>
        <div className="palette-list" ref={listRef}>
          {results.length === 0 ? <div className="hint" style={{ padding: 16 }}>Nothing matches "{query}".</div> : null}
          {results.map((command, index) => {
            const header = command.group !== lastGroup ? command.group : null
            lastGroup = command.group
            return (
              <div key={command.id}>
                {header ? <div className="palette-group">{header}</div> : null}
                <button
                  type="button"
                  className={'palette-item' + (index === active ? ' active' : '')}
                  data-active={index === active ? 'true' : 'false'}
                  onMouseMove={() => setActive(index)}
                  onClick={() => run(command)}
                >
                  {command.icon}
                  <span className="label">{command.label}</span>
                  {command.meta ? <span className="meta">{command.meta}</span> : null}
                </button>
              </div>
            )
          })}
        </div>
        <div className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd><CornerDownLeft size={10} /></kbd> run</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
