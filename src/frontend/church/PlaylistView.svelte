<script lang="ts">
    // ----- FreeShow Church -----
    // Continuous playlist (View > Continuous Playlist): every song/show in the current project, one after
    // another in a single scrolling list, instead of one song at a time. Clicking a slide works like normal
    // (goes live), and that song becomes the active one (tools on the right, next/previous, etc.).

    import { onDestroy, tick } from "svelte"
    import type { ProjectShowRef } from "../../types/Projects"
    import { activeProject, activeShow, categories, outputs, projects, showsCache, special } from "../stores"
    import Icon from "../components/helpers/Icon.svelte"
    import { getActiveOutputs } from "../components/helpers/output"
    import { loadShows } from "../components/helpers/setShow"
    import Loader from "../components/main/Loader.svelte"
    import Center from "../components/system/Center.svelte"
    import Slides from "../components/show/Slides.svelte"
    import TransitionBar from "./TransitionBar.svelte"
    import { togglePlaylistView } from "./playlistView"

    $: project = $projects[$activeProject || ""]
    $: items = (project?.shows || []).map((item, index) => ({ ...item, index })) as (ProjectShowRef & { index: number })[]
    $: listItems = items.filter((a) => (a.type || "show") === "show" || a.type === "section")
    $: showIds = listItems.filter((a) => (a.type || "show") === "show").map((a) => a.id)

    // load all songs of the project (only when the list changes)
    let loadedKey = ""
    let loading = false
    $: key = showIds.join(",")
    $: if (key !== loadedKey) load()
    async function load() {
        const current = key
        loadedKey = current
        loading = true
        await loadShows(showIds)
        if (current === loadedKey) loading = false
        await tick()
        scrollToItem(activeIndex, false)
    }

    function getName(item: ProjectShowRef) {
        if (item.type === "section") return item.name || ""
        return $showsCache[item.id]?.name || item.name || "Unnamed"
    }
    function getIcon(item: ProjectShowRef) {
        const show = $showsCache[item.id]
        return $categories[show?.category || ""]?.icon || "noIcon"
    }

    $: activeIndex = $activeShow?.index ?? -1

    function selectSong(item: ProjectShowRef & { index: number }) {
        activeShow.set({ id: item.id, index: item.index, type: "show" })
    }

    // ---- scrolling ----

    let scrollElem: HTMLElement | undefined

    function scrollToItem(index: number, smooth = true) {
        if (!scrollElem || index < 0) return
        const elem = scrollElem.querySelector(`#playlist_item_${index}`) as HTMLElement | null
        if (!elem) return
        scrollElem.scrollTo({ top: Math.max(0, elem.offsetTop - 34), behavior: smooth ? "smooth" : "auto" })
    }

    // song picked in the project list -> jump to it (but not when it was picked by clicking a slide here)
    let clickedHere = false
    let previousActive = ""
    $: activeKey = `${$activeShow?.id}_${activeIndex}`
    $: if (activeKey !== previousActive) {
        previousActive = activeKey
        if (!clickedHere) setTimeout(() => scrollToItem(activeIndex))
        clickedHere = false
    }

    // live slide moved (keyboard, remote, next song...) -> keep it visible
    $: outputId = getActiveOutputs($outputs, true, true, true)[0] || ""
    $: outSlide = $outputs[outputId]?.out?.slide
    $: liveKey = outSlide ? `${outSlide.id}_${outSlide.projectIndex}_${outSlide.index}` : ""
    let previousLive = ""
    $: if (liveKey && liveKey !== previousLive) {
        previousLive = liveKey
        setTimeout(keepLiveVisible, 50)
    }
    function keepLiveVisible() {
        if (!scrollElem || !outSlide) return
        const projectIndex = outSlide.projectIndex ?? items.find((a) => a.id === outSlide?.id)?.index
        if (projectIndex === undefined) return
        const itemElem = scrollElem.querySelector(`#playlist_item_${projectIndex}`) as HTMLElement | null
        const slideElem = itemElem?.querySelector(".grid")?.children[outSlide.index || 0] as HTMLElement | undefined
        if (!slideElem) return

        const viewTop = scrollElem.scrollTop
        const viewBottom = viewTop + scrollElem.clientHeight
        const rect = slideElem.getBoundingClientRect()
        const parentRect = scrollElem.getBoundingClientRect()
        const top = rect.top - parentRect.top + viewTop
        if (top > viewTop + 60 && top + rect.height < viewBottom - 20) return
        scrollElem.scrollTo({ top: Math.max(0, top - 80), behavior: "smooth" })
    }

    function clickCapture(e: MouseEvent, item: ProjectShowRef & { index: number }) {
        if (!(e.target as HTMLElement)?.closest(".slide")) return
        clickedHere = true
        if ($activeShow?.id !== item.id || $activeShow?.index !== item.index) selectSong(item)
    }

    onDestroy(() => {
        clickedHere = false
    })
</script>

<div class="playlist" bind:this={scrollElem}>
    <div class="top">
        {#if $special.churchTransitionBar !== false}
            <div class="bar"><TransitionBar top={0} /></div>
        {/if}
        <button class="exit" data-title="Back to one song at a time (View → Continuous Playlist)" on:click={togglePlaylistView}>
            <Icon id="close" size={0.75} white />
            <span>Playlist</span>
        </button>
    </div>

    {#if !listItems.length}
        <Center faded>This project has no songs yet.</Center>
    {:else if loading && !showIds.every((id) => $showsCache[id])}
        <Center><Loader /></Center>
    {:else}
        {#each listItems as item (item.index + "_" + item.id)}
            {#if item.type === "section"}
                <div class="section" style={item.color ? `--color: ${item.color};` : ""}>
                    <span>{getName(item)}</span>
                </div>
            {:else}
                <div id="playlist_item_{item.index}" class="song" class:active={activeIndex === item.index && $activeShow?.id === item.id} on:click|capture={(e) => clickCapture(e, item)} role="none">
                    <div class="songHeader" role="button" tabindex="0" on:click={() => selectSong(item)} on:keydown={(e) => e.key === "Enter" && selectSong(item)}>
                        <Icon id={getIcon(item)} custom white right size={0.85} />
                        <span class="name">{getName(item)}</span>
                        {#if outSlide?.id === item.id && (outSlide.projectIndex === undefined || outSlide.projectIndex === item.index)}
                            <span class="live">LIVE</span>
                        {/if}
                    </div>

                    {#if $showsCache[item.id]}
                        <Slides showId={item.id} layout={item.layout || ""} projectIndex={item.index} hideHeader />
                    {:else}
                        <p class="missing">Song not found</p>
                    {/if}
                </div>
            {/if}
        {/each}
        <div class="end"></div>
    {/if}
</div>

<style>
    .playlist {
        position: relative;
        height: 100%;
        width: 100%;
        overflow-y: auto;
        overflow-x: hidden;
    }

    .top {
        position: sticky;
        top: 0;
        z-index: 210;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 6px 2px 0;
        backdrop-filter: blur(10px);
        background-color: rgb(0 0 10 / 0.2);
    }
    .bar {
        flex: 1;
        min-width: 0;
    }
    .bar :global(.transitionBar) {
        margin-top: 0;
    }
    .exit {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
        margin-left: auto;
        padding: 4px 10px;
        border-radius: 99px;
        border: 1px solid var(--primary-lighter);
        background: transparent;
        color: var(--text);
        font-family: inherit;
        font-size: 0.78em;
        cursor: pointer;
        opacity: 0.8;
    }
    .exit:hover {
        opacity: 1;
        background-color: rgb(255 255 255 / 0.06);
    }

    .song {
        margin: 6px 6px 10px;
        border-radius: 10px;
        border: 1px solid transparent;
        background-color: rgb(255 255 255 / 0.015);
    }
    .song.active {
        border-color: color-mix(in srgb, var(--secondary) 45%, transparent);
    }

    /* the slides of each song are part of the one long list (no own scrolling) */
    .song :global(.scroll),
    .song :global(.droparea) {
        overflow: visible !important;
        height: auto !important;
        flex: none !important;
    }

    /* no big empty space under every song (only needed at the end of a single song) */
    .song :global(.grid) {
        padding-bottom: 5px !important;
    }

    .songHeader {
        position: sticky;
        top: 34px;
        z-index: 205;

        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 10px;

        font-weight: 600;
        font-size: 0.9em;
        border-radius: 10px 10px 0 0;
        background-color: var(--primary-darker);
        cursor: pointer;
    }
    .song.active .songHeader {
        background-color: color-mix(in srgb, var(--secondary) 18%, var(--primary-darker));
    }
    .songHeader .name {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
    }
    .live {
        margin-left: auto;
        padding: 1px 8px;
        border-radius: 99px;
        font-size: 0.75em;
        letter-spacing: 0.5px;
        background-color: var(--secondary);
        color: var(--secondary-text, #fff);
    }

    .section {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 14px 12px 4px;
        font-size: 0.75em;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 1px;
        opacity: 0.6;
    }
    .section::after {
        content: "";
        flex: 1;
        height: 1px;
        background-color: var(--color, rgb(255 255 255 / 0.2));
    }

    .missing {
        padding: 10px 14px;
        opacity: 0.5;
        font-size: 0.85em;
    }

    .end {
        height: 60px;
    }
</style>
