<script lang="ts">
    // ----- FreeShow Church -----
    // Settings > Redundancy: master / backup mirroring between two computers.

    import { redundancyStatus, takeOverAsMaster, updateRedundancySettings } from "./redundancy"

    $: status = $redundancyStatus
    $: s = status?.settings || {}
    $: role = status?.role || "off"

    const ROLES = [
        { id: "off", label: "Off", text: "This computer works on its own." },
        { id: "master", label: "Master", text: "This computer runs the service. Backups mirror everything it does." },
        { id: "backup", label: "Backup", text: "This computer mirrors a master, ready to take over. Its controls are locked." }
    ]

    function setRole(id: string) {
        if (id === role) return
        if (id !== "off" && !s.code) code = code || newCode()
        updateRedundancySettings({ role: id, ...(id !== "off" && !s.code ? { code } : {}) })
    }

    let code = ""
    let name = ""
    let address = ""
    let lastSettings = ""
    $: if (status && JSON.stringify([s.code, s.name, s.masterAddress]) !== lastSettings) {
        lastSettings = JSON.stringify([s.code, s.name, s.masterAddress])
        code = s.code || ""
        name = s.name || ""
        address = s.masterAddress || ""
    }

    function newCode() {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
    }

    function save(key: string, value: any) {
        if (s[key] === value) return
        updateRedundancySettings({ [key]: value })
    }

    $: stateText = getStateText(status)
    function getStateText(status: any) {
        if (!status) return { dot: "off", text: "Loading…" }
        if (status.state === "error") return { dot: "error", text: status.error || "Error" }
        if (status.role === "off") return { dot: "off", text: status.error || "Redundancy is off" }
        if (status.role === "master") {
            if (!status.peers?.length) return { dot: "idle", text: "Master · waiting for a backup to connect" }
            return { dot: "on", text: "Master · " + status.peers.map((p: any) => `${p.name} connected (${p.latency} ms)`).join(", ") }
        }
        if (status.state === "lost") return { dot: "error", text: `Master ${status.master?.name || ""} lost` }
        if (status.state === "connected" && status.master) return { dot: "on", text: `Backup · following ${status.master.name} (${status.master.latency} ms)` }
        if (status.state === "connecting") return { dot: "idle", text: "Backup · connecting…" + (status.error ? ` (${status.error})` : "") }
        return { dot: "idle", text: "Backup · looking for the master on the network…" + (status.error ? ` (${status.error})` : "") }
    }
</script>

<div class="redundancy">
    <section>
        <header>
            <h3>Role</h3>
            <div class="state"><span class="dot {stateText.dot}"></span>{stateText.text}</div>
        </header>

        <div class="roles">
            {#each ROLES as r}
                <button class="role" class:active={role === r.id} on:click={() => setRole(r.id)}>
                    <span class="rname">{r.label}</span>
                    <span class="rtext">{r.text}</span>
                </button>
            {/each}
        </div>

        {#if role === "backup"}
            <button class="takeover" on:click={takeOverAsMaster}>Take over as master now</button>
        {/if}
        {#if status?.downloads}
            <p class="note">Copying {status.downloads} media file{status.downloads === 1 ? "" : "s"} from the master…</p>
        {/if}
    </section>

    <section>
        <header><h3>Connection</h3></header>

        <div class="grid">
            <label class="field">
                <span>Pairing code</span>
                <div class="row">
                    <input type="text" bind:value={code} maxlength="32" placeholder="Same code on both computers" on:change={() => save("code", code.trim().toUpperCase())} />
                    <button class="small" on:click={() => save("code", (code = newCode()))}>New</button>
                </div>
            </label>

            <label class="field">
                <span>This computer's name</span>
                <input type="text" bind:value={name} maxlength="40" on:change={() => save("name", name.trim())} />
            </label>

            {#if role === "backup"}
                <label class="field">
                    <span>Master address <small>(optional)</small></span>
                    <input type="text" bind:value={address} placeholder="Found automatically" on:change={() => save("masterAddress", address.trim())} />
                </label>

                <div class="field">
                    <span>Masters on this network</span>
                    <div class="masters">
                        {#each status?.masters || [] as m}
                            <div class="master"><span class="dot on"></span>{m.name} <small>{m.address}</small></div>
                        {:else}
                            <div class="master none">None found yet</div>
                        {/each}
                    </div>
                </div>
            {/if}
        </div>

        <p class="note">Use the same pairing code on both computers. A wired network is strongly recommended. Outputs are matched by name (an output called "NDI 1" on the backup shows what "NDI 1" shows on the master), others show the master's first output.</p>
    </section>

    {#if role === "backup"}
        <section>
            <header><h3>Backup</h3></header>

            <label class="switch">
                <input type="checkbox" checked={s.autoTakeover} on:change={(e) => save("autoTakeover", e.currentTarget.checked)} />
                <span>
                    Take over automatically
                    <small>If the master is silent for the time below, this computer becomes the master by itself. Off: it warns and waits for you to click Take over.</small>
                </span>
            </label>

            <label class="field narrow">
                <span>Master is lost after</span>
                <select value={String(s.takeoverSeconds || 3)} on:change={(e) => save("takeoverSeconds", Number(e.currentTarget.value))}>
                    {#each [2, 3, 5, 10] as sec}<option value={String(sec)}>{sec} seconds</option>{/each}
                </select>
            </label>

            <label class="switch">
                <input type="checkbox" checked={s.muteBackupAudio !== false} on:change={(e) => save("muteBackupAudio", e.currentTarget.checked)} />
                <span>
                    Keep the backup silent
                    <small>Video sound plays only on the master. Sound comes back as soon as this computer takes over.</small>
                </span>
            </label>
        </section>
    {/if}

    <section>
        <header><h3>What is mirrored</h3></header>
        <p class="note plain">Every slide change, background, overlay, clear and transition · setlists/projects, songs, overlays, templates, stage layouts, timers, variables and actions · the selected setlist and song · video position. Media files the backup doesn't have are copied from the master automatically. Actions, MIDI, timecode and the remote app are handled by the master only, so nothing fires twice. NDI outputs on the backup are named "… (Backup)".</p>
    </section>
</div>

<style>
    .redundancy {
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
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
    }
    h3 {
        font-size: 1.05em;
        font-weight: 600;
        flex-shrink: 0;
    }
    .state {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 7px;
        font-size: 0.85em;
        opacity: 0.85;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
        background-color: rgb(255 255 255 / 0.25);
    }
    .dot.on {
        background-color: #3ddc84;
        box-shadow: 0 0 6px #3ddc84;
    }
    .dot.idle {
        background-color: #ffb347;
    }
    .dot.error {
        background-color: #ff5a5a;
    }

    .roles {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
        gap: 10px;
    }
    .role {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 5px;
        padding: 12px 14px;
        border-radius: 10px;
        border: 1px solid rgb(255 255 255 / 0.08);
        background-color: rgb(255 255 255 / 0.03);
        color: var(--text);
        font-family: inherit;
        text-align: left;
        cursor: pointer;
    }
    .role:hover {
        background-color: rgb(255 255 255 / 0.07);
    }
    .role.active {
        border-color: var(--secondary);
        background-color: rgb(255 255 255 / 0.08);
    }
    .rname {
        font-weight: 600;
    }
    .rtext {
        font-size: 0.8em;
        opacity: 0.6;
        line-height: 1.4;
    }

    .takeover {
        margin-top: 12px;
        padding: 9px 16px;
        border-radius: 8px;
        border: none;
        background-color: #ff5a5a;
        color: white;
        font-family: inherit;
        font-weight: 600;
        cursor: pointer;
    }
    .takeover:hover {
        filter: brightness(1.1);
    }

    .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px 22px;
    }
    .field {
        display: flex;
        flex-direction: column;
        gap: 7px;
        min-width: 0;
    }
    .field.narrow {
        max-width: calc(50% - 11px);
        margin-top: 12px;
    }
    .field > span {
        font-size: 0.92em;
        opacity: 0.9;
    }
    .field small {
        opacity: 0.5;
    }
    .row {
        display: flex;
        gap: 8px;
    }
    input[type="text"],
    select {
        width: 100%;
        padding: 7px 10px;
        border-radius: 6px;
        border: none;
        outline: none;
        font-family: inherit;
        font-size: 0.95em;
        color: var(--text);
        background-color: rgb(255 255 255 / 0.07);
    }
    input[type="text"]:focus-visible,
    select:focus-visible {
        box-shadow: 0 0 0 1px var(--secondary);
    }
    select option {
        background-color: var(--primary-darker);
    }
    .small {
        padding: 0 12px;
        border-radius: 6px;
        border: none;
        background-color: rgb(255 255 255 / 0.1);
        color: var(--text);
        font-family: inherit;
        cursor: pointer;
    }
    .masters {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 0.9em;
    }
    .master {
        display: flex;
        align-items: center;
        gap: 7px;
    }
    .master small,
    .master.none {
        opacity: 0.5;
    }

    .switch {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        margin: 6px 0;
        cursor: pointer;
    }
    .switch input {
        margin-top: 3px;
        width: 15px;
        height: 15px;
        accent-color: var(--secondary);
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

    .note {
        margin-top: 12px;
        font-size: 0.82em;
        opacity: 0.55;
        line-height: 1.45;
        white-space: normal;
    }
    .note.plain {
        margin-top: 0;
    }
</style>
