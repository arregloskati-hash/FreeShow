<script lang="ts">
    // ----- FreeShow Church -----
    // Compact slide-transition bar under the show title (Show tab).
    // Changes the global slide (text) transition live - the next slide change uses it.
    // A transition set on an output style or on single slides still wins (shown with a small hint).

    import type { TransitionType } from "../../types/Show"
    import { outputs, styles, transitionData } from "../stores"
    import Icon from "../components/helpers/Icon.svelte"

    // sticky offset (below the show title)
    export let top = 30

    const TYPES: { id: TransitionType; label: string }[] = [
        { id: "none", label: "Cut" },
        { id: "fade", label: "Fade" },
        { id: "blur", label: "Blur" },
        { id: "scale", label: "Zoom" },
        { id: "slide", label: "Slide" },
        { id: "spin", label: "Spin" }
    ]

    const EASINGS = [
        { value: "sine", label: "Smooth" },
        { value: "linear", label: "Linear" },
        { value: "cubic", label: "Soft" },
        { value: "circ", label: "Sharp" },
        { value: "back", label: "Back" },
        { value: "elastic", label: "Elastic" },
        { value: "bounce", label: "Bounce" }
    ]

    const DIRECTIONS = [
        { id: "left_right", icon: "→" },
        { id: "right_left", icon: "←" },
        { id: "bottom_top", icon: "↑" },
        { id: "top_bottom", icon: "↓" }
    ]

    $: current = $transitionData?.text || { type: "fade", duration: 500, easing: "sine" }
    $: type = current.type || "fade"
    $: duration = type === "none" ? 0 : Number(current.duration ?? 500)
    $: direction = current.custom?.direction || "left_right"

    function update(values: { [key: string]: any }) {
        transitionData.update((a) => {
            const text = { ...(a.text || { type: "fade", duration: 500, easing: "sine" }), ...values }
            // "Cut" keeps the last duration, so switching back to Fade restores it
            return { ...a, text }
        })
    }

    function setType(id: TransitionType) {
        if (id === type) return
        const values: any = { type: id }
        if (id !== "none" && !Number(current.duration)) values.duration = 500
        update(values)
    }

    function setDuration(e: Event) {
        const value = Number((e.target as HTMLInputElement).value)
        update({ duration: value })
    }

    function nudge(amount: number) {
        const next = Math.max(0, Math.min(3000, Math.round((Number(current.duration ?? 500) + amount) / 50) * 50))
        update({ duration: next })
    }

    function setEasing(e: Event) {
        update({ easing: (e.target as HTMLSelectElement).value })
    }

    function setDirection(id: string) {
        update({ custom: { ...(current.custom || {}), direction: id } })
    }

    // an output style with its own transition overrides this (FreeShow priority: slide > style > global)
    $: overridingStyle = Object.values($outputs || {}).find((output: any) => output?.enabled && !output.stageOutput && output.style && $styles[output.style]?.transition?.text?.type)
    $: overrideName = overridingStyle ? $styles[(overridingStyle as any).style]?.name || "an output style" : ""

    let durationFocus = false
    $: seconds = (Number(current.duration ?? 500) / 1000).toFixed(Number(current.duration ?? 500) % 100 === 0 ? 1 : 2)
</script>

<div class="transitionBar" class:override={!!overrideName} style="top: {top}px;">
    <span class="label" data-title="Slide transition (live)">
        <Icon id="transition" size={0.8} white />
    </span>

    <div class="types">
        {#each TYPES as t}
            <button class="type" class:active={type === t.id} on:click={() => setType(t.id)}>{t.label}</button>
        {/each}
    </div>

    {#if type !== "none"}
        <div class="sep"></div>

        <div class="duration" class:focus={durationFocus}>
            <button class="step" data-title="Faster" on:click={() => nudge(-100)}>−</button>
            <input type="range" min="0" max="3000" step="50" value={duration} on:input={setDuration} on:focus={() => (durationFocus = true)} on:blur={() => (durationFocus = false)} aria-label="Transition duration" />
            <button class="step" data-title="Slower" on:click={() => nudge(100)}>+</button>
            <span class="value">{seconds}s</span>
        </div>

        <div class="sep"></div>

        {#if type === "slide"}
            <div class="directions">
                {#each DIRECTIONS as d}
                    <button class="dir" class:active={direction === d.id} on:click={() => setDirection(d.id)}>{d.icon}</button>
                {/each}
            </div>
            <div class="sep"></div>
        {/if}

        <select class="easing" value={current.easing || "sine"} on:change={setEasing} aria-label="Transition easing">
            {#each EASINGS as e}
                <option value={e.value}>{e.label}</option>
            {/each}
        </select>
    {/if}

    {#if overrideName}
        <span class="hint" data-title="The output style &quot;{overrideName}&quot; has its own slide transition, which is used instead. Remove it in Settings → Styles to use this one.">
            <Icon id="info" size={0.75} white />
            Style override
        </span>
    {/if}
</div>

<style>
    .transitionBar {
        position: sticky;
        top: 30px;
        z-index: 199;

        display: flex;
        align-items: center;
        gap: 6px;

        height: 28px;
        margin: 2px 6px 0;
        padding: 0 6px;

        border-radius: 8px;
        background-color: rgb(0 0 10 / 0.28);
        backdrop-filter: blur(10px);

        font-size: 0.78em;
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: none;
        white-space: nowrap;
    }
    .transitionBar::-webkit-scrollbar {
        display: none;
    }

    .label {
        display: flex;
        opacity: 0.6;
        flex-shrink: 0;
    }

    button,
    select {
        font-family: inherit;
        font-size: inherit;
        color: var(--text);
        background: transparent;
        border: none;
        cursor: pointer;
    }

    .types {
        display: flex;
        gap: 2px;
        padding: 2px;
        border-radius: 7px;
        background-color: rgb(255 255 255 / 0.04);
        flex-shrink: 0;
    }

    .type {
        padding: 2px 8px;
        border-radius: 5px;
        opacity: 0.65;
        transition:
            background-color 0.15s,
            opacity 0.15s;
    }
    .type:hover {
        opacity: 1;
        background-color: rgb(255 255 255 / 0.06);
    }
    .type.active {
        opacity: 1;
        font-weight: 600;
        background-color: var(--secondary);
        color: var(--secondary-text, #fff);
    }

    .sep {
        width: 1px;
        height: 14px;
        flex-shrink: 0;
        background-color: rgb(255 255 255 / 0.12);
    }

    .duration {
        display: flex;
        align-items: center;
        gap: 2px;
        flex-shrink: 0;
    }
    .duration input {
        width: 90px;
        height: 4px;
        accent-color: var(--secondary);
        cursor: pointer;
    }
    .step {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        line-height: 1;
        opacity: 0.6;
    }
    .step:hover {
        opacity: 1;
        background-color: rgb(255 255 255 / 0.08);
    }
    .value {
        min-width: 34px;
        text-align: end;
        font-variant-numeric: tabular-nums;
        opacity: 0.85;
    }

    .directions {
        display: flex;
        gap: 1px;
        flex-shrink: 0;
    }
    .dir {
        width: 20px;
        height: 20px;
        border-radius: 5px;
        opacity: 0.55;
    }
    .dir.active {
        opacity: 1;
        background-color: rgb(255 255 255 / 0.12);
    }

    .easing {
        padding: 2px 4px;
        border-radius: 5px;
        opacity: 0.75;
        flex-shrink: 0;
    }
    .easing:hover {
        opacity: 1;
        background-color: rgb(255 255 255 / 0.06);
    }
    .easing option {
        background-color: var(--primary-darker, #1a1a1a);
        color: var(--text);
    }

    .hint {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-left: auto;
        padding: 2px 8px;
        border-radius: 99px;
        flex-shrink: 0;
        color: #ffb347;
        background-color: rgb(255 179 71 / 0.12);
    }
</style>
