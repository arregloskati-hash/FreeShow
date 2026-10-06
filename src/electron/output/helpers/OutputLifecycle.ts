import { BrowserWindow, screen, type BrowserWindowConstructorOptions } from "electron"
import { OUTPUT_CONSOLE, getMainWindow, isMac, loadWindowContent, toApp } from "../.."
import { OUTPUT } from "../../../types/Channels"
import type { Output } from "../../../types/Output"
import { BlackmagicSender } from "../../blackmagic/BlackmagicSender"
import { initializeSender } from "../../blackmagic/bmdTalk"
import { CaptureHelper } from "../../capture/CaptureHelper"
import { NdiSender } from "../../ndi/NdiSender"
import { setDataNDI } from "../../ndi/talk"
import { wait } from "../../utils/helpers"
import { outputOptions } from "../../utils/windowOptions"
import { OutputHelper } from "../OutputHelper"
import { setOutputAlwaysOnTop } from "./OutputAlwaysOnTop"
import { OutputVisibility } from "./OutputVisibility"

export class OutputLifecycle {
    private static pendingCaptureStart: { [id: string]: NodeJS.Timeout } = {}

    // FreeShow Church: an output that is closing (removed, or being restarted). While closing, new create/remove
    // requests only update what should happen once it's closed, and show/hide requests wait for it, so fast
    // clicks (enable/disable, restart, toggle) can never leave two windows, a stray NDI source or a wrong state.
    private static closing: { [id: string]: { reopen: Output | null; queued: (() => void)[] } } = {}
    // screen outputs hidden because their display was unplugged (shown again when it comes back)
    private static hiddenByDisplayLoss: Set<string> = new Set()

    static isClosing(id: string) {
        return !!this.closing[id]
    }

    /** run now, or after the output has finished closing/reopening */
    static whenSettled(id: string, fn: () => void) {
        if (this.closing[id]) this.closing[id].queued.push(fn)
        else fn()
    }

    private static clearPendingCaptureStart(id: string) {
        const pending = this.pendingCaptureStart[id]
        if (!pending) return

        clearTimeout(pending)
        delete this.pendingCaptureStart[id]
    }

    static initListeners() {
        screen.on("display-metrics-changed", () => {
            setTimeout(() => this.restoreAllOutputBounds(), 500)
        })
        screen.on("display-added", () => {
            setTimeout(() => {
                this.restoreAllOutputBounds()
                this.reshowOutputsOnReturnedDisplays()
            }, 1000)
        })
        screen.on("display-removed", () => {
            // FreeShow Church: hide screen outputs whose display is gone first, otherwise the OS moves them
            // onto the main screen (covering the operator's screen in the middle of a service)
            this.hideOutputsOnMissingDisplays()
            this.restoreAllOutputBounds()
        })
    }

    private static hideOutputsOnMissingDisplays() {
        OutputHelper.getKeys().forEach((id) => {
            const output = OutputHelper.getOutput(id)
            if (!output?.window || output.window.isDestroyed() || output.invisible) return
            if (!output.window.isVisible()) return
            if (OutputVisibility.findOutputDisplay(output)) return

            console.info("Output display disconnected, hiding output until it's back: " + id)
            this.hiddenByDisplayLoss.add(id)
            OutputVisibility.hideWindow(output.window)
        })
    }

    private static reshowOutputsOnReturnedDisplays() {
        this.hiddenByDisplayLoss.forEach((id) => {
            const output = OutputHelper.getOutput(id)
            if (!output?.window || output.window.isDestroyed() || output.invisible) {
                this.hiddenByDisplayLoss.delete(id)
                return
            }

            const display = OutputVisibility.findOutputDisplay(output)
            if (!display) return

            console.info("Output display reconnected, showing output again: " + id)
            this.hiddenByDisplayLoss.delete(id)
            OutputHelper.Bounds.updateBounds({ id, bounds: { ...display.bounds } })
            OutputVisibility.showWindow(output.window, output.alwaysOnTop !== false)
        })
    }

    /** the output was hidden on purpose (or shown again) - forget any "waiting for display" state */
    static clearDisplayLossState(id: string) {
        this.hiddenByDisplayLoss.delete(id)
    }

    static restoreAllOutputBounds() {
        OutputHelper.getKeys().forEach((id) => {
            const output = OutputHelper.getOutput(id)
            if (!output || !output.window || output.window.isDestroyed()) return
            if (!output.intendedBounds) return
            if (this.hiddenByDisplayLoss.has(id)) return // keep where it belongs until its display is back

            // invisible/capture outputs: re-apply so the DPI-corrected render size follows scale changes
            if (output.invisible) {
                const expected = OutputHelper.Bounds.getRenderBounds(output, output.intendedBounds)
                const currentBounds = output.window.getBounds()
                if (currentBounds.width !== expected.width || currentBounds.height !== expected.height) {
                    OutputHelper.Bounds.updateBounds({ id, bounds: output.intendedBounds })
                }
                return
            }

            const targetBounds = OutputVisibility.resolveOutputBounds({ ...output, bounds: output.intendedBounds, id })
            const currentBounds = output.window.getBounds()
            if (JSON.stringify(currentBounds) !== JSON.stringify(targetBounds)) {
                OutputHelper.Bounds.updateBounds({ id, bounds: targetBounds })
            }
        })
    }

    static async createOutput(output: Output) {
        const id: string = output.id || ""
        if (!id) return

        // closing (removed or restarting): just make sure it opens with these settings afterwards
        if (this.closing[id]) {
            this.closing[id].reopen = output
            return
        }

        // already exists: restart it with the new settings
        if (OutputHelper.getOutput(id)) {
            this.removeOutput(id, output)
            return
        }

        this.hiddenByDisplayLoss.delete(id)

        this.clearPendingCaptureStart(id)

        // disable move/resize listeners during initialization
        OutputHelper.Bounds.disableWindowMoveListener()

        // invisible/capture outputs render DPI-corrected so capturePage() matches the configured resolution
        const resolvedBounds = output.invisible ? output.bounds : OutputVisibility.resolveOutputBounds(output)
        const renderBounds = OutputHelper.Bounds.getRenderBounds(output, resolvedBounds)
        const outputWindow = this.createOutputWindow({ ...renderBounds, alwaysOnTop: output.alwaysOnTop !== false, backgroundColor: output.transparent ? "#00000000" : "#000000" }, id, output.name, output)
        // const previewWindow = this.createPreviewWindow({ ...output.bounds, backgroundColor: "#000000" })

        OutputHelper.setOutput(id, { window: outputWindow, invisible: output.invisible, boundsLocked: output.boundsLocked, screen: output.screen, intendedBounds: resolvedBounds, transparent: output.transparent, webrtcData: output.webrtcData, rtmpData: output.rtmpData, name: output.name, ndiData: output.ndiData, alwaysOnTop: output.alwaysOnTop })
        // OutputHelper.setOutput(id, { window: outputWindow, previewWindow: previewWindow })
        OutputHelper.Bounds.updateBounds({ id: output.id!, bounds: resolvedBounds })
        this.updateWindowConstraints(id)

        // OutputHelper.Bounds.updatePreviewBounds()

        this.pendingCaptureStart[id] = setTimeout(() => {
            delete this.pendingCaptureStart[id]

            if (!CaptureHelper.Lifecycle || !OutputHelper.getOutput(id)) return // window closed before timeout finished
            CaptureHelper.Lifecycle.startCapture(id, { ndi: output.ndi || false, blackmagic: !!output.blackmagic, webrtc: !!output.webrtcData?.streaming, rtmp: !!output.rtmpData?.streaming })
        }, 1200)

        // NDI
        if (output.ndi) {
            await NdiSender.createSenderNDI(id, NdiSender.initNameNDI(output.ndiData?.name, output.name), output.ndiData?.groups)
            if (output.ndiData) setDataNDI({ id, ...output.ndiData })
        }

        // Blackmagic
        if (output.blackmagic) initializeSender(output, outputWindow, id)
    }

    /*
    private static createPreviewWindow(options) {
        const mainBounds = mainWindow?.getBounds()

        options = { ...outputOptions, ...options }
        options.x = 0
        options.y = 0
        options.width = 320
        options.height = 180
        options.show = true
        if (mainBounds) {
            options.x = mainBounds.x + mainBounds.width - options.width - 20 - 300
            options.y = mainBounds.y + 100
        }

        let window: BrowserWindow | null = new BrowserWindow(options)
        window.setSkipTaskbar(options.skipTaskbar) // hide from taskbar
        if (isMac) window.minimize() // hide on mac
        loadWindowContent(window, true)
        window.showInactive()
        window.moveTop()
        return window
    }*/

    private static createOutputWindow(options: BrowserWindowConstructorOptions, id: string, name: string, extra: any) {
        options = { ...outputOptions, ...options }

        if (options.alwaysOnTop === false) {
            options.skipTaskbar = false
            if (!extra.boundsLocked) options.resizable = true
        }

        if (OUTPUT_CONSOLE) options.webPreferences!.devTools = true
        const window: BrowserWindow | null = new BrowserWindow(options)

        // only win & linux
        // window.removeMenu() // hide menubar
        // window.setAutoHideMenuBar(true) // hide menubar

        window.setSkipTaskbar(!!options.skipTaskbar) // hide from taskbar
        if (isMac) window.minimize() // hide on mac

        window.once("show", () => {
            if (options.alwaysOnTop) setOutputAlwaysOnTop(window, true)
        })
        // window.setVisibleOnAllWorkspaces(true)

        loadWindowContent(window, "output")
        this.setWindowListeners(window, { id, name })

        // open devtools
        if (OUTPUT_CONSOLE) window.webContents.openDevTools({ mode: "detach" })

        return window
    }

    /** only creates the output if it doesn't exist yet (never restarts a running one) */
    static ensureOutput(output: Output) {
        const id = output?.id || ""
        if (!id || this.closing[id] || OutputHelper.getOutput(id)) return
        this.createOutput(output)
    }

    static async removeOutput(id: string, reopen: Output | null = null) {
        // already closing: only update whether it should open again afterwards
        if (this.closing[id]) {
            this.closing[id].reopen = reopen
            return
        }

        this.clearPendingCaptureStart(id)
        this.hiddenByDisplayLoss.delete(id)

        CaptureHelper.Lifecycle.stopCapture(id)
        NdiSender.stopSenderNDI(id)
        BlackmagicSender.stop(id)

        const output = OutputHelper.getOutput(id)
        if (!output) {
            if (reopen) this.createOutput(reopen)
            return
        }

        this.closing[id] = { reopen, queued: [] }

        let finished = false
        let fallback: NodeJS.Timeout | null = null
        const finish = () => {
            if (finished) return
            finished = true
            if (fallback) clearTimeout(fallback)

            OutputHelper.deleteOutput(id)

            const state = this.closing[id]
            delete this.closing[id]

            if (state?.reopen) this.createOutput(state.reopen)
            state?.queued.forEach((fn) => {
                try {
                    fn()
                } catch (err) {
                    console.error(err)
                }
            })
        }

        if (!output.window || output.window.isDestroyed()) {
            finish()
            return
        }

        output.window.once("closed", finish)
        // never get stuck waiting: force it closed if the window doesn't close by itself
        fallback = setTimeout(() => {
            if (output.window && !output.window.isDestroyed()) output.window.destroy()
            finish()
        }, 3000)

        try {
            // this has to be called to actually remove the process!
            output.window.removeAllListeners("close")
            output.window.close()
            await wait(80)
        } catch (err) {
            console.error(err)
            finish()
        }
    }

    static focusOutput(id: string) {
        OutputHelper.getOutput(id)?.window?.focus()
    }

    static setWindowListeners(window: BrowserWindow, { id, name }: { [key: string]: string }) {
        window.on("ready-to-show", () => {
            // focus back on main window if output window is not on top
            const mainWindow = getMainWindow()
            if (mainWindow) {
                const windowNotCoveringMain = OutputVisibility.amountCovered(window.getBounds(), mainWindow.getBounds()) < 0.5
                if (windowNotCoveringMain || isMac) mainWindow.focus()
            }

            window.setMenu(null)
            window.setTitle(name || "Output")
        })

        // Building the app does not like this for some reason:
        // Argument of type '"move"' is not assignable to parameter of type '"will-resize"'.
        // @ts-ignore
        window.on("move", (e: Electron.Event) => {
            // (the output can already be removed while its window is closing)
            if (!OutputHelper.Bounds.moveEnabled || OutputHelper.Bounds.updatingBounds || !OutputHelper.getOutput(id) || OutputHelper.getOutput(id).boundsLocked) return e.preventDefault()

            const bounds = window.getBounds()
            toApp(OUTPUT, { channel: "MOVE", data: { id, bounds } })
        })

        // @ts-ignore
        window.on("resize", (e: Electron.Event) => {
            // FreeShow Church: report resizes while moving/resizing is allowed (this was inverted, so manual resizes were never saved)
            if (!OutputHelper.Bounds.moveEnabled || OutputHelper.Bounds.updatingBounds || !OutputHelper.getOutput(id) || OutputHelper.getOutput(id).boundsLocked) return e.preventDefault()

            const bounds = window.getBounds()
            toApp(OUTPUT, { channel: "MOVE", data: { id, bounds } })
        })

        // FreeShow Church: if the output's page crashes (GPU/driver hiccup, out of memory), reload it instead of
        // leaving a frozen or black output for the rest of the service
        // (at most 3 automatic reloads per minute, so a page that keeps crashing can't flood the app with reloads)
        const recentReloads: number[] = []
        const reloadOutput = (reason: string) => {
            const now = Date.now()
            while (recentReloads.length && now - recentReloads[0] > 60000) recentReloads.shift()
            if (recentReloads.length >= 3) {
                console.error(`Output ${name || id} keeps failing (${reason}) - not reloading again for now`)
                return
            }
            recentReloads.push(now)
            console.error(`Output ${name || id} ${reason}, reloading`)
            setTimeout(() => {
                if (!window.isDestroyed()) window.webContents.reload()
            }, 300)
        }

        window.webContents.on("render-process-gone", (_e, details) => {
            if (details?.reason === "clean-exit") return
            reloadOutput(`crashed (${details?.reason})`)
        })

        // a hung output page (e.g. too heavy content at a very large resolution): reload it if it stays stuck
        let unresponsiveTimer: NodeJS.Timeout | null = null
        window.on("unresponsive", () => {
            if (unresponsiveTimer) return
            unresponsiveTimer = setTimeout(() => {
                unresponsiveTimer = null
                if (!window.isDestroyed()) reloadOutput("stopped responding")
            }, 8000)
        })
        window.on("responsive", () => {
            if (unresponsiveTimer) clearTimeout(unresponsiveTimer)
            unresponsiveTimer = null
        })
        window.on("closed", () => {
            if (unresponsiveTimer) clearTimeout(unresponsiveTimer)
            unresponsiveTimer = null
        })
    }

    static updateWindowConstraints(id: string) {
        const output = OutputHelper.getOutput(id)
        if (!output || !output.window || output.window.isDestroyed()) return

        const locked = output.boundsLocked === true || output.invisible === true
        const movable = OutputHelper.Bounds.moveEnabled && !locked

        output.window.setResizable(movable)
        output.window.setMovable(movable)

        if (locked) {
            const bounds = output.window.getBounds()
            output.window.setMinimumSize(bounds.width, bounds.height)
            output.window.setMaximumSize(bounds.width, bounds.height)
        } else {
            output.window.setMinimumSize(0, 0)
            output.window.setMaximumSize(99999, 99999)
        }
    }

    static async closeAllOutputs() {
        await Promise.all(OutputHelper.getKeys().map(async (id) => await this.removeOutput(id)))
    }
}
