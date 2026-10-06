// ----- FreeShow Church -----
// View > Continuous Playlist: show every song of the current project in one scrolling list.

import { get } from "svelte/store"
import { activePage, activeProject, focusMode, projects, special } from "../stores"
import { newToast } from "../utils/common"

export function togglePlaylistView() {
    const turnOn = !get(special).churchPlaylistView

    if (turnOn) {
        const project = get(projects)[get(activeProject) || ""]
        if (!project?.shows?.some((a) => (a.type || "show") === "show")) {
            newToast("Open a project with songs first")
            return
        }
        if (get(focusMode)) focusMode.set(false)
        activePage.set("show")
    }

    special.update((a) => {
        if (turnOn) a.churchPlaylistView = true
        else delete a.churchPlaylistView
        return a
    })
}
