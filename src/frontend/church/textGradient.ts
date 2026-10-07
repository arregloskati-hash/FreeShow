// ----- FreeShow Church -----
// Gradient text color ("color: linear-gradient(...)") rendering, shared by the output/previews and the editor.
//
// A gradient isn't a valid CSS color, so it is drawn as a background clipped to the text. Two things made it
// unreliable before:
// - a text shadow/glow is painted on top of a text-clipped background, so any shadow tinted the gradient
//   (the gradient looked washed out or just took the glow's color) -> shadows are drawn as drop-shadow filters
//   (behind the text) instead
// - the editor ignored it, so while editing the text showed in a fallback color

import { getStyles } from "../components/helpers/style"

export function isGradient(value: string | undefined | null) {
    return typeof value === "string" && /(^|\s)(repeating-)?(linear|radial|conic)-gradient\(/i.test(value.trim())
}

/** split a CSS list on top-level commas (not inside parentheses) */
export function splitTopLevel(value: string, separator = ","): string[] {
    const parts: string[] = []
    let depth = 0
    let buffer = ""
    for (const char of value) {
        if (char === "(") depth++
        if (char === ")") depth = Math.max(0, depth - 1)
        if (char === separator && depth === 0) {
            parts.push(buffer.trim())
            buffer = ""
        } else buffer += char
    }
    if (buffer.trim()) parts.push(buffer.trim())
    return parts
}

/** "2px 2px 10px #000, 0 0 20px rgb(255 0 0)" -> "drop-shadow(2px 2px 10px #000) drop-shadow(0 0 20px rgb(255 0 0))" */
export function textShadowToDropShadow(textShadow: string) {
    if (!textShadow || textShadow.trim() === "none") return ""
    return splitTopLevel(textShadow)
        .map((shadow) => shadow.replace(/\binset\b/gi, "").trim())
        .filter(Boolean)
        .map((shadow) => `drop-shadow(${shadow})`)
        .join(" ")
}

const DEFAULT_SHADOW = "2px 2px 10px #000000"

/**
 * extra CSS (to append after the text style) that draws a gradient text color
 * @param editor in the editor: keep the caret visible
 */
export function getGradientTextCss(style: string, editor = false): string {
    if (!style || !style.includes("gradient")) return ""

    const styles = getStyles(style)
    const gradient = styles.color
    if (!isGradient(gradient)) return ""

    let css = `background-image: ${gradient};-webkit-background-clip: text;background-clip: text;color: transparent;-webkit-box-decoration-break: clone;box-decoration-break: clone;`

    // shadows/glows go behind the gradient
    const shadow = styles["text-shadow"] || ""
    const dropShadow = shadow && !shadow.includes(DEFAULT_SHADOW) ? textShadowToDropShadow(shadow) : ""
    const existingFilter = styles.filter && styles.filter !== "none" ? styles.filter + " " : ""
    css += "text-shadow: none;"
    if (dropShadow) css += `filter: ${existingFilter}${dropShadow};`

    if (editor) css += "caret-color: #ffffff;"

    return css
}
