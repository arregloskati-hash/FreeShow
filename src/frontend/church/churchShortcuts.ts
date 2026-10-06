// ----- FreeShow Church -----
// Customizable keyboard shortcuts (Settings > Shortcuts).
//
// Every action has default keys that match FreeShow's built-in keys. While an action keeps its
// default keys, FreeShow's own handling runs unchanged. When a key is added, it is handled here;
// when a default key is removed, FreeShow's built-in handling for that key is switched off.
// Saved in the settings (special.churchShortcuts = { actionId: ["Cmd+K", ...] }), only for changed actions.

import { get } from "svelte/store"
import { clearAudio } from "../audio/audioFading"
import { OutputHelper } from "../components/helpers/OutputHelper"
import { refreshOut, setOutput, toggleOutputs } from "../components/helpers/output"
import { selectProjectShow } from "../components/helpers/showActions"
import { clearAll, clearBackground, clearOverlays, clearSlide, clearTimers } from "../components/output/clear"
import { activePopup, contextActive, currentWindow, guideActive, os, outLocked, special, timelineRecordingAction } from "../stores"
import { togglePlayingMedia } from "../utils/shortcuts"

export type ShortcutAction = {
    id: string
    label: string
    description?: string
    group: string
    defaults: string[]
    // true: the default keys are FreeShow's built-in keys (handled by FreeShow itself while unchanged)
    builtin?: boolean
    run: () => void
}

const isMac = () => get(os).platform === "darwin"
const MOD = () => (isMac() ? "Cmd" : "Ctrl")

function ifUnlocked(fn: () => void) {
    return () => {
        if (get(outLocked)) return
        fn()
    }
}

export function getShortcutActions(): ShortcutAction[] {
    return [
        // CLEAR
        { id: "clear_all", group: "Clear", label: "Clear all", description: "Text, media, overlays and audio", defaults: ["Escape", "."], builtin: true, run: () => clearAll(true) },
        {
            id: "clear_slide",
            group: "Clear",
            label: "Clear slide (lyrics)",
            defaults: ["F2"],
            builtin: true,
            run: ifUnlocked(() => {
                clearSlide()
                timelineRecordingAction.set({ id: "clear_slide" })
            })
        },
        {
            id: "clear_background",
            group: "Clear",
            label: "Clear media / background",
            defaults: ["F1"],
            builtin: true,
            run: ifUnlocked(() => {
                clearBackground()
                timelineRecordingAction.set({ id: "clear_background" })
            })
        },
        {
            id: "clear_overlays",
            group: "Clear",
            label: "Clear overlays",
            defaults: ["F3"],
            builtin: true,
            run: ifUnlocked(() => {
                clearOverlays()
                setOutput("effects", [])
                timelineRecordingAction.set({ id: "clear_overlays" })
            })
        },
        {
            id: "clear_audio",
            group: "Clear",
            label: "Clear audio",
            defaults: ["F4"],
            builtin: true,
            run: ifUnlocked(() => {
                clearAudio("", { clearPlaylist: true, clearMicrophones: true, commonClear: true })
                timelineRecordingAction.set({ id: "clear_audio" })
            })
        },
        { id: "clear_timers", group: "Clear", label: "Clear timers", defaults: [], run: ifUnlocked(() => clearTimers()) },

        // SLIDES
        { id: "next_slide", group: "Slides", label: "Next slide", defaults: ["ArrowRight", "Space", "PageDown"], builtin: true, run: () => OutputHelper.advanceOutputs("next") },
        { id: "previous_slide", group: "Slides", label: "Previous slide", defaults: ["ArrowLeft", "PageUp"], builtin: true, run: () => OutputHelper.advanceOutputs("previous") },
        { id: "first_slide", group: "Slides", label: "First slide", defaults: ["Home"], builtin: true, run: () => OutputHelper.advanceOutputs({ key: "Home", altKey: false } as any) },
        { id: "last_slide", group: "Slides", label: "Last slide", defaults: ["End"], builtin: true, run: () => OutputHelper.advanceOutputs({ key: "End", altKey: false } as any) },
        { id: "next_project_item", group: "Slides", label: "Next item in project", defaults: [], run: () => selectProjectShow("next") },
        { id: "previous_project_item", group: "Slides", label: "Previous item in project", defaults: [], run: () => selectProjectShow("previous") },

        // MEDIA
        { id: "play_pause_media", group: "Media", label: "Play / pause selected media", defaults: [], run: () => togglePlayingMedia(null) },

        // OUTPUT
        { id: "lock_output", group: "Output", label: "Lock / unlock output", defaults: [`${MOD()}+L`], builtin: true, run: () => outLocked.set(!get(outLocked)) },
        { id: "refresh_output", group: "Output", label: "Refresh output", defaults: [`${MOD()}+R`], builtin: true, run: ifUnlocked(() => refreshOut()) },
        { id: "toggle_output", group: "Output", label: "Show / hide output screens", defaults: [`${MOD()}+O`], builtin: true, run: () => toggleOutputs() }
    ]
}

// ---- key combos ----

const MODIFIER_KEYS = ["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "Fn", "OS"]

export function eventToCombo(e: KeyboardEvent): string {
    if (!e.key || MODIFIER_KEYS.includes(e.key)) return ""

    let key = e.key
    if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
    else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5)
    else if (/^Numpad\d$/.test(e.code)) key = "Num" + e.code.slice(6)
    else if (key === " ") key = "Space"
    else if (key.length === 1) key = key.toUpperCase()

    const parts: string[] = []
    if (e.ctrlKey) parts.push("Ctrl")
    if (e.metaKey) parts.push(isMac() ? "Cmd" : "Win")
    if (e.altKey) parts.push(isMac() ? "Option" : "Alt")
    if (e.shiftKey) parts.push("Shift")
    parts.push(key)
    return parts.join("+")
}

const SYMBOLS: { [key: string]: string } = { Cmd: "⌘", Option: "⌥", Shift: "⇧", Ctrl: "⌃", ArrowRight: "→", ArrowLeft: "←", ArrowUp: "↑", ArrowDown: "↓", Escape: "Esc", PageDown: "Page Down", PageUp: "Page Up", Space: "Space", Enter: "Return", Backspace: "⌫", Delete: "Del" }
export function comboToLabel(combo: string): string {
    const mac = isMac()
    return combo
        .split("+")
        .map((part) => {
            if (!mac && ["Cmd", "Option", "Shift", "Ctrl"].includes(part)) return part === "Option" ? "Alt" : part
            return SYMBOLS[part] || part
        })
        .join(mac ? "" : " + ")
}

// ---- bindings ----

export function getBindings(): { [actionId: string]: string[] } {
    const custom = get(special).churchShortcuts || {}
    const result: { [actionId: string]: string[] } = {}
    getShortcutActions().forEach((action) => {
        result[action.id] = Array.isArray(custom[action.id]) ? custom[action.id] : action.defaults
    })
    return result
}

export function setBinding(actionId: string, combos: string[] | null) {
    special.update((a) => {
        const custom = { ...(a.churchShortcuts || {}) }
        if (combos === null) delete custom[actionId]
        else custom[actionId] = combos
        a.churchShortcuts = custom
        return a
    })
}

export function resetAllBindings() {
    special.update((a) => {
        delete a.churchShortcuts
        return a
    })
}

// which actions use this combo (to warn about duplicates)
export function getComboUsers(combo: string, bindings = getBindings()): string[] {
    return Object.keys(bindings).filter((id) => bindings[id].includes(combo))
}

// ---- handling ----

let recording = false
export function setRecording(value: boolean) {
    recording = value
}

function isTyping() {
    const elem = document.activeElement as HTMLElement | null
    if (!elem) return false
    if (elem.closest?.(".edit") || elem.isContentEditable) return true
    const tag = elem.tagName
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
}

// returns "handled" (run here), "blocked" (default key removed: FreeShow should ignore it) or null (not ours)
export function checkShortcut(e: KeyboardEvent | { key: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }, fromOutputWindow = false): "handled" | "blocked" | null {
    const combo = eventToCombo(e as KeyboardEvent)
    if (!combo) return null

    const actions = getShortcutActions()
    const bindings = getBindings()
    const actionId = Object.keys(bindings).find((id) => bindings[id].includes(combo))
    const defaultOwner = actions.find((a) => a.builtin && a.defaults.includes(combo))

    if (actionId) {
        const action = actions.find((a) => a.id === actionId)!
        // unchanged built-in key: let FreeShow handle it like it always does
        if (action.builtin && action.defaults.includes(combo)) return null

        if (!fromOutputWindow) {
            if (get(activePopup) || get(guideActive) || get(contextActive)) return null
            const hasModifier = combo.includes("+") && /(Ctrl|Cmd|Win|Alt|Option)\+/.test(combo)
            if (isTyping() && !hasModifier && !/^F\d+$/.test(combo)) return null
        }

        action.run()
        return "handled"
    }

    if (defaultOwner) return "blocked"
    return null
}

function onKeydown(e: KeyboardEvent) {
    if (recording || get(currentWindow)) return
    const result = checkShortcut(e)
    if (result === "handled") {
        e.preventDefault()
        e.stopImmediatePropagation()
    } else if (result === "blocked") {
        ;(e as any).churchShortcutBlocked = true
    }
}

let installed = false
export function installChurchShortcuts() {
    if (installed || typeof window === "undefined") return
    installed = true
    // capture phase: runs before FreeShow's own key handlers
    window.addEventListener("keydown", onKeydown, true)
}
