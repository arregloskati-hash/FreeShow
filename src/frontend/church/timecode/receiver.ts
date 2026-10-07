// ----- FreeShow Church -----
// SMPTE/LTC receive + send configuration. The audio itself runs natively in the main process (all channels of
// any interface): "SMPTE Timecode Input 1/2" are channels of the input device, decoded times come back as
// TIMECODE_VALUE { time, input }. Runs app-wide (main window), independent of any timeline.

import { get } from "svelte/store"
import { Main } from "../../../types/IPC/Main"
import { requestMain } from "../../IPC/main"
import { timecode } from "../../stores"
import { chaseFrame, chaseSignalLost } from "./chase"
import { audioDevices, getTimecodeSettings, hasSignal, SIGNAL_TIMEOUT, timecodeLive, timecodeOutStatus, type SmpteInput } from "./timecodeShared"

let started = false
let inputKey = ""
let outputKey = ""

export function initTimecodeReceiver() {
    if (started) return
    started = true

    timecode.subscribe((value) => {
        const s = getTimecodeSettings(value)

        const inKey = JSON.stringify([s.inAudioDevice, s.inChannel1, s.inChannel2, s.inFramerate])
        if (inKey !== inputKey) {
            inputKey = inKey
            configureInput()
        }

        const outKey = JSON.stringify([s.outEnabled, s.outDevice, s.outChannel])
        if (outKey !== outputKey) {
            outputKey = outKey
            configureOutput()
        }
    })

    // device plugged in/out: re-open what's configured
    navigator.mediaDevices?.addEventListener?.("devicechange", () => {
        setTimeout(() => {
            refreshAudioDevices()
            const live = get(timecodeLive)
            if (getTimecodeSettings().inAudioDevice && !live.listening) configureInput(true)
            if (getTimecodeSettings().outEnabled && !get(timecodeOutStatus).open) configureOutput(true)
        }, 800)
    })

    setInterval(watchdog, 200)
}

export async function refreshAudioDevices() {
    const list = await requestMain(Main.CHURCH_AUDIO_DEVICES)
    if (list) audioDevices.set(list)
    return list
}

async function configureInput(force = false) {
    const s = getTimecodeSettings()
    const status = await requestMain(Main.CHURCH_TIMECODE_INPUT, { device: s.inAudioDevice, channels: [s.inChannel1, s.inChannel2], framerate: s.inFramerate, force })
    if (!status) return
    if (force && !status.listening) return
    timecodeLive.update((a) => ({ ...a, inputs: {}, listening: status.listening, deviceLabel: status.device, channelCount: status.channelCount, error: status.error }))
}

async function configureOutput(force = false) {
    const s = getTimecodeSettings()
    const status = await requestMain(Main.CHURCH_TIMECODE_OUTPUT, { enabled: s.outEnabled, device: s.outDevice, channel: s.outChannel, force })
    if (status) timecodeOutStatus.set(status)
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
