// ----- FreeShow Church -----
// SMPTE/LTC sender: while a song timeline plays, its time (+ the song's offset when Timecode is on) is encoded
// to LTC in the main process and played natively on the chosen output device/channel.

import { Main } from "../../../types/IPC/Main"
import { sendMain } from "../../IPC/main"
import { getSongTimecode, getSongTimeline, getTimecodeSettings } from "./timecodeShared"

let sending = false
let lastFrame = -1

export function startSendingTimecode() {
    const s = getTimecodeSettings()
    if (!s.outEnabled || !s.outDevice) return
    sending = true
    lastFrame = -1
    sendMain(Main.TIMECODE_START, { type: "send", mode: "LTC", framerate: s.outFramerate })
}

export function stopSendingTimecode() {
    if (!sending) return
    sending = false
    lastFrame = -1
    sendMain(Main.TIMECODE_STOP, { type: "send" } as any)
}

export function sendSongTime(ref: { id: string; layoutId?: string }, timeMs: number) {
    if (!sending) return
    const s = getTimecodeSettings()

    const tc = getSongTimecode(getSongTimeline(ref.id, ref.layoutId))
    const value = timeMs + (tc.enabled ? tc.offset : 0)

    const frame = Math.floor(value / (1000 / s.outFramerate))
    if (frame === lastFrame) return
    lastFrame = frame

    sendMain(Main.TIMECODE_VALUE, value)
}
