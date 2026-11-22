import { combineCollections, hasNonLatinLetters, normalizeCards, normalizeDeck, packVersion, readPack } from "./cards.mjs";
import { createScanner, loadCardPhotos, saveCardPhotos } from "./capture.mjs";
import { saveCollectionPdf, saveDownload } from "./exports.mjs";

export function createAuthoring(element, { store, show, currentView, setMessage, study, count }) {
  const byName = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const editorForm = element("capture-form");
  const menu = element("deck-dialog");
  const importDialog = element("import-dialog");
  const deleteDialog = element("delete-card-dialog");
  const confirmDelete = element("delete-card-confirm");
  const cancelDelete = element("delete-card-cancel");
  const selection = new Set();
  let activeDeck = null;
  let editingDeck = null;
  let editor = null;
  let cardToDelete = null;
  let results = [];
  let limit = 50;
  const photoUrls = {};

  function decks() {
    return [...store.data.decks].sort((a, b) => byName.compare(a.name, b.name));
  }

  function nameOf(id) {
    if (!id) return "Unassigned";
    return store.data.decks.find(deck => deck.id === id)?.name ?? "Deck " + id;
  }

  function locationOf(id) {
    return id ? nameOf(id) : "Library";
  }

  function renderDecks() {
    const deckList = decks();
    const totals = new Map();
    for (const card of store.data.cards) {
      totals.set(card.deck, (totals.get(card.deck) ?? 0) + 1);
    }
    element("deck-summary").textContent = count(deckList.length, "deck") + " · " + count(store.data.cards.length, "card");
    element("no-decks").hidden = !!deckList.length;
    const tiles = deckList.map(deck => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const name = document.createElement("strong");
      const total = document.createElement("span");
      button.type = "button";
      button.dataset.openDeck = deck.id;
      name.textContent = deck.name;
      total.textContent = count(totals.get(deck.id) ?? 0, "card");
      button.replaceChildren(name, total);
      item.append(button);
      return item;
    });
    element("deck-tiles").replaceChildren(...tiles);
  }

  function openCollection(deck = null, { review = false } = {}) {
    setMessage();
    if (deck !== activeDeck || currentView() !== "library") {
      element("card-search").value = "";
      element("only-review").checked = review;
      limit = 50;
    }
    activeDeck = deck;
    show("library");
  }

  function exportCards() {
    const cards = store.data.cards;
    return activeDeck ? cards.filter(card => card.deck === activeDeck) : cards.filter(card => selection.has(card.id));
  }

  function updateSelection() {
    element("selection-count").textContent = selection.size.toLocaleString("en") + " selected";
    element("select-all").disabled = !results.some(card => !selection.has(card.id));
    element("deselect-all").disabled = !selection.size;
    element("select-all").textContent = element("card-search").value.trim() || element("only-review").checked
      ? "Select matches" : "Select all";
    const hasCards = activeDeck ? store.data.cards.some(card => card.deck === activeDeck) : selection.size > 0;
    element("export-excel").disabled = !hasCards;
    element("export-pdf").disabled = !hasCards;
  }

  function row(card) {
    const item = document.createElement("li");
    item.className = "library-card";
    if (!activeDeck) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "card-check";
      checkbox.dataset.selectCard = card.id;
      checkbox.checked = selection.has(card.id);
      checkbox.setAttribute("aria-label", "Select card " + card.english);
      item.append(checkbox);
      item.classList.add("selectable-card");
    }
    const english = document.createElement("p");
    english.className = "english-cell";
    english.textContent = card.english;
    const indonesian = document.createElement("p");
    indonesian.lang = "id";
    indonesian.className = "indonesian-cell";
    indonesian.textContent = card.indonesian;
    const actions = document.createElement("div");
    actions.className = "card-end";
    if (!activeDeck) {
      const name = document.createElement("span");
      name.className = "card-deck-name";
      name.textContent = nameOf(card.deck);
      actions.append(name);
    }
    if (card.needsReview) {
      const badge = document.createElement("span");
      badge.className = "review-tag";
      badge.textContent = "Needs review";
      actions.append(badge);
    }
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "text-button";
    edit.dataset.edit = card.id;
    edit.textContent = card.needsReview ? "Review" : "Edit";
    edit.setAttribute("aria-label", edit.textContent + " card " + card.english);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button danger-text";
    remove.dataset.deleteCard = card.id;
    remove.textContent = "Delete";
    remove.setAttribute("aria-label", "Delete card " + card.english);
    actions.append(edit, remove);
    item.append(english, indonesian, actions);
    return item;
  }

  function renderLibrary() {
    const cards = activeDeck ? store.data.cards.filter(card => card.deck === activeDeck) : store.data.cards;
    const query = element("card-search").value.trim().toLocaleLowerCase();
    const toReview = cards.filter(card => card.needsReview).length;
    element("library-title").textContent = locationOf(activeDeck);
    element("rename-deck").hidden = !activeDeck;
    element("study-deck").hidden = !activeDeck;
    element("study-deck").disabled = !cards.some(card => !card.needsReview);
    for (const id of ["export-cards", "import-open", "library-select"]) element(id).hidden = !!activeDeck;
    element("export-cards").disabled = !store.data.decks.length && !store.data.cards.length;
    element("review-field").hidden = !toReview;
    element("review-label").textContent = "Show scans to review (" + toReview + ")";
    if (!toReview) element("only-review").checked = false;
    results = cards.filter(card => (!element("only-review").checked || card.needsReview) &&
      (!query || [card.english, card.indonesian, nameOf(card.deck)].some(text => text.toLocaleLowerCase().includes(query))));
    element("library-count").textContent = results.length === cards.length ? count(cards.length, "card")
      : count(results.length, "match") + " in " + count(cards.length, "card");
    if (selection.size) {
      const available = new Set(store.data.cards.map(card => card.id));
      for (const id of selection) if (!available.has(id)) selection.delete(id);
    }
    updateSelection();
    const rows = results.slice(0, limit).map(row);
    if (!rows.length) {
      const empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = cards.length ? "No cards match these filters." : "Add a card by typing it or scanning both sides.";
      rows.push(empty);
    }
    element("library-cards").replaceChildren(...rows);
    element("show-more").hidden = results.length <= limit;
  }

  function refresh() {
    if (currentView() === "decks") renderDecks();
    else if (currentView() === "library") renderLibrary();
  }

  function manageDeck(id = null) {
    editingDeck = id;
    element("deck-dialog-title").textContent = id ? "Rename deck" : "New deck";
    element("deck-save").textContent = id ? "Save name" : "Create deck";
    element("deck-name").value = id ? nameOf(id) : "";
    element("deck-error").textContent = "";
    menu.showModal();
    element("deck-name").focus();
  }

  function fillPhotos(photos) {
    for (const side of ["en", "id"]) {
      const image = element(side + "-photo");
      if (photoUrls[side]) URL.revokeObjectURL(photoUrls[side]);
      if (photos[side]) photoUrls[side] = URL.createObjectURL(photos[side]);
      else delete photoUrls[side];
      image.hidden = !photos[side];
      if (photoUrls[side]) image.src = photoUrls[side];
      else image.removeAttribute("src");
    }
  }

  function enterManually({ card, draft } = {}) {
    scanner.stop();
    setMessage();
    const fromDraft = draft ?? { id: "card-" + crypto.randomUUID(), deck: activeDeck, photos: {} };
    editor = { card, draft: fromDraft };
    const context = editor;
    const side = card ?? fromDraft;
    element("capture-title").textContent = card?.needsReview ? "Review card" : card ? "Edit card" : "Add manually";
    element("capture-destination").textContent = locationOf(activeDeck);
    element("capture-delete").hidden = !card;
    element("scanner").hidden = true;
    editorForm.hidden = false;
    element("en-text").value = side.english ?? "";
    element("id-text").value = side.indonesian ?? "";
    element("capture-deck").replaceChildren(new Option("Unassigned", ""),
      ...decks().map(deck => new Option(deck.name, deck.id)));
    element("capture-deck").value = side.deck ?? "";
    element("editor-deck-field").hidden = !!activeDeck && !card;
    element("capture-save").textContent = card?.needsReview ? "Mark reviewed" : card ? "Save changes" : "Save card";
    const scriptIssue = hasNonLatinLetters(side.english ?? "") || hasNonLatinLetters(side.indonesian ?? "");
    element("capture-status").textContent = scriptIssue
      ? "Check the wording against the saved photo and correct the unexpected letters." : "";
    fillPhotos(fromDraft.photos);
    show("capture");
    element("en-text").focus();
    if (card) {
      loadCardPhotos(card.id).then(photos => {
        if (editor === context && currentView() === "capture") fillPhotos(photos);
      }).catch(() => {});
    }
  }

  function editCard(id) {
    const card = store.data.cards.find(item => item.id === id);
    if (card) enterManually({ card });
  }

  function requestDelete(id) {
    const card = store.data.cards.find(item => item.id === id);
    if (!card || deleteDialog.open) return;
    cardToDelete = card;
    element("delete-card-preview").textContent = card.english + "\n" + card.indonesian;
    const where = card.deck ? nameOf(card.deck) + " and the Library" : "the Library";
    element("delete-card-effect").textContent = "This removes the card from " + where + ". Saved scan photos are kept.";
    element("delete-card-error").textContent = "";
    deleteDialog.showModal();
  }

  async function saveCard(entry, { existing = false } = {}) {
    const [card] = normalizeCards([{ ...entry, needsReview: false }]);
    if (entry.photos) await saveCardPhotos(card.id, entry.photos);
    await store.change(latest => {
      if (card.deck && !latest.decks.some(deck => deck.id === card.deck)) {
        throw new Error("This deck is unavailable. Choose another deck.");
      }
      const cards = new Map(latest.cards.map(existing => [existing.id, existing]));
      if (existing && !cards.has(card.id)) throw new Error("This card has been deleted. Go back to the card list.");
      cards.set(card.id, { ...cards.get(card.id), ...card, needsReview: card.needsReview });
      return { ...latest, cards: [...cards.values()] };
    });
    const saved = card.needsReview ? "Card saved for review in " : "Card saved in ";
    return { card, message: saved + locationOf(card.deck) + "." };
  }

  const scanner = createScanner(element, { save: saveCard, manual: draft => enterManually({ draft }), edit: editCard });

  function startScanner() {
    setMessage();
    editor = null;
    fillPhotos({});
    element("capture-title").textContent = "Scan with camera";
    element("capture-destination").textContent = "Save to " + locationOf(activeDeck);
    element("capture-delete").hidden = true;
    editorForm.hidden = true;
    element("scanner").hidden = false;
    show("capture");
    scanner.start(activeDeck);
  }

  function openImport() {
    element("import-result").hidden = true;
    element("card-file").value = "";
    importDialog.showModal();
  }

  function saveBackup() {
    const body = JSON.stringify({ version: packVersion, ...store.data }, null, 2) + "\n";
    saveDownload(new Blob([body], { type: "application/json" }), "bahasa-studio-decks.json");
  }

  async function exportList(type) {
    const rows = exportCards().map(card => ({ ...card, deckLabel: nameOf(card.deck) }));
    if (!rows.length) return;
    const greeting = activeDeck ? nameOf(activeDeck) : "Library";
    const filename = greeting.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "cards";
    try {
      if (type === "pdf") {
        await saveCollectionPdf(rows, { title: greeting, filename: "bahasa-" + filename + ".pdf" });
      } else {
        const { makeWorkbook } = await import("./xlsx.mjs");
        saveDownload(await makeWorkbook(rows), "bahasa-" + filename + ".xlsx");
      }
    } catch {
      setMessage("Export could not finish. Try again.");
    }
  }

  element("deck-tiles").addEventListener("click", event => {
    const id = event.target.closest("[data-open-deck]")?.dataset.openDeck;
    if (id) openCollection(id);
  });
  element("new-deck").addEventListener("click", () => manageDeck());
  element("rename-deck").addEventListener("click", () => manageDeck(activeDeck));
  element("deck-close").addEventListener("click", () => menu.close());
  element("deck-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = element("deck-save");
    if (button.disabled) return;
    button.disabled = true;
    const existingId = editingDeck;
    try {
      const deck = normalizeDeck({ id: existingId ?? "deck-" + crypto.randomUUID(), name: element("deck-name").value });
      await store.change(latest => {
        if (latest.decks.some(item => item.id !== deck.id && byName.compare(item.name, deck.name) === 0)) {
          throw new Error("A deck with that name already exists.");
        }
        const list = existingId ? latest.decks.map(item => item.id === deck.id ? deck : item) : [...latest.decks, deck];
        return { ...latest, decks: list };
      });
      menu.close();
      openCollection(deck.id);
      setMessage(existingId ? "Deck renamed to “" + deck.name + "”." : "Created “" + deck.name + "”.");
    } catch (error) {
      element("deck-error").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  element("study-deck").addEventListener("click", () => study(activeDeck));
  element("add-manual").addEventListener("click", () => enterManually());
  element("add-scan").addEventListener("click", startScanner);
  element("capture-cancel").addEventListener("click", () => openCollection(activeDeck));
  const deleteFromEditor = element("capture-delete");
  deleteFromEditor.addEventListener("click", () => requestDelete(editor?.card?.id));
  editorForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!editor) return;
    const button = element("capture-save");
    if (button.disabled) return;
    button.disabled = deleteFromEditor.disabled = true;
    const { card, draft } = editor;
    try {
      const english = element("en-text").value;
      const indonesian = element("id-text").value;
      if (hasNonLatinLetters(english)) {
        element("en-text").focus();
        throw new Error("Check the English text and replace letters outside the Latin alphabet.");
      }
      if (hasNonLatinLetters(indonesian)) {
        element("id-text").focus();
        throw new Error("Check the Bahasa Indonesia text and replace letters outside the Latin alphabet.");
      }
      const saved = await saveCard({
        id: card?.id ?? draft.id, deck: element("capture-deck").value || null,
        english, indonesian, photos: draft.photos,
      }, { existing: !!card });
      openCollection(activeDeck);
      setMessage(card ? "Card updated." : saved.message);
    } catch (error) {
      element("capture-status").textContent = error.message;
    } finally {
      button.disabled = deleteFromEditor.disabled = false;
    }
  });
  cancelDelete.addEventListener("click", () => deleteDialog.close());
  deleteDialog.addEventListener("cancel", event => {
    if (confirmDelete.disabled) event.preventDefault();
  });
  element("delete-card-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!cardToDelete || !deleteDialog.open || confirmDelete.disabled) return;
    const card = cardToDelete;
    confirmDelete.disabled = cancelDelete.disabled = true;
    try {
      await store.change(latest => {
        const current = latest.cards.find(item => item.id === card.id);
        if (current && (current.deck !== card.deck || current.english !== card.english ||
            current.indonesian !== card.indonesian)) {
          throw new Error("This card was edited in another window. Refresh the page and check it before deleting.");
        }
        return { ...latest, cards: latest.cards.filter(item => item.id !== card.id) };
      });
      deleteDialog.close();
      if (currentView() === "capture") openCollection(activeDeck);
      setMessage("Card deleted.");
      element("library-title").focus({ preventScroll: true });
    } catch (error) {
      element("delete-card-error").textContent = error.message;
    } finally {
      confirmDelete.disabled = cancelDelete.disabled = false;
    }
  });
  element("library-cards").addEventListener("click", event => {
    const action = event.target.closest("[data-edit], [data-delete-card]")?.dataset;
    if (action?.edit) editCard(action.edit);
    if (action?.deleteCard) requestDelete(action.deleteCard);
  });
  element("library-cards").addEventListener("change", event => {
    const id = event.target.dataset.selectCard;
    if (!id) return;
    if (event.target.checked) selection.add(id);
    else selection.delete(id);
    updateSelection();
  });
  element("select-all").addEventListener("click", () => {
    for (const card of results) selection.add(card.id);
    renderLibrary();
  });
  element("deselect-all").addEventListener("click", () => { selection.clear(); renderLibrary(); });
  for (const [id, event] of [["card-search", "input"], ["only-review", "change"]]) {
    element(id).addEventListener(event, () => { limit = 50; renderLibrary(); });
  }
  element("show-more").addEventListener("click", () => { limit += 50; renderLibrary(); });
  element("export-cards").addEventListener("click", saveBackup);
  element("export-excel").addEventListener("click", () => exportList("xlsx"));
  element("export-pdf").addEventListener("click", () => exportList("pdf"));
  element("import-first").addEventListener("click", openImport);
  element("import-open").addEventListener("click", openImport);
  element("import-start").addEventListener("click", async () => {
    const button = element("import-start");
    const input = element("card-file").files[0];
    const output = element("import-result");
    button.disabled = true;
    try {
      if (!input) throw new Error("Choose a JSON or CSV file.");
      if (input.size > 55 * 1024 * 1024) throw new Error("Choose a card file under 55 MB.");
      const imported = readPack(await input.text());
      if (!imported.cards.length && !imported.decks.length) throw new Error("This file contains no cards or decks.");
      await store.change(latest => combineCollections(latest, imported, imported.legacy));
      importDialog.close();
      setMessage("Imported " + count(imported.decks.length, "deck") + " and " + count(imported.cards.length, "card") + ".");
    } catch (error) {
      output.textContent = error instanceof SyntaxError ? "This JSON file could not be read." : error.message;
      output.classList.add("error");
      output.hidden = false;
    } finally {
      button.disabled = false;
    }
  });

  function leaveCapture() {
    scanner.stop();
    fillPhotos({});
    editor = null;
  }

  return { renderDecks, renderLibrary, refresh, openCollection, leaveCapture, nameOf,
    get deckOpen() { return !!activeDeck; },
  };
}
