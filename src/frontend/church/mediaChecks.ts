// ----- FreeShow Church -----
// Helpful warnings when a background (video/image) is sent live but won't be visible.

import { get } from "svelte/store"
import { outputs, styles } from "../stores"
import { newToast } from "../utils/common"
import { getMediaInfo, getExtension, getMediaType } from "../components/helpers/media"

const DEFAULT_LAYERS = ["background", "slide", "overlays"]

let lastLayerWarning = 0
/** warn when no enabled output shows the background layer (e.g. a lyrics/NDI style was picked for the screen output) */
export function checkBackgroundVisible(outputIds: string[], data: any) {
    if (!data?.path && !data?.id) return
    if (data.ignoreLayer) return // "foreground" media is drawn with the slide layer

    const list = get(outputs)
    const ids = outputIds.filter((id) => list[id]?.enabled && !list[id]?.stageOutput)
    if (!ids.length) return

    const hiding = ids.filter((id) => {
        const style = get(styles)[list[id].style || ""]
        const layers = Array.isArray(style?.layers) ? style!.layers : DEFAULT_LAYERS
        return !layers.includes("background")
    })
    if (hiding.length < ids.length) return // at least one output shows it

    // don't repeat the same warning on every click
    if (Date.now() - lastLayerWarning < 20000) return
    lastLayerWarning = Date.now()

    const names = hiding.map((id) => list[id].name || "Output").join(", ")
    newToast(`Backgrounds are hidden on ${names}: the style used has the "Background" layer turned off (Settings → Styles → Active layers).`)
}

// codecs Chromium can't decode: Resolume DXV, HAP, Apple ProRes
const PRO_CODECS = /^(dxd3|dxdi|dxt1|dxt3|dxt5|dxv|hap1|hap5|hapy|hapm|hapa|ap4h|ap4x|apch|apcn|apcs|apco)/i
const checked = new Map<string, boolean>()

/** warn right away (instead of a black output) when a video uses a codec that can't be played */
export async function checkVideoPlayable(path: string) {
    if (!path || typeof path !== "string") return true
    if (getMediaType(getExtension(path)) !== "video") return true
    if (checked.has(path)) return checked.get(path)!

    const info = await getMediaInfo(path)
    const unsupported = !!info?.codecs?.some((codec) => PRO_CODECS.test(codec))
    checked.set(path, !unsupported)

    if (unsupported) {
        const name = path.split(/[\\/]/).pop() || path
        newToast(`"${name}" can't be played: it uses a pro video codec (Resolume DXV, HAP or ProRes). Use an H.264/H.265 .mp4 version of it.`)
    }
    return !unsupported
}
