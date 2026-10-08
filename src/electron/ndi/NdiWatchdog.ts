// ----- FreeShow Church -----
// Keeps NDI senders healthy during long services (hours, often over Wi-Fi):
// - capture loop stalled (no frame for a while)          -> restart the capture loop
// - a native NDI send never finished                      -> recreate the sender
// - a receiver dropped and did not come back              -> recreate the sender (fresh listener for reconnects)
// - network changed (Wi-Fi reconnect, new IP, wake/unlock) -> recreate all senders
// - App Nap / app suspension while sending                 -> prevented
// Every action is logged (console + ndi-watchdog.log in the app's log folder) for diagnosing long runs.

import { app, powerMonitor, powerSaveBlocker } from "electron"
import fs from "fs"
import os from "os"
import path from "path"
import { CaptureHelper } from "../capture/CaptureHelper"
import { NdiSender } from "./NdiSender"

const CHECK_INTERVAL_MS = 2000
const CAPTURE_STALL_MS = 6000 // no captured frame for this long -> restart capture
const SEND_STUCK_MS = 5000 // one video send taking this long -> sender is wedged
const RECONNECT_GRACE_MS = 20000 // receiver gone this long -> recreate the sender once
const NETWORK_SETTLE_MS = 3000
const MIN_RECREATE_GAP_MS = 15000 // never recreate the same sender more often than this

interface SenderHealth {
    hadConnection: boolean
    lostAt: number
    recreatedForLoss: boolean
    lastRecreate: number
}

const health: { [id: string]: SenderHealth } = {}
let started = false
let networkSignature = ""
let networkTimer: NodeJS.Timeout | null = null
let blockerId: number | null = null

export function startNdiWatchdog() {
    if (started) return
    started = true

    networkSignature = getNetworkSignature()
    setInterval(check, CHECK_INTERVAL_MS)

    powerMonitor.on("resume", () => scheduleRecreateAll("system resumed from sleep"))
    powerMonitor.on("unlock-screen", () => scheduleRecreateAll("screen unlocked"))
}

function check() {
    const now = Date.now()
    const ids = Object.keys(NdiSender.NDI)

    // keep macOS from napping/suspending the app while NDI is being sent
    updatePowerBlocker(ids.length > 0)

    // network changed?
    const signature = getNetworkSignature()
    if (signature !== networkSignature) {
        log(`network changed (${networkSignature || "none"} -> ${signature || "none"})`)
        networkSignature = signature
        scheduleRecreateAll("network changed")
    }

    ids.forEach((id) => {
        const sender = NdiSender.NDI[id]
        if (!sender?.sender) return
        const h = (health[id] = health[id] || { hadConnection: false, lostAt: 0, recreatedForLoss: false, lastRecreate: 0 })

        // 1. capture loop stalled
        const lastCapture = CaptureHelper.Lifecycle.getLastFrameTime(id)
        if (lastCapture && now - lastCapture > CAPTURE_STALL_MS) {
            log(`${sender.name}: no frame captured for ${Math.round((now - lastCapture) / 1000)}s - restarting capture`)
            CaptureHelper.Lifecycle.restartCaptureLoop(id)
        }

        // 2. a send never finished
        if (sender.sendingVideo && sender.videoSendStartedAt && now - sender.videoSendStartedAt > SEND_STUCK_MS) {
            recreate(id, `video send stuck for ${Math.round((now - sender.videoSendStartedAt) / 1000)}s`)
            return
        }

        // 3. receiver dropped and did not come back
        const connections = Number(sender.connections || 0)
        if (connections > 0) {
            h.hadConnection = true
            h.lostAt = 0
            h.recreatedForLoss = false
        } else if (h.hadConnection) {
            if (!h.lostAt) {
                h.lostAt = now
                log(`${sender.name}: receiver disconnected`)
            } else if (!h.recreatedForLoss && now - h.lostAt > RECONNECT_GRACE_MS) {
                h.recreatedForLoss = true
                recreate(id, `receiver did not reconnect within ${RECONNECT_GRACE_MS / 1000}s`)
            }
        }
    })

    // forget removed senders
    Object.keys(health).forEach((id) => {
        if (!NdiSender.NDI[id]) delete health[id]
    })
}

function recreate(id: string, reason: string) {
    const sender = NdiSender.NDI[id]
    if (!sender) return
    const h = health[id]
    const now = Date.now()
    if (h && now - h.lastRecreate < MIN_RECREATE_GAP_MS) return
    if (h) h.lastRecreate = now

    log(`${sender.name}: recreating sender (${reason})`)
    NdiSender.recreateSender(id)
    CaptureHelper.Lifecycle.restartCaptureLoop(id)
}

function scheduleRecreateAll(reason: string) {
    if (networkTimer) clearTimeout(networkTimer)
    networkTimer = setTimeout(() => {
        networkTimer = null
        Object.keys(NdiSender.NDI).forEach((id) => {
            if (health[id]) health[id].lastRecreate = 0 // a network change always gets a fresh sender
            recreate(id, reason)
        })
    }, NETWORK_SETTLE_MS)
}

/** non-internal IPv4 addresses, e.g. "en0:192.168.1.20" */
function getNetworkSignature() {
    try {
        const interfaces = os.networkInterfaces()
        return Object.keys(interfaces)
            .flatMap((name) => (interfaces[name] || []).filter((a) => a.family === "IPv4" && !a.internal).map((a) => `${name}:${a.address}`))
            .sort()
            .join(",")
    } catch {
        return networkSignature
    }
}

function updatePowerBlocker(active: boolean) {
    if (active && blockerId === null) {
        blockerId = powerSaveBlocker.start("prevent-app-suspension")
    } else if (!active && blockerId !== null) {
        if (powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId)
        blockerId = null
    }
}

// ---- log ----

let logFile = ""
function log(message: string) {
    const line = `${new Date().toISOString()} ${message}`
    console.info("[NDI watchdog] " + message)
    try {
        if (!logFile) logFile = path.join(app.getPath("logs"), "ndi-watchdog.log")
        fs.mkdirSync(path.dirname(logFile), { recursive: true })
        // keep it small
        if (fs.existsSync(logFile) && fs.statSync(logFile).size > 512 * 1024) fs.renameSync(logFile, logFile + ".old")
        fs.appendFileSync(logFile, line + "\n")
    } catch {}
}
