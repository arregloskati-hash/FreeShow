// ----- FreeShow Church -----
// Cleans lyrics that come from web search (mostly Genius page leftovers) so only the song remains.

const NOISE_LINES: RegExp[] = [
    /^you might also like.*$/i, // Genius inline ad block
    /^see .+ live$/i,
    /^get tickets as low as .*$/i,
    /^\d*\s*embed$/i, // "Embed" / "12Embed" at the end
    /^translations?$/i,
    /^(english|español|deutsch|français|português|italiano|tagalog|filipino|cebuano|русский|한국어|日本語)$/i, // translation menu entries
    /^read more\s*$/i
]

export function cleanWebLyrics(text: string): string {
    if (!text) return ""
    let lines = text.replaceAll("\r", "").split("\n")

    // Header like "1 ContributorDungog Ug Himaya LyricsDungog Ug Himaya" or "23 Contributors…Song Lyrics"
    // -> keep only what follows the word "Lyrics" on that first line
    const firstIndex = lines.findIndex((l) => l.trim().length)
    if (firstIndex > -1) {
        const first = lines[firstIndex]
        const header = first.match(/^\s*\d+\s*contributors?.*?lyrics(.*)$/i) || first.match(/^[^\[]*?lyrics(?=[^\s])(.*)$/i)
        if (header) {
            const rest = (header[1] || "").trim()
            // whatever follows "Lyrics" is the first real lyric line (often the title words)
            if (!rest) lines.splice(firstIndex, 1)
            else lines[firstIndex] = rest
        }
    }

    // Genius sometimes puts a description paragraph before the first [Section] tag ending in "Read More"
    const readMoreIndex = lines.findIndex((l) => /read more\s*$/i.test(l.trim()))
    if (readMoreIndex > -1 && readMoreIndex < 15) lines = lines.slice(readMoreIndex + 1)

    lines = lines.map((l) => l.trimEnd()).filter((l) => !NOISE_LINES.some((re) => re.test(l.trim())))

    // "…last line12Embed" glued to the final lyric line
    for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].trim()) continue
        lines[i] = lines[i].replace(/\d*\s*Embed$/, "").trimEnd()
        break
    }

    // collapse 3+ empty lines into one stanza break, trim start/end
    return lines
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
}

// "Title=…" / "Artist=…" lines at the top of the text, split out so they don't clutter the editor
export function splitMetadata(text: string): { metadata: string[]; text: string } {
    const lines = text.split("\n")
    const metadata: string[] = []
    while (lines.length && /^\s*[A-Za-z][A-Za-z ]{1,20}=.+$/.test(lines[0])) metadata.push(lines.shift()!.trim())
    while (lines.length && !lines[0].trim()) lines.shift()
    return { metadata, text: lines.join("\n") }
}
