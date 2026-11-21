# Wei-Chien’s Bahasa Studio

Wei-Chien’s Bahasa Studio turns two-sided Indonesian–English paper flashcards into study decks. The number on the English side is the deck number.

## Study on iPhone or iPad

Open [Wei-Chien’s Bahasa Studio](https://swietychris.github.io/bahasa-cards/) in Safari. To bring over a collection, save its JSON deck file to Files, tap **Import deck** and choose the file. Tap a card to flip it. **Again** brings it back in the same round. **Got it** schedules the next review. **Quiz** lets you type the translation in either direction.

For a Home Screen icon, use Safari’s **Share**, **Add to Home Screen**, and **Open as Web App** if shown. Add the icon before importing if you plan to study there. [Apple’s iPhone guide](https://support.apple.com/guide/iphone/iphea86e5236/ios)

**Library → Backup** saves a deck file you can send to another device. **Excel** saves a searchable workbook and **Save PDF** makes a printable reference. Cards and review progress are stored in the browser on each device. Import a newer backup to bring over new or changed cards. Keep a copy of the JSON backup in Files.

## Digitize cards

1. Open **Add cards** and select **Start camera**. A guide sized to the proportions of an 85 × 55 mm card frames the shot. You can also choose photos already on the device.
2. Capture the Indonesian side. Flip that card and capture the English side, keeping the deck number visible.
3. Check both text fields and the deck number. Choose **Save card**. The form is ready for the next card, with the camera still on. Turn it off with **Stop camera**.

On a Mac, run **Start Bahasa Studio.command** to open a local copy with Apple Vision handwriting recognition. macOS needs Python 3 and the Xcode Command Line Tools for recognition. The app suggests text and, when it recognizes a standalone number, the deck. Check the spelling, punctuation, and deck number against the photos. You can select **iPhone Camera** when Continuity Camera is listed. [Apple’s Continuity Camera setup](https://support.apple.com/en-us/102546)

In the hosted app you can type both fields, or paste text copied from photos with iOS Live Text. [Apple’s Live Text guide](https://support.apple.com/HT212630)

To retain the photos, leave **Keep photos on this Mac** checked. Saving a card also saves a ZIP of the photos in **Documents / Codex / Bahasa Studio Photos**, grouped by deck. The card ID in the filename matches the Excel and backup files. From the hosted site, tap **Save photos to a file** before saving the card. Keep those ZIPs with your other deck files.

## Project

The web app is buildless HTML, CSS, and JavaScript in `dist/`. The GitHub Pages site serves the root of the `gh-pages` branch, which contains only `dist/`. To update it after committing changes to the source branch, run `git subtree push --prefix dist origin gh-pages`. Increment the version in `dist/sw.js` when changing cached files.

For local development, run `python3 tools/serve.py` and open the printed address. It listens on loopback and serves the app and the Mac-only Vision helper. The hosted app uses the camera only when **Start camera** is selected, and records only the confirmed text and deck number in the collection.
