# FreeShow Church — our enhanced build

This folder holds the helper scripts for running and building our own version of
[FreeShow](https://github.com/ChurchApps/FreeShow). Double-click them in Finder.

| Script | What it does |
| --- | --- |
| **1 - Setup.command** | One-time setup. Backs up your FreeShow settings/shows to `~/Documents/FreeShow-Backups`, installs Node.js (private copy, no admin) and the app's dependencies. |
| **2 - Start Dev.command** | Runs FreeShow straight from the source code with live reload — use this while enhancements are being made. |
| **3 - Build App.command** | Builds **FreeShow Church.app** into Applications. This is the version to use on Sunday. |
| **4 - Update from FreeShow.command** | Pulls the newest official FreeShow release into our version (keeping our changes), then offers to rebuild. |

Notes
- Our version is based on the official release in `BASE_VERSION` (stable releases only).
- FreeShow Church uses the same shows and settings as the official FreeShow app. Don't run both at once.
- Our build never auto-updates itself to the official version, so the enhancements stay put.
- Logs from each script are saved in `church/logs/`.
- Code changes live on the `church` branch of our GitHub fork; push/pull with GitHub Desktop.
