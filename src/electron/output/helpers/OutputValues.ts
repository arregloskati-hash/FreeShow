import type { BrowserWindow } from "electron"
import { initializeSender } from "../../blackmagic/bmdTalk"
import { CaptureHelper } from "../../capture/CaptureHelper"
import { NdiSender } from "../../ndi/NdiSender"
import type { Output as OutputWindow } from "../Output"
import { OutputHelper } from "../OutputHelper"
import type { Output } from "../../../types/Output"
import { setOutputAlwaysOnTop } from "./OutputAlwaysOnTop"

const setValues = {
    ndi: async (value: boolean, window: BrowserWindow, id: string, output: OutputWindow) => {
        // FreeShow Church: use the output's own NDI name/groups (was the window title, so the source got a
        // different name than after a restart and receivers lost it)
        if (value) await NdiSender.createSenderNDI(id, NdiSender.initNameNDI(output?.ndiData?.name, output?.name || window.getTitle()), output?.ndiData?.groups)
        else NdiSender.stopSenderNDI(id)

        setValues.capture({ key: "ndi", value }, window, id)
    },
    // FreeShow Church: rename / change groups live (no restart needed)
    ndiData: async (value: any, _window: BrowserWindow, id: string, output: OutputWindow) => {
        const previous = output.ndiData || {}
        output.ndiData = value || {}

        const nameChanged = (previous.name || "") !== (output.ndiData?.name || "") || (previous.groups || "") !== (output.ndiData?.groups || "")
        if (!nameChanged || !NdiSender.NDI[id]) return

        await NdiSender.createSenderNDI(id, NdiSender.initNameNDI(output.ndiData?.name, output.name), output.ndiData?.groups)
        CaptureHelper.updateFramerate(id)
    },
    name: (value: string, _window: BrowserWindow, id: string, output: OutputWindow) => {
        const previous = output.name
        output.name = value
        if (_window && !_window.isDestroyed()) _window.setTitle(value || "Output")

        // the default NDI name includes the output name
        if (previous !== value && NdiSender.NDI[id] && !output.ndiData?.name) {
            void NdiSender.createSenderNDI(id, NdiSender.initNameNDI(undefined, value), output.ndiData?.groups)
        }
    },
    blackmagic: (data: Output, window: BrowserWindow, id: string) => {
        initializeSender(data, window, id)
    },
    webrtc: (value: boolean, _window: BrowserWindow, id: string) => {
        CaptureHelper.Lifecycle.startCapture(id, { webrtc: value })
    },
    webrtcData: (value: any, _window: BrowserWindow, id: string, output: OutputWindow) => {
        output.webrtcData = value
        CaptureHelper.Lifecycle.startCapture(id, { webrtc: !!value?.streaming })
    },
    rtmp: (value: boolean, _window: BrowserWindow, id: string) => {
        CaptureHelper.Lifecycle.startCapture(id, { rtmp: value })
    },
    rtmpData: (value: any, _window: BrowserWindow, id: string, output: OutputWindow) => {
        output.rtmpData = value
        CaptureHelper.Lifecycle.startCapture(id, { rtmp: !!value?.streaming })
    },
    capture: (data: { key: string; value: boolean }, _window: BrowserWindow, id: string) => {
        CaptureHelper.Lifecycle.startCapture(id, { [data.key]: data.value })
    },
    transparent: (value: boolean, window: BrowserWindow, _id: string, output: OutputWindow) => {
        window.setBackgroundColor(value ? "#00000000" : "#000000")
        output.transparent = value
    },
    alwaysOnTop: (value: boolean, window: BrowserWindow, _id: string, output: OutputWindow) => {
        output.alwaysOnTop = value
        setOutputAlwaysOnTop(window, value)
        // show in taskbar if not always on top, because this will also show it in Alt+Tab menu
        window.setSkipTaskbar(value)
        if (output.boundsLocked !== true) window.setResizable(!value)
    },
    boundsLocked: (value: boolean, _window: BrowserWindow, id: string, output: OutputWindow) => {
        output.boundsLocked = value
        OutputHelper.Lifecycle.updateWindowConstraints(id)
    }
}

export class OutputValues {
    static updateValue({ id, key, value }: { id: string; key: string; value: any }) {
        const output = OutputHelper.getOutput(id)
        if (!output) return
        if (!(key in setValues)) return

        if (!output.window || output.window.isDestroyed()) return
        setValues[key as keyof typeof setValues](value, output.window, id, output)
    }
}
