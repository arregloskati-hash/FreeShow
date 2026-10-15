// ----- FreeShow Church -----
// Event installers: an installer can carry a ready-made FreeShow setup (songs, setlists, templates, overlays,
// stage layouts, settings) in resources/event. The first time FreeShow starts after installing it, that setup
// is restored, so the computer opens with the event ready to go. It happens once per event (a newer event
// installer seeds again). Anything already on the computer is backed up first.
//
// resources/event/event.json  { "id": "jesus-reigns-2026", "name": "Jesus Reigns" }
// resources/event/backup.zip  a normal FreeShow "Backup everything" file
// (fonts are installed by the Windows installer itself - see church/installer.nsh)

import { app } from "electron"
import fs from "fs"
import path from "path"
import { config } from "../data/store"
import { getDataFolderPath, getTimePointString } from "./files"

export async function seedEventData() {
    try {
        const eventFolder = app.isPackaged ? path.join(process.resourcesPath, "event") : path.join(process.cwd(), "church", "event", "data")
        const infoFile = path.join(eventFolder, "event.json")
        const backupFile = path.join(eventFolder, "backup.zip")
        if (!fs.existsSync(infoFile) || !fs.existsSync(backupFile)) return

        const info = JSON.parse(fs.readFileSync(infoFile, "utf8"))
        const id = String(info.id || "")
        if (!id || config.get("eventSeeded" as any) === id) return

        console.info(`Event setup: restoring "${info.name || id}"`)

        // keep whatever this computer already had
        const showsFolder = getDataFolderPath("shows")
        const configFolder = getDataFolderPath("userData")
        const hasData = fs.readdirSync(showsFolder).some((f) => f.endsWith(".show"))
        if (hasData) {
            const keep = path.join(getDataFolderPath("backups"), `before-${id}-${getTimePointString()}`)
            fs.mkdirSync(keep, { recursive: true })
            fs.cpSync(showsFolder, path.join(keep, "Shows"), { recursive: true })
            fs.cpSync(configFolder, path.join(keep, "Config"), { recursive: true })
            console.info("Event setup: previous data saved in " + keep)
        }

        const { restoreFiles } = require("../data/backup")
        await restoreFiles({ path: backupFile })

        config.set("eventSeeded" as any, id as any)
        console.info("Event setup: done")
    } catch (err) {
        console.error("Event setup failed:", err)
    }
}
