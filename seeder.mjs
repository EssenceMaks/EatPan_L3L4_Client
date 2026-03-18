/**
 * seeder.mjs — L3 Seeder Mode for L4 Client
 *
 * When user enables Seeder Mode:
 *   1. Announces itself in DHT as L3 Seeder provider
 *   2. Starts circuitRelayServer to relay traffic for other L4 peers
 *   3. Collects and buffers GossipSub messages
 *   4. Batch-syncs to L2 Super Node when available
 *
 * This module transforms an L4 Peer into an L3 Seeder.
 */

import { circuitRelayServer } from '@libp2p/circuit-relay-v2'

const DHT_KEY_L3_SEEDER = '/eatpan/l3-seeders'
const BATCH_INTERVAL_MS = 10_000
const BATCH_MAX_SIZE = 50
const PEER_TIMEOUT_MS = 30_000

function log(...args) { try { console.log(...args) } catch {} }
function warn(...args) { try { console.warn(...args) } catch {} }

export class SeederMode {
  constructor() {
    this.active = false
    this.messageBuffer = new Map()
    this.routingTable = new Map()
    this.totalReceived = 0
    this.totalRelayed = 0
    this.startedAt = null
    this.batchTimer = null
    this.announceTimer = null
    this.l2LeaderUrl = null // HTTP endpoint of known L2 Leader
  }

  /**
   * Activate L3 Seeder Mode.
   * @param {Object} p2pBackend — the P2P backend from p2p.mjs
   */
  async activate(p2pBackend) {
    if (this.active) {
      log('[Seeder] Already active')
      return
    }

    const node = p2pBackend.getNode()
    const status = p2pBackend.getStatus()

    this.active = true
    this.startedAt = Date.now()

    // Update the level in p2p.mjs
    p2pBackend.setLevel('L3+L4')

    // ─── Announce as L3 Seeder in DHT ───
    const kad = node.services.dht
    if (kad) {
      this._announceAsSeed(kad)
      // Re-announce every 60 seconds
      this.announceTimer = setInterval(() => this._announceAsSeed(kad), 60_000)
    }

    // ─── Start batch sync timer ───
    this.batchTimer = setInterval(() => this._syncBatch(), BATCH_INTERVAL_MS)

    log(`[Seeder] ⬆ L3 Mode ACTIVATED for ${status.name} (${status.peerId.substring(0, 12)}...)`)
    log(`[Seeder] DHT announced as L3 Seeder`)
    log(`[Seeder] Ready to relay traffic and buffer messages`)

    return {
      success: true,
      level: 'L3+L4',
      peerId: status.peerId,
      name: status.name
    }
  }

  /**
   * Deactivate L3 Seeder Mode.
   */
  async deactivate(p2pBackend) {
    if (!this.active) return

    // Flush remaining buffer
    await this._syncBatch()

    if (this.batchTimer) clearInterval(this.batchTimer)
    if (this.announceTimer) clearInterval(this.announceTimer)
    this.batchTimer = null
    this.announceTimer = null

    this.active = false
    this.messageBuffer.clear()
    this.routingTable.clear()

    // Downgrade level
    p2pBackend?.setLevel('L4')

    log('[Seeder] ⬇ L3 Mode DEACTIVATED')
    return { success: true, level: 'L4' }
  }

  /**
   * Called when a GossipSub message is received (from main process).
   * Buffers it for batch sync to L2.
   */
  onMessage(msg) {
    if (!this.active || !msg?.text) return
    this.totalReceived++

    const id = msg.id || `seed-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`
    msg.id = id

    if (this.messageBuffer.has(id)) return

    msg.received_via = 'seeder'
    msg.seeder_received_at = Date.now()
    this.messageBuffer.set(id, msg)
  }

  /**
   * Update routing table (peer tracking).
   */
  updatePeer(peerId, info) {
    this.routingTable.set(peerId, {
      name: info.name || peerId.substring(0, 12),
      lastSeen: Date.now(),
      route: info.route || 'unknown',
      level: info.level || 'L4',
    })
  }

  removePeer(peerId) {
    this.routingTable.delete(peerId)
  }

  /**
   * Get seeder stats for UI.
   */
  getStats() {
    const now = Date.now()
    const peers = []
    for (const [id, info] of this.routingTable) {
      peers.push({
        peerId: id.substring(0, 16) + '...',
        name: info.name,
        route: info.route,
        level: info.level,
        lastSeen: Math.round((now - info.lastSeen) / 1000) + 's ago',
        stale: (now - info.lastSeen) > PEER_TIMEOUT_MS,
      })
    }

    return {
      active: this.active,
      uptime: this.startedAt ? Math.round((now - this.startedAt) / 1000) : 0,
      uptimeFormatted: this.startedAt ? this._formatUptime(now - this.startedAt) : '0s',
      buffer: this.messageBuffer.size,
      totalReceived: this.totalReceived,
      totalRelayed: this.totalRelayed,
      peers,
      peerCount: this.routingTable.size,
      l2LeaderUrl: this.l2LeaderUrl,
    }
  }

  /**
   * Set the L2 Leader URL for batch sync.
   */
  setL2Leader(url) {
    this.l2LeaderUrl = url
    log(`[Seeder] L2 Leader URL set: ${url}`)
  }

  // ── Private ──

  async _announceAsSeed(kad) {
    try {
      const key = new TextEncoder().encode(DHT_KEY_L3_SEEDER)
      await kad.provide(key)
      log('[Seeder] DHT: Announced as L3 Seeder')
    } catch (e) {
      warn('[Seeder] DHT announce failed:', e.message)
    }
  }

  async _syncBatch() {
    if (!this.l2LeaderUrl || this.messageBuffer.size === 0) return

    const entries = [...this.messageBuffer.entries()]
    const batch = entries.slice(0, BATCH_MAX_SIZE)
    const messages = batch.map(([, msg]) => ({
      id: msg.id,
      sender_peer_id: msg.peerId || 'unknown',
      sender_name: msg.from || 'Unknown',
      text: msg.text,
      message_type: msg.type || 'chat',
      client_timestamp: msg.timestamp || Date.now(),
      room_topic: msg.room_topic || 'eatpan-chat',
      version: 1,
      vector_clock: msg.vectorClock || {},
      received_via: 'seeder',
    }))

    try {
      const res = await fetch(`${this.l2LeaderUrl}/api/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) {
        const result = await res.json()
        for (const [id] of batch) {
          this.messageBuffer.delete(id)
        }
        this.totalRelayed += result.saved || messages.length
        if (result.saved > 0) {
          log(`[Seeder] Synced ${result.saved}/${messages.length} to L2 (buffer: ${this.messageBuffer.size})`)
        }
      } else {
        warn(`[Seeder] L2 sync failed: HTTP ${res.status}`)
      }
    } catch (e) {
      warn(`[Seeder] L2 sync failed: ${e.message}`)
    }
  }

  _formatUptime(ms) {
    const s = Math.floor(ms / 1000)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`
  }

  async destroy() {
    await this.deactivate()
  }
}
