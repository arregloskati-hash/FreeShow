// Installer build config for "FreeShow Church" (Windows installer + Mac app for the DMG).
// Based on the local church config (no official signing/notarizing/auto-update).
const base = require("./electron-builder.church.js")

const config = { ...base }

// ---- Windows: unsigned NSIS installer that installs next to (not over) the official FreeShow ----
config.win = { ...base.win }
delete config.win.azureSignOptions // official code-signing account (not available to us)
config.nsis = {
    ...(base.nsis || {}),
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    shortcutName: "FreeShow Church",
    uninstallDisplayName: "FreeShow Church",
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    include: "church/installer.nsh",
    artifactName: "FreeShow-Church-${version}-Windows-Setup.${ext}"
}

module.exports = config
