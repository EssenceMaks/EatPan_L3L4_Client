/**
 * EatPan L4/L3 Client — Electron Main Process
 * 
 * Clean implementation with:
 *   - P2P via libp2p (DHT + GossipSub + mDNS)
 *   - L3 Seeder Mode toggle
 *   - Backbone sync to L2
 *   - Rooms (Global, DM, Group)
 *   - Contacts
 *   - Auto-updater via GitHub Releases
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')

const isDev = process.argv.includes('--dev')

// Suppress EPIPE errors
const origShowErrorBox = dialog.showErrorBox
dialog.showErrorBox = (title, content) => {
  if (content?.includes('EPIPE')) return
  origShowErrorBox(title, content)
}
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE' || err.message?.includes('EPIPE')) return
  origShowErrorBox('Error', err.stack || err.message)
  process.exit(1)
})

let mainWindow = null
let p2pBackend = null
let backboneSync = null
let seeder = null
let roomManager = null
let contactList = null

// ═══════════════════════════════════════════
//  Window
// ═══════════════════════════════════════════

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 480,
    minHeight: 500,
    title: 'EatPan',
    backgroundColor: '#0a0a0f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  mainWindow.once('ready-to-show', () => mainWindow.show())
  if (isDev) mainWindow.webContents.openDevTools()
  mainWindow.on('closed', () => { mainWindow = null })
}

// ═══════════════════════════════════════════
//  IPC Handlers
// ═══════════════════════════════════════════

function setupIPC() {
  // Chat
  ipcMain.on('send-message', (_event, text, topic) => {
    if (p2pBackend) p2pBackend.sendChat(text, topic || undefined)
  })
  ipcMain.handle('get-status', () => p2pBackend ? p2pBackend.getStatus() : null)

  // Backbone
  ipcMain.handle('backbone-status', () => ({
    online: backboneSync?.isOnline ?? false,
    pending: backboneSync?.pendingSync?.length ?? 0,
    url: process.env.BACKBONE_URL || 'http://localhost:8000',
  }))
  ipcMain.on('backbone-flush', async () => {
    if (backboneSync) await backboneSync.flush()
  })

  // Seeder Mode
  ipcMain.handle('seeder-status', () => ({
    active: seeder?.active ?? false,
    stats: seeder?.getStats() ?? null,
  }))
  ipcMain.handle('seeder-activate', async () => {
    if (!seeder || !p2pBackend) return { success: false, reason: 'not ready' }
    try {
      const result = await seeder.activate(p2pBackend)
      if (mainWindow) mainWindow.webContents.send('seeder-changed', seeder.getStats())
      return result
    } catch (e) {
      return { success: false, reason: e.message }
    }
  })
  ipcMain.handle('seeder-deactivate', async () => {
    if (!seeder) return { success: false }
    const result = await seeder.deactivate(p2pBackend)
    if (mainWindow) mainWindow.webContents.send('seeder-changed', seeder.getStats())
    return result
  })
  ipcMain.handle('seeder-stats', () => seeder?.getStats() || null)

  // Rooms
  ipcMain.handle('get-rooms', () => roomManager?.listRooms() || [])
  ipcMain.handle('create-dm', (_e, peerId, peerName) => {
    if (!roomManager) return null
    const room = roomManager.getOrCreateDM(peerId, peerName)
    p2pBackend?.joinTopic(room.topic)
    return room
  })
  ipcMain.handle('create-group', (_e, name, memberIds) => {
    if (!roomManager) return null
    const room = roomManager.createGroup(name, memberIds)
    p2pBackend?.joinTopic(room.topic)
    for (const mid of memberIds) {
      p2pBackend?.sendInvite(room.topic, room.name, mid)
    }
    return room
  })
  ipcMain.handle('join-group', (_e, topic, name) => {
    if (!roomManager) return null
    const room = roomManager.joinGroup(topic, name)
    p2pBackend?.joinTopic(room.topic)
    return room
  })
  ipcMain.handle('leave-room', (_e, roomId) => {
    if (!roomManager) return false
    const topic = roomManager.leaveRoom(roomId)
    if (topic) p2pBackend?.leaveTopic(topic)
    return !!topic
  })
  ipcMain.handle('reset-unread', (_e, roomId) => roomManager?.resetUnread(roomId))

  // Contacts
  ipcMain.handle('get-contacts', () => contactList?.list() || [])
  ipcMain.handle('save-contact', (_e, peerId, name) => {
    contactList?.addContact(peerId, name, name)
    return true
  })
  ipcMain.handle('remove-contact', (_e, peerId) => contactList?.removeContact(peerId) || false)
  ipcMain.handle('rename-contact', (_e, peerId, newName) => contactList?.rename(peerId, newName) || false)
}

// ═══════════════════════════════════════════
//  Auto-Updater
// ═══════════════════════════════════════════

async function setupAutoUpdater() {
  if (isDev) return
  try {
    const { autoUpdater } = require('electron-updater')
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.logger = {
      info: (...args) => console.log('[Updater]', ...args),
      warn: (...args) => console.warn('[Updater]', ...args),
      error: (...args) => console.error('[Updater]', ...args),
      debug: (...args) => console.log('[Updater:debug]', ...args),
    }

    autoUpdater.on('checking-for-update', () => console.log('[Updater] Checking...'))
    autoUpdater.on('update-available', (info) => {
      console.log('[Updater] Update available:', info.version)
      if (mainWindow) mainWindow.webContents.send('update-available', {
        version: info.version, releaseNotes: info.releaseNotes
      })
    })
    autoUpdater.on('update-not-available', () => console.log('[Updater] Up to date'))
    autoUpdater.on('download-progress', (progress) => {
      console.log(`[Updater] Download: ${Math.round(progress.percent)}%`)
      if (mainWindow) mainWindow.webContents.send('update-progress', {
        percent: Math.round(progress.percent)
      })
    })
    autoUpdater.on('update-downloaded', () => {
      console.log('[Updater] Ready to install')
      if (mainWindow) mainWindow.webContents.send('update-downloaded')
    })
    autoUpdater.on('error', (err) => {
      console.error('[Updater]', err.message)
      if (mainWindow) mainWindow.webContents.send('update-error', { message: err.message })
    })

    ipcMain.on('download-update', async () => {
      try { await autoUpdater.downloadUpdate() }
      catch (e) {
        if (mainWindow) mainWindow.webContents.send('update-error', { message: e.message })
      }
    })
    ipcMain.on('install-update', () => autoUpdater.quitAndInstall())

    autoUpdater.checkForUpdates()
    setInterval(() => autoUpdater.checkForUpdates(), 30 * 60 * 1000)
  } catch (e) {
    console.log('Auto-updater not available:', e.message)
  }
}

// ═══════════════════════════════════════════
//  Startup
// ═══════════════════════════════════════════

app.whenReady().then(async () => {
  setupIPC()

  // Polyfill CustomEvent for Node 18 (Electron 28)
  if (typeof globalThis.CustomEvent === 'undefined') {
    globalThis.CustomEvent = class CustomEvent extends Event {
      constructor(type, params = {}) {
        super(type, params)
        this.detail = params.detail ?? null
      }
    }
  }

  try {
    // ─── Backbone Sync ───
    const bbModule = await import('./backbone-sync.mjs')
    backboneSync = new bbModule.BackboneSync(`electron-${Date.now()}`, 'EatPan Desktop')
    const bbOnline = await backboneSync.init()

    // ─── Seeder Module ───
    const seederModule = await import('./seeder.mjs')
    seeder = new seederModule.SeederMode()

    // ─── P2P Backend ───
    const p2pModule = await import('./p2p.mjs')
    p2pBackend = await p2pModule.createP2PBackend({
      onChat: (msg) => {
        if (mainWindow) mainWindow.webContents.send('chat-message', msg)
        seeder?.onMessage(msg)
        const topic = msg.room_topic || 'eatpan-chat'
        const room = roomManager?.findByTopic(topic)
        if (room) {
          roomManager.updateLastMessage(room.id, msg)
          if (mainWindow) mainWindow.webContents.send('room-update', room)
        }
      },
      onPeersUpdate: (peers) => {
        if (mainWindow) mainWindow.webContents.send('peers-update', peers)
        if (seeder?.active) {
          for (const [id, info] of Object.entries(peers)) {
            seeder.updatePeer(id, info)
          }
        }
        if (contactList) {
          for (const [id, info] of Object.entries(peers)) {
            contactList.updateLastSeen(id, info.name)
          }
        }
      },
      onConnected: (peerId) => {
        if (mainWindow) mainWindow.webContents.send('peer-connected', peerId)
      },
      onDisconnected: (peerId) => {
        if (mainWindow) mainWindow.webContents.send('peer-disconnected', peerId)
        seeder?.removePeer(peerId)
      },
      onInvite: (data) => {
        if (mainWindow) mainWindow.webContents.send('room-invite', data)
      },
    }, backboneSync)

    console.log('[Main] P2P Backend started')

    // ─── Rooms & Contacts ───
    const roomsModule = await import('./rooms.mjs')
    const contactsModule = await import('./contacts.mjs')
    roomManager = new roomsModule.RoomManager(app.getPath('userData'), p2pBackend.getStatus().peerId)
    contactList = new contactsModule.ContactList(app.getPath('userData'))

    for (const topic of roomManager.getAllTopics()) {
      p2pBackend.joinTopic(topic)
    }
    console.log(`[Main] Loaded ${roomManager.rooms.size} rooms`)

    // ─── Send history after window loads ───
    mainWindow?.webContents.once('did-finish-load', async () => {
      if (bbOnline) {
        const history = await backboneSync.loadHistory()
        if (history.length > 0) mainWindow.webContents.send('chat-history', history)
      }
    })
  } catch (e) {
    console.error('[Main] Startup error:', e.message, e.stack)
  }

  createWindow()
  setupAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  if (seeder) await seeder.destroy()
  if (backboneSync) await backboneSync.flush()
  if (backboneSync) backboneSync.destroy()
  if (p2pBackend) await p2pBackend.stop()
  if (process.platform !== 'darwin') app.quit()
})
