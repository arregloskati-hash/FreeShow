<script lang="ts">
    // ----- FreeShow Church -----
    // Settings > Timecode: receiving (SMPTE in) and sending (SMPTE out), separately.

    import { onDestroy, onMount } from "svelte"
    import { timecode } from "../../stores"
    import TimecodeSource from "./TimecodeSource.svelte"
    import { refreshAudioDevices } from "./receiver"
    import { audioDevices, FRAMERATES, getTimecodeSettings, timecodeLive, timecodeOutStatus, updateTimecodeSettings } from "./timecodeShared"

    $: s = getTimecodeSettings($timecode)

    // native devices: every channel of every interface
    let loading = true
    async function loadDevices() {
        await refreshAudioDevices()
        loading = false
    }
    onMount(() => {
        loadDevices()
        navigator.mediaDevices?.addEventListener?.("devicechange", loadDevices)
    })
    onDestroy(() => navigator.mediaDevices?.removeEventListener?.("devicechange", loadDevices))

    $: inputDevices = $audioDevices.inputs
    $: outputDevices = $audioDevices.outputs

    $: inDevice = inputDevices.find((d) => d.name === s.inAudioDevice)
    $: inChannels = inDevice?.channels || $timecodeLive.channelCount || 2
    $: inChannelOptions = Array.from({ length: Math.max(inChannels, s.inChannel1 + 1, s.inChannel2 + 1) }, (_, i) => i)

    $: outDevice = outputDevices.find((d) => d.name === s.outDevice)
    $: outChannels = outDevice?.channels || $timecodeOutStatus.channelCount || 2
    $: outChannelOptions = Array.from({ length: Math.max(outChannels, s.outChannel + 1) }, (_, i) => i)

    $: inputMissing = !loading && !!s.inAudioDevice && !inDevice
    $: outputMissing = !loading && !!s.outDevice && !outDevice

    // "Rogue Amoeba Software, Inc.: Timecode" -> "Timecode"
    const deviceLabel = (name: string) => (name || "").replace(/^[^:]{2,60}:\s+/, "")

    function channelLabel(ch: number, total: number) {
        // stereo pairs read better on big interfaces: "Channel 3 (2 L)"
        if (total <= 2) return `Channel ${ch + 1}`
        return `Channel ${ch + 1}  ·  ${Math.floor(ch / 2) * 2 + 1}/${Math.floor(ch / 2) * 2 + 2} ${ch % 2 ? "R" : "L"}`
    }

    const num = (e: Event) => Number((e.target as HTMLSelectElement).value)
    const str = (e: Event) => (e.target as HTMLSelectElement).value
</script>

<div class="timecode">
    <section>
        <header>
            <h3>Receive</h3>
            <span class="sub">SMPTE / LTC in</span>
            <div class="source"><TimecodeSource showBoth /></div>
        </header>

        <label class="field full">
            <span>Audio Input Device</span>
            <select value={s.inAudioDevice} on:change={(e) => updateTimecodeSettings({ inAudioDevice: str(e) })}>
                <option value="">No Input Device</option>
                {#if inputMissing}<option value={s.inAudioDevice}>{deviceLabel(s.inAudioDevice)} (not connected)</option>{/if}
                {#each inputDevices as device}
                    <option value={device.name}>{deviceLabel(device.name)} ({device.channels} ch)</option>
                {/each}
            </select>
        </label>

        <div class="grid">
            <label class="field">
                <span>SMPTE Timecode Framerate</span>
                <select value={s.inFramerate.toString()} on:change={(e) => updateTimecodeSettings({ inFramerate: num(e) })}>
                    {#each FRAMERATES as fps}<option value={fps.toString()}>{fps}</option>{/each}
                </select>
            </label>
            <div></div>

            <label class="field">
                <span>SMPTE Timecode Input 1</span>
                <select value={s.inChannel1.toString()} disabled={!s.inAudioDevice} on:change={(e) => updateTimecodeSettings({ inChannel1: num(e) })}>
                    <option value="-1">Select Input Channel</option>
                    {#each inChannelOptions as ch}<option value={ch.toString()}>{channelLabel(ch, inChannels)}</option>{/each}
                </select>
            </label>

            <label class="field">
                <span>SMPTE Timecode Input 2</span>
                <select value={s.inChannel2.toString()} disabled={!s.inAudioDevice} on:change={(e) => updateTimecodeSettings({ inChannel2: num(e) })}>
                    <option value="-1">Select Input Channel</option>
                    {#each inChannelOptions as ch}<option value={ch.toString()}>{channelLabel(ch, inChannels)}</option>{/each}
                </select>
            </label>
        </div>

        {#if $audioDevices.error}
            <p class="note warn">{$audioDevices.error}</p>
        {:else if $timecodeLive.error}
            <p class="note warn">{$timecodeLive.error}</p>
        {:else}
            <p class="note">Turn on <b>Timecode</b> in a song's timeline and give it an offset (e.g. 01:00:00;00). When the incoming time reaches it, that song opens and its timeline runs in sync.</p>
        {/if}
    </section>

    <section>
        <header>
            <h3>Send</h3>
            <span class="sub">SMPTE / LTC out</span>
            <label class="switch">
                <input type="checkbox" checked={s.outEnabled} on:change={(e) => updateTimecodeSettings({ outEnabled: e.currentTarget.checked })} />
                <span>{s.outEnabled ? "On" : "Off"}</span>
            </label>
        </header>

        <div class:off={!s.outEnabled}>
            <label class="field full">
                <span>Audio Output Device</span>
                <select value={s.outDevice} on:change={(e) => updateTimecodeSettings({ outDevice: str(e) })}>
                    <option value="">No Output Device</option>
                    {#if outputMissing}<option value={s.outDevice}>{deviceLabel(s.outDevice)} (not connected)</option>{/if}
                    {#each outputDevices as device}
                        <option value={device.name}>{deviceLabel(device.name)} ({device.channels} ch)</option>
                    {/each}
                </select>
            </label>

            <div class="grid">
                <label class="field">
                    <span>SMPTE Timecode Framerate</span>
                    <select value={s.outFramerate.toString()} on:change={(e) => updateTimecodeSettings({ outFramerate: num(e) })}>
                        {#each FRAMERATES as fps}<option value={fps.toString()}>{fps}</option>{/each}
                    </select>
                </label>

                <label class="field">
                    <span>SMPTE Timecode Output</span>
                    <select value={s.outChannel.toString()} disabled={!s.outDevice} on:change={(e) => updateTimecodeSettings({ outChannel: num(e) })}>
                        <option value="-1">All Channels</option>
                        {#each outChannelOptions as ch}<option value={ch.toString()}>{channelLabel(ch, outChannels)}</option>{/each}
                    </select>
                </label>
            </div>

            {#if s.outEnabled && $timecodeOutStatus.error}
                <p class="note warn">{$timecodeOutStatus.error}</p>
            {:else}
                <p class="note">Sends the playing song's timeline as LTC (with the song's offset when its Timecode is on).</p>
            {/if}
        </div>
    </section>
</div>

<style>
    .timecode {
        display: flex;
        flex-direction: column;
        gap: 18px;
        max-width: 860px;
        margin: 0 auto;
    }

    section {
        padding: 16px 18px 14px;
        border-radius: 12px;
        background-color: var(--primary-darker);
        border: 1px solid rgb(255 255 255 / 0.05);
    }

    header {
        display: flex;
        align-items: baseline;
        gap: 10px;
        margin-bottom: 14px;
    }
    h3 {
        font-size: 1.05em;
        font-weight: 600;
    }
    .sub {
        font-size: 0.8em;
        opacity: 0.5;
        letter-spacing: 0.3px;
    }
    .source {
        margin-left: auto;
        align-self: center;
    }

    .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px 22px;
        margin-top: 14px;
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: 7px;
    }
    .field.full {
        max-width: calc(50% - 11px);
    }
    .field > span {
        font-size: 0.92em;
        opacity: 0.9;
    }

    select {
        appearance: none;
        -webkit-appearance: none;
        width: 100%;
        padding: 7px 30px 7px 10px;
        border-radius: 6px;
        border: none;
        outline: none;
        font-family: inherit;
        font-size: 0.95em;
        color: var(--text);
        background-color: rgb(255 255 255 / 0.07);
        background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
        background-position:
            calc(100% - 15px) 52%,
            calc(100% - 10px) 52%;
        background-size:
            5px 5px,
            5px 5px;
        background-repeat: no-repeat;
        cursor: pointer;
    }
    select:hover:not(:disabled) {
        background-color: rgb(255 255 255 / 0.1);
    }
    select:focus-visible {
        box-shadow: 0 0 0 1px var(--secondary);
    }
    select:disabled {
        opacity: 0.45;
        cursor: default;
    }
    select option {
        background-color: var(--primary-darker);
        color: var(--text);
    }

    .note {
        margin-top: 14px;
        font-size: 0.82em;
        opacity: 0.55;
        line-height: 1.45;
        white-space: normal;
    }
    .note.warn {
        opacity: 1;
        color: #ffb347;
    }

    .switch {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.85em;
        cursor: pointer;
    }
    .switch input {
        accent-color: var(--secondary);
        width: 15px;
        height: 15px;
        cursor: pointer;
    }

    .off {
        opacity: 0.45;
    }
</style>
