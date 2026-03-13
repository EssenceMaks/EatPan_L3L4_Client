/**
 * contacts.mjs — Contact List for P4 Terminal
 *
 * Saves known peers with custom names.
 * Persists to contacts.json in userData directory.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

export class ContactList {
  /**
   * @param {string} dataDir — app.getPath('userData') from Electron
   */
  constructor(dataDir) {
    this.dataDir = dataDir
    this.filePath = join(dataDir, 'contacts.json')

    // Map<peerId, ContactInfo>
    // ContactInfo: { peerId, name, savedName, lastSeen, addedAt }
    this.contacts = new Map()

    this._load()
  }

  /**
   * Add or update a contact.
   */
  addContact(peerId, name, savedName) {
    const existing = this.contacts.get(peerId)
    this.contacts.set(peerId, {
      peerId,
      name: name || existing?.name || peerId.substring(0, 12),
      savedName: savedName || existing?.savedName || name || peerId.substring(0, 12),
      lastSeen: Date.now(),
      addedAt: existing?.addedAt || Date.now(),
    })
    this._save()
  }

  /**
   * Remove a contact.
   */
  removeContact(peerId) {
    const had = this.contacts.delete(peerId)
    if (had) this._save()
    return had
  }

  /**
   * Update last seen time (called when peer is discovered online).
   */
  updateLastSeen(peerId, name) {
    const c = this.contacts.get(peerId)
    if (c) {
      c.lastSeen = Date.now()
      if (name) c.name = name
    }
  }

  /**
   * Rename a contact.
   */
  rename(peerId, newName) {
    const c = this.contacts.get(peerId)
    if (c) {
      c.savedName = newName
      this._save()
      return true
    }
    return false
  }

  /**
   * Get display name for a peer (saved name > discovered name > truncated peerId).
   */
  getDisplayName(peerId, fallback) {
    const c = this.contacts.get(peerId)
    if (c) return c.savedName || c.name
    return fallback || peerId.substring(0, 12)
  }

  /**
   * Check if peer is a saved contact.
   */
  isContact(peerId) {
    return this.contacts.has(peerId)
  }

  /**
   * Get all contacts as array.
   */
  list() {
    return [...this.contacts.values()].sort((a, b) =>
      (b.lastSeen || 0) - (a.lastSeen || 0)
    )
  }

  // ── Persistence ──

  _save() {
    try {
      const data = {}
      for (const [id, c] of this.contacts) {
        data[id] = c
      }
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (e) {
      console.warn('[Contacts] Save failed:', e.message)
    }
  }

  _load() {
    try {
      if (!existsSync(this.filePath)) return
      const raw = readFileSync(this.filePath, 'utf-8')
      const data = JSON.parse(raw)
      for (const [id, c] of Object.entries(data)) {
        this.contacts.set(id, c)
      }
    } catch (e) {
      console.warn('[Contacts] Load failed:', e.message)
    }
  }
}
