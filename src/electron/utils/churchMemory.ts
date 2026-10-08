// ----- FreeShow Church -----
// Keeps the main process from piling up frame memory.
//
// Every captured frame (capturePage) is a native image of width x height x 4 bytes (8 MB at 1080p) that is only
// released when JavaScript's garbage collector runs. The collector can't see that native memory, so with a few
// outputs capturing at 30 fps it can let gigabytes of old frames build up before it cleans - on a laptop with
// 8-16 GB that makes Windows swap and the whole app freeze. We count the frame bytes ourselves and clean up
// regularly instead.

import { app } from "electron"
import fs from "fs"
import os from "os"
import path from "path"
import v8 from "v8"
import vm from "vm"

const CLEAN_AFTER_BYTES = 384 * 1024 * 1024 // native frame memory created since the last clean-up
const MIN_INTERVAL_MS = 250

let gcFn: (() => void) | null = null
let pendingBytes = 0
let lastGc = 0
let gcCount = 0
let gcTimeMs = 0
let started = false

export function initChurchMemory() {
    if (started) return
    started = true

    try {
        v8.setFlagsFromString("--expose_gc")
        gcFn = vm.runInNewContext("gc")
    } catch (err) {
        console.warn("Memory: could not enable clean-up:", err)
    }

    // also clean up now and then when frames are rare (and after outputs are removed)
    setInterval(() => {
        if (pendingBytes > 32 * 1024 * 1024) collect()
    }, 10000).unref?.()

    setInterval(watchProcesses, 30000).unref?.()

    if (!app.isPackaged) startDevLog()
}

// ---- safety net: watch every FreeShow process ----

const OUTPUT_RELOAD_MB = 2048 // an output page using this much while the computer is almost out of memory is reloaded
const LOW_SYSTEM_MEMORY = 0.08 // share of the computer's memory still free
const LOG_EVERY_MS = 5 * 60 * 1000
let lastLog = 0
const lastReload: { [id: string]: number } = {}

function watchProcesses() {
    try {
        const metrics = app.getAppMetrics()
        const freeShare = os.freemem() / os.totalmem()
        const mainRssMB = process.memoryUsage().rss / 1048576
        if (mainRssMB > 1500) collect()

        const outputs = getOutputWindows()
        const now = Date.now()

        // write a short memory line to the log now and then (and whenever memory is getting tight),
        // so a problem on another computer can be traced afterwards
        if (now - lastLog > LOG_EVERY_MS || (freeShare < 0.15 && now - lastLog > 60000)) {
            lastLog = now
            const parts = metrics.map((m) => {
                const output = outputs.find((o) => o.pid === m.pid)
                const name = output ? `output "${output.name}"` : m.type === "Browser" ? "main" : m.type
                return `${name}=${Math.round((m.memory?.workingSetSize || 0) / 1024)}MB`
            })
            writeLog(`free ${Math.round(freeShare * 100)}% of ${Math.round(os.totalmem() / 1073741824)}GB | ${parts.join(" ")}`)
        }

        // (macOS counts its file cache as used memory, so "free" is always low there - only judge on Windows/Linux)
        if (process.platform === "darwin" || freeShare > LOW_SYSTEM_MEMORY) return

        // the computer is nearly out of memory: an output page that grew very large gets a fresh start
        // (a short blink on that output beats the whole computer freezing in the middle of a service)
        outputs.forEach((o) => {
            const m = metrics.find((p) => p.pid === o.pid)
            const mb = (m?.memory?.workingSetSize || 0) / 1024
            if (mb < OUTPUT_RELOAD_MB) return
            if (now - (lastReload[o.id] || 0) < 10 * 60 * 1000) return
            lastReload[o.id] = now
            writeLog(`output "${o.name}" uses ${Math.round(mb)}MB while the computer is almost out of memory - reloading it`)
            try {
                o.window.webContents.reload()
            } catch {}
        })
    } catch (err) {
        console.warn("Memory watch:", err)
    }
}

function getOutputWindows(): { id: string; name: string; pid: number; window: any }[] {
    try {
        const { OutputHelper } = require("../output/OutputHelper")
        return OutputHelper.getKeys()
            .map((id: string) => {
                const output = OutputHelper.getOutput(id)
                const window = output?.window
                if (!window || window.isDestroyed()) return null
                return { id, name: output.name || id, pid: window.webContents.getOSProcessId(), window }
            })
            .filter(Boolean)
    } catch {
        return []
    }
}

function writeLog(line: string) {
    try {
        const file = path.join(app.getPath("logs"), "memory.log")
        try {
            if (fs.statSync(file).size > 2 * 1024 * 1024) fs.renameSync(file, file + ".old")
        } catch {}
        fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`)
    } catch {}
}

/** a native frame of this size was created (capture, resize, bitmap copy) */
export function noteFrameBytes(bytes: number) {
    if (!bytes || bytes < 0) return
    pendingBytes += bytes
    if (pendingBytes < CLEAN_AFTER_BYTES) return
    if (Date.now() - lastGc < MIN_INTERVAL_MS) return
    collect()
}

/** clean up right away (e.g. after an output was closed) */
export function collect() {
    if (!gcFn || disabledForTest()) {
        pendingBytes = 0
        return
    }
    const start = performance.now()
    try {
        gcFn()
    } catch {}
    gcTimeMs += performance.now() - start
    gcCount++
    lastGc = Date.now()
    pendingBytes = 0
}

export function getMemoryStats() {
    const m = process.memoryUsage()
    const mb = (n: number) => Math.round(n / 1048576)
    return { rssMB: mb(m.rss), heapMB: mb(m.heapUsed), externalMB: mb(m.external), arrayBuffersMB: mb(m.arrayBuffers), cleanups: gcCount, cleanupMs: Math.round(gcTimeMs) }
}

// ---- dev only: A/B testing ----
function disabledForTest() {
    if (app.isPackaged) return false
    try {
        return fs.existsSync(path.join(process.cwd(), "church", "logs", "nogc"))
    } catch {
        return false
    }
}

function startDevLog() {
    const flag = path.join(process.cwd(), "church", "logs", "memlog")
    setInterval(() => {
        if (!fs.existsSync(flag)) return
        const procs = app
            .getAppMetrics()
            .map((p) => `${p.type}:${Math.round((p.memory?.workingSetSize || 0) / 1024)}`)
            .join(" ")
        console.log("MEMLOG", new Date().toISOString().slice(11, 19), JSON.stringify(getMemoryStats()), procs)
    }, 10000).unref?.()
}
