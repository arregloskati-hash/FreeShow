// ----- FreeShow Church -----
// "Ember" look: warm dark UI with orange glow accents.
// The colors live here; the layout/shape styling lives in ember.css (only active when this theme is selected).

import type { Themes } from "../../types/Settings"

export const EMBER_THEME_ID = "ember"

export const emberTheme: Themes = {
    name: "Ember",
    default: true,
    font: {
        family: "",
        size: "1em"
    },
    colors: {
        primary: "#120c09",
        "primary-lighter": "#2b1c13",
        "primary-darker": "#0d0907",
        "primary-darkest": "#080504",
        text: "#f6eee8",
        textInvert: "#140d09",
        "secondary-text": "#ffffff",
        secondary: "#ff6a1f",
        "secondary-opacity": "rgb(255 106 31 / 0.45)",
        hover: "rgb(255 140 70 / 0.06)",
        focus: "rgb(255 140 70 / 0.12)"
    }
}

// Switch to Ember once, the first time this build runs. People can still pick another theme in Settings > Theme.
const APPLIED_KEY = "church.emberApplied"
export function shouldAutoApplyEmber(): boolean {
    try {
        if (localStorage.getItem(APPLIED_KEY)) return false
        localStorage.setItem(APPLIED_KEY, "1")
        return true
    } catch {
        return false
    }
}

// Ember-specific layout styling is switched on through this attribute (main window only, never the output screens).
export function setUiStyle(themeId: string, isMainWindow: boolean) {
    const value = isMainWindow && themeId === EMBER_THEME_ID ? EMBER_THEME_ID : ""
    if (value) document.documentElement.setAttribute("data-ui", value)
    else document.documentElement.removeAttribute("data-ui")
}
