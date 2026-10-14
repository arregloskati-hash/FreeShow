<script lang="ts">
    // ----- FreeShow Church -----
    // Top bar: master/backup state at a glance (click: Settings > Redundancy)
    import { activePage, settingsTab } from "../../stores"
    import { redundancyStatus } from "./redundancy"

    $: status = $redundancyStatus
    $: role = status?.role || "off"
    $: info = getInfo(status)

    function getInfo(status: any) {
        if (!status || status.role === "off") return null
        if (status.role === "master") {
            const n = status.peers?.length || 0
            return { tag: "MASTER", text: n ? (n === 1 ? status.peers[0].name : `${n} backups`) : "no backup", cls: n ? "on" : "idle" }
        }
        if (status.state === "lost") return { tag: "BACKUP", text: "master lost", cls: "error" }
        if (status.state === "connected" && status.master) return { tag: "BACKUP", text: status.master.name, cls: "on" }
        return { tag: "BACKUP", text: "searching…", cls: "idle" }
    }

    function open() {
        settingsTab.set("redundancy" as any)
        activePage.set("settings")
    }
</script>

{#if info && role !== "off"}
    <button class="pill {info.cls}" on:click={open} data-title="Redundancy">
        <span class="dot"></span>
        <span class="tag">{info.tag}</span>
        <span class="text">{info.text}</span>
    </button>
{/if}

<style>
    .pill {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        inset-inline-end: calc(var(--navigation-width) + 8px);
        z-index: 2;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px 10px 3px 8px;
        border-radius: 99px;
        border: 1px solid rgb(255 255 255 / 0.08);
        background-color: rgb(255 255 255 / 0.05);
        color: var(--text);
        font-family: inherit;
        font-size: 0.75em;
        white-space: nowrap;
        cursor: pointer;
        -webkit-app-region: no-drag;
        max-width: 220px;
        overflow: hidden;
    }
    .pill:hover {
        background-color: rgb(255 255 255 / 0.1);
    }
    .dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        flex-shrink: 0;
        background-color: #ffb347;
    }
    .on .dot {
        background-color: #3ddc84;
        box-shadow: 0 0 6px #3ddc84;
    }
    .error .dot {
        background-color: #ff5a5a;
    }
    .error {
        border-color: #ff5a5a;
    }
    .tag {
        font-weight: 700;
        letter-spacing: 0.5px;
        opacity: 0.75;
    }
    .text {
        overflow: hidden;
        text-overflow: ellipsis;
    }
</style>
