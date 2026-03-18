/**
 * rooms.mjs — Room Manager (Global, DM, Group)
 *
 * Topic naming:
 *   - eatpan-chat               → Global broadcast
 *   - eatpan-dm-{peerA}-{peerB} → Private DM (sorted peer IDs)
 *   - eatpan-room-{uuid}        → Group room
 */

import { randomUUID } from 'crypto'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const GLOBAL_TOPIC = 'eatpan-chat'

export class RoomManager {
  constructor(dataDir, myPeerId) {
    this.dataDir = dataDir
    this.myPeerId = myPeerId
    this.filePath = join(dataDir, 'rooms.json')
    this.rooms = new Map()

    // Global room always exists
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

  getOrCreateDM(peerId, peerName) {
    for (const [, room] of this.rooms) {
      if (room.type === 'dm' && room.members.includes(peerId)) return room
    }
    const sorted = [this.myPeerId, peerId].sort()
    const topic = `eatpan-dm-${sorted[0].substring(0, 16)}-${sorted[1].substring(0, 16)}`
    const roomId = `dm-${peerId.substring(0, 16)}`
    const room = {
      id: roomId, topic, name: peerName || peerId.substring(0, 12),
      type: 'dm', members: [peerId], peerId,
      createdAt: Date.now(), lastMessage: null, unread: 0,
    }
    this.rooms.set(roomId, room)
    this._save()
    return room
  }

  createGroup(name, memberIds = []) {
    const roomId = randomUUID()
    const topic = `eatpan-room-${roomId}`
    const room = {
      id: roomId, topic, name: name || `Group ${this.rooms.size}`,
      type: 'group', members: [...new Set(memberIds)],
      createdAt: Date.now(), lastMessage: null, unread: 0,
    }
    this.rooms.set(roomId, room)
    this._save()
    return room
  }

  joinGroup(topic, name, members = []) {
    const roomId = topic.replace('eatpan-room-', '')
    if (this.rooms.has(roomId)) return this.rooms.get(roomId)
    const room = {
      id: roomId, topic, name: name || 'Group',
      type: 'group', members,
      createdAt: Date.now(), lastMessage: null, unread: 0,
    }
    this.rooms.set(roomId, room)
    this._save()
    return room
  }

  leaveRoom(roomId) {
    if (roomId === 'global') return false
    const room = this.rooms.get(roomId)
    if (!room) return false
    this.rooms.delete(roomId)
    this._save()
    return room.topic
  }

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

  incrementUnread(roomId) {
    const room = this.rooms.get(roomId)
    if (room) room.unread = (room.unread || 0) + 1
  }

  resetUnread(roomId) {
    const room = this.rooms.get(roomId)
    if (room) room.unread = 0
  }

  findByTopic(topic) {
    for (const [, room] of this.rooms) {
      if (room.topic === topic) return room
    }
    return null
  }

  listRooms() {
    return [...this.rooms.values()].sort((a, b) => {
      if (a.type === 'global') return -1
      if (b.type === 'global') return 1
      return (b.lastMessage?.time || b.createdAt) - (a.lastMessage?.time || a.createdAt)
    })
  }

  getAllTopics() {
    return [...this.rooms.values()].map(r => r.topic)
  }

  renameRoom(roomId, newName) {
    const room = this.rooms.get(roomId)
    if (room && room.type === 'group') {
      room.name = newName
      this._save()
      return true
    }
    return false
  }

  _save() {
    try {
      const data = {}
      for (const [id, room] of this.rooms) {
        if (id === 'global') continue
        data[id] = room
      }
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (e) { console.warn('[Rooms] Save failed:', e.message) }
  }

  _load() {
    try {
      if (!existsSync(this.filePath)) return
      const raw = readFileSync(this.filePath, 'utf-8')
      const data = JSON.parse(raw)
      for (const [id, room] of Object.entries(data)) {
        this.rooms.set(id, { ...room, unread: 0 })
      }
    } catch (e) { console.warn('[Rooms] Load failed:', e.message) }
  }
}
