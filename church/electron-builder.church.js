// Local build config for "FreeShow Church": the official config, minus signing,
// notarizing and auto-update publishing (so our build never replaces itself with the official one).
const fs = require("fs")
const path = require("path")
const yaml = require("js-yaml")

const base = yaml.load(fs.readFileSync(path.join(__dirname, "../config/building/electron-builder.yaml"), "utf8"))

delete base.afterSign
base.publish = null
base.appId = "app.freeshow.church" // separate app identity so macOS doesn't mix it up with the official FreeShow
base.mac = {
    ...base.mac,
    identity: null,
    notarize: false,
    extendInfo: { ...(base.mac.extendInfo || {}), CFBundleDisplayName: "FreeShow Church" }
}

// native timecode audio (audify / RtAudio): keep the .node + its libraries outside the asar
const unpackAudify = "**/node_modules/audify/**"
base.mac.asarUnpack = [...(base.mac.asarUnpack || []), unpackAudify]
if (base.win) base.win.asarUnpack = [...(base.win.asarUnpack || []), unpackAudify]

module.exports = base
