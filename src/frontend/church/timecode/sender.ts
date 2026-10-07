// ----- FreeShow Church -----
// SMPTE/LTC sender: while a song timeline plays, its time (+ the song's offset when Timecode is on) is encoded
// to LTC in the main process; the audio frames come back here and are played gap-free on the chosen
// output device/channel.

import { Main } from "../../../types/IPC/Main"
import { sendMain } from "../../IPC/main"
import { getSongTimecode, getSongTimeline, getTimecodeSettings } from "./timecodeShared"

let sending = false
let lastFrame = -1

export function startSendingTimecode() {
    const s = getTimecodeSettings()
    if (!s.outEnabled || !s.audioOutput) return
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

// ---- audio ----

let ctx: AudioContext | null = null
let sinkId = ""
let nextStart = 0

export function isChurchSender() {
    return getTimecodeSettings().outEnabled
}

export async function playLTCFrame(buffer: Uint8Array) {
    const s = getTimecodeSettings()
    if (!s.audioOutput || !buffer?.length) return

    try {
        if (!ctx) ctx = new AudioContext({ sampleRate: 48000 })
        if (sinkId !== s.audioOutput && (ctx as any).setSinkId) {
            sinkId = s.audioOutput
            await (ctx as any).setSinkId(s.audioOutput).catch((e: unknown) => console.warn("LTC output:", e))
            nextStart = 0
        }
        if (ctx.state === "suspended") await ctx.resume()

        // channel routing: one channel, or the same signal on all
        const maxChannels = ctx.destination.maxChannelCount || 2
        const channel = s.outChannel >= 0 && s.outChannel < maxChannels ? s.outChannel : -1
        const channels = channel >= 0 ? channel + 1 : 1
        if (channel >= 0) {
            ctx.destination.channelCount = Math.max(channels, Math.min(maxChannels, 2))
            ctx.destination.channelInterpretation = "discrete"
        } else {
            ctx.destination.channelCount = Math.min(maxChannels, 2)
            ctx.destination.channelInterpretation = "speakers"
        }

        const audioBuffer = ctx.createBuffer(channels, buffer.length, 48000)
        const data = audioBuffer.getChannelData(channel >= 0 ? channel : 0)
        for (let i = 0; i < buffer.length; i++) data[i] = (buffer[i] - 128) / 128

        const source = ctx.createBufferSource()
        source.buffer = audioBuffer
        source.connect(ctx.destination)

        // queue right after the previous frame (no gaps/clicks); resync if we fell behind or ran ahead
        const now = ctx.currentTime
        if (nextStart < now + 0.01 || nextStart > now + 0.25) nextStart = now + 0.04
        source.start(nextStart)
        nextStart += audioBuffer.duration
    } catch (err) {
        console.warn("Could not play LTC frame:", err)
    }
}
