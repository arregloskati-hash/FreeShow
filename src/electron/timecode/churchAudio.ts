// ----- FreeShow Church -----
// Native (CoreAudio / WASAPI) audio I/O for SMPTE timecode, using RtAudio (audify).
// The browser audio API only exposes the first 2 channels of an interface, this sees every channel:
// - input:  one stream with ALL channels of the device; SMPTE Input 1/2 are any of those channels
// - output: LTC written to any channel (or all) of any output device

import { app } from "electron"
import { Main } from "../../types/IPC/Main"
import { sendMain } from "../IPC/main"
import { feedChurchLTC } from "./LTC"

const FLOAT32 = 0x10 // RtAudioFormat.RTAUDIO_FLOAT32
const FRAME_SIZE = 480 // samples per callback (10 ms at 48 kHz)

interface DeviceInfo {
    id: number
    name: string
    inputChannels: number
    outputChannels: number
    preferredSampleRate: number
    sampleRates?: number[]
}

let RtAudio: any = null
let loadError = ""
function getRtAudio() {
    if (RtAudio || loadError) return RtAudio
    try {
        RtAudio = require("audify").RtAudio
    } catch (err) {
        loadError = "The audio driver could not be loaded: " + String((err as any)?.message || err)
        console.error("Timecode audio:", err)
    }
    return RtAudio
}

// IMPORTANT: RtAudio instances are created once and never released. When a closed instance gets garbage
// collected, its destructor reports through an already released callback and Electron aborts (SIGABRT).
const instances: { [role: string]: any } = {}
function getInstance(role: "list" | "input" | "output") {
    const Rt = getRtAudio()
    if (!Rt) return null
    if (!instances[role]) instances[role] = new Rt()
    return instances[role]
}

function getDevices(): DeviceInfo[] {
    const rt = getInstance("list")
    if (!rt) return []
    try {
        return rt.getDevices() as DeviceInfo[]
    } catch (err) {
        console.error("Timecode audio devices:", err)
        return []
    }
}

function pickSampleRate(device: DeviceInfo) {
    const rates = device.sampleRates || []
    if (rates.includes(48000)) return 48000
    return device.preferredSampleRate || rates[rates.length - 1] || 48000
}

export function listChurchAudioDevices() {
    const devices = getDevices()
    return {
        inputs: devices.filter((d) => d.inputChannels > 0).map((d) => ({ name: d.name, channels: d.inputChannels })),
        outputs: devices.filter((d) => d.outputChannels > 0).map((d) => ({ name: d.name, channels: d.outputChannels })),
        error: loadError
    }
}

// ---- INPUT ----

interface InputConfig {
    device: string
    channels: [number, number] // SMPTE Input 1/2 -> 0-based device channel, -1 = off
    framerate: number
    force?: boolean
}

let inputStream: any = null
let inputKey = ""
let inputStatus = { listening: false, device: "", channelCount: 0, sampleRate: 0, error: "" }

export function configureChurchInput(config: InputConfig) {
    const key = JSON.stringify([config.device, config.channels, config.framerate])
    if (!config.force && key === inputKey && (inputStream || !config.device)) return inputStatus
    inputKey = key

    stopInput()
    inputStatus = { listening: false, device: config.device, channelCount: 0, sampleRate: 0, error: "" }
    if (!config.device) return inputStatus

    const rt = getInstance("input")
    if (!rt) return (inputStatus = { ...inputStatus, error: loadError })

    const device = getDevices().find((d) => d.name === config.device && d.inputChannels > 0)
    if (!device) return (inputStatus = { ...inputStatus, error: "Device not connected" })

    const nChannels = device.inputChannels
    const sampleRate = pickSampleRate(device)
    const used = config.channels.map((ch, i) => ({ input: i + 1, ch })).filter((a) => a.ch >= 0 && a.ch < nChannels)

    try {
        rt.openStream(
            null,
            { deviceId: device.id, nChannels, firstChannel: 0 },
            FLOAT32,
            sampleRate,
            FRAME_SIZE,
            "FreeShow Timecode In",
            (data: Buffer) => {
                const samples = new Float32Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 4))
                const frames = Math.floor(samples.length / nChannels)

                used.forEach(({ input, ch }) => {
                    // a fresh buffer every time (the decoder may still hold the previous one)
                    const u8 = Buffer.allocUnsafe(frames)
                    for (let i = 0; i < frames; i++) {
                        const s = samples[i * nChannels + ch]
                        u8[i] = s >= 1 ? 255 : s <= -1 ? 0 : Math.floor(s * 128 + 128)
                    }
                    feedChurchLTC(input, config.framerate, u8, onFrame, sampleRate)
                })
            },
            null,
            0,
            (_type: number, msg: string) => console.warn("Timecode input:", msg)
        )
        rt.start()
        inputStream = rt
        inputStatus = { listening: true, device: device.name, channelCount: nChannels, sampleRate, error: "" }
    } catch (err) {
        console.error("Timecode input:", err)
        closeSafely(rt)
        inputStream = null
        inputStatus = { ...inputStatus, listening: false, channelCount: nChannels, error: "Could not open the audio input" }
    }

    return inputStatus
}

function onFrame(time: number, input: number) {
    sendMain(Main.TIMECODE_VALUE, { time, input })
}

function stopInput() {
    if (!inputStream) return
    closeSafely(inputStream)
    inputStream = null
}

function closeSafely(rt: any) {
    try {
        if (rt.isStreamRunning()) rt.stop()
    } catch {}
    try {
        if (rt.isStreamOpen()) rt.closeStream()
    } catch {}
}

export function getChurchInputStatus() {
    return inputStatus
}

// ---- OUTPUT ----

interface OutputConfig {
    enabled: boolean
    device: string
    channel: number // 0-based, -1 = all channels
    force?: boolean
}

let output: { rt: any; nChannels: number; channel: number; sampleRate: number; pending: Float32Array; pendingLength: number; queued: number } | null = null
let outputKey = ""
let outputStatus = { open: false, device: "", channelCount: 0, sampleRate: 0, error: "" }

export function configureChurchOutput(config: OutputConfig) {
    const key = JSON.stringify([config.enabled, config.device, config.channel])
    if (!config.force && key === outputKey && (output || !config.enabled || !config.device)) return outputStatus
    outputKey = key

    stopOutput()
    outputStatus = { open: false, device: config.device, channelCount: 0, sampleRate: 0, error: "" }
    if (!config.enabled || !config.device) return outputStatus

    const rt = getInstance("output")
    if (!rt) return (outputStatus = { ...outputStatus, error: loadError })

    const device = getDevices().find((d) => d.name === config.device && d.outputChannels > 0)
    if (!device) return (outputStatus = { ...outputStatus, error: "Device not connected" })

    const nChannels = device.outputChannels
    const sampleRate = pickSampleRate(device)
    try {
        rt.openStream(
            { deviceId: device.id, nChannels, firstChannel: 0 },
            null,
            FLOAT32,
            sampleRate,
            FRAME_SIZE,
            "FreeShow Timecode Out",
            null,
            () => {
                if (output) output.queued = Math.max(0, output.queued - 1)
            },
            0,
            (_type: number, msg: string) => console.warn("Timecode output:", msg)
        )
        rt.start()
        output = { rt, nChannels, channel: config.channel < nChannels ? config.channel : -1, sampleRate, pending: new Float32Array(FRAME_SIZE * 8), pendingLength: 0, queued: 0 }
        outputStatus = { open: true, device: device.name, channelCount: nChannels, sampleRate, error: "" }
    } catch (err) {
        console.error("Timecode output:", err)
        closeSafely(rt)
        output = null
        outputStatus = { ...outputStatus, channelCount: nChannels, error: "Could not open the audio output" }
    }

    return outputStatus
}

function stopOutput() {
    if (!output) return
    try {
        output.rt.clearOutputQueue()
    } catch {}
    closeSafely(output.rt)
    output = null
}

export function isChurchOutputOpen() {
    return !!output
}
export function getChurchOutputSampleRate() {
    return output?.sampleRate || 48000
}

const MAX_QUEUED_BLOCKS = 20 // ~200 ms

/** one LTC frame of unsigned 8-bit mono samples (at the output sample rate) */
export function writeChurchLTCAudio(u8: Buffer) {
    if (!output) return
    const o = output

    // keep latency low: if the queue grew (the timeline runs a bit fast), start fresh
    if (o.queued > MAX_QUEUED_BLOCKS) {
        try {
            o.rt.clearOutputQueue()
        } catch {}
        o.queued = 0
        o.pendingLength = 0
    }

    if (o.pending.length < o.pendingLength + u8.length) {
        const bigger = new Float32Array((o.pendingLength + u8.length) * 2)
        bigger.set(o.pending.subarray(0, o.pendingLength))
        o.pending = bigger
    }
    for (let i = 0; i < u8.length; i++) o.pending[o.pendingLength + i] = (u8[i] - 128) / 128
    o.pendingLength += u8.length

    while (o.pendingLength >= FRAME_SIZE) {
        const block = new Float32Array(FRAME_SIZE * o.nChannels)
        for (let i = 0; i < FRAME_SIZE; i++) {
            const s = o.pending[i]
            if (o.channel >= 0) block[i * o.nChannels + o.channel] = s
            else for (let c = 0; c < o.nChannels; c++) block[i * o.nChannels + c] = s
        }
        try {
            o.rt.write(Buffer.from(block.buffer))
            o.queued++
        } catch (err) {
            console.warn("Timecode output:", err)
        }
        o.pending.copyWithin(0, FRAME_SIZE, o.pendingLength)
        o.pendingLength -= FRAME_SIZE
    }
}

/** close all native audio streams (app quit) - the audio threads must be stopped before Node shuts down */
export function shutdownChurchAudio() {
    stopInput()
    stopOutput()
    inputKey = outputKey = ""
}

// also on any other way of quitting
app.on("before-quit", () => shutdownChurchAudio())
process.once("exit", () => shutdownChurchAudio())
