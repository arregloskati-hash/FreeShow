<script lang="ts">
    // ----- FreeShow Church -----
    // Settings > Performance: is the GPU being used, what each part of FreeShow costs (live), and the
    // performance switches.

    import { onDestroy, onMount } from "svelte"
    import { Main } from "../../types/IPC/Main"
    import { requestMain, sendMain } from "../IPC/main"

    let info: any = null
    let timer: any = null
    let gpuChanged = false

    async function refresh() {
        const data = await requestMain(Main.CHURCH_PERFORMANCE)
        if (data) info = data
    }

    onMount(() => {
        refresh()
        timer = setInterval(refresh, 1500)
    })
    onDestroy(() => clearInterval(timer))

    function setConfig(key: string, value: boolean) {
        sendMain(Main.SET_STORE_VALUE, { file: "config", key, value } as any)
        if (info) info = { ...info, [key]: value }
    }

    const FEATURES = [
        { key: "gpu_compositing", label: "Drawing (compositing)" },
        { key: "rasterization", label: "Text & graphics" },
        { key: "video_decode", label: "Video decoding" },
        { key: "webgl", label: "WebGL effects" }
    ]

    function featureState(value: string | undefined) {
        if (!value) return { label: "Unknown", cls: "idle" }
        if (value.startsWith("enabled")) return { label: "GPU", cls: "on" }
        if (value.includes("software")) return { label: "Software (CPU)", cls: "idle" }
        return { label: "Off (CPU)", cls: "off" }
    }

    $: gpuOk = info && featureState(info.gpuStatus?.gpu_compositing).cls === "on" && featureState(info.gpuStatus?.video_decode).cls === "on"
    $: topProcesses = info ? [...info.processes].sort((a, b) => b.cpu - a.cpu).slice(0, 10) : []
    $: cpuOfMachine = info ? Math.round((info.totalCpu / Math.max(1, info.cpuCores)) * 10) / 10 : 0
</script>

<div class="perf">
    {#if !info}
        <p class="note">Measuring…</p>
    {:else}
        <!-- summary -->
        <div class="summary">
            <div class="stat">
                <span class="big">{info.totalCpu}%</span>
                <span class="small">CPU (FreeShow, 100% = one core)</span>
            </div>
            <div class="stat">
                <span class="big">{cpuOfMachine}%</span>
                <span class="small">of the whole computer ({info.cpuCores} cores)</span>
            </div>
            <div class="stat">
                <span class="big">{Math.round(info.totalMemoryMB)} MB</span>
                <span class="small">memory</span>
            </div>
            <div class="stat">
                <span class="big {gpuOk ? 'ok' : 'warn'}">{gpuOk ? "GPU on" : "GPU limited"}</span>
                <span class="small">{info.gpuDevices.find((d) => d.active)?.name || info.gpuDevices[0]?.name || "Graphics"}</span>
            </div>
        </div>

        <!-- GPU -->
        <section>
            <header><h3>Graphics (GPU)</h3></header>

            <div class="features">
                {#each FEATURES as f}
                    {@const st = featureState(info.gpuStatus?.[f.key])}
                    <div class="feature">
                        <span class="dot {st.cls}"></span>
                        <span class="fname">{f.label}</span>
                        <span class="fstate">{st.label}</span>
                    </div>
                {/each}
            </div>

            {#if info.gpuDevices.length > 1}
                <p class="note">This computer has {info.gpuDevices.length} graphics processors: {info.gpuDevices.map((d) => d.name + (d.active ? " (in use)" : "")).join(", ")}.</p>
            {/if}

            {#if info.hardwareAccelerationDisabled}
                <p class="note warn">Hardware acceleration is turned off (Settings → Other). Everything is drawn by the CPU - turn it back on unless video flickers.</p>
            {/if}

            <label class="switch">
                <input type="checkbox" checked={info.preferHighPerformanceGpu} on:change={(e) => { setConfig("preferHighPerformanceGpu", e.currentTarget.checked); gpuChanged = true }} />
                <span>
                    Use the high-performance GPU
                    <small>On computers with two graphics processors (e.g. Intel + NVIDIA/AMD), FreeShow uses the faster one.</small>
                </span>
            </label>
            {#if gpuChanged}<p class="note warn">Restart FreeShow to apply.</p>{/if}
        </section>

        <!-- NDI -->
        <section>
            <header><h3>NDI outputs</h3></header>

            <label class="switch">
                <input type="checkbox" checked={info.ndiSaveStill} on:change={(e) => setConfig("ndiSaveStill", e.currentTarget.checked)} />
                <span>
                    Save CPU while the picture is still
                    <small>Between slide changes NDI sends 5 frames per second instead of 30. Any change (slide, media, transition) goes out instantly at full rate.</small>
                </span>
            </label>

            {#if info.outputs.length}
                <div class="outputs">
                    {#each info.outputs as o}
                        <div class="output">
                            <div class="oname">{o.name} <span>{o.resolution} · {o.connections} receiver{o.connections === 1 ? "" : "s"}</span></div>
                            <div class="ostats">
                                <div><b>{o.fps}</b><small>frames/s</small></div>
                                <div><b>{o.captureMs} ms</b><small>capture</small></div>
                                <div><b>{o.processMs} ms</b><small>processing</small></div>
                                <div><b>{o.sendMs} ms</b><small>NDI send</small></div>
                            </div>
                        </div>
                    {/each}
                </div>
                <p class="note">Without receivers an NDI output only sends 1 frame per second. Times are per frame.</p>
            {:else}
                <p class="note">No NDI outputs are running.</p>
            {/if}
        </section>

        <!-- processes -->
        <section>
            <header><h3>Where the CPU goes</h3></header>
            <table>
                <thead>
                    <tr><th>Part</th><th>CPU</th><th>Memory</th></tr>
                </thead>
                <tbody>
                    {#each topProcesses as p}
                        <tr>
                            <td class="name">{p.name}</td>
                            <td>
                                <div class="bar"><span style="width: {Math.min(100, p.cpu)}%"></span></div>
                                {p.cpu}%
                            </td>
                            <td>{p.memoryMB} MB</td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </section>
    {/if}
</div>

<style>
    .perf {
        display: flex;
        flex-direction: column;
        gap: 18px;
        max-width: 900px;
        margin: 0 auto;
    }

    .summary {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 12px;
    }
    .stat {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 14px 16px;
        border-radius: 12px;
        background-color: var(--primary-darker);
        border: 1px solid rgb(255 255 255 / 0.05);
        min-width: 0;
    }
    .big {
        font-size: 1.5em;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
    }
    .big.ok {
        color: #3ddc84;
    }
    .big.warn {
        color: #ffb347;
    }
    .small {
        font-size: 0.78em;
        opacity: 0.55;
        line-height: 1.35;
    }

    section {
        padding: 16px 18px 14px;
        border-radius: 12px;
        background-color: var(--primary-darker);
        border: 1px solid rgb(255 255 255 / 0.05);
    }
    header {
        margin-bottom: 12px;
    }
    h3 {
        font-size: 1.05em;
        font-weight: 600;
    }

    .features {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px 22px;
        margin-bottom: 12px;
    }
    .feature {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.92em;
    }
    .fstate {
        margin-left: auto;
        opacity: 0.65;
    }
    .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: rgb(255 255 255 / 0.25);
        flex-shrink: 0;
    }
    .dot.on {
        background-color: #3ddc84;
    }
    .dot.idle {
        background-color: #ffb347;
    }
    .dot.off {
        background-color: #ff5a5a;
    }

    .switch {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        margin: 10px 0 4px;
        cursor: pointer;
    }
    .switch input {
        margin-top: 3px;
        width: 15px;
        height: 15px;
        accent-color: var(--secondary);
        cursor: pointer;
        flex-shrink: 0;
    }
    .switch span {
        display: flex;
        flex-direction: column;
        gap: 3px;
    }
    .switch small {
        font-size: 0.8em;
        opacity: 0.55;
        line-height: 1.4;
    }

    .outputs {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 10px;
    }
    .output {
        padding: 10px 12px;
        border-radius: 8px;
        background-color: rgb(255 255 255 / 0.03);
    }
    .oname {
        font-size: 0.92em;
        font-weight: 500;
        margin-bottom: 8px;
    }
    .oname span {
        font-weight: 400;
        opacity: 0.5;
        margin-left: 6px;
        font-size: 0.9em;
    }
    .ostats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
        gap: 8px;
        font-variant-numeric: tabular-nums;
    }
    .ostats div {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .ostats small {
        font-size: 0.75em;
        opacity: 0.5;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.88em;
        margin-top: 10px;
        font-variant-numeric: tabular-nums;
    }
    th {
        text-align: left;
        font-weight: 500;
        opacity: 0.5;
        padding: 4px 8px;
        border-bottom: 1px solid rgb(255 255 255 / 0.08);
    }
    td {
        padding: 5px 8px;
        border-bottom: 1px solid rgb(255 255 255 / 0.04);
        white-space: nowrap;
    }
    td.name {
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .bar {
        display: inline-block;
        width: 70px;
        height: 5px;
        margin-right: 8px;
        border-radius: 3px;
        background-color: rgb(255 255 255 / 0.07);
        vertical-align: middle;
        overflow: hidden;
    }
    .bar span {
        display: block;
        height: 100%;
        background-color: var(--secondary);
    }

    .note {
        margin-top: 10px;
        font-size: 0.82em;
        opacity: 0.55;
        line-height: 1.45;
        white-space: normal;
    }
    .note.warn {
        opacity: 1;
        color: #ffb347;
    }
</style>
