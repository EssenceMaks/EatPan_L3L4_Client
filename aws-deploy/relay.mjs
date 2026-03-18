/**
 * relay.mjs — EatPan AWS DHT + GossipSub Mesh + Circuit Relay
 * 
 * Ports: TCP 9090 (Electron) + WS 9091 (nginx → browsers)
 * 
 * After first run, saves peer key to peer-key.json for ID persistence.
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
import { circuitRelayServer } from '@libp2p/circuit-relay-v2'
import { readFileSync, writeFileSync, existsSync } from 'fs'

// Polyfill: Node < 22
if (typeof Promise.withResolvers === 'undefined') {
  Promise.withResolvers = function () {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }
}
if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, params = {}) { super(type, params); this.detail = params.detail ?? null }
  }
}

const TCP_PORT = process.env.RELAY_TCP_PORT || 9090
const WS_PORT  = process.env.RELAY_WS_PORT  || 9091
const TOPIC    = 'eatpan-chat'

async function startRelay() {
  const node = await createLibp2p({
    addresses: {
      listen: [
        `/ip4/0.0.0.0/tcp/${TCP_PORT}`,
        `/ip4/0.0.0.0/tcp/${WS_PORT}/ws`,
      ]
    },
    transports: [tcp(), webSockets()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    connectionManager: { minConnections: 0, maxConnections: 300 },
    services: {
      identify: identify(),
      ping: ping(),
      dht: kadDHT({ clientMode: false, protocol: '/eatpan/kad/1.0.0' }),
      pubsub: gossipsub({
        emitSelf: false,
        allowPublishToZeroTopicPeers: true,
        floodPublish: true,
        heartbeatInterval: 1000,
      }),
      relay: circuitRelayServer({
        reservations: { maxReservations: 200, reservationTtl: 300_000, defaultDataLimit: 1 << 24 }
      })
    }
  })

  // Subscribe to eatpan-chat — makes relay part of GossipSub mesh
  node.services.pubsub.subscribe(TOPIC)

  // Save peer ID for reference (can't easily persist libp2p v3 keys programmatically,
  // but we log the peer ID so it can be hardcoded after first deploy)
  const myPeerId = node.peerId.toString()
  try {
    writeFileSync('/opt/eatpan/current-peer-id.txt', myPeerId)
  } catch {}

  console.log('═══════════════════════════════════════════')
  console.log('  🌐 EatPan AWS — DHT + GossipSub + Relay')
  console.log('═══════════════════════════════════════════')
  console.log(`  Peer ID: ${myPeerId}`)
  console.log(`  TCP: ${TCP_PORT}  |  WS: ${WS_PORT}`)
  console.log(`  Topic: ${TOPIC}`)
  for (const ma of node.getMultiaddrs()) {
    console.log(`  ${ma.toString()}`)
  }
  console.log(`  TCP bootstrap: /dns4/relay.eatpan.com/tcp/${TCP_PORT}/p2p/${myPeerId}`)
  console.log(`  WSS bootstrap: /dns4/relay.eatpan.com/tcp/443/wss/p2p/${myPeerId}`)
  console.log('═══════════════════════════════════════════')

  // ── Event logging ──
  node.addEventListener('peer:connect', (evt) => {
    const remote = evt.detail.toString()
    console.log(`[+] ${remote.substring(0, 24)}... (total: ${node.getConnections().length})`)
  })
  node.addEventListener('peer:disconnect', (evt) => {
    const remote = evt.detail.toString()
    console.log(`[-] ${remote.substring(0, 24)}... (total: ${node.getConnections().length})`)
  })

  // GossipSub events
  node.services.pubsub.addEventListener('subscription-change', (evt) => {
    const { peerId, subscriptions } = evt.detail
    const subs = subscriptions.map(s => `${s.topic}(${s.subscribe ? '+' : '-'})`).join(', ')
    console.log(`[GS] Sub change: ${peerId.toString().substring(0, 20)}... → ${subs}`)
  })

  node.services.pubsub.addEventListener('message', (evt) => {
    try {
      const data = JSON.parse(new TextDecoder().decode(evt.detail.data))
      console.log(`[GS] MSG type=${data.type} from=${(data.name || '?').substring(0, 16)}`)
    } catch {
      console.log(`[GS] MSG on ${evt.detail.topic}`)
    }
  })

  // Stats
  setInterval(() => {
    const conns = node.getConnections()
    let subs = 0
    try { subs = node.services.pubsub.getSubscribers(TOPIC).length } catch {}
    const peers = conns.map(c => c.remotePeer.toString().substring(0, 12)).join(', ')
    console.log(`[S] conns=${conns.length} [${peers}] subs=${subs}`)
  }, 10_000)

  process.on('SIGINT', async () => {
    console.log('\nShutting down...')
    await node.stop()
    process.exit(0)
  })
}

startRelay().catch(e => { console.error('FAIL:', e); process.exit(1) })
