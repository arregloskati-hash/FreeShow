<script lang="ts">
    // ----- FreeShow Church -----
    // Group chips for the "New show" lyrics editor.
    // Put the cursor in a stanza (or just start from the top) and click a group:
    // the stanza gets a [Group] label and the cursor jumps to the next stanza,
    // so a whole song can be tagged with a few clicks.

    import { createEventDispatcher, onDestroy, onMount, tick } from "svelte"
    import { groups } from "../stores"
    import { translateText } from "../utils/language"
    import { isGroupHidden } from "../utils/profile"

    export let text = ""
    export let textareaSelector = ".churchLyrics textarea"
    // "Text edit" mode: blocks are slides, and a slide without a label belongs to the group above it
    export let slideMode = false

    const dispatch = createEventDispatcher()

    const ORDER = ["intro", "verse", "pre_chorus", "chorus", "bridge", "tag", "break", "outro"]
    $: groupList = Object.entries($groups)
        .filter(([id]) => !isGroupHidden(id))
        .map(([id, g]: [string, any]) => {
            const order = g.default ? ORDER.indexOf(g.name) : -1
            return { id, name: g.default ? translateText(`groups.${g.name}`) : g.name, color: g.color || "var(--secondary)", order: order < 0 ? 50 : order }
        })
        .filter((g) => g.name)
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))

    // ---- stanzas ----

    type Stanza = { start: number; end: number; label: string; preview: string }
    const LABEL = /^\s*\[(.+)\]\s*$/

    function getStanzas(value: string): Stanza[] {
        const stanzas: Stanza[] = []
        const lines = value.split("\n")
        let offset = 0
        let current: { start: number; lines: string[] } | null = null

        lines.forEach((line, i) => {
            const isEmpty = !line.trim()
            if (!isEmpty && !current) current = { start: offset, lines: [] }
            if (!isEmpty && current) current.lines.push(line)
            const isLast = i === lines.length - 1
            if ((isEmpty || isLast) && current) {
                const end = isEmpty ? offset - 1 : offset + line.length
                const label = current.lines[0]?.match(LABEL)?.[1] || ""
                const preview = (label ? current.lines[1] : current.lines[0]) || ""
                stanzas.push({ start: current.start, end: Math.max(current.start, end), label, preview })
                current = null
            }
            offset += line.length + 1
        })
        return stanzas
    }

    $: stanzas = getStanzas(text)

    let caret = 0
    function getTextarea() {
        return document.querySelector(textareaSelector) as HTMLTextAreaElement | null
    }
    function trackCaret() {
        const ta = getTextarea()
        if (ta && document.activeElement === ta) caret = ta.selectionStart
    }

    // stanza at the cursor, or the next one if the cursor sits in an empty gap
    $: currentIndex = findStanza(stanzas, caret)
    function findStanza(list: Stanza[], pos: number) {
        if (!list.length) return -1
        const inside = list.findIndex((s) => pos >= s.start && pos <= s.end + 1)
        if (inside > -1) return inside
        const next = list.findIndex((s) => s.start >= pos)
        return next > -1 ? next : list.length - 1
    }

    onMount(() => document.addEventListener("selectionchange", trackCaret))
    onDestroy(() => document.removeEventListener("selectionchange", trackCaret))

    // ---- tagging ----

    async function tag(name: string | null) {
        const index = currentIndex
        const stanza = stanzas[index]
        if (!stanza) return

        const before = text.slice(0, stanza.start)
        const body = text.slice(stanza.start, stanza.end + 1)
        const after = text.slice(stanza.end + 1)

        const bodyLines = body.split("\n")
        if (LABEL.test(bodyLines[0] || "")) bodyLines.shift()
        if (name) bodyLines.unshift(`[${name}]`)
        const newText = before + bodyLines.join("\n") + after

        text = newText
        dispatch("change", newText)

        // move on to the next stanza
        await tick()
        const nextStanzas = getStanzas(newText)
        const target = nextStanzas[Math.min(index + 1, nextStanzas.length - 1)]
        moveCaret(target ? target.start : newText.length)
    }

    function moveCaret(pos: number) {
        const ta = getTextarea()
        if (!ta) return
        // make sure the textarea already shows the new text
        if (ta.value !== text) ta.value = text
        ta.focus()
        ta.setSelectionRange(pos, pos)
        caret = pos

        // scroll the stanza into view
        const lineIndex = text.slice(0, pos).split("\n").length - 1
        const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20
        ta.scrollTop = Math.max(0, lineIndex * lineHeight - ta.clientHeight / 3)
    }

    function goTo(index: number) {
        const s = stanzas[index]
        if (s) moveCaret(s.start)
    }

    $: taggedCount = stanzas.filter((s) => s.label).length
    // the group the current block belongs to (in slide mode: nearest label at or above it)
    $: currentGroup = getCurrentGroup(stanzas, currentIndex)
    function getCurrentGroup(list: Stanza[], index: number) {
        if (index < 0) return ""
        if (!slideMode) return list[index]?.label || ""
        for (let i = index; i >= 0; i--) if (list[i]?.label) return list[i].label
        return ""
    }
    $: unit = slideMode ? "Slide" : "Stanza"
</script>

<div class="tagger">
    <div class="head">
        <span class="title">Groups</span>
        {#if stanzas.length}
            <span class="status">
                <button class="nav" disabled={currentIndex <= 0} on:mousedown|preventDefault on:click={() => goTo(currentIndex - 1)}>‹</button>
                {unit} {currentIndex + 1} of {stanzas.length}
                <button class="nav" disabled={currentIndex >= stanzas.length - 1} on:mousedown|preventDefault on:click={() => goTo(currentIndex + 1)}>›</button>
                <span class="preview">{stanzas[currentIndex]?.preview || ""}</span>
                {#if slideMode}
                    {#if currentGroup}<span class="count">in {currentGroup}</span>{/if}
                {:else}
                    <span class="count">{taggedCount}/{stanzas.length} tagged</span>
                {/if}
            </span>
        {:else}
            <span class="status">{slideMode ? "Put the cursor on a slide, then click a group to start that section" : "Paste or type lyrics, then click a group for each stanza"}</span>
        {/if}
    </div>

    <div class="chips">
        {#each groupList as group (group.id)}
            {@const isCurrent = currentGroup.toLowerCase().replace(/\s*\d+$/, "") === group.name.toLowerCase()}
            <button class="chip" class:isCurrent style="--group-color: {group.color};" disabled={!stanzas.length} on:mousedown|preventDefault on:click={() => tag(group.name)} data-title="Tag the current stanza as {group.name}">
                {group.name}
            </button>
        {/each}
        <button class="chip clear" disabled={!stanzas[currentIndex]?.label} on:mousedown|preventDefault on:click={() => tag(null)} data-title="Remove the group label from the current stanza">Clear</button>
    </div>
</div>

<style>
    .tagger {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 12px;
    }

    .head {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 0.8em;
        min-width: 0;
    }
    .title {
        font-weight: 600;
        letter-spacing: 0.6px;
        text-transform: uppercase;
        opacity: 0.85;
    }
    .status {
        display: flex;
        align-items: center;
        gap: 6px;
        opacity: 0.7;
        min-width: 0;
        flex: 1;
    }
    .preview {
        opacity: 0.6;
        font-style: italic;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
        flex: 1;
    }
    .count {
        white-space: nowrap;
        opacity: 0.8;
    }
    .nav {
        width: 22px;
        height: 22px;
        border: none;
        border-radius: 50%;
        background: rgb(255 255 255 / 0.06);
        color: var(--text);
        cursor: pointer;
        font-size: 1.1em;
        line-height: 1;
    }
    .nav:disabled {
        opacity: 0.3;
        cursor: default;
    }

    .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .chip {
        padding: 6px 13px;
        border-radius: 99px;
        font-size: 0.85em;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        color: var(--text);
        background: color-mix(in srgb, var(--group-color) 18%, transparent);
        border: 1px solid color-mix(in srgb, var(--group-color) 55%, transparent);
        transition:
            background 0.15s,
            box-shadow 0.2s;
    }
    .chip:hover:not(:disabled) {
        background: color-mix(in srgb, var(--group-color) 34%, transparent);
        box-shadow: 0 0 12px color-mix(in srgb, var(--group-color) 40%, transparent);
    }
    .chip.isCurrent {
        background: color-mix(in srgb, var(--group-color) 45%, transparent);
        box-shadow: 0 0 0 1px var(--group-color);
    }
    .chip.clear {
        --group-color: rgb(255 255 255 / 0.4);
        border-style: dashed;
    }
    .chip:disabled {
        opacity: 0.35;
        cursor: default;
    }
</style>
