import { useState, type ReactNode } from 'react'
import { Check, ListPlus, Plus } from 'lucide-react'
import type { LibraryState } from '@shared/types'
import { errorMessage, unwrap } from '../lib/api'
import type { ToastTone } from '../lib/types'
import { PromptDialog } from './common'

/** Pick one of the user's playlists (or make a new one) for the given library keys. */
export default function AddToPlaylist({
  state,
  keys,
  onClose,
  pushToast,
}: {
  state: LibraryState
  keys: string[]
  onClose: () => void
  pushToast: (message: string, tone?: ToastTone) => void
}): ReactNode {
  const [creating, setCreating] = useState(state.playlists.length === 0)

  const add = async (id: string, name: string): Promise<void> => {
    try {
      await unwrap(window.api.addToPlaylist(id, keys))
      pushToast('Added to ' + name + '.', 'success')
      onClose()
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    }
  }

  if (creating) {
    return (
      <PromptDialog
        title="New playlist"
        confirm="Create"
        placeholder="Playlist name"
        onCancel={onClose}
        onConfirm={(name) => {
          void (async () => {
            try {
              await unwrap(window.api.createPlaylist(name, keys))
              pushToast('Added to ' + name + '.', 'success')
              onClose()
            } catch (err) {
              pushToast(errorMessage(err), 'error')
            }
          })()
        }}
      />
    )
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <h3>Add to playlist</h3>
        <div className="modal-list">
          <button type="button" className="modal-list-item" onClick={() => setCreating(true)}>
            <Plus size={16} />
            <span className="grow">New playlist...</span>
          </button>
          {state.playlists.map((playlist) => {
            const already = keys.every((key) => playlist.items.includes(key))
            return (
              <button key={playlist.id} type="button" className="modal-list-item" onClick={() => void add(playlist.id, playlist.name)}>
                {already ? <Check size={16} style={{ color: 'var(--ok)' }} /> : <ListPlus size={16} />}
                <span className="grow">{playlist.name}</span>
                <span className="stat">{playlist.items.length}</span>
              </button>
            )
          })}
        </div>
        <div className="row tight" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
