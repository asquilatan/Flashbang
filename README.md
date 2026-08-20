# Flashbang

I made Flashbang because pressing `Windows + Shift + S` is a pain in the ass when taking notes. I needed an instant way to capture specific coordinates with a single keystroke and compile the whole queue directly into a PDF — ergo, Flashbang!

It's like the 19403198th screenshotting tool made on Earth, I know. 

---

## What it does

- **Fixed-Coordinate Capture**: Set your coordinates once (or use the screen selection tool) and press `Shift+Z` anywhere in the background to capture that exact region.
- **Undo Anytime**: Press `Shift+X` globally to delete the last taken screenshot if you made a mistake.
- **VS Code Tabbed Viewer**: Preview captured images in tabs, zoom, and reorder them on the left sidebar.
- **Export to PDF or ZIP**: Convert your captured sequence into a PDF or package them into a ZIP archive.
- **Temporary by Default**: All screenshots live in a temporary session directory and are automatically purged when the app is closed or cleared.
- **Persistent Settings**: Your coordinate region and hotkey bindings are saved locally in a SQLite database.

---

## Running the App

```bash
# Start with live reload
npm start

# Build & run production bundle
npm run start:dist
```