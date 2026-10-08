import type { ValidChannels } from "../../../types/Channels"
import { OUTPUT } from "../../../types/Channels"
import type { Message } from "../../../types/Socket"
import { clone } from "../../utils/helpers"
import type { Output } from "../Output"
import { OutputHelper } from "../OutputHelper"

// FreeShow Church: messages that don't change what an output shows (sent often) - everything else wakes the
// output's capture (NDI "still" mode) so a slide change goes out without delay
const NO_VISUAL_CHANGE = new Set(["ACTIVE_TIMERS", "VISUALIZER_DATA", "METRONOME_TIMER", "PLAYING_VIDEO_STATE", "PLAYING_AUDIO", "REQUEST_VOLUME", "MAIN_REQUEST_VOLUME", "REQUEST_DYNAMIC_VALUE", "MAIN_REQUEST_DYNAMIC_VALUE", "REQUEST_DATA_MAIN", "MAIN_SHORTCUT", "FOCUS", "TO_FRONT", "CAPTURE", "PREVIEW"])
let captureLifecycle: any = null

export class OutputSend {
    static sendToOutputWindow(msg: Message) {
        OutputHelper.getAllOutputs().forEach(sendToWindow)

        function sendToWindow(output: Output & { id: string }) {
            if ((msg.data?.id && msg.data.id !== output.id) || !output?.window || output.window.isDestroyed()) return
            if (msg.target && msg.target !== output.id) return

            let tempMsg: Message = clone(msg)
            if (msg.channel === "OUTPUTS") tempMsg = onlySendToMatchingId(tempMsg, output.id)

            output.window.webContents.send(OUTPUT, tempMsg)

            if (!NO_VISUAL_CHANGE.has(String(msg.channel))) {
                if (!captureLifecycle) captureLifecycle = require("../../capture/helpers/CaptureLifecycle").CaptureLifecycle
                captureLifecycle?.boost(output.id)
            }

            // if (!output.previewWindow || output.previewWindow.isDestroyed()) return
            // output.previewWindow.webContents.send(OUTPUT, tempMsg)
        }

        function onlySendToMatchingId(tempMsg: Message, id: string) {
            if (!msg.data?.[id]) return tempMsg

            tempMsg.data = { [id]: msg.data[id] }
            return tempMsg
        }
    }

    static sendToWindow(id: string, msg: any, channel: ValidChannels = OUTPUT) {
        const output = OutputHelper.getOutput(id)
        if (!output?.window || output.window.isDestroyed()) return
        output.window.webContents.send(channel, msg)
        // if (!output.previewWindow || output.previewWindow.isDestroyed()) return
        // output.previewWindow.webContents.send(OUTPUT, msg)
    }
}
