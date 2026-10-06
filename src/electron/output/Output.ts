import type { BrowserWindow, Rectangle } from "electron"
import type { RtmpData } from "../../types/Output"
import type { CaptureOptions } from "../capture/CaptureOptions"

export class Output {
    window!: BrowserWindow
    invisible?: boolean
    boundsLocked?: boolean
    screen?: string | null
    intendedBounds?: Rectangle
    transparent?: boolean
    webrtcData?: any
    rtmpData?: RtmpData
    // FreeShow Church: kept so NDI can be (re)started with the right name, and screens re-shown correctly
    name?: string
    ndiData?: { name?: string; groups?: string; framerate?: number | string }
    alwaysOnTop?: boolean
    // previewWindow: BrowserWindow
    captureOptions?: CaptureOptions
    /*
    previewBounds?: {
        x: number
        y: number
        width: number
        height: number
    }*/
}
