/**
 * relay.mjs — EatPan AWS DHT + GossipSub Mesh Node
 * 
 * Roles:
 *   1. DHT Server (Phonebook) — peers register, discover each other
 *   2. GossipSub Mesh Member — enables message forwarding between peers
 *      that are connected to this relay but NOT to each other
 *   3. Circuit Relay Server — optional NAT traversal bridge
 * 
 * How messaging works:
 *   - Peer A (Electron/TCP) connects to relay
 *   - Peer B (Browser/WSS) connects to relay
 *   - Both subscribe to 'eatpan-chat' topic
 *   - GossipSub sees: A ↔ Relay ↔ B (mesh formed)
 *   - A publishes → relay forwards to B (standard GossipSub)
 *   - Relay does NOT "process" messages — GossipSub handles it
 * 
 * This is standard libp2p P2P networking — the relay is just
 * another peer in the mesh, like any L4 node would be.
 * 
 * Ports:
 *   - TCP 9090 — Electron L4/L2/L1 clients
 *   - WS  9091 — nginx WSS (443) proxy → browsers
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
    connectionManager: {
      minConnections: 0,
      maxConnections: 300,
    },
    services: {
      identify: identify(),
      ping: ping(),
      // DHT in server mode — phonebook
      dht: kadDHT({
        clientMode: false,
        protocol: '/eatpan/kad/1.0.0'
      }),
      // GossipSub — mesh member for message forwarding between peers
      pubsub: gossipsub({
        emitSelf: false,
        allowPublishToZeroTopicPeers: true,
        floodPublish: true,
        heartbeatInterval: 1000,
      }),
      // Circuit Relay — helps NAT'd peers reach each other
      relay: circuitRelayServer({
        reservations: {
          maxReservations: 200,
          reservationTtl: 300_000,
          defaultDataLimit: 1 << 24,
        }
      })
    }
  })

  // Subscribe to chat topic — makes relay part of GossipSub mesh
  node.services.pubsub.subscribe(TOPIC)

  const myPeerId = node.peerId.toString()

  console.log('═══════════════════════════════════════════')
  console.log('  🌐 EatPan AWS — DHT + GossipSub + Relay')
  console.log('═══════════════════════════════════════════')
  console.log(`  Peer ID: ${myPeerId}`)
  console.log(`  TCP: ${TCP_PORT}  (Electron)`)
  console.log(`  WS:  ${WS_PORT}  (nginx WSS → browsers)`)
  console.log(`  GossipSub topic: ${TOPIC}`)
  console.log('')
  console.log('  Multiaddrs:')
  for (const ma of node.getMultiaddrs()) {
    console.log(`    ${ma.toString()}`)
  }
  console.log('')
  console.log(`  Bootstrap addr for clients:`)
  console.log(`    TCP: /dns4/relay.eatpan.com/tcp/${TCP_PORT}/p2p/${myPeerId}`)
  console.log(`    WSS: /dns4/relay.eatpan.com/tcp/443/wss/p2p/${myPeerId}`)
  console.log('═══════════════════════════════════════════')

  // Connection tracking
  node.addEventListener('peer:connect', (evt) => {
    const remote = evt.detail.toString()
    console.log(`[Relay] + ${remote.substring(0, 24)}... (total: ${node.getConnections().length})`)
  })
  node.addEventListener('peer:disconnect', (evt) => {
    const remote = evt.detail.toString()
    console.log(`[Relay] - ${remote.substring(0, 24)}... (total: ${node.getConnections().length})`)
  })

  // Stats every 60s
  setInterval(() => {
    const subs = node.services.pubsub.getSubscribers(TOPIC)
    console.log(`[Relay] Conns: ${node.getConnections().length} | Topic subscribers: ${subs.length}`)
  }, 60_000)

  process.on('SIGINT', async () => {
    console.log('\n[Relay] Shutting down...')
    await node.stop()
    process.exit(0)
  })
}

startRelay().catch((e) => {
  console.error('Relay failed:', e)
  process.exit(1)
})
