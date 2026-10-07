import { getChurchOutputSampleRate, isChurchOutputOpen, writeChurchLTCAudio } from "./churchAudio"
// only types are imported at the top level, the actual require is done in the functions in case systems are missing dependencies
import type { LTCDecoder, LTCEncoder } from "libltc-wrapper"
import { Main } from "../../types/IPC/Main"
import { sendMain, sendToMain } from "../IPC/main"
import { processFrame } from "./timecode"
import { isWindows } from ".."
import { ToMain } from "../../types/IPC/ToMain"

// RECEIVER

// FreeShow Church: one decoder per SMPTE input (audio channel); all frames in a chunk are read (a chunk can hold more than one)
const churchDecoders: { [input: string]: { decoder: LTCDecoder; framerate: number; sampleRate: number } } = {}
let churchDecoderFailed = false
export function feedChurchLTC(input: number, framerate: number, audioframes: Buffer, onFrame: (timeMs: number, input: number) => void, rate: number = sampleRate) {
    if (churchDecoderFailed) return
    const fps = framerate || 30

    let entry = churchDecoders[input]
    if (!entry || entry.framerate !== fps || entry.sampleRate !== rate) {
        try {
            const { LTCDecoder } = require("libltc-wrapper")
            entry = { decoder: new LTCDecoder(rate, Math.round(fps), "u8") as LTCDecoder, framerate: fps, sampleRate: rate }
            churchDecoders[input] = entry
        } catch (error) {
            console.error("Failed to create LTCDecoder:", error)
            churchDecoderFailed = true
            sendToMain(ToMain.ALERT, "Could not start the timecode (LTC) decoder.")
            return
        }
    }

    entry.decoder.write(audioframes)

    let last: any
    let frame: any
    let guard = 0
    while ((frame = entry.decoder.read()) !== undefined && guard++ < 50) last = frame
    if (!last) return

    const time = last.hours * 3600 + last.minutes * 60 + last.seconds + last.frames / fps
    onFrame(time * 1000, input)
}

export function feedLTCFrame(audioframes: Buffer) {
    if (!decoder) return

    decoder.write(audioframes)

    const frame = decoder.read()
    if (frame !== undefined) {
        const time = frame.hours * 3600 + frame.minutes * 60 + frame.seconds + frame.frames / framerate
        processFrame(time * 1000)
    }
}

let decoder: LTCDecoder | null = null

let framerate = 25
const sampleRate = 48000
let decoderFailed = false
export function setupLTCListener(f = 25) {
    if (decoderFailed) return null
    framerate = f

    try {
        const { LTCDecoder } = require("libltc-wrapper")
        decoder = new LTCDecoder(sampleRate, framerate, "u8") as LTCDecoder // 48khz, 25 fps, unsigned 8 bit
    } catch (error) {
        console.error("Failed to create LTCDecoder:", error)

        let msg = "Could not initialize LTC Decoder!"
        if (isWindows) msg += "\n\nThis is likely because the required Visual C++ Redistributable is not installed.\nPlease install it from https://aka.ms/vs/17/release/vc_redist.x64.exe"
        sendToMain(ToMain.ALERT, msg)

        decoderFailed = true
        return null
    }

    return {
        stop: () => {
            decoder = null
        }
    }
}

// SENDER

let encoder: LTCEncoder | null = null
let currentFramerate: number | null = null
let currentEncoderRate = 0
let lastTimeMs = -1

let encoderFailed = false
export function sendLTC(timeMs: number, framerate: number) {
    if (encoderFailed) return

    // using default LTC_USE_DATE encoding
    // FreeShow Church: native multichannel output (Settings > Timecode) at the device's sample rate
    const nativeOut = isChurchOutputOpen()
    const rate = nativeOut ? getChurchOutputSampleRate() : sampleRate

    if (!encoder || currentFramerate !== framerate || currentEncoderRate !== rate || timeMs < lastTimeMs) {
        try {
            const { LTCEncoder } = require("libltc-wrapper")
            encoder = new LTCEncoder(rate, framerate) as LTCEncoder
            currentEncoderRate = rate
        } catch (error) {
            console.error("Failed to create LTCEncoder:", error)

            let msg = "Could not initialize LTC Encoder!"
            if (isWindows) msg += "\n\nThis is likely because the required Visual C++ Redistributable is not installed.\nPlease install it from https://aka.ms/vs/17/release/vc_redist.x64.exe"
            sendToMain(ToMain.ALERT, msg)

            encoderFailed = true
            return
        }

        currentFramerate = framerate
    }
    lastTimeMs = timeMs

    const hours = Math.floor((timeMs / (1000 * 60 * 60)) % 24)
    const minutes = Math.floor((timeMs / (1000 * 60)) % 60)
    const seconds = Math.floor((timeMs / 1000) % 60)
    const frames = Math.floor(((timeMs % 1000) / 1000) * framerate)

    // FreeShow Church: the native encoder reads "frame" (singular) - with only "frames" every frame was sent as :00
    encoder.setTimecode({ hours, minutes, seconds, frame: frames, frames } as any)

    // encoder.incrementTimecode();

    // Get 1 frame worth of LTC audio (48khz 25fps would be 40ms audio)
    encoder.encodeFrame()

    const buffer = encoder.getBuffer()
    if (nativeOut) return writeChurchLTCAudio(Buffer.from(buffer as any))
    sendMain(Main.TIMECODE_AUDIO_DATA, buffer)
}

export function stopSendLTC() {
    encoder = null
    lastTimeMs = -1
}
