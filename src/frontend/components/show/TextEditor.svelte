<script lang="ts">
    import type { Show } from "../../../types/Show"
    import { getQuickExample } from "../../converters/txt"
    import { activePopup, textEditZoom } from "../../stores"
    import { transposeText } from "../../utils/chordTranspose"
    import { newToast } from "../../utils/common"
    import Icon from "../helpers/Icon.svelte"
    import FloatingInputs from "../input/FloatingInputs.svelte"
    import MaterialButton from "../inputs/MaterialButton.svelte"
    import MaterialZoom from "../inputs/MaterialZoom.svelte"
    import { formatText } from "./formatTextEditor"
    import { getPlainEditorText } from "./getTextEditor"
    import HighlightedNotes from "./tools/HighlightedNotes.svelte"
    import GroupTagger from "../../church/GroupTagger.svelte"

    export let currentShow: Show | undefined

    let text = ""
    // FreeShow Church: remember the last text applied, so leaving the editor without changes
    // doesn't rebuild the song (and add an extra undo step that makes Undo seem to do nothing)
    let lastApplied = ""
    $: if (currentShow) {
        text = getPlainEditorText()
        lastApplied = text
    }
    function applyText(newText: string) {
        if (newText === lastApplied) return
        lastApplied = newText
        formatText(newText)
    }

    $: hasLockedSlide = Object.values(currentShow?.slides || {}).some((a) => a?.locked)
    $: isLocked = currentShow?.locked || hasLockedSlide
    $: if (isLocked) newToast("output.state_locked")

    // Ctrl+F in shortcuts.ts does not get triggered when a text input is active, so we trigger from here as well
    function keydown(e: any) {
        if (!e.ctrlKey && !e.metaKey) return
        if (e.key === "f") activePopup.set("find_replace")
    }

    // transpose chords
    function transposeUp() {
        formatText(transposeText(text, 1))
    }
    function transposeDown() {
        formatText(transposeText(text, -1))
    }

    $: showHasChords = Object.values(currentShow?.slides || {}).some((a) => a?.items?.some((a) => a.lines?.some((a) => a.chords)))
</script>

<!-- FreeShow Church: group chips to tag stanzas, same as in "New show" -->
<div class="churchTextEdit">
    {#if !isLocked}
        <div class="tagger">
            <GroupTagger
                {text}
                textareaSelector=".churchTextEdit textarea"
                slideMode
                on:change={(e) => {
                    text = e.detail
                    applyText(e.detail)
                }}
            />
        </div>
    {/if}
    <div class="editorArea">
        <HighlightedNotes class="context #editbox_text" disabled={isLocked} style="padding: 30px;padding-bottom: 60px;font-size: {$textEditZoom / 8}em;" placeholder={getQuickExample()} value={text} on:change={(e) => applyText(e.detail)} on:keydown={keydown} />
    </div>
</div>

<FloatingInputs side="left">
    {#if showHasChords}
        <MaterialButton on:click={transposeUp} title="edit.transpose_up">
            <Icon id="arrow_up" size={1.3} white />
        </MaterialButton>
        <MaterialButton on:click={transposeDown} title="edit.transpose_down">
            <Icon id="arrow_down" size={1.3} white />
        </MaterialButton>
    {/if}

    <MaterialZoom hidden={showHasChords} columns={$textEditZoom / 10} min={0.5} max={2} defaultValue={1} addValue={-0.1} on:change={(e) => textEditZoom.set(e.detail * 10)} />
</FloatingInputs>

<style>
    .churchTextEdit {
        display: flex;
        flex-direction: column;
        height: 100%;
    }
    .churchTextEdit .tagger {
        padding: 14px 30px 0;
        border-bottom: 1px solid var(--primary-lighter);
    }
    .editorArea {
        flex: 1;
        min-height: 0;
        display: flex;
    }
</style>
