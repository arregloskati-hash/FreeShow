// ----- FreeShow Church -----
// Friendly names for dynamic values ({scripture_text} -> "⚡ Scripture text"), used in the editors and
// the dynamic values picker. The real {codes} are unchanged; this only changes how they're shown.

const LABELS: { [id: string]: string } = {
    // time
    time_date: "Date",
    time_month: "Month",
    time_year: "Year",
    time_hours: "Hours",
    time_minutes: "Minutes",
    time_seconds: "Seconds",
    time_str_day: "Day name",
    time_str_month: "Month name",

    // project
    project_section: "Project section",
    project_section_next: "Next project section",
    project_section_time: "Section time",
    project_section_time_next: "Next section time",
    project_section_time_until_next: "Time until next section",

    // show
    show_name: "Song name",
    show_name_next: "Next song name",
    layout_slides: "Number of slides",
    layout_notes: "Arrangement notes",
    show_text_full: "Whole song text",

    // slide
    slide_number: "Slide number",
    slide_group: "Slide group",
    slide_group_color: "Slide group color",
    slide_group_next: "Next slide's group",
    slide_group_next_color: "Next slide's group color",
    slide_group_upcoming: "Next group",
    slide_group_upcoming_color: "Next group color",
    slide_notes: "Slide notes",
    slide_notes_next: "Next slide notes",
    slide_text: "Slide text",
    slide_text_previous: "Previous slide text",
    slide_text_current: "Current slide text",
    slide_text_next: "Next slide text",
    slide_group_text: "Group text",

    // image info
    exif_datetime: "Photo date",
    exif_aperture: "Aperture",
    exif_brightness: "Brightness",
    exif_exposure: "Exposure",
    exif_fnumber: "F-number",
    exif_flash: "Flash",
    exif_focallength: "Focal length",
    exif_iso: "ISO",
    exif_interopoffset: "Interop offset",
    exif_lightsource: "Light source",
    exif_shutterspeed: "Shutter speed",
    exif_lens: "Lens",
    exif_lensmodel: "Lens model",
    exif_gps: "GPS location",
    exif_device: "Camera",
    exif_software: "Software",

    // video
    video_time: "Video time",
    video_countdown: "Video time left",
    video_duration: "Video length",

    // audio
    audio_title: "Song title (audio)",
    audio_subtitle: "Audio subtitle",
    audio_artist: "Artist",
    audio_album: "Album",
    audio_genre: "Genre",
    audio_year: "Audio year",
    audio_time: "Audio time",
    audio_countdown: "Audio time left",
    audio_duration: "Audio length",
    audio_volume: "Volume",

    // interaction
    interaction_players: "Players",
    interaction_players_count: "Number of players",
    interaction_question: "Question",
    interaction_input_options: "Answer options",
    interaction_option_percentages: "Answer percentages",
    interaction_time: "Time left",
    interaction_answer: "Answer",
    interaction_player_answers: "Player answers",
    interaction_player_answer_latest: "Latest answer",
    interaction_leaderboard: "Leaderboard",

    // scripture
    scripture_text: "Bible text",
    scripture_book: "Bible book",
    scripture_book_abbr: "Book (short)",
    scripture_chapter: "Chapter",
    scripture_verses: "Verses",
    scripture_reference: "Bible reference",
    scripture_reference_full: "Full reference",
    scripture_reference_last: "Reference (last slide)",
    scripture_name: "Bible version",
    scripture_name_abbr: "Version (short)",
    scripture_number: "Verse number",
    scripture_red_jesus: "Words of Jesus (red)"
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const fromId = (text: string) => capitalize(text.replaceAll("_", " ").trim())

// the part before any +1 / -1 / #2 / |format / ?fallback
function splitToken(token: string) {
    const id = token.match(/^([^+\-#|?]+)/)?.[1] || token
    const rest = token.slice(id.length)
    const offset = Number(rest.match(/^([+-]\d+)/)?.[1] || 0)
    const index = rest.match(/#(\d+)/)?.[1] || ""
    return { id, offset, index, hasExtra: /[|?]/.test(rest) }
}

function getBaseLabel(id: string): string {
    if (LABELS[id]) return LABELS[id]

    // second/third translation: scripture2_text
    const scripture = id.match(/^scripture(\d+)_(.+)$/)
    if (scripture) return `${getBaseLabel("scripture_" + scripture[2])} (${scripture[1]})`

    if (id.startsWith("$")) return "Variable: " + fromId(id.slice(1)).replace(/ history$/i, " (history)")
    if (id.startsWith("variable_set_")) return "Variable set: " + fromId(id.slice(13))
    if (id.startsWith("timer_mp_")) return "Timer: " + fromId(id.slice(9)) + " (minutes, padded)"
    if (id.startsWith("timer_sp_")) return "Timer: " + fromId(id.slice(9)) + " (seconds, padded)"
    if (id.startsWith("timer_m_")) return "Timer: " + fromId(id.slice(8)) + " (minutes)"
    if (id.startsWith("timer_s_")) return "Timer: " + fromId(id.slice(8)) + " (seconds)"
    if (id.startsWith("timer_")) return "Timer: " + fromId(id.slice(6))
    if (id.startsWith("meta_")) return fromId(id.slice(5))
    if (id.startsWith("rss_")) return "RSS: " + fromId(id.slice(4))

    return fromId(id)
}

/** "scripture_text" / "slide_text+1" / "{show_name}" -> friendly name */
export function getDynamicLabel(token: string): string {
    token = token.replace(/^\{|\}$/g, "")
    const { id, offset, index, hasExtra } = splitToken(token)
    let label = getBaseLabel(id)

    if (offset === 1) label = /^next /i.test(label) ? label : `Next: ${label.charAt(0).toLowerCase()}${label.slice(1)}`
    else if (offset === -1) label = `Previous: ${label.charAt(0).toLowerCase()}${label.slice(1)}`
    else if (offset) label += ` (${offset > 0 ? "+" : ""}${offset})`
    if (index) label += ` #${index}`
    if (hasExtra) label += " …"

    return label
}

const escapeHtml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")

/** replace {codes} in the text parts of an HTML string with "⚡ Name" badges (tags/attributes are left alone) */
export function dynamicValuesToBadges(html: string): string {
    if (!html || !html.includes("{")) return html
    return html
        .split(/(<[^>]*>)/)
        .map((part) => {
            if (part.startsWith("<")) return part
            return part.replace(/\{([^{}<>"']+)\}/g, (_full, token) => `<span class="churchDynamicBadge" data-title="{${escapeHtml(token)}}"><span class="churchDynamicBolt">⚡</span>${escapeHtml(getDynamicLabel(token))}</span>`)
        })
        .join("")
}

export function hasDynamicValues(text: string) {
    return /\{[^{}<>"']+\}/.test(text || "")
}
