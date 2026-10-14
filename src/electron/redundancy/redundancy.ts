// ----- FreeShow Church -----
// Redundancy: a BACKUP computer mirrors a MASTER computer in real time (slides, media, setlists, songs...).
//
// This is the network side (main process). The frontend decides WHAT to sync (church/redundancy/*).
// - master: socket.io server (port 5520) + a UDP beacon (port 5521) so backups find it automatically,
//           serves media files a backup is missing (only files it has synced, only with the pairing code)
// - backup: listens for beacons (or uses a fixed address), connects, translates media paths to local
//           files (downloading missing ones), and hands every message to the frontend
// - heartbeat every 250 ms; a backup that hears nothing for a while reports the master as lost and can take over
// - two masters with the same pairing code: the one that became master last wins, the other turns into a backup

import { app } from "electron"
import crypto from "crypto"
import dgram from "dgram"
import fs from "fs"
import http from "http"
import os from "os"
import path from "path"
import { Server, type Socket } from "socket.io"
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client"
import { Main } from "../../types/IPC/Main"
import { config } from "../data/store"
import { sendMain } from "../IPC/main"

export type RedundancyRole = "off" | "master" | "backup"
export interface RedundancySettings {
    role: RedundancyRole
    code: string // pairing code (both computers must use the same)
    name: string // this computer's name as shown to the other one
    masterAddress: string // backup: fixed master IP ("" = find automatically)
    autoTakeover: boolean
    takeoverSeconds: number
    muteBackupAudio: boolean
    epoch: number // when this computer last became master (newest master wins)
}

const PORT = 5520
const BEACON_PORT = 5521
const HEARTBEAT_MS = 250
const BEACON_MS = 1000

const DEFAULTS: RedundancySettings = { role: "off", code: "", name: "", masterAddress: "", autoTakeover: false, takeoverSeconds: 3, muteBackupAudio: true, epoch: 0 }

let settings: RedundancySettings = { ...DEFAULTS }

export function getRedundancySettings(): RedundancySettings {
    return settings
}
export function isRedundancyBackup() {
    return settings.role === "backup"
}

function loadSettings() {
    const stored = (config.get("redundancy" as any) || {}) as Partial<RedundancySettings>
    settings = { ...DEFAULTS, ...stored }
    if (!settings.name) settings.name = os.hostname().replace(/\.local$/, "")
}
function saveSettings() {
    config.set("redundancy" as any, settings as any)
}

const keyOf = (code: string) => crypto.createHash("sha256").update("freeshow-redundancy:" + (code || "")).digest("hex")
const shortKey = () => keyOf(settings.code).slice(0, 12)

// ---------------- status (shown in the app) ----------------

interface Status {
    role: RedundancyRole
    state: "off" | "waiting" | "connected" | "searching" | "connecting" | "lost" | "error"
    name: string
    peers: { name: string; address: string; latency: number }[] // master: connected backups
    master: { name: string; address: string; latency: number; lastSeen: number } | null // backup: followed master
    masters: { name: string; address: string; epoch: number }[] // backup: masters seen on the network
    error: string
    downloads: number
    settings: RedundancySettings
}

let state: Status["state"] = "off"
let errorText = ""
let statusTimer: NodeJS.Timeout | null = null

export function getRedundancyStatus(): Status {
    return {
        role: settings.role,
        state,
        name: settings.name,
        peers: Array.from(peers.values()).map((p) => ({ name: p.name, address: p.address, latency: Math.round(p.latency) })),
        master: master ? { name: master.name, address: master.address, latency: Math.round(master.latency), lastSeen: master.lastSeen } : null,
        masters: Array.from(seenMasters.values())
            .filter((m) => Date.now() - m.seen < 5000)
            .map((m) => ({ name: m.name, address: m.address, epoch: m.epoch })),
        error: errorText,
        downloads: downloadQueue.length + activeDownloads,
        settings: { ...settings, code: settings.code }
    }
}

function pushStatus() {
    // (not while the main window is (re)loading - Electron logs an error for every message then)
    try {
        const { mainWindow } = require("..")
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) return
    } catch {
        return
    }
    sendMain(Main.REDUNDANCY_STATUS, getRedundancyStatus())
}

// ---------------- lifecycle ----------------

let started = false
export function startRedundancy() {
    if (started) return
    started = true
    loadSettings()
    applyRole()
    statusTimer = setInterval(pushStatus, 1000)
}

export function stopRedundancy() {
    stopMaster()
    stopBackup()
    stopBeacon()
    if (statusTimer) clearInterval(statusTimer)
}

export function setRedundancySettings(changes: Partial<RedundancySettings>) {
    const before = { ...settings }
    settings = { ...settings, ...changes }
    if (changes.role === "master" && before.role !== "master") settings.epoch = Date.now()
    saveSettings()

    const restart = before.role !== settings.role || before.code !== settings.code || before.masterAddress !== settings.masterAddress || before.name !== settings.name
    if (restart) applyRole()
    pushStatus()
    return getRedundancyStatus()
}

/** backup -> master, right now */
export function takeOver() {
    if (settings.role === "master") return getRedundancyStatus()
    console.info("Redundancy: taking over as master")
    settings.role = "master"
    settings.epoch = Date.now()
    saveSettings()
    applyRole()
    pushStatus()
    return getRedundancyStatus()
}

function applyRole() {
    stopMaster()
    stopBackup()
    stopBeacon()
    errorText = ""

    if (settings.role === "off" || !settings.code) {
        state = "off"
        if (settings.role !== "off" && !settings.code) errorText = "Set a pairing code first"
        return
    }

    startBeacon()
    if (settings.role === "master") startMaster()
    else startBackup()
}

// ---------------- UDP beacon (discovery) ----------------

let beaconSocket: dgram.Socket | null = null
let beaconTimer: NodeJS.Timeout | null = null
const seenMasters: Map<string, { name: string; address: string; port: number; epoch: number; seen: number }> = new Map()

function startBeacon() {
    try {
        const socket = dgram.createSocket({ type: "udp4", reuseAddr: true })
        beaconSocket = socket
        socket.on("error", (err) => console.warn("Redundancy beacon:", err.message))
        socket.on("message", (buffer, rinfo) => onBeacon(buffer, rinfo))
        socket.bind(BEACON_PORT, () => {
            try {
                socket.setBroadcast(true)
            } catch {}
        })
    } catch (err) {
        console.warn("Redundancy beacon:", err)
    }

    if (settings.role === "master") {
        beaconTimer = setInterval(sendBeacon, BEACON_MS)
        sendBeacon()
    }
}

function stopBeacon() {
    if (beaconTimer) clearInterval(beaconTimer)
    beaconTimer = null
    try {
        beaconSocket?.close()
    } catch {}
    beaconSocket = null
    seenMasters.clear()
}

function broadcastAddresses() {
    const list = new Set<string>(["255.255.255.255"])
    Object.values(os.networkInterfaces()).forEach((nets) => {
        ;(nets || []).forEach((net) => {
            if (net.family !== "IPv4" || net.internal || !net.netmask) return
            const ip = net.address.split(".").map(Number)
            const mask = net.netmask.split(".").map(Number)
            list.add(ip.map((part, i) => (part & mask[i]) | (~mask[i] & 255)).join("."))
        })
    })
    list.add("127.0.0.1") // a backup on the same computer (testing)
    return Array.from(list)
}

function sendBeacon() {
    if (!beaconSocket || settings.role !== "master") return
    const message = Buffer.from(JSON.stringify({ app: "freeshow-redundancy", v: 1, key: shortKey(), name: settings.name, port: PORT, epoch: settings.epoch, id: instanceId }))
    broadcastAddresses().forEach((address) => {
        try {
            beaconSocket?.send(message, BEACON_PORT, address)
        } catch {}
    })
}

const instanceId = crypto.randomBytes(6).toString("hex")

function onBeacon(buffer: Buffer, rinfo: dgram.RemoteInfo) {
    let data: any
    try {
        data = JSON.parse(buffer.toString())
    } catch {
        return
    }
    if (data?.app !== "freeshow-redundancy" || data.key !== shortKey() || data.id === instanceId) return

    const address = rinfo.address
    seenMasters.set(data.id, { name: data.name || address, address, port: data.port || PORT, epoch: Number(data.epoch) || 0, seen: Date.now() })

    // another master with a newer claim: this one steps down and follows it (never two masters)
    if (settings.role === "master" && Number(data.epoch) > settings.epoch) {
        console.warn(`Redundancy: ${data.name} became master after this computer - switching to backup`)
        settings.role = "backup"
        saveSettings()
        applyRole()
        sendMain(Main.REDUNDANCY_RECEIVE, { t: "local", event: "demoted", by: data.name })
        pushStatus()
        return
    }

    if (settings.role === "backup") maybeConnect()
}

// ---------------- MASTER ----------------

let httpServer: http.Server | null = null
let ioServer: Server | null = null
let heartbeatTimer: NodeJS.Timeout | null = null
let heartbeatSeq = 0
const peers: Map<string, { name: string; address: string; latency: number; socket: Socket }> = new Map()
const servedPaths: Set<string> = new Set()

function startMaster() {
    state = "waiting"
    const key = keyOf(settings.code)

    httpServer = http.createServer((req, res) => {
        try {
            const url = new URL(req.url || "/", "http://localhost")
            if (url.pathname !== "/redundancy/media") return // socket.io handles its own path
            const file = url.searchParams.get("path") || ""
            if (url.searchParams.get("key") !== key || !servedPaths.has(file) || !fs.existsSync(file)) {
                res.writeHead(404)
                res.end()
                return
            }
            const stat = fs.statSync(file)
            res.writeHead(200, { "Content-Length": stat.size, "Content-Type": "application/octet-stream" })
            fs.createReadStream(file).pipe(res)
        } catch {
            res.writeHead(500)
            res.end()
        }
    })

    ioServer = new Server(httpServer, { cors: { origin: "*" }, maxHttpBufferSize: 64 * 1024 * 1024, pingInterval: 2000, pingTimeout: 4000 })
    ioServer.use((socket, next) => {
        if (socket.handshake.auth?.key !== key) return next(new Error("Wrong pairing code"))
        next()
    })
    ioServer.on("connection", (socket) => {
        const address = (socket.handshake.address || "").replace("::ffff:", "")
        const name = String(socket.handshake.auth?.name || address)
        peers.set(socket.id, { name, address, latency: 0, socket })
        console.info(`Redundancy: backup "${name}" connected (${address})`)
        state = "connected"
        socket.emit("hello", { name: settings.name, epoch: settings.epoch })
        // the frontend sends a full snapshot to everyone (it's cheap and keeps all backups identical)
        sendMain(Main.REDUNDANCY_SNAPSHOT_REQUEST, { peer: name })

        socket.on("pong-check", (sentAt: number) => {
            const peer = peers.get(socket.id)
            if (peer) peer.latency = (Date.now() - sentAt) / 2
        })
        socket.on("rtt", (sentAt: number, ack: (value: number) => void) => {
            if (typeof ack === "function") ack(sentAt)
        })
        socket.on("request-snapshot", () => sendMain(Main.REDUNDANCY_SNAPSHOT_REQUEST, { peer: name }))
        socket.on("disconnect", () => {
            peers.delete(socket.id)
            console.info(`Redundancy: backup "${name}" disconnected`)
            if (!peers.size) state = "waiting"
            pushStatus()
        })
        pushStatus()
    })

    httpServer.on("error", (err: any) => {
        errorText = err?.code === "EADDRINUSE" ? `Port ${PORT} is already in use (is another master running on this computer?)` : String(err?.message || err)
        state = "error"
        console.warn("Redundancy:", errorText)
        pushStatus()
    })
    httpServer.listen(PORT)

    heartbeatTimer = setInterval(() => {
        heartbeatSeq++
        ioServer?.emit("hb", { seq: heartbeatSeq, at: Date.now() })
        if (heartbeatSeq % 4 === 0) ioServer?.emit("ping-check", Date.now())
    }, HEARTBEAT_MS)

    console.info(`Redundancy: master "${settings.name}" on port ${PORT}`)
}

function stopMaster() {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    heartbeatTimer = null
    peers.clear()
    try {
        ioServer?.close()
    } catch {}
    try {
        httpServer?.close()
    } catch {}
    ioServer = null
    httpServer = null
    servedPaths.clear()
}

/** master: a message from the frontend for every backup */
export function redundancySend(message: any) {
    // backup frontend (re)started: ask the master for everything
    if (settings.role === "backup" && message?.t === "request-snapshot") {
        client?.emit("request-snapshot")
        return
    }
    if (settings.role !== "master" || !ioServer) return
    collectPaths(message, servedPaths)
    if (!peers.size) return
    ioServer.emit("m", message)
}

// ---------------- BACKUP ----------------

let client: ClientSocket | null = null
let connectedTo = ""
let master: { name: string; address: string; latency: number; lastSeen: number } | null = null
let lostTimer: NodeJS.Timeout | null = null
let lostReported = false

function startBackup() {
    state = "searching"
    if (settings.masterAddress) connectTo(settings.masterAddress, PORT, settings.masterAddress)
    lostTimer = setInterval(checkLost, 250)
}

function stopBackup() {
    if (lostTimer) clearInterval(lostTimer)
    lostTimer = null
    disconnectClient()
    master = null
    lostReported = false
}

function disconnectClient() {
    try {
        client?.removeAllListeners()
        client?.disconnect()
    } catch {}
    client = null
    connectedTo = ""
}

function maybeConnect() {
    if (settings.masterAddress) return // fixed address
    // follow the newest master that is still announcing itself
    const best = Array.from(seenMasters.values())
        .filter((m) => Date.now() - m.seen < 5000)
        .sort((a, b) => b.epoch - a.epoch)[0]
    if (!best) return
    const target = `${best.address}:${best.port}`
    if (connectedTo === target && client) return
    // don't drop a working connection for an older/equal master
    if (client?.connected && master && Date.now() - master.lastSeen < 1500) {
        const current = Array.from(seenMasters.values()).find((m) => `${m.address}:${m.port}` === connectedTo)
        if (current && current.epoch >= best.epoch) return
    }
    connectTo(best.address, best.port, best.name)
}

function connectTo(address: string, port: number, name: string) {
    disconnectClient()
    connectedTo = `${address}:${port}`
    state = "connecting"
    console.info(`Redundancy: connecting to master ${name} (${address})`)

    const socket = ioClient(`http://${address}:${port}`, { auth: { key: keyOf(settings.code), name: settings.name }, reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 2000, timeout: 3000, transports: ["websocket"] })
    client = socket

    socket.on("connect", () => {
        errorText = ""
        state = "connected"
        master = { name, address, latency: 0, lastSeen: Date.now() }
        lostReported = false
        pushStatus()
    })
    socket.on("connect_error", (err: any) => {
        errorText = String(err?.message || err)
        if (errorText.includes("pairing")) state = "error"
        pushStatus()
    })
    socket.on("hello", (data: any) => {
        if (master) master.name = data?.name || master.name
        sendMain(Main.REDUNDANCY_RECEIVE, { t: "local", event: "connected", name: master?.name })
    })
    socket.on("hb", () => {
        if (!master) return
        master.lastSeen = Date.now()
        if (lostReported) {
            lostReported = false
            state = "connected"
            sendMain(Main.REDUNDANCY_RECEIVE, { t: "local", event: "back" })
            pushStatus()
        }
    })
    socket.on("ping-check", (sentAt: number) => socket.emit("pong-check", sentAt))
    socket.on("m", (message: any) => {
        if (master) master.lastSeen = Date.now()
        sendMain(Main.REDUNDANCY_RECEIVE, translatePaths(message))
    })
}

let lastRtt = 0
function checkLost() {
    if (settings.role !== "backup" || !master) return

    // round trip to the master, measured with this computer's clock only
    if (client?.connected && Date.now() - lastRtt > 1000) {
        lastRtt = Date.now()
        const sentAt = Date.now()
        client.timeout(2000).emit("rtt", sentAt, (err: any) => {
            if (!err && master) master.latency = (Date.now() - sentAt) / 2
        })
    }

    const silentFor = Date.now() - master.lastSeen
    if (silentFor < Math.max(1, settings.takeoverSeconds) * 1000) return
    if (lostReported) return
    lostReported = true
    state = "lost"
    console.warn(`Redundancy: master "${master.name}" lost (${Math.round(silentFor)} ms without heartbeat)`)
    sendMain(Main.REDUNDANCY_RECEIVE, { t: "local", event: "lost", name: master.name, autoTakeover: settings.autoTakeover })
    if (settings.autoTakeover) takeOver()
    pushStatus()
}

// ---------------- media paths ----------------

const MEDIA_EXT = /\.(mp4|mov|m4v|webm|mkv|avi|wmv|mpg|mpeg|mts|m2ts|ogv|jpg|jpeg|png|gif|webp|bmp|tif|tiff|heic|avif|svg|mp3|wav|m4a|aac|ogg|flac|opus|wma|pdf|pptx?|key)$/i
const isAbsolutePath = (value: string) => value.length < 1024 && (value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\"))
const looksLikeMedia = (value: string) => isAbsolutePath(value) && MEDIA_EXT.test(value)

function walkStrings(value: any, visit: (s: string) => string | void, depth = 0): any {
    if (depth > 40 || value === null || value === undefined) return value
    if (typeof value === "string") {
        const replaced = visit(value)
        return replaced === undefined ? value : replaced
    }
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) value[i] = walkStrings(value[i], visit, depth + 1)
        return value
    }
    if (typeof value === "object") {
        Object.keys(value).forEach((k) => {
            const item = walkStrings(value[k], visit, depth + 1)
            // keys can be media paths too (e.g. per-file media settings)
            const newKey = looksLikeMedia(k) ? visit(k) : undefined
            if (typeof newKey === "string" && newKey !== k) {
                delete value[k]
                value[newKey] = item
            } else value[k] = item
        })
    }
    return value
}

function collectPaths(message: any, into: Set<string>) {
    // (only reads - walkStrings returns the same value when visit returns nothing)
    walkStrings(message, (s) => {
        if (looksLikeMedia(s)) into.add(s)
    })
}

const pathCache: Map<string, string> = new Map()
const mirrorFolder = () => path.join(app.getPath("userData"), "redundancy-media")
const mirrorPath = (remote: string) => path.join(mirrorFolder(), crypto.createHash("sha1").update(remote).digest("hex").slice(0, 12) + "-" + path.basename(remote.replace(/\\/g, "/")))

function translatePaths(message: any) {
    return walkStrings(message, (s) => {
        if (!looksLikeMedia(s)) return
        const cached = pathCache.get(s)
        if (cached && (cached === s || fs.existsSync(cached))) return cached

        // same file at the same place (shared drive / same folder layout)
        if (fs.existsSync(s)) {
            pathCache.set(s, s)
            return s
        }
        const local = mirrorPath(s)
        if (fs.existsSync(local)) {
            pathCache.set(s, local)
            return local
        }
        queueDownload(s, local)
        return local
    })
}

const downloadQueue: { remote: string; local: string }[] = []
const queued: Set<string> = new Set()
const missingOnMaster: Set<string> = new Set() // the master doesn't have it either - don't keep asking
let activeDownloads = 0

function queueDownload(remote: string, local: string) {
    if (queued.has(remote) || missingOnMaster.has(remote)) return
    queued.add(remote)
    downloadQueue.push({ remote, local })
    pumpDownloads()
}

function pumpDownloads() {
    while (activeDownloads < 2 && downloadQueue.length) {
        const job = downloadQueue.shift()!
        activeDownloads++
        download(job.remote, job.local)
            .then(() => {
                pathCache.set(job.remote, job.local)
                sendMain(Main.REDUNDANCY_MEDIA_READY, { remote: job.remote, local: job.local })
            })
            .catch((err) => {
                const message = String(err?.message || err)
                if (message === "HTTP 404") {
                    missingOnMaster.add(job.remote)
                    console.info(`Redundancy: ${job.remote} is not on the master either`)
                    // the master may get it later (it is asked again when it shows it)
                    setTimeout(() => missingOnMaster.delete(job.remote), 5 * 60 * 1000)
                } else console.warn(`Redundancy: could not copy ${job.remote}:`, message)
                setTimeout(() => queued.delete(job.remote), 15000)
            })
            .finally(() => {
                activeDownloads--
                pumpDownloads()
            })
    }
}

function download(remote: string, local: string): Promise<void> {
    return new Promise((resolve, reject) => {
        if (!master) return reject(new Error("no master"))
        fs.mkdirSync(path.dirname(local), { recursive: true })
        const temp = local + ".part"
        const url = `http://${master.address}:${PORT}/redundancy/media?path=${encodeURIComponent(remote)}&key=${keyOf(settings.code)}`
        const req = http.get(url, (res) => {
            if (res.statusCode !== 200) {
                res.resume()
                return reject(new Error("HTTP " + res.statusCode))
            }
            const out = fs.createWriteStream(temp)
            res.pipe(out)
            out.on("finish", () => {
                out.close()
                try {
                    fs.renameSync(temp, local)
                    resolve()
                } catch (err) {
                    reject(err)
                }
            })
            out.on("error", reject)
        })
        req.on("error", reject)
        req.setTimeout(30000, () => req.destroy(new Error("timeout")))
    })
}
