import { get } from "svelte/store"
import type { Popups } from "../../../../types/Main"
import type { DrawerTabIds } from "../../../../types/Tabs"
import { activeDrawerTab, activePage, activePopup, drawer, drawerTabsData } from "../../../stores"
import { hexToRgb } from "../../helpers/color"

// COLOR

// Add opacity to each color stop in the gradient (hex, rgb/rgba in comma or space syntax, hsl/hsla)
// FreeShow Church: also handles "rgb(255 0 0)" / "rgb(255 0 0 / 0.5)" (used by custom gradients) and decimals
const GRADIENT_COLOR_REGEX = /(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\))/g
function colorNumbers(color: string) {
    return color
        .slice(color.indexOf("(") + 1, color.lastIndexOf(")"))
        .replace("/", " ")
        .split(/[\s,]+/)
        .map((a) => a.trim())
        .filter(Boolean)
}
export function addOpacityToGradient(gradientValue: string, alpha: number) {
    return gradientValue.replace(GRADIENT_COLOR_REGEX, (color) => {
        if (color.startsWith("#")) {
            const rgb = hexToRgb(color)
            if (rgb) return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
            return color
        }

        const nums = colorNumbers(color)
        if (nums.length < 3) return color
        if (color.toLowerCase().startsWith("hsl")) return `hsla(${nums[0]}, ${nums[1]}, ${nums[2]}, ${alpha})`
        return `rgba(${nums[0]}, ${nums[1]}, ${nums[2]}, ${alpha})`
    })
}

// Get the first color stop's alpha value from a gradient string
export function getGradientOpacity(gradientValue: string): number {
    const match = gradientValue.match(/(rgba?|hsla?)\([^)]*\)/i)
    if (!match) return 1
    const nums = colorNumbers(match[0])
    if (nums.length < 4) return 1
    const alpha = nums[3].endsWith("%") ? parseFloat(nums[3]) / 100 : parseFloat(nums[3])
    return isNaN(alpha) ? 1 : Math.max(0, Math.min(1, alpha))
}

// valueIndex splits
export function parseShadowValue(value): string[] {
    // Handles: text-shadow: 10px 10px 4px #ff0000 65 54 / 0.47
    // Returns: [10px, 10px, 4px, #ff0000, 65, 54, /, 0.47]
    if (!value) return []

    // Remove "inset" first so it doesn't mess up color or other regex checks
    let cleanValue = value.replace(/\binset\b/gi, "").trim()

    // Regex for color (hex, rgb[a], hsl[a], named)
    const colorRegex = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|\b[a-zA-Z]+\b)/
    const match = cleanValue.match(colorRegex)
    if (!match) return cleanValue.split(/\s+/).filter(Boolean)

    const color = match[0]
    const before = cleanValue.slice(0, match.index).trim()
    const after = cleanValue.slice(match.index + color.length).trim()

    let arr: string[] = []
    if (before) arr = arr.concat(before.split(/\s+/).filter(Boolean))
    arr.push(color)
    if (after) arr = arr.concat(after.split(/\s+/).filter(Boolean))

    return arr
}

// DRAWER

const drawerPages: { [key: string]: DrawerTabIds } = {
    shows: "shows",
    media: "media",
    audio: "audio",
    overlays: "overlays",
    effects: "overlays",
    templates: "templates",
    scripture: "scripture",
    calendar: "calendar",
    functions: "functions",

    online: "media",
    media_inputs: "media",

    audio_inputs: "audio",

    action: "calendar",

    actions: "functions",
    timer: "functions",
    variables: "functions"
}
export function openDrawer(id: string, openPopup = false) {
    activePage.set("show")

    // set sub tab
    const drawerPageId = drawerPages[id]
    if (!drawerPageId) return

    // first subtab
    if (id === "calendar") id = "event"
    else if (id === "functions") id = "actions"
    else if (id === "scripture")
        id = "" // Object.keys(get(scriptures))[0]
    else if (id === drawerPageId) id = "all"
    else if (id === "media_inputs" || id === "audio_inputs") id = "inputs"

    if (id) {
        drawerTabsData.update((a) => {
            if (!a[drawerPageId]) a[drawerPageId] = { enabled: true, activeSubTab: null }
            a[drawerPageId].activeSubTab = id

            return a
        })
    }

    activeDrawerTab.set(drawerPageId)

    // open drawer
    if (get(drawer).height <= 40) {
        drawer.set({ height: 300, stored: get(drawer).height })
    }

    if (!openPopup) return

    // create new popup
    let popupId = id
    if (popupId === "variables") popupId = "variable"
    activePopup.set(popupId as Popups)
}

// ADD NEW

export const newDropdown = {
    "new.timer": () => {
        openDrawer("timer", true)
    }
}
