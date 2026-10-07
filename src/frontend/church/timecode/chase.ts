// ----- FreeShow Church -----
// Timecode chase: every song in the current project with "Timecode" checked follows incoming SMPTE.
// When the time enters a song's range (offset .. offset + duration) that song is opened and its timeline runs
// in sync (slides/media fire as recorded). Outside every range, or when the signal stops, the timeline pauses.

import { tick } from "svelte"
import { get } from "svelte/store"
import { activeProject, activeShow, projects, showsCache, special } from "../../stores"
import { clone } from "../../components/helpers/array"
import { loadShows } from "../../components/helpers/setShow"
import { getActiveTimelinePlayback, showTimelinePlayers, TimelinePlayback } from "../../components/timeline/TimelinePlayback"
import { getSongDuration, getSongTimecode, type SmpteInput } from "./timecodeShared"

interface Target {
    id: string
    layoutId: string
    index: number
    offset: number
    key: string
}

let chasing: { target: Target; player: TimelinePlayback | null; input: SmpteInput } | null = null
let switching = false
const requested = new Set<string>()

// decoded LTC arrives a bit late (audio buffer + decode + IPC); small drifts are left to the internal clock
const INPUT_LATENCY = 60 // ms
const SYNC_TOLERANCE = 120 // ms

function findTarget(input: SmpteInput, time: number): Target | null {
    const project = get(projects)[get(activeProject) || ""]
    if (!project?.shows?.length) return null

    const cache = get(showsCache)
    let best: Target | null = null
    const missing: string[] = []

    project.shows.forEach((item, index) => {
        if ((item.type || "show") !== "show" || !item.id) return

        const show = cache[item.id]
        if (!show) {
            if (!requested.has(item.id)) missing.push(item.id)
            return
        }

        const layoutId = item.layout && show.layouts?.[item.layout] ? item.layout : show.settings?.activeLayout || ""
        const timeline: any = show.layouts?.[layoutId]?.timeline
        const tc = getSongTimecode(timeline)
        if (!tc.enabled || tc.input !== input) return
        if (time < tc.offset || time >= tc.offset + getSongDuration(timeline)) return

        if (!best || tc.offset >= best.offset) best = { id: item.id, layoutId, index, offset: tc.offset, key: JSON.stringify({ id: item.id, layoutId }) }
    })

    if (missing.length) {
        missing.forEach((id) => requested.add(id))
        loadShows(missing)
    }

    return best
}

export function chaseFrame(input: SmpteInput, time: number) {
    if (switching) return
    if (chasing && chasing.input !== input && chasing.player?.isPlaying) {
        // another input is driving a song right now - only take over when this input matches a song too
        if (!findTarget(input, time)) return
    }

    const target = findTarget(input, time)
    if (!target) {
        if (chasing) release()
        return
    }

    if (!chasing || chasing.target.key !== target.key || !chasing.player || chasing.player.getId() !== target.key) {
        switchTo(target, input, time)
        return
    }

    chasing.input = input
    sync(chasing.player, time - target.offset)
}

function sync(player: TimelinePlayback, relativeTime: number) {
    relativeTime += INPUT_LATENCY
    player.externalSync = true
    if (!player.isPlaying) {
        player.setTime(relativeTime)
        player.play()
        return
    }
    if (Math.abs(player.currentTime - relativeTime) > SYNC_TOLERANCE) player.setTime(relativeTime)
}

async function switchTo(target: Target, input: SmpteInput, time: number) {
    switching = true
    try {
        const show = get(showsCache)[target.id]
        if (show && show.settings?.activeLayout !== target.layoutId) {
            showsCache.update((a) => {
                if (a[target.id]?.settings) a[target.id].settings.activeLayout = target.layoutId
                return a
            })
        }

        const current = get(activeShow)
        if (current?.id !== target.id || current?.index !== target.index) activeShow.set({ id: target.id, index: target.index, type: "show" })
        if (!get(special).timelineActive) special.update((a) => ({ ...a, timelineActive: true }))

        await tick()
        await new Promise((r) => setTimeout(r, 30))

        // the open timeline (if it's this song), else play it in the background
        let player: TimelinePlayback | null = getActiveTimelinePlayback("show")
        if (player?.getId() !== target.key) player = [...showTimelinePlayers].find((p) => p.getId() === target.key) || null
        if (!player) {
            player = new TimelinePlayback("show")
            player.setRef({ id: target.id, layoutId: target.layoutId })
            const timeline: any = get(showsCache)[target.id]?.layouts?.[target.layoutId]?.timeline
            player.setActions(clone(timeline?.actions || []))
        }
        player.externalSync = true

        chasing = { target, player, input }
        sync(player, time - target.offset)
    } finally {
        switching = false
    }
}

export function chaseSignalLost(input: SmpteInput) {
    if (!chasing || chasing.input !== input) return
    release()
}

function release() {
    const player = chasing?.player
    chasing = null
    if (!player) return
    if (player.isPlaying) player.pause()
    player.externalSync = false
}

/** the song currently following timecode (for display) */
export function getChasingSong() {
    return chasing?.target || null
}
