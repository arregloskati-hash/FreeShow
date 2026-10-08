// ----- FreeShow Church -----
// Imported first in electron/index.ts.
// NDI sends every video and audio frame on Node's background thread pool, which only has 4 threads by default.
// With a few NDI outputs (and audio) those threads are always busy, and everything else that needs them - saving
// shows and settings, reading media files, DNS - has to wait, so the app seems to hang while changing outputs.
// (must be set before the pool is used for the first time)
if (!process.env.UV_THREADPOOL_SIZE) process.env.UV_THREADPOOL_SIZE = "16"

export {}
