// ----- FreeShow Church -----
// Timecode (SMPTE/LTC) shared state + helpers.
//
// Settings (Settings > Timecode) live in the existing `timecode` store (saved with the settings):
//   receive: inAudioDevice, inFramerate, inChannel1, inChannel2 (0-based channel of the device, -1 = off)
//   send:    outEnabled, outDevice, outFramerate, outChannel (-1 = all channels)
// Devices are native audio devices (all channels), stored by name.
// Per song (show layout timeline): timeline.timecode = { enabled, offset (ms), input (1|2) }, timeline.duration (s)

import { get, writable } from "svelte/store"
import type { Timeline } from "../../../types/Show"
import { showsCache, timecode } from "../../stores"

export type SmpteInput = 1 | 2

export interface ChurchTimecodeSettings {
    inAudioDevice: string
    inFramerate: number
    inChannel1: number
    inChannel2: number
    outEnabled: boolean
    outDevice: string
    outFramerate: number
    outChannel: number
}

export const FRAMERATES = [24, 25, 29.97, 30]

export function getTimecodeSettings(value: any = get(timecode)): ChurchTimecodeSettings {
    const a = value || {}
    return {
        // (an id from the old browser-based input isn't a device name - ignore it)
        inAudioDevice: a.inAudioDevice && !/^[0-9a-f]{32,}$/i.test(a.inAudioDevice) ? a.inAudioDevice : "",
        inFramerate: Number(a.inFramerate) || 30,
        inChannel1: typeof a.inChannel1 === "number" ? a.inChannel1 : 0,
        inChannel2: typeof a.inChannel2 === "number" ? a.inChannel2 : -1,
        outEnabled: !!a.outEnabled,
        outDevice: a.outDevice || "",
        outFramerate: Number(a.outFramerate) || 30,
        outChannel: typeof a.outChannel === "number" ? a.outChannel : -1
    }
}

export function updateTimecodeSettings(values: Partial<ChurchTimecodeSettings>) {
    timecode.update((a: any) => ({ ...(a || {}), ...values }))
}

// ---- native audio devices / output status ----

export const audioDevices = writable<{ inputs: { name: string; channels: number }[]; outputs: { name: string; channels: number }[]; error: string }>({ inputs: [], outputs: [], error: "" })
export const timecodeOutStatus = writable<{ open: boolean; device: string; channelCount: number; sampleRate: number; error: string }>({ open: false, device: "", channelCount: 0, sampleRate: 0, error: "" })

// ---- live input state ----

export const SIGNAL_TIMEOUT = 600 // ms without frames = no signal

export interface LiveInput {
    time: number // ms
    at: number // performance.now() of the last frame
}

export const timecodeLive = writable<{
    inputs: { [key in SmpteInput]?: LiveInput }
    listening: boolean
    deviceLabel: string
    channelCount: number
    error: string
}>({ inputs: {}, listening: false, deviceLabel: "", channelCount: 0, error: "" })

export function hasSignal(input: LiveInput | undefined, now = performance.now()) {
    return !!input && now - input.at < SIGNAL_TIMEOUT
}

// ---- formatting ----

const pad = (n: number) => Math.floor(n).toString().padStart(2, "0")

/** 3600000 -> "01:00:00:00" (frames) */
export function formatSmpte(ms: number, fps = 30) {
    ms = Math.max(0, ms || 0)
    const totalSeconds = Math.floor(ms / 1000)
    const frames = Math.floor(((ms % 1000) / 1000) * Math.round(fps))
    return `${pad(totalSeconds / 3600)}:${pad((totalSeconds % 3600) / 60)}:${pad(totalSeconds % 60)}:${pad(frames)}`
}

/** "01:00:00;00" / "01:00:00:12" / "1:00:00" -> ms (last part = frames when there are 4 parts) */
export function parseSmpte(value: string, fps = 30): number | null {
    const parts = (value || "")
        .trim()
        .split(/[:;.]/)
        .filter((a) => a !== "")
        .map((a) => Number(a))
    if (!parts.length || parts.some((a) => isNaN(a) || a < 0)) return null

    let frames = 0
    if (parts.length === 4) frames = parts.pop()!
    while (parts.length < 3) parts.unshift(0)
    const [h, m, s] = parts.slice(-3)

    return Math.round((h * 3600 + m * 60 + s) * 1000 + (frames / Math.round(fps)) * 1000)
}

// ---- per song settings ----

export interface SongTimecode {
    enabled: boolean
    offset: number // ms
    input: SmpteInput
}

const ONE_MINUTE = 60000

export function getSongTimeline(showId: string, layoutId?: string): (Timeline & { timecode?: SongTimecode; duration?: number }) | null {
    const show = get(showsCache)[showId]
    if (!show) return null
    const id = layoutId || show.settings?.activeLayout || ""
    return (show.layouts?.[id]?.timeline as any) || null
}

export function getSongTimecode(timeline: any): SongTimecode {
    const tc = timeline?.timecode || {}
    return { enabled: !!tc.enabled, offset: Number(tc.offset) || 0, input: tc.input === 2 ? 2 : 1 }
}

/** the song's timeline length in ms (set duration, never shorter than its last action) */
export function getSongDuration(timeline: any) {
    const actions: any[] = timeline?.actions || []
    const lastAction = actions.length ? Math.max(...actions.map((a) => a.time + (a.duration || 0) * 1000)) : 0
    const set = Number(timeline?.duration) || 0
    if (set > 0) return Math.max(set * 1000, lastAction)
    return Math.max(5 * ONE_MINUTE, lastAction + ONE_MINUTE)
}

export function updateSongTimeline(showId: string, layoutId: string, values: { timecode?: Partial<SongTimecode>; duration?: number }) {
    showsCache.update((a) => {
        const layout = a[showId]?.layouts?.[layoutId]
        if (!layout) return a

        if (!layout.timeline) layout.timeline = { actions: [] }
        const timeline: any = layout.timeline
        if (values.timecode) timeline.timecode = { ...getSongTimecode(timeline), ...values.timecode }
        if (values.duration !== undefined) timeline.duration = values.duration

        return a
    })
}
