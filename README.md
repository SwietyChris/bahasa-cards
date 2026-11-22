# Wei-Chien’s Bahasa Studio

Create Indonesian–English flashcards, organize them into named decks, and study them in either direction.

## Build your decks on the Mac

1. Double-click **Start Bahasa Studio.command** in Finder. It opens Mac Studio at <http://127.0.0.1:8765/>. Leave its Terminal window open while you work.
2. Choose **New deck**, type a name and select **Create deck**. Open a deck from **Decks** to add cards, rename it, or study it.
3. Choose **Add manually** to type English first and Bahasa Indonesia second. Choose **Scan with camera** to read paper cards.

For scanning, allow camera access when your browser asks. Hold the English side inside the guide until the first beep. Flip the same card to Bahasa Indonesia and hold it steady until the second beep. Studio saves the pair and shows the saved wording before prompting for the next card. **Use this frame** can capture a difficult side, and **Type instead** lets you finish the entry by hand. An iPhone listed in the camera menu works through Continuity Camera. [Apple’s Continuity Camera guide](https://support.apple.com/en-us/102546)

Studio uses the deck you opened. A card added from the **Library** starts unassigned unless you select a deck in the manual form. Use **Edit** in a deck or the Library to check the words, correct either side, or change the assignment. The Mac opens the archived photos alongside the text.

## Save, export, and share

- **Export Excel** and **Export PDF** in a deck export its complete list. In **Library**, check individual cards or use **Select all** and **Deselect all** before exporting. When a filter is active, **Select matches** selects all matching cards.
- Mac Studio stores the collection in `~/Documents/Codex/Bahasa Studio/collection.json`. Captured photos are kept by card ID in `~/Documents/Codex/Bahasa Studio Photos/By card`.
- When you are ready to share, **Library → Backup** saves the named decks and their cards as a JSON file. Share that file privately. In Safari on an iPhone or iPad, open the Studio and tap **Import deck**. Edits made there are stored on that device and can be transferred with a new backup. [Open the study site](https://swietychris.github.io/bahasa-cards/)

**Study** flips the card and schedules review. **Quiz** checks a typed answer. An optional Home Screen icon is available in Safari’s Share menu. [Apple’s iPhone Home Screen guide](https://support.apple.com/guide/iphone/iphea86e5236/ios)

## Project

The buildless web app lives in `dist/`. GitHub Pages serves the root of `gh-pages`, which contains this directory. After committing a source change, run `git subtree push --prefix dist origin gh-pages`. Increment the cache version in `dist/sw.js` when changing cached assets.

Mac Studio runs a loopback Python 3 server. It uses the Xcode Command Line Tools and Apple Vision to read camera frames locally. Use `python3 tools/serve.py` for development. A separate collection and archive can be selected with `--collection` and `--photo-folder` for testing. JSON backups accept version 1 and version 2. CSV imports accept ID or Card ID, Deck, English, and Indonesian headers, plus optional Deck ID and Review.
