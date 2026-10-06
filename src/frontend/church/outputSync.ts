// ----- FreeShow Church -----
// Keeps the output engine (windows, NDI senders, captures) in sync with the outputs list.
//
// Before this, some changes only updated the list: deleting an output (or undo/redo) left its window,
// NDI source and capture running until the app was restarted, and outputs enabled from other places
// were never created/shown. This watches the list and fixes that, without restarting outputs that are
// already running (ENSURE only creates missing ones).

import { get } from "svelte/store"
import { OUTPUT } from "../../types/Channels"
import type { Output } from "../../types/Output"
import { toggleOutputs } from "../components/helpers/output"
import { ndiData, outputDisplay, outputs, outputState } from "../stores"
import { send } from "../utils/request"

type Snapshot = { [id: string]: { enabled: boolean; name: string; invisible: boolean } }

let started = false
let previous: Snapshot = {}

function snapshot(list: { [id: string]: Output }): Snapshot {
    const result: Snapshot = {}
    Object.entries(list || {}).forEach(([id, output]) => {
        if (!output) return
        result[id] = { enabled: !!output.enabled, name: output.name || "", invisible: !!output.invisible }
    })
    return result
}

/** start after the outputs have been created on startup */
export function startOutputSync() {
    if (started) return
    started = true

    previous = snapshot(get(outputs))
    outputs.subscribe((current) => {
        const next = snapshot(current)
        // let the change that triggered this finish (and send its own messages) first
        const before = previous
        previous = next
        setTimeout(() => syncChanges(before, next, current))
    })
}

function syncChanges(before: Snapshot, after: Snapshot, current: { [id: string]: Output }) {
    // deleted or disabled -> close window, NDI source and capture
    Object.keys(before).forEach((id) => {
        const removed = !after[id]
        const disabled = before[id].enabled && after[id] && !after[id].enabled
        if (!removed && !disabled) return

        send(OUTPUT, ["REMOVE"], { id })

        // forget its shown/hidden state, so turning it on again starts from "hidden" (not a stale "shown")
        outputState.update((a) => a.filter((state) => state.id !== id))
        if (removed) {
            ndiData.update((a) => {
                delete a[id]
                return a
            })
        }
    })

    // new or enabled -> make sure it exists, and show it if outputs are currently shown
    Object.keys(after).forEach((id) => {
        if (!after[id].enabled) return
        const isNew = !before[id] || !before[id].enabled
        if (!isNew) return

        const output = current[id]
        if (!output) return

        send(OUTPUT, ["ENSURE"], { ...output, id })
        if (get(outputDisplay) && !output.invisible) setTimeout(() => toggleOutputs([id], { state: true }), 300)
    })

    // renamed -> window title and default NDI name follow
    Object.keys(after).forEach((id) => {
        if (!before[id] || !after[id].enabled) return
        if (before[id].name === after[id].name) return
        send(OUTPUT, ["SET_VALUE"], { id, key: "name", value: after[id].name })
    })
}

/** restart one output with its current settings, and show it again if outputs are shown */
export function restartOutputAndShow(id: string) {
    const output = get(outputs)[id]
    if (!output) return

    send(OUTPUT, ["CREATE"], { ...output, id })
    // (the engine waits for the restart to finish before applying this)
    if (output.enabled && !output.invisible && get(outputDisplay)) toggleOutputs([id], { state: true })
}
