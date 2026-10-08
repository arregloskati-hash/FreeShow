// ----- FreeShow Church -----
// Performance measurement (Settings > Performance): GPU status, CPU/memory per process and the cost of every
// NDI output (frames sent, capture / processing / send time). Also the performance switches (stored in config).

import { app, BrowserWindow } from "electron"
import { config } from "../data/store"
import { OutputHelper } from "../output/OutputHelper"

// ---- NDI pipeline counters ----

interface Counter {
    frames: number // frames handed to NDI
    captures: number // capturePage calls
    captureMs: number
    processMs: number
    sendMs: number
    sends: number
}

const counters: { [id: string]: Counter } = {}
let lastSnapshot = Date.now()

function counter(id: string) {
    return (counters[id] = counters[id] || { frames: 0, captures: 0, captureMs: 0, processMs: 0, sendMs: 0, sends: 0 })
}

export const perf = {
    capture(id: string, ms: number) {
        const c = counter(id)
        c.captures++
        c.captureMs += ms
    },
    process(id: string, ms: number) {
        const c = counter(id)
        c.frames++
        c.processMs += ms
    },
    send(id: string, ms: number) {
        const c = counter(id)
        c.sends++
        c.sendMs += ms
    }
}

// ---- switches ----

/** NDI: capture less often while the picture is still (slides between changes) - default on */
export function isNdiStillSaverEnabled() {
    return (config.get("ndiSaveStill" as any) as boolean | undefined) !== false
}

// ---- snapshot for the settings page ----

export async function getPerformanceInfo() {
    const now = Date.now()
    const seconds = Math.max(0.25, (now - lastSnapshot) / 1000)
    lastSnapshot = now

    // processes
    const windowsByPid: { [pid: number]: string } = {}
    BrowserWindow.getAllWindows().forEach((window) => {
        try {
            if (window.isDestroyed()) return
            const pid = window.webContents.getOSProcessId()
            const title = window.getTitle() || "Window"
            windowsByPid[pid] = windowsByPid[pid] ? windowsByPid[pid] + ", " + title : title
        } catch {}
    })

    const processes = app.getAppMetrics().map((m) => {
        let name = m.type === "Browser" ? "Main process" : m.type === "GPU" ? "GPU" : m.type === "Tab" ? windowsByPid[m.pid] || "Window" : m.name || m.serviceName || m.type
        if (m.type === "Utility" && m.serviceName) name = m.serviceName.replace(/^.*\./, "")
        return { pid: m.pid, type: m.type, name, cpu: Math.round((m.cpu?.percentCPUUsage || 0) * 10) / 10, memoryMB: Math.round((m.memory?.workingSetSize || 0) / 1024) }
    })
    const totalCpu = Math.round(processes.reduce((sum, p) => sum + p.cpu, 0) * 10) / 10
    const totalMemoryMB = processes.reduce((sum, p) => sum + p.memoryMB, 0)

    // NDI outputs
    const { NdiSender } = require("../ndi/NdiSender")
    const outputs = Object.keys(NdiSender.NDI).map((id) => {
        const sender = NdiSender.NDI[id]
        const c = counters[id] || { frames: 0, captures: 0, captureMs: 0, processMs: 0, sendMs: 0, sends: 0 }
        const output = OutputHelper.getOutput(id)
        const size = output?.intendedBounds || output?.window?.getBounds()
        const result = {
            id,
            name: sender?.name || id,
            connections: Number(sender?.connections || 0),
            resolution: size ? `${size.width}×${size.height}` : "",
            fps: Math.round((c.frames / seconds) * 10) / 10,
            captureFps: Math.round((c.captures / seconds) * 10) / 10,
            captureMs: c.captures ? Math.round((c.captureMs / c.captures) * 10) / 10 : 0,
            processMs: c.frames ? Math.round((c.processMs / c.frames) * 10) / 10 : 0,
            sendMs: c.sends ? Math.round((c.sendMs / c.sends) * 10) / 10 : 0
        }
        return result
    })
    Object.keys(counters).forEach((id) => delete counters[id])

    // GPU
    const gpuDevices = await getGpuDevices()

    return {
        gpuStatus: app.getGPUFeatureStatus() as any as { [key: string]: string },
        gpuDevices,
        hardwareAccelerationDisabled: config.get("disableHardwareAcceleration") === true,
        preferHighPerformanceGpu: config.get("preferHighPerformanceGpu" as any) !== false,
        ndiSaveStill: isNdiStillSaverEnabled(),
        processes,
        totalCpu,
        totalMemoryMB,
        outputs,
        cpuCores: require("os").cpus().length
    }
}

// the full GPU info is slow to collect - once is enough
let gpuDevicesCache: { name: string; active: boolean }[] | null = null
async function getGpuDevices() {
    if (gpuDevicesCache) return gpuDevicesCache
    try {
        const info: any = await app.getGPUInfo("complete")
        const renderer: string = info?.auxAttributes?.glRenderer || ""
        const devices: any[] = info?.gpuDevice || []
        gpuDevicesCache = devices.map((d: any) => {
            let name = d.deviceString || ""
            // e.g. "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)" -> "Apple M1 Pro"
            if (!name && (d.active || devices.length === 1) && renderer) name = (renderer.match(/Renderer: ([^,)]+)/)?.[1] || renderer.match(/\(([^,]+),\s*([^,(]+)/)?.[2] || renderer).trim()
            if (!name) name = `${vendorName(d.vendorId)} graphics`
            return { name, active: !!d.active }
        })
    } catch {
        gpuDevicesCache = []
    }
    return gpuDevicesCache
}

function vendorName(id: number) {
    return { 0x10de: "NVIDIA", 0x1002: "AMD", 0x8086: "Intel", 0x106b: "Apple" }[id] || "GPU"
}
