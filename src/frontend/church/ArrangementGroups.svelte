<script lang="ts">
    // ----- FreeShow Church -----
    // Groups tab, "arrangement" style:
    // - every group in the song's order is listed (no "x3" counters)
    // - drag rows to rearrange the slides
    // - drag or click a group below to add it to the arrangement
    // - x removes one occurrence from the arrangement (the slides themselves are kept)

    import { onDestroy } from "svelte"
    import { uid } from "uid"
    import { activePopup, activeShow, alertMessage, cachedShowsData, globalGroupViewEnabled, groups, showsCache } from "../stores"
    import { clone, sortByName } from "../components/helpers/array"
    import { history } from "../components/helpers/history"
    import Icon from "../components/helpers/Icon.svelte"
    import { getShowCacheId } from "../components/helpers/show"
    import { getAccess, isGroupHidden } from "../utils/profile"
    import { translateText } from "../utils/language"
    import { newToast } from "../utils/common"

    $: showId = $activeShow?.id || ""
    $: show = $showsCache[showId]
    $: layoutId = show?.settings?.activeLayout || ""
    $: layoutSlides = (show?.layouts?.[layoutId]?.slides || []) as any[]

    // names with numbers ("Verse 2") and colors, as shown on the slides
    $: cachedGroups = ($cachedShowsData[getShowCacheId(showId, show)]?.groups || []) as any[]
    $: groupInfo = cachedGroups.reduce((map, g) => {
        map[g.id] = g
        return map
    }, {} as Record<string, any>)
    $: showGroups = sortByName(
        cachedGroups.filter((a) => a.group !== "."),
        "group"
    )

    $: globalGroups = sortByName(
        Object.entries($groups)
            .filter(([id]) => !isGroupHidden(id))
            .map(([id, group]: [string, any]) => ({
                id,
                group: group.default ? translateText(`groups.${group.name}`) : group.name,
                color: group.color || null,
                globalGroup: id,
                settings: {},
                notes: "",
                items: []
            })),
        "group"
    )

    const profile = getAccess("shows")
    $: isLocked = !!show?.locked || profile.global === "read" || profile[show?.category || ""] === "read"

    // ---- row data ----

    // numbers ("Verse 1", "Verse 2") worked out from the show itself, so they're right
    // straight away after undo/redo (the shared cache can lag behind)
    $: numberedNames = getNumberedNames(show, layoutSlides)
    function getNumberedNames(currentShow: any, ref: any[]) {
        const names: Record<string, string> = {}
        const slides = currentShow?.slides || {}
        const order: string[] = []
        ref.forEach((s) => {
            if (s?.id && slides[s.id] && !order.includes(s.id)) order.push(s.id)
        })
        Object.keys(slides).forEach((id) => {
            if (slides[id]?.group !== undefined && slides[id]?.group !== null && !order.includes(id)) order.push(id)
        })
        const byName: Record<string, string[]> = {}
        order.forEach((id) => {
            const base = String(slides[id]?.group || "").trim()
            if (!base) return
            ;(byName[base] = byName[base] || []).push(id)
        })
        Object.entries(byName).forEach(([base, ids]) => {
            ids.forEach((id, i) => (names[id] = ids.length > 1 ? `${base} ${i + 1}` : base))
        })
        return names
    }

    function getName(slideId: string) {
        const slide = show?.slides?.[slideId]
        return numberedNames[slideId] || groupInfo[slideId]?.group || slide?.group || "—"
    }
    function getColor(slideId: string) {
        const slide = show?.slides?.[slideId]
        return groupInfo[slideId]?.color || slide?.color || $groups[slide?.globalGroup || ""]?.color || "var(--secondary)"
    }
    function getPreview(slideId: string) {
        const slide = show?.slides?.[slideId]
        const item = (slide?.items || []).find((it: any) => it?.lines?.length)
        const line = (item?.lines || []).map((l: any) => (l.text || []).map((t: any) => t.value).join("")).find((t: string) => t.trim())
        return (line || "").replace(/<[^>]*>/g, "")
    }
    function getSlideCount(slideId: string) {
        return 1 + (show?.slides?.[slideId]?.children?.length || 0)
    }

    // ---- editing ----

    function guard() {
        if (!isLocked) return true
        alertMessage.set(show?.locked ? "show.locked" : "profile.locked")
        activePopup.set("alert")
        return false
    }

    function saveLayout(newLayout: any[]) {
        if (!show || !layoutId || !$activeShow) return
        history({
            id: "slide",
            newData: { slides: clone(show.slides), layout: newLayout, media: clone(show.media || {}) },
            location: { layout: layoutId, page: "show", show: $activeShow }
        })
    }

    function moveEntry(from: number, to: number) {
        if (from === to || from + 1 === to) return
        const layout = clone(layoutSlides)
        const [moved] = layout.splice(from, 1)
        layout.splice(from < to ? to - 1 : to, 0, moved)
        saveLayout(layout)
    }

    function insertGroup(slideId: string, at: number) {
        if (show?.slides?.[slideId]?.locked) return newToast("output.state_locked")
        const layout = clone(layoutSlides)
        layout.splice(at, 0, { id: slideId })
        saveLayout(layout)
    }

    // duplicate a section right below itself (keeps its arrangement settings)
    function duplicateEntry(index: number) {
        if (!guard()) return
        const entry = layoutSlides[index]
        if (!entry) return
        if (show?.slides?.[entry.id]?.locked) return newToast("output.state_locked")
        const layout = clone(layoutSlides)
        layout.splice(index + 1, 0, clone(entry))
        saveLayout(layout)
        highlighted = index + 1
        setTimeout(() => {
            if (highlighted === index + 1) highlighted = -1
        }, 900)
    }

    function removeEntry(index: number) {
        if (!guard()) return
        const layout = clone(layoutSlides)
        layout.splice(index, 1)
        saveLayout(layout)
    }

    function addGlobalGroup(group: any) {
        if (!guard() || !$activeShow) return
        history({ id: "SLIDES", newData: { data: [{ ...group, id: uid() }] } })
    }

    // ---- jump to the group's slides in the main view ----

    let highlighted = -1
    function revealEntry(index: number) {
        highlighted = index
        setTimeout(() => {
            if (highlighted === index) highlighted = -1
        }, 900)

        // flattened slide index (parents + their child slides)
        let flatIndex = 0
        for (let i = 0; i < index; i++) flatIndex += getSlideCount(layoutSlides[i]?.id)

        const slideElems = document.querySelectorAll(".column > .row > .center .grid > .main")
        const total = layoutSlides.reduce((sum, s) => sum + getSlideCount(s.id), 0)
        if (slideElems.length !== total) return
        const elem = slideElems[flatIndex] as HTMLElement | undefined
        if (!elem) return
        elem.scrollIntoView({ block: "center", behavior: "smooth" })
        elem.classList.add("churchFlash")
        setTimeout(() => elem.classList.remove("churchFlash"), 900)
    }

    // ---- drag & drop (pointer based, works with mouse, trackpad and touch) ----

    let listElem: HTMLElement
    let dragFrom: number | null = null // row being moved
    let dragGroup: any = null // group chip being placed
    let dropAt: number | null = null
    let ghost: { x: number; y: number; label: string; color: string } | null = null
    let pending: { kind: "row" | "group"; index?: number; group?: any; x: number; y: number } | null = null

    function pointerDown(e: PointerEvent, kind: "row" | "group", index?: number, group?: any) {
        if (e.button !== 0 || isLocked) return
        if ((e.target as HTMLElement).closest(".remove, .duplicate")) return
        pending = { kind, index, group, x: e.clientX, y: e.clientY }
        window.addEventListener("pointermove", pointerMove)
        window.addEventListener("pointerup", pointerUp, { once: true })
    }

    function pointerMove(e: PointerEvent) {
        if (!pending) return
        if (dragFrom === null && !dragGroup) {
            if (Math.abs(e.clientX - pending.x) + Math.abs(e.clientY - pending.y) < 6) return
            // start dragging
            if (pending.kind === "row") dragFrom = pending.index!
            else dragGroup = pending.group
            document.body.style.cursor = "grabbing"
        }

        const label = dragGroup ? dragGroup.group : getName(layoutSlides[dragFrom!]?.id)
        const color = dragGroup ? dragGroup.color || "var(--secondary)" : getColor(layoutSlides[dragFrom!]?.id)
        ghost = { x: e.clientX, y: e.clientY, label, color }
        dropAt = getDropIndex(e.clientX, e.clientY)
        autoScroll(e.clientY)
    }

    function pointerUp() {
        window.removeEventListener("pointermove", pointerMove)
        const wasDragging = dragFrom !== null || !!dragGroup
        const p = pending
        pending = null
        document.body.style.cursor = ""

        if (wasDragging) {
            if (dropAt !== null) {
                if (dragFrom !== null) moveEntry(dragFrom, dropAt)
                else if (dragGroup) insertGroup(dragGroup.id, dropAt)
            }
            // swallow the click that follows the drag
            window.addEventListener("click", (ev) => ev.stopPropagation(), { capture: true, once: true })
        } else if (p) {
            // plain click
            if (p.kind === "row") revealEntry(p.index!)
            else if (p.group && guard()) insertGroup(p.group.id, layoutSlides.length)
        }

        dragFrom = null
        dragGroup = null
        dropAt = null
        ghost = null
    }

    function getDropIndex(x: number, y: number): number | null {
        if (!listElem) return null
        const box = listElem.getBoundingClientRect()
        const margin = 30
        if (x < box.left - margin || x > box.right + margin || y < box.top - margin || y > box.bottom + margin) return null

        const rows = [...listElem.querySelectorAll(".row")] as HTMLElement[]
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i].getBoundingClientRect()
            if (y < r.top + r.height / 2) return i
        }
        return rows.length
    }

    function autoScroll(y: number) {
        const scroller = listElem?.closest(".scroll") as HTMLElement | null
        if (!scroller) return
        const box = scroller.getBoundingClientRect()
        if (y < box.top + 30) scroller.scrollTop -= 8
        else if (y > box.bottom - 30) scroller.scrollTop += 8
    }

    onDestroy(() => window.removeEventListener("pointermove", pointerMove))
</script>

<div class="arrangement">
    <div class="scroll">
        <div class="sectionTitle">
            <span>Arrangement</span>
            <span class="hint">{isLocked ? "Locked" : "Drag to reorder"}</span>
        </div>

        <div class="list" class:dragging={dragFrom !== null || !!dragGroup} bind:this={listElem}>
            {#each layoutSlides as entry, i (i + "_" + entry.id)}
                {@const color = getColor(entry.id)}
                {#if dropAt === i}<div class="dropLine" />{/if}
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <div
                    class="row"
                    class:isDragged={dragFrom === i}
                    class:disabled={entry.disabled}
                    class:flash={highlighted === i}
                    style="--group-color: {color};"
                    on:pointerdown={(e) => pointerDown(e, "row", i)}
                    on:keydown={(e) => {
                        if (e.key === "Enter") revealEntry(i)
                    }}
                    role="button"
                    tabindex="0"
                    data-title="Click to jump to these slides"
                >
                    <span class="handle"><svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="2" cy="3" r="1.5" /><circle cx="8" cy="3" r="1.5" /><circle cx="2" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="2" cy="13" r="1.5" /><circle cx="8" cy="13" r="1.5" /></svg></span>
                    <span class="number">{i + 1}</span>
                    <span class="text">
                        <span class="name">{numberedNames[entry.id] || getName(entry.id)}</span>
                        <span class="preview">{getPreview(entry.id)}</span>
                    </span>
                    {#if !isLocked}
                        <button class="duplicate" data-title="Duplicate this section below" on:click|stopPropagation={() => duplicateEntry(i)}>
                            <Icon id="add" size={0.85} white />
                        </button>
                        <button class="remove" data-title="Remove from arrangement" on:click|stopPropagation={() => removeEntry(i)}>
                            <Icon id="close" size={0.8} white />
                        </button>
                    {/if}
                </div>
            {/each}
            {#if dropAt === layoutSlides.length}<div class="dropLine" />{/if}

            {#if !layoutSlides.length}
                <div class="empty">Drag or click a group below to build the arrangement</div>
            {/if}
        </div>

        <div class="sectionTitle">
            <span>Add a group</span>
            <span class="hint">Click to add · drag to place</span>
        </div>

        <div class="chips">
            {#each showGroups as group}
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <div
                    class="chip"
                    style="--group-color: {group.color || 'var(--secondary)'};"
                    on:pointerdown={(e) => (isLocked ? guard() : pointerDown(e, "group", undefined, group))}
                    on:keydown={(e) => {
                        if (e.key === "Enter" && guard()) insertGroup(group.id, layoutSlides.length)
                    }}
                    role="button"
                    tabindex="0"
                >
                    {group.group}
                </div>
            {/each}
            {#if !showGroups.length}
                <div class="empty">This show has no groups yet</div>
            {/if}
        </div>

        <button class="toggleGlobal" on:click={() => globalGroupViewEnabled.set(!$globalGroupViewEnabled)}>
            <Icon id={$globalGroupViewEnabled ? "remove" : "add"} size={0.8} white />
            {$globalGroupViewEnabled ? "Hide" : "Show"} global groups (new empty slide)
        </button>

        {#if $globalGroupViewEnabled}
            <div class="chips">
                {#each globalGroups as group}
                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                    <div class="chip global" style="--group-color: {group.color || 'var(--secondary)'};" on:click={() => addGlobalGroup(group)} on:keydown={(e) => e.key === "Enter" && addGlobalGroup(group)} role="button" tabindex="0">
                        <Icon id="add" size={0.7} white />
                        {group.group}
                    </div>
                {/each}
            </div>
        {/if}
    </div>

    {#if ghost}
        <div class="ghost" style="left: {ghost.x}px; top: {ghost.y}px; --group-color: {ghost.color};">{ghost.label}</div>
    {/if}
</div>

<style>
    .arrangement {
        height: 100%;
        position: relative;
        overflow: hidden;
    }
    .scroll {
        height: 100%;
        overflow-y: auto;
        padding: 8px 8px 16px;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .scroll > * {
        flex-shrink: 0;
    }

    .sectionTitle {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        padding: 6px 4px 2px;
        font-size: 0.75em;
        font-weight: 600;
        letter-spacing: 0.6px;
        text-transform: uppercase;
        opacity: 0.85;
    }
    .sectionTitle .hint {
        font-weight: 400;
        text-transform: none;
        letter-spacing: 0;
        opacity: 0.5;
    }

    .list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-height: 40px;
        padding: 2px;
        border-radius: 10px;
    }
    .list.dragging {
        background: rgb(255 255 255 / 0.02);
    }

    .row {
        position: relative;
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 40px;
        padding: 5px 8px 5px 6px;
        border-radius: 10px;
        cursor: grab;
        touch-action: none;

        background: linear-gradient(90deg, color-mix(in srgb, var(--group-color) 22%, transparent) 0%, rgb(255 255 255 / 0.02) 70%);
        border: 1px solid color-mix(in srgb, var(--group-color) 30%, transparent);
        box-shadow: inset 3px 0 0 var(--group-color);
        transition:
            background 0.15s,
            transform 0.15s,
            opacity 0.15s,
            box-shadow 0.2s;
    }
    .row:hover {
        background: linear-gradient(90deg, color-mix(in srgb, var(--group-color) 32%, transparent) 0%, rgb(255 255 255 / 0.04) 70%);
    }
    .row:active {
        cursor: grabbing;
    }
    .row.isDragged {
        opacity: 0.35;
    }
    .row.disabled {
        opacity: 0.45;
    }
    .row.flash {
        box-shadow:
            inset 3px 0 0 var(--group-color),
            0 0 0 1px var(--group-color),
            0 0 16px color-mix(in srgb, var(--group-color) 50%, transparent);
    }

    .handle {
        display: flex;
        opacity: 0.35;
    }
    .row:hover .handle {
        opacity: 0.8;
    }

    .number {
        min-width: 18px;
        text-align: center;
        font-size: 0.75em;
        opacity: 0.5;
        font-variant-numeric: tabular-nums;
    }

    .text {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        line-height: 1.25;
    }
    .name {
        font-weight: 600;
        font-size: 0.9em;
        color: var(--text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .preview {
        font-size: 0.72em;
        opacity: 0.5;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .preview:empty {
        display: none;
    }


    .duplicate,
    .remove {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: inherit;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.15s;
    }
    .row:hover .remove,
    .row:hover .duplicate {
        opacity: 0.6;
    }
    .duplicate:hover {
        opacity: 1 !important;
        background: color-mix(in srgb, var(--group-color) 40%, transparent);
    }
    .remove:hover {
        opacity: 1 !important;
        background: rgb(255 60 60 / 0.25);
    }

    .dropLine {
        height: 3px;
        margin: -2px 6px;
        border-radius: 3px;
        background: var(--secondary);
        box-shadow: 0 0 10px var(--secondary);
    }

    .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 2px;
    }
    .chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 5px 11px;
        border-radius: 99px;
        font-size: 0.8em;
        font-weight: 600;
        cursor: pointer;
        touch-action: none;
        color: var(--text);
        background: color-mix(in srgb, var(--group-color) 18%, transparent);
        border: 1px solid color-mix(in srgb, var(--group-color) 55%, transparent);
        transition:
            background 0.15s,
            box-shadow 0.2s;
    }
    .chip:hover {
        background: color-mix(in srgb, var(--group-color) 32%, transparent);
        box-shadow: 0 0 12px color-mix(in srgb, var(--group-color) 35%, transparent);
    }
    .chip.global {
        border-style: dashed;
    }

    .toggleGlobal {
        align-self: flex-start;
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 6px;
        padding: 4px 8px;
        border: none;
        border-radius: 8px;
        background: transparent;
        color: var(--text);
        opacity: 0.6;
        font-size: 0.75em;
        cursor: pointer;
    }
    .toggleGlobal:hover {
        opacity: 1;
        background: rgb(255 255 255 / 0.05);
    }

    .ghost {
        position: fixed;
        z-index: 6000;
        pointer-events: none;
        transform: translate(12px, -50%);
        padding: 6px 12px;
        border-radius: 10px;
        font-size: 0.85em;
        font-weight: 600;
        color: var(--text);
        background: color-mix(in srgb, var(--group-color) 45%, #120c09);
        border: 1px solid var(--group-color);
        box-shadow:
            0 8px 24px rgb(0 0 0 / 0.5),
            0 0 16px color-mix(in srgb, var(--group-color) 45%, transparent);
    }

    .empty {
        padding: 10px;
        font-size: 0.8em;
        opacity: 0.5;
        text-align: center;
        width: 100%;
    }

    /* brief highlight on the slide in the main view after clicking a row */
    :global(.churchFlash > .slide) {
        box-shadow:
            0 0 0 2px var(--secondary),
            0 0 24px var(--secondary) !important;
        transition: box-shadow 0.2s;
    }
</style>
