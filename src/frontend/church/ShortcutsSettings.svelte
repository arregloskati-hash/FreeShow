<script lang="ts">
    // ----- FreeShow Church -----
    // Settings > Shortcuts: record, remove and reset keyboard shortcuts.

    import { onDestroy } from "svelte"
    import { special } from "../stores"
    import Icon from "../components/helpers/Icon.svelte"
    import { comboToLabel, eventToCombo, getBindings, getComboUsers, getShortcutActions, resetAllBindings, setBinding, setRecording, type ShortcutAction } from "./churchShortcuts"

    const actions = getShortcutActions()
    const groups = [...new Set(actions.map((a) => a.group))]
    const actionName = (id: string) => actions.find((a) => a.id === id)?.label || id

    // re-read when the saved shortcuts change
    let bindings = getBindings()
    $: if ($special) bindings = getBindings()

    $: changedCount = Object.keys($special.churchShortcuts || {}).length

    function isChanged(action: ShortcutAction, current: { [id: string]: string[] }) {
        return JSON.stringify(current[action.id] || []) !== JSON.stringify(action.defaults)
    }

    // ---- recording ----

    let recordingId = ""
    let warning = ""

    function startRecording(id: string) {
        stopRecording()
        recordingId = id
        warning = ""
        setRecording(true)
        window.addEventListener("keydown", recordKey, true)
    }

    function stopRecording() {
        recordingId = ""
        setRecording(false)
        window.removeEventListener("keydown", recordKey, true)
    }

    function recordKey(e: KeyboardEvent) {
        e.preventDefault()
        e.stopImmediatePropagation()

        const combo = eventToCombo(e)
        if (!combo) return // only a modifier so far (wait for the real key)

        const id = recordingId
        const current = bindings[id] || []
        if (!current.includes(combo)) {
            // a key can only do one thing: take it away from any other action
            const others = getComboUsers(combo, bindings).filter((other) => other !== id)
            others.forEach((other) => setBinding(other, (bindings[other] || []).filter((c) => c !== combo)))
            if (others.length) warning = `${comboToLabel(combo)} was moved from "${others.map(actionName).join(", ")}".`

            setBinding(id, [...current, combo])
        }

        stopRecording()
    }

    function removeCombo(id: string, combo: string) {
        setBinding(
            id,
            (bindings[id] || []).filter((c) => c !== combo)
        )
    }

    function resetAction(action: ShortcutAction) {
        // give default keys back (and take them away from other actions that got them)
        action.defaults.forEach((combo) => {
            getComboUsers(combo, bindings)
                .filter((other) => other !== action.id)
                .forEach((other) => setBinding(other, (bindings[other] || []).filter((c) => c !== combo)))
        })
        setBinding(action.id, null)
    }

    function resetAll() {
        stopRecording()
        warning = ""
        resetAllBindings()
    }

    onDestroy(stopRecording)
</script>

<div class="shortcuts">
    <div class="intro">
        <p>Click <b>+ Add</b> and press the key (or key combination) you want. Click a key to remove it.</p>
        <button class="resetAll" disabled={!changedCount} on:click={resetAll}>
            <Icon id="reset" size={0.9} white />
            Reset all
        </button>
    </div>

    {#if warning}
        <p class="warning">{warning}</p>
    {/if}

    {#each groups as group}
        <h3>{group}</h3>
        <div class="list">
            {#each actions.filter((a) => a.group === group) as action (action.id)}
                <div class="row" class:recording={recordingId === action.id}>
                    <div class="name">
                        <span>{action.label}</span>
                        {#if action.description}<small>{action.description}</small>{/if}
                    </div>

                    <div class="keys">
                        {#each bindings[action.id] || [] as combo (combo)}
                            <button class="key" data-title="Remove this shortcut" on:click={() => removeCombo(action.id, combo)}>
                                {comboToLabel(combo)}
                                <span class="x">×</span>
                            </button>
                        {/each}

                        {#if recordingId === action.id}
                            <span class="listening">Press a key…</span>
                            <button class="small" on:click={stopRecording}>Cancel</button>
                        {:else}
                            {#if !(bindings[action.id] || []).length}<span class="none">No shortcut</span>{/if}
                            <button class="small add" on:click={() => startRecording(action.id)}>+ Add</button>
                        {/if}

                        <button class="small reset" class:hidden={!isChanged(action, bindings)} data-title="Back to default" on:click={() => resetAction(action)}>
                            <Icon id="reset" size={0.8} white />
                        </button>
                    </div>
                </div>
            {/each}
        </div>
    {/each}

    <p class="hint">Letter and number shortcuts don't fire while you're typing in a text field. Function keys and shortcuts with ⌘/Ctrl/Alt always work. Group and slide shortcut keys set on songs still work as before.</p>
</div>

<style>
    .shortcuts {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding-bottom: 30px;
    }

    .intro {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        opacity: 0.85;
    }
    .intro p {
        font-size: 0.9em;
        white-space: normal;
    }

    h3 {
        margin-top: 14px;
        font-size: 0.8em;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        opacity: 0.6;
        font-weight: 600;
    }

    .list {
        display: flex;
        flex-direction: column;
        border-radius: 10px;
        overflow: hidden;
        border: 1px solid var(--primary-lighter);
    }

    .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 8px 12px;
        min-height: 44px;
    }
    .row:nth-child(even) {
        background: rgb(255 255 255 / 0.025);
    }
    .row.recording {
        background: color-mix(in srgb, var(--secondary) 14%, transparent);
    }

    .name {
        display: flex;
        flex-direction: column;
    }
    .name small {
        opacity: 0.5;
        font-size: 0.8em;
    }

    .keys {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        justify-content: flex-end;
    }

    button {
        font-family: inherit;
        color: var(--text);
        cursor: pointer;
        border: none;
    }

    .key {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 7px;
        font-size: 0.85em;
        font-weight: 600;
        background: rgb(255 255 255 / 0.08);
        border: 1px solid rgb(255 255 255 / 0.15);
        border-bottom-width: 2px;
    }
    .key .x {
        opacity: 0;
        transition: opacity 0.15s;
    }
    .key:hover {
        border-color: rgb(255 80 80 / 0.6);
    }
    .key:hover .x {
        opacity: 0.8;
    }

    .small {
        padding: 4px 10px;
        border-radius: 99px;
        font-size: 0.8em;
        background: transparent;
        border: 1px solid var(--primary-lighter);
    }
    .small:hover {
        background: rgb(255 255 255 / 0.06);
    }
    .add {
        border-color: color-mix(in srgb, var(--secondary) 50%, transparent);
    }
    .reset {
        display: flex;
        padding: 4px 6px;
    }
    .reset.hidden {
        visibility: hidden;
    }

    .listening {
        font-size: 0.85em;
        color: var(--secondary);
        animation: pulse 1s ease-in-out infinite alternate;
    }
    @keyframes pulse {
        from {
            opacity: 1;
        }
        to {
            opacity: 0.4;
        }
    }

    .none {
        font-size: 0.8em;
        opacity: 0.4;
    }

    .resetAll {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 14px;
        border-radius: 99px;
        background: rgb(255 255 255 / 0.05);
        border: 1px solid var(--primary-lighter);
        white-space: nowrap;
    }
    .resetAll:disabled {
        opacity: 0.4;
        cursor: default;
    }

    .warning {
        white-space: normal;
        font-size: 0.85em;
        color: #ffb347;
    }

    .hint {
        white-space: normal;
        margin-top: 10px;
        font-size: 0.8em;
        opacity: 0.5;
    }
</style>
