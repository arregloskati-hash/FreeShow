// ----- FreeShow Church -----
// SMPTE/LTC receiver: listens on one audio input device; "SMPTE Timecode Input 1/2" are channels of that device.
// Each used channel goes to its own LTC decoder (main process) - decoded times come back as TIMECODE_VALUE { time, input }.
// Runs app-wide (main window), independent of any timeline.

import { get } from "svelte/store"
import { Main } from "../../../types/IPC/Main"
import { sendMain } from "../../IPC/main"
import { timecode } from "../../stores"
import { chaseFrame, chaseSignalLost } from "./chase"
import { getTimecodeSettings, hasSignal, SIGNAL_TIMEOUT, timecodeLive, type SmpteInput } from "./timecodeShared"

let stream: MediaStream | null = null
let ctx: AudioContext | null = null
let currentKey = ""
let started = false

export function initTimecodeReceiver() {
    if (started) return
    started = true

    timecode.subscribe((value) => {
        const s = getTimecodeSettings(value)
        const key = JSON.stringify([s.inAudioDevice, s.inChannel1, s.inChannel2, s.inFramerate])
        if (key === currentKey) return
        currentKey = key
        restart()
    })

    // device plugged in/out
    navigator.mediaDevices?.addEventListener?.("devicechange", () => {
        if (!getTimecodeSettings().inAudioDevice) return
        if (stream?.getAudioTracks().some((t) => t.readyState === "live")) return
        restart()
    })

    setInterval(watchdog, 200)
}

let restartId = 0
async function restart() {
    const id = ++restartId
    await stop()
    if (id !== restartId) return

    const s = getTimecodeSettings()
    if (!s.inAudioDevice) {
        timecodeLive.set({ inputs: {}, listening: false, deviceLabel: "", channelCount: 0, error: "" })
        return
    }

    try {
        const newStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: { exact: s.inAudioDevice },
                channelCount: { ideal: 16 },
                sampleRate: 48000,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        })
        if (id !== restartId) {
            newStream.getTracks().forEach((t) => t.stop())
            return
        }
        stream = newStream

        const track = stream.getAudioTracks()[0]
        const channelCount = Math.max(1, Number((track?.getSettings() as any)?.channelCount) || 2)

        ctx = new AudioContext({ sampleRate: 48000 })
        await ctx.audioWorklet.addModule("./assets/church-ltc-processor.js")
        if (id !== restartId) return

        const source = ctx.createMediaStreamSource(stream)
        const splitter = ctx.createChannelSplitter(Math.max(2, channelCount))
        source.connect(splitter)

        // keeps the graph running without making any sound
        const sink = ctx.createGain()
        sink.gain.value = 0
        sink.connect(ctx.destination)

        const inputs: [SmpteInput, number][] = [
            [1, s.inChannel1],
            [2, s.inChannel2]
        ]
        inputs.forEach(([input, channel]) => {
            if (channel < 0 || channel >= channelCount) return

            const node = new AudioWorkletNode(ctx!, "church-ltc-processor")
            splitter.connect(node, channel)
            node.connect(sink)
            node.port.onmessage = (e) => {
                sendMain(Main.TIMECODE_AUDIO_DATA, { mode: "LTC", buffer: e.data, input, framerate: s.inFramerate } as any)
            }
        })

        if (ctx.state === "suspended") await ctx.resume()

        timecodeLive.update((a) => ({ ...a, inputs: {}, listening: true, deviceLabel: track?.label || "", channelCount, error: "" }))
    } catch (err) {
        console.error("Timecode input:", err)
        if (id !== restartId) return
        timecodeLive.update((a) => ({ ...a, inputs: {}, listening: false, error: "Could not open the audio input" }))
    }
}

async function stop() {
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    if (ctx) {
        const old = ctx
        ctx = null
        try {
            await old.close()
        } catch {}
    }
}

// ---- frames from the decoder ----

let lastUiUpdate = 0
const latest: { [key in SmpteInput]?: { time: number; at: number } } = {}

export function receiveTimecodeFrame(data: { time: number; input: SmpteInput }) {
    const input: SmpteInput = data.input === 2 ? 2 : 1
    const now = performance.now()
    latest[input] = { time: data.time, at: now }

    chaseFrame(input, data.time)

    // display: ~15 updates/s is plenty
    if (now - lastUiUpdate < 66) return
    lastUiUpdate = now
    timecodeLive.update((a) => ({ ...a, inputs: { ...latest } }))
}

const lostReported: { [key in SmpteInput]?: boolean } = {}
function watchdog() {
    const now = performance.now()
    ;([1, 2] as SmpteInput[]).forEach((input) => {
        const live = latest[input]
        if (!live) return

        if (hasSignal(live, now)) {
            lostReported[input] = false
            return
        }
        if (lostReported[input]) return
        lostReported[input] = true

        chaseSignalLost(input)
        timecodeLive.update((a) => ({ ...a, inputs: { ...latest } }))
    })
}

export function getLatestTimecode(input: SmpteInput) {
    const live = latest[input]
    if (!live || performance.now() - live.at > SIGNAL_TIMEOUT) return null
    return live.time
}

// for the settings page (the device must be opened once to know its channel count)
export function getReceiverChannelCount() {
    return get(timecodeLive).channelCount
}
