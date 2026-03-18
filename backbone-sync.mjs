/**
 * backbone-sync.mjs — Offline Cache + L2 Backbone Batch Sync
 *
 * Buffers chat messages locally. When online and L2 is reachable,
 * batch-syncs them via HTTP POST. Handles reconnection detection.
 *
 * This replaces the old backbone.mjs with clean reconnect logic.
 */

const SYNC_BATCH_SIZE = 20
const SYNC_INTERVAL_MS = 5000
const HISTORY_LIMIT = 100

function log(...args) { try { console.log(...args) } catch {} }
function warn(...args) { try { console.warn(...args) } catch {} }

export class BackboneSync {
  constructor(nodeId, nodeName) {
    this.nodeId = nodeId
    this.nodeName = nodeName
    this.backboneUrl = process.env.BACKBONE_URL || 'http://localhost:8000'
    this.isOnline = false
    this.pendingSync = []
    this.syncTimer = null
    this.retryTimer = null
    this.room = 'eatpan-chat'
    this.wasOffline = false // track for reconnect detection
  }

  /**
   * Initialize — check L2 connectivity, start sync timer.
   */
  async init() {
    this.isOnline = await this._checkConnectivity()
    if (this.isOnline) {
      log(`[BackboneSync] Connected to L2 at ${this.backboneUrl}`)
      this._startSyncTimer()
    } else {
      this.wasOffline = true
      warn(`[BackboneSync] L2 offline — P2P-only mode, messages buffered locally`)
      this.retryTimer = setInterval(() => this._retryConnection(), 30000)
    }
    return this.isOnline
  }

  /**
   * Load chat history from L2 on startup.
   */
  async loadHistory() {
    if (!this.isOnline) return []
    try {
      const url = `${this.backboneUrl}/api/v1/chat/history/${this.room}/?limit=${HISTORY_LIMIT}`
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) return []
      const data = await res.json()
      const messages = data.results || []
      log(`[BackboneSync] Loaded ${messages.length} historical messages`)
      return messages.map(m => ({
        id: m.id,
        from: m.sender_name,
        peerId: m.sender_peer_id,
        text: m.text,
        timestamp: m.client_timestamp,
        route: m.received_via || 'backbone',
        gsn: m.global_sequence_number,
        vectorClock: m.vector_clock,
        isHistory: true,
        type: 'chat',
      })).sort((a, b) => a.timestamp - b.timestamp)
    } catch (e) {
      warn('[BackboneSync] Failed to load history:', e.message)
      return []
    }
  }

  /**
   * Queue a message for sync to L2.
   */
  enqueueSync(msg) {
    if (!msg?.id || !msg?.text) return
    this.pendingSync.push({
      id: msg.id,
      sender_peer_id: msg.peerId || this.nodeId,
      sender_name: msg.from || this.nodeName,
      text: msg.text,
      message_type: 'chat',
      client_timestamp: msg.timestamp || Date.now(),
      room_topic: msg.room_topic || this.room,
      version: msg.version || 1,
      vector_clock: msg.vectorClock || { [this.nodeId]: 1 },
      node_origin: this.nodeId,
      received_via: msg.route || 'direct',
    })
  }

  /**
   * Force-flush buffer to L2.
   */
  async flush() {
    if (this.pendingSync.length > 0) {
      await this._syncBatch()
    }
  }

  // ── Private ──

  async _checkConnectivity() {
    try {
      const res = await fetch(`${this.backboneUrl}/api/v1/chat/rooms/`, {
        signal: AbortSignal.timeout(3000),
      })
      return res.ok
    } catch { return false }
  }

  async _retryConnection() {
    if (this.isOnline) return
    this.isOnline = await this._checkConnectivity()
    if (this.isOnline) {
      log('[BackboneSync] L2 reconnected!')
      if (this.retryTimer) clearInterval(this.retryTimer)
      this._startSyncTimer()

      // ─── Reconnect: auto-flush offline cache ───
      if (this.wasOffline && this.pendingSync.length > 0) {
        log(`[BackboneSync] Flushing ${this.pendingSync.length} offline-cached messages to L2...`)
        await this.flush()
        this.wasOffline = false
      }
    }
  }

  _startSyncTimer() {
    if (this.syncTimer) return
    this.syncTimer = setInterval(() => this._syncBatch(), SYNC_INTERVAL_MS)
  }

  async _syncBatch() {
    if (!this.isOnline || this.pendingSync.length === 0) return

    const batch = this.pendingSync.splice(0, SYNC_BATCH_SIZE)
    try {
      const res = await fetch(`${this.backboneUrl}/api/v1/chat/sync/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: batch, node_id: this.nodeId }),
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        const result = await res.json()
        if (result.saved > 0) {
          log(`[BackboneSync] Synced ${result.saved} messages (conflicts: ${result.conflicts})`)
        }
      } else {
        this.pendingSync.unshift(...batch)
        this.isOnline = false
        this.wasOffline = true
      }
    } catch (e) {
      this.pendingSync.unshift(...batch)
      this.isOnline = false
      this.wasOffline = true
      warn('[BackboneSync] Sync failed:', e.message)
    }
  }

  destroy() {
    if (this.syncTimer) { clearInterval(this.syncTimer); this.syncTimer = null }
    if (this.retryTimer) { clearInterval(this.retryTimer); this.retryTimer = null }
  }
}
