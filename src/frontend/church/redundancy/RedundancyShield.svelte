<script lang="ts">
    // ----- FreeShow Church -----
    // On a BACKUP: locks the controls (it only mirrors the master) and shows the follow banner.
    // Anywhere: the "master lost" / "stepped down" alerts.
    import { onDestroy, onMount } from "svelte"
    import { activePage, settingsTab } from "../../stores"
    import { redundancyAlert, redundancyStatus, takeOverAsMaster, updateRedundancySettings } from "./redundancy"

    $: status = $redundancyStatus
    $: following = status?.role === "backup"
    $: locked = following && $activePage !== "settings"
    $: lost = $redundancyAlert?.type === "lost" && following

    let top = 0
    function measure() {
        const bar = document.querySelector(".top")
        top = bar ? Math.round(bar.getBoundingClientRect().bottom) : 50
    }

    // keys would change slides on this computer - the master does that
    function blockKeys(e: KeyboardEvent) {
        if (!locked) return
        if (e.ctrlKey || e.metaKey) return
        const target = e.target as HTMLElement
        if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return
        e.stopImmediatePropagation()
        e.preventDefault()
    }

    onMount(() => {
        measure()
        window.addEventListener("resize", measure)
        window.addEventListener("keydown", blockKeys, true)
    })
    onDestroy(() => {
        window.removeEventListener("resize", measure)
        window.removeEventListener("keydown", blockKeys, true)
    })
    $: if (locked) setTimeout(measure)

    function openSettings() {
        settingsTab.set("redundancy" as any)
        activePage.set("settings")
    }
    function stopFollowing() {
        updateRedundancySettings({ role: "off" })
    }
</script>

{#if locked}
    <div class="shield" style="top: {top}px;" role="none" on:mousedown|stopPropagation|preventDefault on:click|stopPropagation|preventDefault on:dblclick|stopPropagation|preventDefault on:contextmenu|stopPropagation|preventDefault on:wheel|stopPropagation />
{/if}

{#if following}
    <div class="banner" class:lost>
        <span class="dot"></span>
        <span class="title">BACKUP</span>
        <span class="text">
            {#if lost}
                Master {$redundancyAlert?.name || ""} lost
            {:else if status?.state === "connected" && status?.master}
                Mirroring {status.master.name} · {status.master.latency} ms{status.downloads ? ` · copying ${status.downloads} media` : ""}
            {:else}
                Looking for the master…
            {/if}
        </span>
        <button class="take" on:click={takeOverAsMaster}>Take over</button>
        <button class="ghost" on:click={openSettings}>Settings</button>
        {#if !lost}<button class="ghost" on:click={stopFollowing}>Stop</button>{/if}
    </div>
{/if}

{#if lost}
    <div class="alert">
        <h2>Master lost</h2>
        <p>{$redundancyAlert?.name || "The master"} stopped responding. This computer shows the same picture and can take over now.</p>
        <button class="take big" on:click={takeOverAsMaster}>Take over as master</button>
    </div>
{/if}

{#if $redundancyAlert?.type === "demoted"}
    <div class="alert">
        <h2>Now a backup</h2>
        <p>{$redundancyAlert.name || "Another computer"} took over as master, so this computer now mirrors it.</p>
        <button class="ghost" on:click={() => redundancyAlert.set(null)}>OK</button>
    </div>
{/if}

{#if $redundancyAlert?.type === "takeover"}
    <div class="toast">This computer is now the master</div>
{/if}

<style>
    .shield {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 4000;
        background-color: rgb(0 0 0 / 0.04);
        cursor: not-allowed;
    }
    .banner {
        position: fixed;
        left: 50%;
        bottom: 18px;
        transform: translateX(-50%);
        z-index: 4001;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px 8px 14px;
        border-radius: 12px;
        background-color: rgb(20 20 24 / 0.92);
        border: 1px solid rgb(255 255 255 / 0.12);
        box-shadow: 0 6px 24px rgb(0 0 0 / 0.45);
        font-size: 0.9em;
        white-space: nowrap;
        backdrop-filter: blur(6px);
    }
    .banner.lost {
        border-color: #ff5a5a;
    }
    .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: #3ddc84;
        box-shadow: 0 0 6px #3ddc84;
    }
    .lost .dot {
        background-color: #ff5a5a;
        box-shadow: 0 0 6px #ff5a5a;
    }
    .title {
        font-weight: 700;
        letter-spacing: 0.6px;
    }
    .text {
        opacity: 0.75;
    }
    button {
        font-family: inherit;
        cursor: pointer;
        border: none;
        border-radius: 7px;
        padding: 6px 12px;
        color: var(--text);
    }
    .take {
        background-color: #ff5a5a;
        color: white;
        font-weight: 600;
    }
    .take:hover {
        filter: brightness(1.1);
    }
    .take.big {
        padding: 12px 22px;
        font-size: 1.1em;
    }
    .ghost {
        background-color: rgb(255 255 255 / 0.1);
    }
    .ghost:hover {
        background-color: rgb(255 255 255 / 0.16);
    }
    .alert {
        position: fixed;
        left: 50%;
        top: 35%;
        transform: translate(-50%, -50%);
        z-index: 4002;
        width: min(440px, 90vw);
        padding: 22px 24px;
        border-radius: 14px;
        background-color: rgb(24 24 28 / 0.97);
        border: 1px solid #ff5a5a;
        box-shadow: 0 10px 40px rgb(0 0 0 / 0.6);
        text-align: center;
    }
    .alert h2 {
        margin-bottom: 8px;
    }
    .alert p {
        opacity: 0.75;
        margin-bottom: 16px;
        white-space: normal;
        line-height: 1.45;
    }
    .toast {
        position: fixed;
        left: 50%;
        top: 70px;
        transform: translateX(-50%);
        z-index: 4002;
        padding: 10px 18px;
        border-radius: 10px;
        background-color: #3ddc84;
        color: #0b1a10;
        font-weight: 600;
    }
</style>
