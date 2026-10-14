// ----- FreeShow Church -----
// Imported first in electron/index.ts (runs before any other module is loaded).

import { app } from "electron"
import fs from "fs"
import path from "path"

// NDI sends every video and audio frame on Node's background thread pool, which only has 4 threads by default.
// With a few NDI outputs (and audio) those threads are always busy, and everything else that needs them - saving
// shows and settings, reading media files, DNS - has to wait, so the app seems to hang while changing outputs.
// (must be set before the pool is used for the first time)
if (!process.env.UV_THREADPOOL_SIZE) process.env.UV_THREADPOOL_SIZE = "16"

// A second, separate instance on the same computer (testing master + backup): its own settings folder.
// Must happen before the settings stores are created. A new folder starts with a copy of the normal settings.
if (process.env.FREESHOW_USER_DATA) {
    const target = process.env.FREESHOW_USER_DATA
    try {
        const source = app.getPath("userData")
        fs.mkdirSync(target, { recursive: true })
        if (!fs.existsSync(path.join(target, "settings.json")) && fs.existsSync(source)) {
            fs.readdirSync(source)
                .filter((file) => file.endsWith(".json"))
                .forEach((file) => fs.copyFileSync(path.join(source, file), path.join(target, file)))
        }
        if (process.env.FREESHOW_TEST_REDUNDANCY) {
            const file = path.join(target, "config.json")
            let data: any = {}
            try {
                data = JSON.parse(fs.readFileSync(file, "utf8"))
            } catch {}
            data.redundancy = { ...(data.redundancy || {}), ...JSON.parse(process.env.FREESHOW_TEST_REDUNDANCY) }
            fs.writeFileSync(file, JSON.stringify(data))
        }
    } catch (err) {
        console.error("Separate settings folder:", err)
    }
    app.setPath("userData", target)
}

export {}
