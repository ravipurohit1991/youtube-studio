import type { ReactNode } from 'react'
import { parseStamp } from '../lib/ai'

/**
 * The small Markdown subset the AI is asked to write: "## " headings, "- " bullets, **bold**, and
 * [mm:ss] timestamps, which become buttons that jump the player there when onSeek is given.
 */

const INLINE = /(\*\*[^*\n]+\*\*|\[\d{1,2}:\d{2}(?::\d{2})?\])/g

function inline(text: string, onSeek: ((seconds: number) => void) | undefined, keyBase: string): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    const key = keyBase + ':' + index
    if (!part) return null
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={key}>{part.slice(2, -2)}</strong>
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

export default function RichText({ text, onSeek, streaming }: { text: string; onSeek?: (seconds: number) => void; streaming?: boolean }): ReactNode {
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
      bullets.push(<li key={key}>{inline(bullet[1], onSeek, key)}</li>)
      return
    }
    flush(key)
    if (heading) blocks.push(<h4 key={key}>{inline(heading[1], onSeek, key)}</h4>)
    else if (line.trim()) blocks.push(<p key={key}>{inline(line, onSeek, key)}</p>)
  })
  flush('end')
  return (
    <div className={'rich' + (streaming ? ' streaming' : '')}>
      {blocks}
    </div>
  )
}
