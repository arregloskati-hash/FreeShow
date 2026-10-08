import { app, ipcMain, powerSaveBlocker } from "electron"
import { mainWindow, powerSaveBlockerId, resetMainWindow } from ".."
import { Main } from "../../types/IPC/Main"
import { ToMain } from "../../types/IPC/ToMain"
import { sendMain, sendToMain } from "../IPC/main"
import { NdiReceiver } from "../ndi/NdiReceiver"
import { OutputHelper } from "../output/OutputHelper"
import { closeServers } from "../servers"
import { RtmpStreamer } from "../streaming/RtmpStreamer"
import { stopApiListener } from "./api"
import { stopMidi } from "./midi"

export let dialogClose = false // is unsaved

// FreeShow Church: closing asks the main window's page to save first. If that page is frozen it never answers
// and FreeShow could not be closed at all - then close anyway (it can't save in that state either).
let mainUnresponsive = false
let closeCheck: NodeJS.Timeout | null = null
export function setMainUnresponsive(value: boolean) {
    mainUnresponsive = value
}

export function callClose(e: Electron.Event) {
    if (dialogClose) return
    e.preventDefault()

    if (mainUnresponsive) {
        console.warn("Main window is not responding - closing without saving")
        exitApp()
        return
    }

    sendMain(Main.CLOSE, false)

    // the page may freeze while handling the close request
    if (closeCheck) clearTimeout(closeCheck)
    closeCheck = setTimeout(() => {
        closeCheck = null
        if (mainUnresponsive && !isExiting) {
            console.warn("Main window stopped responding while closing - closing without saving")
            exitApp()
        }
    }, 10000)
}

export function saveAndClose() {
    sendMain(Main.CLOSE, true)
}

let isExiting = false
export async function exitApp() {
    if (isExiting) return
    isExiting = true

    console.info("Closing app!")

    // FreeShow Church: if anything below gets stuck (an output, NDI, a server), still quit
    setTimeout(() => {
        console.warn("Closing took too long - forcing exit")
        app.exit()
    }, 8000)

    // FreeShow Church: stop native timecode audio first (its audio thread must not call into a closing app)
    try {
        require("../timecode/churchAudio").shutdownChurchAudio()
    } catch {}

    dialogClose = false

    RtmpStreamer.stopAll()
    await OutputHelper.Lifecycle.closeAllOutputs()
    NdiReceiver.stopReceiversNDI()

    closeServers()
    stopApiListener()

    stopMidi()

    // relaunch does not work very well as it launched new processes
    // if (!isProd) {
    //     console.log("Dev mode active - Relaunching...")
    //     app.relaunch()
    // } else {
    // this has to be called to actually remove the process!
    // https://stackoverflow.com/a/43520274
    mainWindow?.removeAllListeners("close")
    ipcMain.removeAllListeners()
    // }

    resetMainWindow()

    if (powerSaveBlockerId !== null) {
        powerSaveBlocker.stop(powerSaveBlockerId)
    }

    try {
        app.quit()

        // shouldn't need to use exit!
        setTimeout(() => {
            app.exit()
        }, 500)
    } catch (err) {
        console.error("Failed closing app:", err)
        isExiting = false
    }
}

export function closeMain() {
    dialogClose = true
    mainWindow?.close()
}

// not in use currently - was used when custom data location changed previously
export function forceCloseApp() {
    sendToMain(ToMain.ALERT, "actions.closing")
    // let user read message and action finish
    setTimeout(exitApp, 2000)
}
