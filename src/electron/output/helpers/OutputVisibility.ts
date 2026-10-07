import type { BrowserWindow, Display, Rectangle } from "electron"
import { screen } from "electron"
import { mainWindow, toApp } from "../.."
import { MAIN, OUTPUT } from "../../../types/Channels"
import type { Output } from "../../../types/Output"
import { OutputHelper } from "../OutputHelper"
import { setOutputAlwaysOnTop } from "./OutputAlwaysOnTop"
import { OutputBounds } from "./OutputBounds"

export class OutputVisibility {
    static toggleOutputs(data: { outputs: (Output & { id: string })[]; state: boolean; force?: boolean; autoStartup?: boolean; autoPosition?: boolean }) {
        const newStates: { id: string; active: boolean | "invisible" }[] = []

        data.outputs.forEach((output) => {
            // FreeShow Church: the output is closing/restarting - apply this once it's open again (it reports its own state)
            if (output?.id && OutputHelper.Lifecycle.isClosing(output.id)) {
                OutputHelper.Lifecycle.whenSettled(output.id, () => OutputVisibility.toggleOutputs({ ...data, outputs: [output] }))
                return
            }

            // FreeShow Church: "activate outputs at startup" never opens a screen output on the operator's screen
            // (e.g. the TV/projector isn't connected yet) - it keeps running hidden and is shown once its display is connected
            if (data.autoStartup && data.state === true && !data.force && !output.invisible && OutputVisibility.wouldCoverOperatorScreen(output)) {
                OutputVisibility.toggleOutput(output, false, false, true)
                if (output.screen) OutputHelper.Lifecycle.waitForDisplay(output.id, output.screen)
                newStates.push({ id: output.id, active: false })
                return
            }

            const force = !!(data.force || output.boundsLocked)
            const newState = OutputVisibility.toggleOutput(output, data.state, force, data.autoStartup, data.autoPosition)
            newStates.push({ id: output.id, active: newState })
        })

        toApp(OUTPUT, { channel: "OUTPUT_STATE", data: newStates })
    }

    static toggleOutput(output: Output & { id: string }, state: boolean, force?: boolean, autoStartup?: boolean, autoPosition?: boolean) {
        if (!output?.id) return false

        let window: BrowserWindow = OutputHelper.getOutput(output.id)?.window

        // a deliberate show/hide replaces any "waiting for the display to come back" state
        OutputHelper.Lifecycle.clearDisplayLossState(output.id)

        if (!window || window.isDestroyed()) {
            OutputHelper.Lifecycle.createOutput(output)
            window = OutputHelper.getOutput(output.id)?.window
            if (!window || window.isDestroyed()) return false
        }

        if (output.invisible) {
            OutputHelper.setOutput(output.id, { ...OutputHelper.getOutput(output.id), invisible: true })
            // (also when minimized: on macOS a new window starts minimized and would stay in the Dock)
            if (window.isVisible() || window.isMinimized()) this.hideWindow(window)
            // capture-only: render at the configured resolution (DPI-corrected)
            OutputBounds.updateBounds({ id: output.id, bounds: output.bounds })
            return "invisible"
        }

        let bounds: Rectangle = this.resolveOutputBounds(output, autoPosition && !force)
        const windowNotCoveringMain = this.amountCovered(bounds, mainWindow!.getBounds()) < 0.5
        // FreeShow Church: never show a screen output where no display is (e.g. HDMI unplugged): the OS would
        // move it onto the main screen and cover it
        const onADisplay = this.isOnAnyDisplay(bounds)

        if (state === true && onADisplay && (force || window.isAlwaysOnTop() === false || windowNotCoveringMain)) {
            this.showWindow(window, output.alwaysOnTop !== false)

            OutputHelper.Bounds.updateBounds({ id: output.id, bounds })
            return true
        } else {
            this.hideWindow(window, output)
            // returning to capture-only: render at the configured resolution (DPI-corrected)
            OutputBounds.updateBounds({ id: output.id, bounds: output.bounds })

            if (state === true && !autoStartup) toApp(MAIN, { channel: "ALERT", data: "error.display" })
            return false
        }
    }

    static resolveOutputBounds(output: Partial<Output> & { bounds: Rectangle; boundsLocked?: boolean; screen?: string | null }, autoPosition = false): Rectangle {
        const displays = screen.getAllDisplays()
        const primaryBounds = displays.length ? displays[0].bounds : { x: 0, y: 0, width: 1920, height: 1080 }
        const hasValidBounds = !!(output.bounds?.width && output.bounds?.height)
        const outputBounds = hasValidBounds ? output.bounds : primaryBounds

        // position at any existing target display
        if (displays.length > 0 && output.screen) {
            const targetDisplay = displays.find((d) => d.id.toString() === output.screen)
            if (targetDisplay) return { ...targetDisplay.bounds }
        }

        // never auto position locked bounds
        if (output.boundsLocked) return outputBounds

        // preserve valid input pos if already on an active display
        if (displays.length > 0 && hasValidBounds && output.bounds) {
            const isCenterOnDisplay = displays.some((d) => {
                const centerX = output.bounds!.x + output.bounds!.width / 2
                const centerY = output.bounds!.y + output.bounds!.height / 2
                return centerX >= d.bounds.x && centerX < d.bounds.x + d.bounds.width && centerY >= d.bounds.y && centerY < d.bounds.y + d.bounds.height
            })

            if (isCenterOnDisplay) return output.bounds
        }

        // fallback to second display auto positioning if not locked and autoPosition requested or bounds are undefined
        // (not on macOS due to window detection quirks)
        if ((autoPosition || !hasValidBounds) && displays.length > 1 && process.platform !== "darwin") {
            return this.getSecondDisplay(outputBounds)
        }

        return outputBounds
    }

    /** FreeShow Church: would showing this screen output put it on the display the main window is on (or is its chosen display missing)? */
    static wouldCoverOperatorScreen(output: Output) {
        const displays = screen.getAllDisplays()
        if (output.screen && !displays.some((d) => d.id.toString() === output.screen)) return true
        if (!mainWindow || mainWindow.isDestroyed()) return false

        const bounds = this.resolveOutputBounds(output as any)
        if (!bounds?.width || !bounds?.height) return false
        const mainDisplay = screen.getDisplayMatching(mainWindow.getBounds())
        return screen.getDisplayMatching(bounds).id === mainDisplay.id
    }

    /** FreeShow Church: is the window meant to be shown? */
    static isWantedShown(window: BrowserWindow) {
        return this.wantShown.has(window)
    }

    static isOnAnyDisplay(bounds: Rectangle) {
        if (!bounds?.width || !bounds?.height) return false
        const centerX = bounds.x + bounds.width / 2
        const centerY = bounds.y + bounds.height / 2
        return screen.getAllDisplays().some((d) => centerX >= d.bounds.x && centerX < d.bounds.x + d.bounds.width && centerY >= d.bounds.y && centerY < d.bounds.y + d.bounds.height)
    }

    /** the display a screen output belongs on (by its chosen screen, else where it was placed), if connected */
    static findOutputDisplay(output: { screen?: string | null; intendedBounds?: Rectangle }): Display | null {
        const displays = screen.getAllDisplays()
        if (output.screen) {
            const byId = displays.find((d) => d.id.toString() === output.screen)
            if (byId) return byId
        }

        const b = output.intendedBounds
        if (!b?.width || !b?.height) return null
        const centerX = b.x + b.width / 2
        const centerY = b.y + b.height / 2
        return displays.find((d) => centerX >= d.bounds.x && centerX < d.bounds.x + d.bounds.width && centerY >= d.bounds.y && centerY < d.bounds.y + d.bounds.height) || null
    }

    static getSecondDisplay(bounds: Rectangle) {
        const displays = screen.getAllDisplays()
        if (displays.length !== 2) return bounds

        const mainWindowBounds = mainWindow!.getBounds()
        const amountCoveredByWindow = this.amountCovered(displays[1].bounds, mainWindowBounds)

        let secondDisplay = displays[1]
        if (amountCoveredByWindow > 0.5) secondDisplay = displays[0]

        return { ...secondDisplay.bounds }
    }

    static amountCovered(displayBounds: Rectangle, windowBounds: Rectangle) {
        const overlapX = Math.max(0, Math.min(displayBounds.x + displayBounds.width, windowBounds.x + windowBounds.width) - Math.max(displayBounds.x, windowBounds.x))
        const overlapY = Math.max(0, Math.min(displayBounds.y + displayBounds.height, windowBounds.y + windowBounds.height) - Math.max(displayBounds.y, windowBounds.y))
        const overlapArea = overlapX * overlapY

        const totalArea = displayBounds.width * displayBounds.height
        const overlapAmount = overlapArea / totalArea

        return overlapAmount
    }

    // MacOS Menu Bar
    // https://stackoverflow.com/questions/39091964/remove-menubar-from-electron-app
    // https://stackoverflow.com/questions/69629262/how-can-i-hide-the-menubar-from-an-electron-app
    // https://github.com/electron/electron/issues/1415
    // https://github.com/electron/electron/issues/1054

    // FreeShow Church: windows that should be shown (a show can arrive while a new window is still loading /
    // being minimized by macOS, and is then ignored - so it's applied again once the window is ready)
    private static wantShown = new WeakMap<BrowserWindow, boolean>()

    static showWindow(window: BrowserWindow, alwaysOnTop = true) {
        if (!window || window.isDestroyed()) return

        this.wantShown.set(window, alwaysOnTop)
        const show = () => {
            if (window.isDestroyed() || !this.wantShown.has(window)) return
            window.showInactive()
            if (this.wantShown.get(window)) setOutputAlwaysOnTop(window, true)
            window.moveTop()
        }

        show()

        // still loading: show again when ready
        if (window.webContents.isLoadingMainFrame()) window.webContents.once("did-finish-load", () => setTimeout(show, 100))
        // the show did not take (e.g. macOS was still minimizing the new window): try again
        setTimeout(() => {
            if (!window.isDestroyed() && this.wantShown.has(window) && (!window.isVisible() || window.isMinimized())) show()
        }, 700)
    }

    /** FreeShow Church: hide, also out of the macOS Dock (a minimized window stays there when only hidden) */
    static hideFully(window: BrowserWindow) {
        if (!window || window.isDestroyed()) return
        if (process.platform !== "darwin" || !window.isMinimized()) {
            window.hide()
            return
        }

        // un-minimize invisibly, then hide
        window.setOpacity(0)
        window.restore()
        setTimeout(() => {
            if (window.isDestroyed()) return
            if (!this.wantShown.has(window)) window.hide()
            window.setOpacity(1)
        }, 450)
    }

    static hideWindow(window: BrowserWindow, data: Output | null = null) {
        if (!window || window.isDestroyed()) return
        this.wantShown.delete(window)

        OutputBounds.disableWindowMoveListener()

        window.setKiosk(false)
        this.hideFully(window)

        // FreeShow Church: a window macOS was still minimizing ignores hide() and stays in the Dock - hide again
        setTimeout(() => {
            if (!window.isDestroyed() && !this.wantShown.has(window) && (window.isVisible() || window.isMinimized())) this.hideFully(window)
        }, 700)

        // seems to be fixed:
        if (!data) return

        // // this is only needed if the output is being captured!! (has to reset for capture to work when window is hidden)
        // const captureEnabled = Object.values(OutputHelper.getOutput(data.id!)?.captureOptions?.options || {}).find((a) => a === true)
        // if (!captureEnabled) return

        // console.info("RESTARTING OUTPUT:", data.id)
        // toApp(OUTPUT, { channel: "RESTART", data: { id: data.id } })
    }

    /*
    static hideAllPreviews() {
        OutputHelper.getKeys().forEach((outputId) => {
            let output = OutputHelper.getOutput(outputId)
            if (output.previewWindow) output.previewWindow.hide()
        })
    }

    static showAllPreviews() {
        OutputHelper.getKeys().forEach((outputId) => {
            let output = OutputHelper.getOutput(outputId)
            if (output.previewWindow) output.previewWindow.showInactive()
        })
    }
    */
}
