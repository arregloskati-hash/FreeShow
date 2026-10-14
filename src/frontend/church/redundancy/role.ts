// ----- FreeShow Church -----
// The redundancy role of this computer (no imports: used by low-level helpers without import cycles)

let role: "off" | "master" | "backup" = "off"
let muteAudio = true

export function setRedundancyRole(value: "off" | "master" | "backup", muteBackupAudio = true) {
    role = value
    muteAudio = muteBackupAudio
}

export function getRedundancyRole() {
    return role
}

/** this computer is a backup that mirrors a master: it shows what the master shows and runs nothing by itself */
export function isFollowingMaster() {
    return role === "backup"
}

/** a backup stays silent by default (the master feeds the sound system) */
export function isBackupMuted() {
    return role === "backup" && muteAudio
}
