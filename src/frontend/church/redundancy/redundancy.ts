// ----- FreeShow Church -----
// Redundancy (frontend): what is synced from the MASTER to a BACKUP computer, and how a backup applies it.
//
// The master sends state, not clicks: "this is what every output shows", "this setlist now looks like this".
// A backup replaces its state with the master's, so a missed message is corrected by the next one
// (and a full snapshot is sent whenever a backup connects). Nothing runs on the backup by itself:
// actions, MIDI, timecode chasing are blocked there (role.ts) - it only mirrors the master's results.

import { get, writable, type Writable } from "svelte/store"
import { Main } from "../../../types/IPC/Main"
import { setOutput } from "../../components/helpers/output"
import { loadShows } from "../../components/helpers/setShow"
import { VideoPlayer } from "../../components/media/video/videoPlayer"
import { requestMain, sendMain } from "../../IPC/main"
import {
    actions,
    activeProject,
    activeShow,
    activeTimers,
    categories,
    effects,
    events,
    folders,
    groups,
    media,
    outputs,
    overlayCategories,
    overlays,
    playerVideos,
    playingVideoState,
    projects,
    projectTemplates,
    shows,
    showsCache,
    stageShows,
    styles,
    templateCategories,
    templates,
    timers,
    variables
} from "../../stores"
import { setRedundancyRole } from "./role"

export type RedundancyRole = "off" | "master" | "backup"

export const redundancyStatus: Writable<any> = writable(null)
/** shown as a banner: master lost / taken over / stepped down */
export const redundancyAlert: Writable<null | { type: "lost" | "back" | "demoted" | "takeover"; name?: string }> = writable(null)

// keyed stores (objects of items): sent as changed/removed keys
const KEYED: { [name: string]: Writable<any> } = {
    projects,
    folders,
    projectTemplates,
    overlays,
    overlayCategories,
    templates,
    templateCategories,
    stageShows,
    styles,
    effects,
    timers,
    variables,
    actions,
    events,
    categories,
    groups,
    media,
    playerVideos
}
// plain values: sent whole
const VALUES: { [name: string]: Writable<any> } = { activeProject, activeShow, activeTimers }

const OUT_LAYERS = ["transition", "background", "slide", "overlays", "effects"] as const

let role: RedundancyRole = "off"
let peerCount = 0
let started = false

// ---------------- start / status ----------------

export async function initRedundancy() {
    if (started) return
    started = true

    const status = await requestMain(Main.REDUNDANCY_STATUS)
    if (status) setStatus(status)

    startPublisher()

    // a backup that (re)starts asks the master for everything
    if (role === "backup") sendMain(Main.REDUNDANCY_SEND, { t: "request-snapshot" })
}

export function setStatus(status: any) {
    if (!status) return
    const previousRole = role
    role = status.role || "off"
    peerCount = status.peers?.length || 0
    setRedundancyRole(role, status.settings?.muteBackupAudio !== false)
    redundancyStatus.set(status)

    if (previousRole !== role) {
        if (role === "backup") sendMain(Main.REDUNDANCY_SEND, { t: "request-snapshot" })
        if (role === "master" && previousRole === "backup") {
            // this computer just became the master: re-enable sound, and everything the backup applied is now its own
            VideoPlayer.updateVolume()
        }
    }
}

export function updateRedundancySettings(changes: any) {
    requestMain(Main.REDUNDANCY_CONFIG, changes, (status) => setStatus(status))
}

export function takeOverAsMaster() {
    redundancyAlert.set({ type: "takeover" })
    requestMain(Main.REDUNDANCY_TAKEOVER, undefined, (status) => setStatus(status))
    setTimeout(() => redundancyAlert.update((a) => (a?.type === "takeover" ? null : a)), 4000)
}

// ---------------- MASTER: publish ----------------

const lastSentKeys: { [store: string]: { [key: string]: string } } = {}
const lastSentValues: { [store: string]: string } = {}
const lastSentShows: { [id: string]: string } = {}
const lastSentList: { [id: string]: string } = {}
let lastSentOut = ""
let lastSentVideo = ""

const canPublish = () => role === "master" && peerCount > 0
const send = (message: any) => sendMain(Main.REDUNDANCY_SEND, message)

function debounce(fn: () => void, ms: number) {
    let timer: NodeJS.Timeout | null = null
    return () => {
        if (timer) return
        timer = setTimeout(() => {
            timer = null
            fn()
        }, ms)
    }
}

function startPublisher() {
    Object.entries(KEYED).forEach(([name, store]) => {
        const publish = debounce(() => publishKeyed(name, store), 120)
        store.subscribe(() => canPublish() && publish())
    })
    Object.entries(VALUES).forEach(([name, store]) => {
        const publish = debounce(() => publishValue(name, store), 30)
        store.subscribe(() => canPublish() && publish())
    })

    const publishShows = debounce(publishShowsCache, 150)
    showsCache.subscribe(() => canPublish() && publishShows())
    const publishList = debounce(publishShowList, 400)
    shows.subscribe(() => canPublish() && publishList())

    // what's live: right away (a slide change must not wait)
    outputs.subscribe(() => canPublish() && queueMicrotask(publishOut))

    const publishVideo = debounce(publishVideoState, 400)
    playingVideoState.subscribe(() => canPublish() && publishVideo())
    // keep playing videos aligned even when nothing else changes
    setInterval(() => canPublish() && publishVideoState(true), 1000)

    // the songs of the open setlist are loaded, so the backup gets them before they're needed
    activeProject.subscribe((id) => {
        if (role !== "master" || !id) return
        const items = get(projects)[id]?.shows || []
        const ids = items.filter((item: any) => !item.type || item.type === "show").map((item: any) => item.id)
        if (ids.length) loadShows(ids)
    })
}

function diffKeyed(name: string, value: any, force = false) {
    const previous = lastSentKeys[name] || {}
    const next: { [key: string]: string } = {}
    const set: any = {}
    Object.keys(value || {}).forEach((key) => {
        const json = JSON.stringify(value[key])
        next[key] = json
        if (force || previous[key] !== json) set[key] = value[key]
    })
    const del = Object.keys(previous).filter((key) => !(key in next))
    lastSentKeys[name] = next
    return { set, del }
}

function publishKeyed(name: string, store: Writable<any>) {
    if (!canPublish()) return
    const { set, del } = diffKeyed(name, get(store))
    if (!Object.keys(set).length && !del.length) return
    send({ t: "store", name, set, del })
}

function publishValue(name: string, store: Writable<any>) {
    if (!canPublish()) return
    const value = get(store)
    const json = JSON.stringify(value ?? null)
    if (lastSentValues[name] === json) return
    lastSentValues[name] = json
    send({ t: "value", name, value })
}

function trimmedEntry(id: string) {
    return get(shows)[id] || null
}

function publishShowsCache() {
    if (!canPublish()) return
    const cache = get(showsCache)
    const set: any = {}
    const list: any = {}
    Object.keys(cache).forEach((id) => {
        const json = JSON.stringify(cache[id])
        if (lastSentShows[id] === json) return
        lastSentShows[id] = json
        set[id] = cache[id]
        const entry = trimmedEntry(id)
        if (entry) list[id] = entry
    })
    if (Object.keys(set).length) send({ t: "shows", set, list })
}

function publishShowList() {
    if (!canPublish()) return
    const all = get(shows)
    const set: any = {}
    Object.keys(all).forEach((id) => {
        const json = JSON.stringify(all[id])
        if (lastSentList[id] === json) return
        lastSentList[id] = json
        set[id] = all[id]
    })
    const del = Object.keys(lastSentList).filter((id) => !all[id])
    del.forEach((id) => delete lastSentList[id])
    if (Object.keys(set).length || del.length) send({ t: "showlist", set, del })
}

function liveOutputs() {
    const all = get(outputs)
    return Object.keys(all)
        .filter((id) => all[id]?.enabled && !all[id].stageOutput && !all[id].hideFromPreview)
        .map((id) => ({ id, name: all[id].name || "", out: all[id].out || {} }))
}

function publishOut(force = false) {
    if (!canPublish()) return
    const list = liveOutputs()
    const json = JSON.stringify(list)
    if (!force && json === lastSentOut) return
    lastSentOut = json
    // the song on screen must be on the backup before its slide is
    const cache = get(showsCache)
    if (list.some((o) => o.out?.slide?.id && cache[o.out.slide.id] && lastSentShows[o.out.slide.id] !== JSON.stringify(cache[o.out.slide.id]))) publishShowsCache()
    send({ t: "out", outputs: list })
}

function videoList() {
    const state = get(playingVideoState)
    return Object.keys(state).map((key) => {
        const s = state[key]
        const split = key.lastIndexOf("_")
        return { path: key.slice(0, split), outputId: key.slice(split + 1), time: s.currentTime || 0, paused: !!s.paused }
    })
}

function publishVideoState(periodic = false) {
    if (!canPublish()) return
    const list = videoList()
    const json = JSON.stringify(list.map((v) => [v.path, v.outputId, v.paused]))
    if (!list.length && json === lastSentVideo) return
    if (periodic && list.every((v) => v.paused) && json === lastSentVideo) return
    lastSentVideo = json
    send({ t: "video", list })
}

/** a backup connected: send everything */
export function sendSnapshot() {
    if (role !== "master") return
    peerCount = Math.max(peerCount, 1)

    const stores: any = {}
    Object.entries(KEYED).forEach(([name, store]) => {
        stores[name] = get(store)
        diffKeyed(name, stores[name], true)
    })
    const values: any = {}
    Object.entries(VALUES).forEach(([name, store]) => {
        values[name] = get(store)
        lastSentValues[name] = JSON.stringify(values[name] ?? null)
    })
    const cache = get(showsCache)
    Object.keys(cache).forEach((id) => (lastSentShows[id] = JSON.stringify(cache[id])))
    const list = get(shows)
    Object.keys(list).forEach((id) => (lastSentList[id] = JSON.stringify(list[id])))
    const out = liveOutputs()
    lastSentOut = JSON.stringify(out)

    send({ t: "snapshot", stores, values, shows: cache, showList: list, outputs: out, video: videoList() })
}

// ---------------- BACKUP: apply ----------------

let lastMasterOut: { id: string; name: string; out: any }[] = []
const lastApplied: { [localId: string]: { [layer: string]: string } } = {}
let mapping: { [localId: string]: string } = {} // local output -> master output

export function receiveRedundancy(message: any) {
    if (!message) return

    if (message.t === "local") return localEvent(message)
    // the main process only forwards master messages while this computer is a backup
    // (the role can change a moment before the next status update reaches this window)
    if (role !== "backup") {
        role = "backup"
        setRedundancyRole("backup", get(redundancyStatus)?.settings?.muteBackupAudio !== false)
    }

    switch (message.t) {
        case "snapshot":
            Object.entries(message.stores || {}).forEach(([name, value]) => mergeKeyed(name, value as any, []))
            Object.entries(message.values || {}).forEach(([name, value]) => VALUES[name]?.set(value))
            applyShows(message.shows || {}, message.showList || {})
            Object.keys(lastApplied).forEach((id) => delete lastApplied[id])
            applyOut(message.outputs || [])
            applyVideo(message.video || [])
            break
        case "store":
            mergeKeyed(message.name, message.set || {}, message.del || [])
            break
        case "value":
            VALUES[message.name]?.set(message.value)
            break
        case "shows":
            applyShows(message.set || {}, message.list || {})
            break
        case "showlist":
            shows.update((a) => {
                Object.assign(a, message.set || {})
                ;(message.del || []).forEach((id: string) => delete a[id])
                return a
            })
            break
        case "out":
            applyOut(message.outputs || [])
            break
        case "video":
            applyVideo(message.list || [])
            break
    }
}

function localEvent(message: any) {
    if (message.event === "lost") redundancyAlert.set({ type: "lost", name: message.name })
    else if (message.event === "back") {
        redundancyAlert.set({ type: "back", name: message.name })
        setTimeout(() => redundancyAlert.update((a) => (a?.type === "back" ? null : a)), 3000)
    } else if (message.event === "demoted") redundancyAlert.set({ type: "demoted", name: message.by })
    else if (message.event === "connected") {
        redundancyAlert.update((a) => (a?.type === "lost" ? null : a))
        // (re)connected: get everything (the master's own snapshot may have arrived before this window knew it's a backup)
        sendMain(Main.REDUNDANCY_SEND, { t: "request-snapshot" })
    }
}

function mergeKeyed(name: string, set: any, del: string[]) {
    const store = KEYED[name]
    if (!store) return
    store.update((a) => {
        a = a || {}
        Object.assign(a, set)
        del.forEach((key) => delete a[key])
        return a
    })
}

function applyShows(cache: any, list: any) {
    if (Object.keys(list).length) shows.update((a) => Object.assign(a, list))
    if (Object.keys(cache).length) showsCache.update((a) => Object.assign(a, cache))
}

function mapOutputs(masterOutputs: { id: string; name: string }[]) {
    const all = get(outputs)
    const result: { [localId: string]: string } = {}
    const local = Object.keys(all).filter((id) => all[id]?.enabled && !all[id].stageOutput)
    local.forEach((id) => {
        const sameName = masterOutputs.find((m) => m.name && m.name === all[id].name)
        const target = sameName || masterOutputs[0]
        if (target) result[id] = target.id
    })
    return result
}

function applyOut(masterOutputs: { id: string; name: string; out: any }[]) {
    lastMasterOut = masterOutputs
    mapping = mapOutputs(masterOutputs)

    Object.entries(mapping).forEach(([localId, masterId]) => {
        const out = masterOutputs.find((m) => m.id === masterId)?.out || {}
        const applied = (lastApplied[localId] = lastApplied[localId] || {})

        OUT_LAYERS.forEach((layer) => {
            const value = out[layer] ?? (layer === "overlays" || layer === "effects" ? [] : null)
            const json = JSON.stringify(value)
            if (applied[layer] === json) return
            applied[layer] = json
            try {
                setOutput(layer, value === null ? null : JSON.parse(json), false, localId)
            } catch (err) {
                console.warn("Redundancy: could not apply", layer, err)
            }
        })
    })
}

/** a media file finished copying from the master: show it where it's used */
export function mediaReady(data: { local: string }) {
    if (role !== "backup" || !data?.local) return
    Object.keys(lastApplied).forEach((localId) => {
        const applied = lastApplied[localId]
        ;["background", "slide", "overlays"].forEach((layer) => {
            if (applied[layer]?.includes(JSON.stringify(data.local).slice(1, -1))) delete applied[layer]
        })
    })
    // slides showing that file in a song: re-render
    showsCache.update((a) => a)
    applyOut(lastMasterOut)
}

function applyVideo(list: { path: string; outputId: string; time: number; paused: boolean }[]) {
    if (role !== "backup") return
    const latency = (get(redundancyStatus)?.master?.latency || 0) / 1000
    const state = get(playingVideoState)

    list.forEach((video) => {
        Object.entries(mapping).forEach(([localId, masterId]) => {
            if (masterId !== video.outputId) return
            const local = state[`${video.path}_${localId}`]
            if (!local) return

            if (video.paused !== !!local.paused) {
                if (video.paused) VideoPlayer.pause(video.path, localId)
                else VideoPlayer.play(video.path, localId)
            }
            const target = video.time + (video.paused ? 0 : latency)
            if (Math.abs((local.currentTime || 0) - target) > 0.25) VideoPlayer.seekTo(video.path, localId, target)
        })
    })
}
