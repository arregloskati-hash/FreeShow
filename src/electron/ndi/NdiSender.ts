import os from "os"
import { toApp } from ".."
import { CaptureHelper } from "../capture/CaptureHelper"
import util from "./vingester-util"

// Dynamic import for grandiose ES module to prevent TypeScript compilation issues
let warned = false
let grandioseModule: any | null = null
let grandiosePromise: Promise<any | null> | null = null
const loadGrandiose = async () => {
    if (grandioseModule) return grandioseModule
    if (grandiosePromise) return grandiosePromise

    grandiosePromise = import("grandiose")
        .then((imported) => {
            grandioseModule = imported
            return imported
        })
        .catch((err: any) => {
            if (!warned) console.warn("NDI not available:", err?.message || err)
            warned = true
            return null
        })
        .finally(() => {
            grandiosePromise = null
        })

    return grandiosePromise
}

// Resources:
// https://www.npmjs.com/package/grandiose-mac
// https://github.com/Streampunk/grandiose
// https://github.com/rse/grandiose
// https://github.com/rse/vingester

export class NdiSender {
    private static readonly BYTES_PER_PIXEL = 4
    private static readonly BYTES_PER_FLOAT32 = 4
    private static readonly PADDING_ALIGNMENT = 16
    private static readonly CONNECTION_POLL_INTERVAL_MS = 1000
    private static readonly TIMECODE_DIVISOR = BigInt(100)

    static timeStart = BigInt(Date.now()) * BigInt(1e6) - process.hrtime.bigint()
    static NDI: {
        [key: string]: {
            name: string
            groups?: string
            status?: string
            previousStatus?: string
            sender?: any
            timer?: NodeJS.Timeout
            sendingVideo?: boolean
            pendingVideoFrame?: any
            sendingAudio?: boolean
            audioQueue?: any[]
            paddedVideoBuffer?: Buffer
            paddedVideoBufferStride?: number
            paddedVideoBufferHeight?: number
        }
    } = {}

    // FreeShow Church: senders that are shutting down (finishing a frame that is being sent right now)
    private static stopping: { [key: string]: Promise<void> | undefined } = {}

    static stopSenderNDI(id: string) {
        const senderData = this.NDI[id]
        if (!senderData) return

        console.info("NDI - stopping sender: " + (senderData.name || id))
        if (senderData.timer) {
            clearInterval(senderData.timer)
        }

        // stop accepting frames right away
        delete this.NDI[id]
        senderData.pendingVideoFrame = undefined
        senderData.audioQueue = []

        const sender = senderData.sender
        if (!sender) return

        // never destroy the native sender while it is sending a frame (could freeze or crash NDI)
        const destroy = () => {
            try {
                sender.destroy()
            } catch (err) {
                console.error("ERROR", err)
            }
        }

        if (!senderData.sendingVideo && !senderData.sendingAudio) {
            destroy()
            return
        }

        const started = Date.now()
        const done = new Promise<void>((resolve) => {
            const check = () => {
                if ((!senderData.sendingVideo && !senderData.sendingAudio) || Date.now() - started > 1000) {
                    destroy()
                    resolve()
                } else setTimeout(check, 5)
            }
            check()
        })

        this.stopping[id] = done
        done.finally(() => {
            if (this.stopping[id] === done) delete this.stopping[id]
        })
    }

    private static async sendQueuedVideoFrameNDI(id: string) {
        const senderData = this.NDI[id]
        if (!senderData?.sender || senderData.sendingVideo) return

        const frame = senderData.pendingVideoFrame
        if (!frame) return

        senderData.pendingVideoFrame = undefined
        senderData.sendingVideo = true

        try {
            await senderData.sender.video(frame)
        } catch (err) {
            console.error("Error sending NDI video frame:", err)
        } finally {
            senderData.sendingVideo = false
            if (this.NDI[id] === senderData && senderData.pendingVideoFrame) {
                void this.sendQueuedVideoFrameNDI(id)
            }
        }
    }

    private static async sendQueuedAudioFrameNDI(id: string) {
        const senderData = this.NDI[id]
        if (!senderData?.sender || senderData.sendingAudio) return

        senderData.sendingAudio = true

        try {
            while (senderData.audioQueue && senderData.audioQueue.length > 0) {
                // stop if this sender was stopped/replaced
                if (this.NDI[id] !== senderData || !senderData.sender) break

                // Limit queue to prevent excessive memory/latency if sending is falling behind
                if (senderData.audioQueue.length > 50) {
                    senderData.audioQueue.splice(0, senderData.audioQueue.length - 20)
                }

                const frame = senderData.audioQueue.shift()
                if (frame) {
                    await senderData.sender.audio(frame)
                }
            }
        } catch (err) {
            console.error("Error sending NDI audio frame:", err)
        } finally {
            senderData.sendingAudio = false
            if (this.NDI[id] === senderData && senderData.sender && senderData.audioQueue && senderData.audioQueue.length > 0) {
                void this.sendQueuedAudioFrameNDI(id)
            }
        }
    }

    static initNameNDI(name?: string, outputName?: string) {
        return name || `FreeShow NDI${outputName ? ` - ${outputName}` : ""}`
    }

    static async createSenderNDI(id: string, name = "", groups?: string) {
        if (this.NDI[id]) {
            this.stopSenderNDI(id)
        }

        // wait until a previous sender for this output is really gone, so receivers never see two sources with the same name
        if (this.stopping[id]) await this.stopping[id]
        // (another create for this output may have started meanwhile - the newest one wins)
        if (this.NDI[id]) this.stopSenderNDI(id)

        const senderData: (typeof NdiSender.NDI)[string] = {
            name,
            groups
        }
        this.NDI[id] = senderData
        console.info("NDI - creating sender: " + this.NDI[id].name, groups ? `; In group: ${groups}` : "")

        try {
            const grandiose = await loadGrandiose()
            if (!grandiose) return

            /* eslint @typescript-eslint/await-thenable: 0 */
            const sender = await grandiose.send({
                name: this.NDI[id].name,
                groups: this.NDI[id].groups,
                clockVideo: false,
                clockAudio: false
            })

            // If stopSenderNDI (or a newer create) happened while await grandiose.send was in progress
            if (this.NDI[id] !== senderData) {
                try {
                    sender.destroy()
                } catch {}
                return
            }

            senderData.sender = sender
        } catch (err) {
            console.error("Could not create NDI sender:", err)
            if (this.NDI[id] === senderData) delete this.NDI[id]
            return
        }

        senderData.timer = setInterval(() => {
            if (this.NDI[id] !== senderData) return
            if (!this.NDI[id]?.sender) return
            /*  poll NDI for connections  */
            const conns: number = this.NDI[id].sender?.connections() || 0
            this.NDI[id].status = conns > 0 ? "connected" : "unconnected"

            const newStatus = String(this.NDI[id].status) + conns.toString()
            if (newStatus !== this.NDI[id].previousStatus) {
                toApp("NDI", { channel: "SEND_DATA", data: { id, status: this.NDI[id].status, connections: conns } })
                CaptureHelper.updateFramerate(id)

                this.NDI[id].previousStatus = newStatus

                if (this.NDI[id].status === "connected") {
                    console.log(`[NDI] Reconnected for ${id}`)
                }
            }
        }, this.CONNECTION_POLL_INTERVAL_MS)
    }

    static async sendVideoBufferNDI(id: string, buffer: Buffer, { size = { width: 1280, height: 720 }, ratio = 16 / 9, framerate = 1, transparent = true }) {
        const senderData = this.NDI[id]
        if (!senderData?.sender) return

        const grandiose = grandioseModule || (await loadGrandiose())
        if (!grandiose) return

        // Convert buffer format for NDI
        if (os.endianness() === "BE") util.ImageBufferAdjustment.ARGBtoBGRA(buffer)

        const fourCC = transparent ? grandiose.FOURCC_BGRA : grandiose.FOURCC_BGRX
        if (!transparent) util.ImageBufferAdjustment.BGRAtoBGRX(buffer)
        // FreeShow Church: Chromium captures with premultiplied alpha, NDI expects straight alpha. Without this,
        // every soft edge (anti-aliased text, glows, shadows, fades) arrives darker and off-color at the receiver.
        else NdiSender.unpremultiplyAlpha(buffer)

        const timecode = (this.timeStart + process.hrtime.bigint()) / this.TIMECODE_DIVISOR

        // Pad width to 16-byte alignment for NDI
        const paddedWidth = (size.width + this.PADDING_ALIGNMENT - 1) & ~(this.PADDING_ALIGNMENT - 1)
        const stride = paddedWidth * this.BYTES_PER_PIXEL
        const sendBuffer = this.getPaddedBuffer(senderData, buffer, size, stride, paddedWidth)

        senderData.pendingVideoFrame = {
            timecode,
            xres: paddedWidth,
            yres: size.height,
            frameRateN: framerate * 1000,
            frameRateD: 1000,
            pictureAspectRatio: ratio,
            frameFormatType: grandiose.FORMAT_TYPE_PROGRESSIVE,
            lineStrideBytes: stride,
            fourCC,
            data: sendBuffer
        }

        void this.sendQueuedVideoFrameNDI(id)
    }

    // c * 255 / a for every alpha (1-254) and color value, so the per-pixel work is one table lookup
    private static unpremultiplyTable: Uint8Array | null = null
    private static getUnpremultiplyTable() {
        if (this.unpremultiplyTable) return this.unpremultiplyTable
        const table = new Uint8Array(256 * 256)
        for (let a = 1; a < 256; a++) {
            for (let c = 0; c <= a; c++) table[a * 256 + c] = Math.min(255, Math.round((c * 255) / a))
            for (let c = a + 1; c < 256; c++) table[a * 256 + c] = 255 // invalid premultiplied value, clamp
        }
        this.unpremultiplyTable = table
        return table
    }

    static unpremultiplyAlpha(buffer: Buffer) {
        const table = this.getUnpremultiplyTable()
        const length = buffer.length - (buffer.length % 4)

        // fast path: check alpha 4 bytes at a time, only touch semi-transparent pixels (usually a small share)
        if (buffer.byteOffset % 4 === 0 && os.endianness() === "LE") {
            const pixels = new Uint32Array(buffer.buffer, buffer.byteOffset, length / 4)
            for (let i = 0; i < pixels.length; i++) {
                const a = pixels[i] >>> 24
                if (a === 0 || a === 255) continue
                const o = i * 4
                const row = a * 256
                buffer[o] = table[row + buffer[o]]
                buffer[o + 1] = table[row + buffer[o + 1]]
                buffer[o + 2] = table[row + buffer[o + 2]]
            }
            return
        }

        for (let o = 0; o < length; o += 4) {
            const a = buffer[o + 3]
            if (a === 0 || a === 255) continue
            const row = a * 256
            buffer[o] = table[row + buffer[o]]
            buffer[o + 1] = table[row + buffer[o + 1]]
            buffer[o + 2] = table[row + buffer[o + 2]]
        }
    }

    private static getPaddedBuffer(senderData: any, buffer: Buffer, size: { width: number; height: number }, stride: number, paddedWidth: number): Buffer {
        if (paddedWidth === size.width) return buffer

        // reuse cached buffer if dimensions match
        if (senderData.paddedVideoBuffer && senderData.paddedVideoBufferStride === stride && senderData.paddedVideoBufferHeight === size.height) {
            const cachedBuffer = senderData.paddedVideoBuffer
            this.copyRowsToPaddedBuffer(buffer, cachedBuffer, size, stride)
            return cachedBuffer
        }

        const paddedBuffer = Buffer.alloc(stride * size.height)
        senderData.paddedVideoBuffer = paddedBuffer
        senderData.paddedVideoBufferStride = stride
        senderData.paddedVideoBufferHeight = size.height

        this.copyRowsToPaddedBuffer(buffer, paddedBuffer, size, stride)
        return paddedBuffer
    }

    private static copyRowsToPaddedBuffer(source: Buffer, dest: Buffer, size: { width: number; height: number }, stride: number): void {
        const rowBytes = size.width * this.BYTES_PER_PIXEL
        for (let y = 0; y < size.height; y++) {
            source.copy(dest, y * stride, y * rowBytes, (y + 1) * rowBytes)
        }
    }

    static async sendAudioBufferNDITarget(id: string, buffer: Buffer, { sampleRate, channelCount }: { sampleRate: number; channelCount: number }) {
        const senderData = this.NDI[id]
        if (!senderData?.sender || !buffer || buffer.length === 0) return

        const grandiose = grandioseModule || (await loadGrandiose())
        if (!grandiose) return

        const noSamples = Math.trunc(buffer.length / (channelCount * this.BYTES_PER_FLOAT32))
        if (noSamples <= 0) return

        const frame = {
            sampleRate,
            noChannels: channelCount,
            noSamples,
            channelStrideBytes: noSamples * this.BYTES_PER_FLOAT32,
            fourCC: grandiose.FOURCC_FLTp,
            data: buffer
        }

        if (!senderData.audioQueue) senderData.audioQueue = []
        senderData.audioQueue.push(frame)
        void this.sendQueuedAudioFrameNDI(id)
    }

    static async sendAudioBufferNDI(buffer: Buffer, { sampleRate, channelCount }: { sampleRate: number; channelCount: number }) {
        const hasSender = Object.values(this.NDI).some((s) => s?.sender)
        if (!hasSender || !buffer || buffer.length === 0) return

        const grandiose = grandioseModule || (await loadGrandiose())
        if (!grandiose) return

        const noSamples = Math.trunc(buffer.length / (channelCount * this.BYTES_PER_FLOAT32))
        if (noSamples <= 0) return

        const frame = {
            sampleRate,
            noChannels: channelCount,
            noSamples,
            channelStrideBytes: noSamples * this.BYTES_PER_FLOAT32,
            fourCC: grandiose.FOURCC_FLTp,
            data: buffer
        }

        Object.keys(this.NDI).forEach((id) => {
            const senderData = this.NDI[id]
            if (!senderData?.sender) return

            if (!senderData.audioQueue) senderData.audioQueue = []
            senderData.audioQueue.push({ ...frame })
            void this.sendQueuedAudioFrameNDI(id)
        })
    }
}
