/**
 * relay.mjs — EatPan AWS Bootstrap Relay
 * 
 * Dual role:
 *   1. DHT Bootstrap (Phonebook) — server-mode Kademlia
 *   2. GossipSub Hub — subscribes to 'eatpan-chat' and bridges
 *      messages between TCP (Electron) and WebSocket (Browser) peers
 * 
 * Ports:
 *   - TCP 9090 — Electron L4/L2/L1 clients connect here
 *   - WS  9091 — Nginx proxies WSS (443) → here for browser chat
 * 
 * Deploy:  scp relay.mjs ec2-user@relay.eatpan.com:/opt/eatpan/relay.mjs
 *          sudo systemctl restart eatpan-relay
 */

import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identify } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { kadDHT } from '@libp2p/kad-dht'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { readFileSync, existsSync } from 'fs'

// Polyfill: Node 18 doesn't have CustomEvent
if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, params = {}) {
      super(type, params)
      this.detail = params.detail ?? null
    }
  }
}

const TCP_PORT = process.env.RELAY_TCP_PORT || 9090
const WS_PORT  = process.env.RELAY_WS_PORT  || 9091
const TOPIC    = 'eatpan-chat'

async function startRelay() {
  // Load persistent peer ID if available (optional — generates new if fails)
  let peerId
  const keyPath = process.env.KEY_PATH || '/opt/eatpan/relay-key.json'
  if (existsSync(keyPath)) {
    try {
      const { createFromJSON } = await import('@libp2p/peer-id-factory')
      const keyData = JSON.parse(readFileSync(keyPath, 'utf-8'))
      peerId = await createFromJSON(keyData)
      console.log(`[Relay] Loaded peer ID: ${peerId.toString().substring(0, 20)}...`)
    } catch (e) {
      console.log(`[Relay] Could not load peer ID (${e.message}), generating new one`)
    }
  }

  const config = {
    addresses: {
      listen: [
        `/ip4/0.0.0.0/tcp/${TCP_PORT}`,
        `/ip4/0.0.0.0/tcp/${WS_PORT}/ws`,
      ]
    },
    transports: [tcp(), webSockets()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    connectionManager: {
      minConnections: 0,
      maxConnections: 200,
    },
    services: {
      identify: identify(),
      ping: ping(),
      dht: kadDHT({
        clientMode: false,
        protocol: '/eatpan/kad/1.0.0'
      }),
      pubsub: gossipsub({
        emitSelf: false,
        allowPublishToZeroTopicPeers: true,
        floodPublish: true,           // forward all messages to all peers
        heartbeatInterval: 1000,
        doPX: true,                   // peer exchange — helps peers find each other
      })
    }
  }

  if (peerId) config.peerId = peerId

  const node = await createLibp2p(config)

  // Subscribe to chat topic — this makes the relay a GossipSub mesh member
  // so messages from Electron (TCP) peers get forwarded to Browser (WS) peers
  node.services.pubsub.subscribe(TOPIC)

  const myPeerId = node.peerId.toString()

  console.log('═══════════════════════════════════════════')
  console.log('  🌐 EatPan AWS Bootstrap Relay')
  console.log('═══════════════════════════════════════════')
  console.log(`  Peer ID: ${myPeerId}`)
  console.log(`  TCP: ${TCP_PORT} (Electron clients)`)
  console.log(`  WS:  ${WS_PORT} (nginx WSS proxy → browsers)`)
  console.log(`  GossipSub topic: ${TOPIC}`)
  console.log('')
  console.log('  Multiaddrs:')
  for (const ma of node.getMultiaddrs()) {
    console.log(`    ${ma.toString()}`)
  }
  console.log('═══════════════════════════════════════════')

  // ─── Connection tracking ───
  let tcpConns = 0
  let wsConns = 0

  node.addEventListener('peer:connect', (evt) => {
    const remote = evt.detail.toString()
    const conns = node.getConnections(evt.detail)
    let isWs = false
    for (const c of conns) {
      if (c.remoteAddr.toString().includes('/ws/')) isWs = true
    }
    if (isWs) wsConns++; else tcpConns++
    console.log(`[Relay] + ${isWs ? 'WS' : 'TCP'} ${remote.substring(0, 20)}... (tcp=${tcpConns} ws=${wsConns})`)
  })

  node.addEventListener('peer:disconnect', (evt) => {
    const remote = evt.detail.toString()
    // We can't easily tell which disconnected, just decrement total
    const totalConns = node.getConnections().length
    console.log(`[Relay] - Disconnected ${remote.substring(0, 20)}... (total=${totalConns})`)
  })

  // ─── GossipSub message logging ───
  let msgCount = 0
  node.services.pubsub.addEventListener('message', (evt) => {
    msgCount++
    try {
      const data = JSON.parse(new TextDecoder().decode(evt.detail.data))
      if (data.type === 'chat') {
        console.log(`[GossipSub] #${msgCount} ${data.from}: "${(data.text || '').substring(0, 50)}" → ${evt.detail.topic}`)
      } else {
        console.log(`[GossipSub] #${msgCount} type=${data.type} from=${(data.name || data.peerId || '?').substring(0, 16)}`)
      }
    } catch {
      console.log(`[GossipSub] #${msgCount} (binary/malformed)`)
    }
  })

  // ─── Stats every 60s ───
  setInterval(() => {
    const conns = node.getConnections()
    const topics = node.services.pubsub.getTopics()
    const subscribers = node.services.pubsub.getSubscribers(TOPIC)
    console.log(`[Relay] Connections: ${conns.length} | Topics: ${topics.join(',')} | Subscribers: ${subscribers.length} | Messages: ${msgCount}`)
  }, 60_000)

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Relay] Shutting down...')
    await node.stop()
    process.exit(0)
  })
}

startRelay().catch((e) => {
  console.error('Relay failed to start:', e)
  process.exit(1)
})
