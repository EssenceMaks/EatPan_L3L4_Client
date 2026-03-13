/**
 * Preload Script (CommonJS) — безпечний міст між Electron і Renderer
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('eatpan', {
  // Chat
  sendMessage: (text, topic) => ipcRenderer.send('send-message', text, topic),
  onChatMessage: (cb) => ipcRenderer.on('chat-message', (_e, msg) => cb(msg)),

  // Peers
  onPeersUpdate: (cb) => ipcRenderer.on('peers-update', (_e, peers) => cb(peers)),
  onPeerConnected: (cb) => ipcRenderer.on('peer-connected', (_e, id) => cb(id)),
  onPeerDisconnected: (cb) => ipcRenderer.on('peer-disconnected', (_e, id) => cb(id)),

  // Status
  getStatus: () => ipcRenderer.invoke('get-status'),

  // Updates
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, info) => cb(info)),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (_e, p) => cb(p)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', () => cb()),
  onUpdateError: (cb) => ipcRenderer.on('update-error', (_e, err) => cb(err)),
  downloadUpdate: () => ipcRenderer.send('download-update'),
  installUpdate: () => ipcRenderer.send('install-update'),

  // L2 Backbone
  onChatHistory: (cb) => ipcRenderer.on('chat-history', (_e, msgs) => cb(msgs)),
  backboneStatus: () => ipcRenderer.invoke('backbone-status'),
  backboneFlush: () => ipcRenderer.send('backbone-flush'),

  // L3 Cluster Mode
  checkDocker: () => ipcRenderer.invoke('check-docker'),
  modeStatus: () => ipcRenderer.invoke('mode-status'),
  upgradeToL3: () => ipcRenderer.invoke('upgrade-to-l3'),
  downgradeToL4: () => ipcRenderer.invoke('downgrade-to-l4'),
  clusterStats: () => ipcRenderer.invoke('cluster-stats'),
  onModeChanged: (cb) => ipcRenderer.on('mode-changed', (_e, s) => cb(s)),

  // Rooms
  getRooms: () => ipcRenderer.invoke('get-rooms'),
  createDM: (peerId, peerName) => ipcRenderer.invoke('create-dm', peerId, peerName),
  createGroup: (name, memberIds) => ipcRenderer.invoke('create-group', name, memberIds),
  joinGroup: (topic, name) => ipcRenderer.invoke('join-group', topic, name),
  leaveRoom: (roomId) => ipcRenderer.invoke('leave-room', roomId),
  resetUnread: (roomId) => ipcRenderer.invoke('reset-unread', roomId),
  onRoomUpdate: (cb) => ipcRenderer.on('room-update', (_e, room) => cb(room)),
  onRoomInvite: (cb) => ipcRenderer.on('room-invite', (_e, data) => cb(data)),

  // Contacts
  getContacts: () => ipcRenderer.invoke('get-contacts'),
  saveContact: (peerId, name) => ipcRenderer.invoke('save-contact', peerId, name),
  removeContact: (peerId) => ipcRenderer.invoke('remove-contact', peerId),
  renameContact: (peerId, newName) => ipcRenderer.invoke('rename-contact', peerId, newName),
})
