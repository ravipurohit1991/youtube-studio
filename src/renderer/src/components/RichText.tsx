import type { ReactNode } from 'react'
import { parseStamp } from '../lib/ai'

/**
 * The small Markdown subset the AI is asked to write: "## " headings, "- " bullets, **bold**, *italic*, and
 * [mm:ss] timestamps, which become buttons that jump the player there when onSeek is given.
 * Answers about the whole library cite passages as [S2 04:31]; those become buttons calling onCite.
 */

const INLINE = /(\*\*[^*\n]+\*\*|(?<![*\w])\*(?![\s*])[^*\n]+?(?<!\s)\*(?![*\w])|\[\d{1,2}:\d{2}(?::\d{2})?\]|\[S\d+[^\]\n]{0,80}\])/g
const CITE = /S(\d+)(?:\s*[,@]?\s*(\d{1,2}:\d{2}(?::\d{2})?))?/g

export type CiteHandler = (ref: string, seconds: number | null) => void

function citations(part: string, onCite: CiteHandler | undefined, citeTitle: ((ref: string) => string | null) | undefined, key: string): ReactNode {
  const found = Array.from(part.matchAll(CITE))
  if (!found.length) return <span key={key}>{part}</span>
  return (
    <span key={key} className="cites">
      {found.map((m, index) => {
        const ref = 'S' + m[1]
        const seconds = m[2] ? parseStamp(m[2]) : null
        const title = citeTitle?.(ref) ?? null
        const label = ref + (m[2] ? ' · ' + m[2] : '')
        return onCite && title !== null ? (
          <button key={index} type="button" className="cite" title={'Play "' + title + '"' + (m[2] ? ' at ' + m[2] : '')} onClick={() => onCite(ref, seconds)}>
            {label}
          </button>
        ) : (
          <span key={index} className="cite static">{label}</span>
        )
      })}
    </span>
  )
}

function inline(text: string, onSeek: ((seconds: number) => void) | undefined, keyBase: string, onCite?: CiteHandler, citeTitle?: (ref: string) => string | null): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    const key = keyBase + ':' + index
    if (!part) return null
    if (/^\[S\d+/.test(part)) return citations(part, onCite, citeTitle, key)
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={key}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2 && !part.startsWith('**')) return <em key={key}>{part.slice(1, -1)}</em>
    if (/^\[\d{1,2}:\d{2}(?::\d{2})?\]$/.test(part)) {
      const label = part.slice(1, -1)
      return onSeek ? (
        <button key={key} type="button" className="stamp" title={'Jump to ' + label} onClick={() => onSeek(parseStamp(part))}>
          {label}
        </button>
      ) : (
        <span key={key} className="stamp static">{label}</span>
      )
    }
    return <span key={key}>{part}</span>
  })
}

export default function RichText({
  text,
  onSeek,
  streaming,
  onCite,
  citeTitle,
}: {
  text: string
  onSeek?: (seconds: number) => void
  streaming?: boolean
  onCite?: CiteHandler
  /** Title of the video behind a citation (null: unknown, shown as plain text). */
  citeTitle?: (ref: string) => string | null
}): ReactNode {
  const blocks: ReactNode[] = []
  let bullets: ReactNode[] = []
  const flush = (key: string): void => {
    if (!bullets.length) return
    blocks.push(<ul key={'ul' + key}>{bullets}</ul>)
    bullets = []
  }
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trimEnd()
    const key = String(index)
    const heading = /^#{1,4}\s+(.*)$/.exec(line)
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line)
    if (bullet) {
      bullets.push(<li key={key}>{inline(bullet[1], onSeek, key, onCite, citeTitle)}</li>)
      return
    }
    flush(key)
    if (heading) blocks.push(<h4 key={key}>{inline(heading[1], onSeek, key, onCite, citeTitle)}</h4>)
    else if (line.trim()) blocks.push(<p key={key}>{inline(line, onSeek, key, onCite, citeTitle)}</p>)
  })
  flush('end')
  return (
    <div className={'rich' + (streaming ? ' streaming' : '')}>
      {blocks}
    </div>
  )
}
