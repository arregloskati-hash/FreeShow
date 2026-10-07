<script lang="ts">
    // ----- FreeShow Church -----
    // Minimal SMPTE source display: ● IN 1  01:00:12:04  Scarlett 2i2 · Ch 1 · 30 fps

    import { activePage, settingsTab, timecode } from "../../stores"
    import { formatSmpte, getTimecodeSettings, hasSignal, timecodeLive, type SmpteInput } from "./timecodeShared"

    export let input: SmpteInput = 1
    export let showBoth = false
    export let compact = false

    $: s = getTimecodeSettings($timecode)
    $: inputs = (showBoth ? [1, 2] : [input]) as SmpteInput[]

    function channelOf(i: SmpteInput) {
        return i === 1 ? s.inChannel1 : s.inChannel2
    }

    function state(i: SmpteInput, _live: any) {
        if (!s.inAudioDevice || channelOf(i) < 0) return "off"
        if ($timecodeLive.error) return "error"
        return hasSignal($timecodeLive.inputs[i]) ? "on" : "idle"
    }

    function shortName(label: string) {
        return (label || "").replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "").replace(/^Default - /, "")
    }

    function openSettings() {
        settingsTab.set("timecode" as any)
        activePage.set("settings")
    }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="sources" role="button" tabindex="-1" on:click={openSettings} data-title="Timecode settings">
    {#each inputs as i}
        {@const st = state(i, $timecodeLive)}
        {#if !(showBoth && st === "off" && i === 2)}
            <div class="source {st}" class:compact>
                <span class="dot"></span>
                <span class="tag">IN {i}</span>
                {#if st === "on"}
                    <span class="time">{formatSmpte($timecodeLive.inputs[i]?.time || 0, s.inFramerate)}</span>
                {:else}
                    <span class="state">{st === "off" ? "Not set" : st === "error" ? "Input error" : "No signal"}</span>
                {/if}
                {#if !compact && st !== "off"}
                    <span class="meta">{shortName($timecodeLive.deviceLabel)}{$timecodeLive.deviceLabel ? " · " : ""}Ch {channelOf(i) + 1} · {s.inFramerate} fps</span>
                {/if}
            </div>
        {/if}
    {/each}
</div>

<style>
    .sources {
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        min-width: 0;
    }

    .source {
        display: flex;
        align-items: center;
        gap: 7px;
        min-width: 0;
        padding: 3px 10px 3px 8px;
        border-radius: 99px;
        background-color: rgb(255 255 255 / 0.05);
        border: 1px solid rgb(255 255 255 / 0.06);
        font-size: 0.78em;
        white-space: nowrap;
    }
    .source:hover {
        background-color: rgb(255 255 255 / 0.09);
    }

    .dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        flex-shrink: 0;
        background-color: rgb(255 255 255 / 0.25);
    }
    .on .dot {
        background-color: #3ddc84;
        box-shadow: 0 0 6px #3ddc84;
    }
    .idle .dot {
        background-color: #ffb347;
    }
    .error .dot {
        background-color: #ff5a5a;
    }

    .tag {
        font-weight: 600;
        opacity: 0.6;
        letter-spacing: 0.4px;
    }
    .time {
        font-family: monospace;
        font-size: 1.12em;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.5px;
    }
    .state {
        opacity: 0.6;
    }
    .meta {
        opacity: 0.45;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .off {
        opacity: 0.6;
    }
</style>
