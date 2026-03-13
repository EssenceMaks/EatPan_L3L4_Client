/**
 * rooms.mjs — Room Manager for P4 Terminal
 *
 * Manages chat rooms: Global broadcast, DMs (1-on-1), Group rooms.
 * Persists to rooms.json in userData directory.
 *
 * Topic naming:
 *   - eatpan-chat              → Global broadcast (always subscribed)
 *   - eatpan-dm-{peerA}-{peerB} → Private DM (sorted peer IDs, deterministic)
 *   - eatpan-room-{uuid}       → Group room (UUID, shared via invite)
 */

import { randomUUID } from 'crypto'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const GLOBAL_TOPIC = 'eatpan-chat'

export class RoomManager {
  /**
   * @param {string} dataDir — app.getPath('userData') from Electron
   * @param {string} myPeerId — local peer ID
   */
  constructor(dataDir, myPeerId) {
    this.dataDir = dataDir
    this.myPeerId = myPeerId
    this.filePath = join(dataDir, 'rooms.json')

    // Map<roomId, RoomInfo>
    // RoomInfo: { id, topic, name, type, members, createdAt, lastMessage, unread }
    this.rooms = new Map()

    // Always have global room
    this.rooms.set('global', {
      id: 'global',
      topic: GLOBAL_TOPIC,
      name: '🌍 Global Chat',
      type: 'global',
      members: [],
      createdAt: Date.now(),
      lastMessage: null,
      unread: 0,
    })

    this._load()
  }

  /**
   * Create or get a DM room with a specific peer.
   * Topic is deterministic: sorted peer IDs joined with '-'.
   */
  getOrCreateDM(peerId, peerName) {
    // Check if DM already exists
    for (const [id, room] of this.rooms) {
      if (room.type === 'dm' && room.members.includes(peerId)) {
        return room
      }
    }

    // Create new DM
    const sorted = [this.myPeerId, peerId].sort()
    const topic = `eatpan-dm-${sorted[0].substring(0, 16)}-${sorted[1].substring(0, 16)}`
    const roomId = `dm-${peerId.substring(0, 16)}`

    const room = {
      id: roomId,
      topic,
      name: peerName || peerId.substring(0, 12),
      type: 'dm',
      members: [peerId],
      peerId,  // shortcut for DM
      createdAt: Date.now(),
      lastMessage: null,
      unread: 0,
    }

    this.rooms.set(roomId, room)
    this._save()
    return room
  }

  /**
   * Create a group room.
   * Returns room info with UUID-based topic.
   */
  createGroup(name, memberIds = []) {
    const roomId = randomUUID()
    const topic = `eatpan-room-${roomId}`

    const room = {
      id: roomId,
      topic,
      name: name || `Group ${this.rooms.size}`,
      type: 'group',
      members: [...new Set(memberIds)],
      createdAt: Date.now(),
      lastMessage: null,
      unread: 0,
    }

    this.rooms.set(roomId, room)
    this._save()
    return room
  }

  /**
   * Join an existing group room by topic (from invite).
   */
  joinGroup(topic, name, members = []) {
    // Extract roomId from topic
    const roomId = topic.replace('eatpan-room-', '')

    if (this.rooms.has(roomId)) {
      return this.rooms.get(roomId)
    }

    const room = {
      id: roomId,
      topic,
      name: name || `Group`,
      type: 'group',
      members,
      createdAt: Date.now(),
      lastMessage: null,
      unread: 0,
    }

    this.rooms.set(roomId, room)
    this._save()
    return room
  }

  /**
   * Leave a room (DM or group). Cannot leave global.
   */
  leaveRoom(roomId) {
    if (roomId === 'global') return false
    const room = this.rooms.get(roomId)
    if (!room) return false
    this.rooms.delete(roomId)
    this._save()
    return room.topic  // return topic to unsubscribe
  }

  /**
   * Update last message for a room (for sidebar preview).
   */
  updateLastMessage(roomId, message) {
    const room = this.rooms.get(roomId)
    if (!room) return
    room.lastMessage = {
      text: message.text?.substring(0, 50) || '',
      from: message.from || 'Unknown',
      time: message.timestamp || Date.now(),
    }
    this._save()
  }

  /**
   * Increment unread counter for a room.
   */
  incrementUnread(roomId) {
    const room = this.rooms.get(roomId)
    if (room) {
      room.unread = (room.unread || 0) + 1
    }
  }

  /**
   * Reset unread counter (when user opens the room).
   */
  resetUnread(roomId) {
    const room = this.rooms.get(roomId)
    if (room) {
      room.unread = 0
    }
  }

  /**
   * Find room by GossipSub topic.
   */
  findByTopic(topic) {
    for (const [, room] of this.rooms) {
      if (room.topic === topic) return room
    }
    return null
  }

  /**
   * Get all rooms as array (for UI).
   */
  listRooms() {
    return [...this.rooms.values()].sort((a, b) => {
      // Global first, then by last message time
      if (a.type === 'global') return -1
      if (b.type === 'global') return 1
      const aTime = a.lastMessage?.time || a.createdAt
      const bTime = b.lastMessage?.time || b.createdAt
      return bTime - aTime
    })
  }

  /**
   * Get all topics to subscribe to.
   */
  getAllTopics() {
    return [...this.rooms.values()].map(r => r.topic)
  }

  /**
   * Rename a group room.
   */
  renameRoom(roomId, newName) {
    const room = this.rooms.get(roomId)
    if (room && room.type === 'group') {
      room.name = newName
      this._save()
      return true
    }
    return false
  }

  // ── Persistence ──

  _save() {
    try {
      const data = {}
      for (const [id, room] of this.rooms) {
        if (id === 'global') continue  // don't persist global
        data[id] = room
      }
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (e) {
      console.warn('[Rooms] Save failed:', e.message)
    }
  }

  _load() {
    try {
      if (!existsSync(this.filePath)) return
      const raw = readFileSync(this.filePath, 'utf-8')
      const data = JSON.parse(raw)
      for (const [id, room] of Object.entries(data)) {
        this.rooms.set(id, { ...room, unread: 0 })  // reset unread on load
      }
    } catch (e) {
      console.warn('[Rooms] Load failed:', e.message)
    }
  }
}
