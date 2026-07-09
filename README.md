<p align="center">
  <img src="icons/ic_search.svg" alt="FuzzyTabEnhanced icon" width="96" height="96">
</p>
<h1 align="center">FuzzyTabEnhanced</h1>
<p align="center">An enhanced, modern, lightning-fast fzf-like fuzzy search across your browser tabs and bookmarks with a glassmorphism UI.</p>

---

FuzzyTabEnhanced is a modernized fork of the original FuzzyTabs browser extension. It introduces a powerful fzf-style search matching algorithm, prioritizes recent tabs with access-tracking, and updates the interface with smooth, premium glassmorphism styling and snappy animations.

## Features

- 🎯 **FZF-Style Matching**: Supports out-of-order multi-term queries (e.g., searching `goog doc` matches `Google Docs`). Exact substring matches are prioritized over scattered fuzzy sequences, and title matches are prioritized over URL matches.
- ⚡ **Recency Prioritization**: Recent tabs and bookmarks are automatically prioritized. The most recently accessed items appear first when the search box is empty and receive a score boost when matching a query.
- 🕒 **Recency Badges**: Features beautiful clock icons next to tabs or bookmarks accessed within the last 24 hours. Hovering over the badge shows a precise access time description (e.g. `Accessed 5m ago`).
- 📊 **Match Counters**: Shows a live FZF-like `matchedCount/totalCount` display (e.g. `12/84`).
- 🎨 **Glassmorphism UI**: Beautiful, modern dark UI featuring translucent backgrounds with a smooth Gaussian blur, premium fonts, clean spacing, and snappy hover/selection animations.
- ⌨️ **Vim & FZF Navigation**: Standard Vim navigation hotkeys (`Ctrl+J` / `Ctrl+K`) and exit bindings (`Ctrl+C`) alongside default arrow keys and `Ctrl+N`/`Ctrl+P`.

## Usage

- **Open tabs**: Click the FuzzyTabEnhanced toolbar button or press `Ctrl+Shift+Space`
- **Open bookmarks**: Press `Ctrl+Shift+B`
- **Switch mode (Tabs/Bookmarks)**: Press `Tab`
- **Navigate**: Arrow Up/Down or `Ctrl+N`/`Ctrl+P` (or Vim-style `Ctrl+J`/`Ctrl+K`)
- **Activate selected item**: Press `Enter` (or click / press mouse button)
- **Close selected tab**: Press `Ctrl+W` (macOS) / `Alt+W` (Linux/Windows)
- **Exit/Close searcher**: Press `Escape` or `Ctrl+C`

## Dev Installation

1. Clone or download this repository.
2. In Chrome:
   - Go to `chrome://extensions/`
   - Enable **Developer mode** (toggle in the top-right).
   - Click **Load unpacked** and select the extension directory.
3. In Firefox:
   - Go to `about:debugging#/runtime/this-firefox`
   - Click **Load Temporary Add-on...**
   - Select `manifest.json` from the extension directory.