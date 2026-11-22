import { examples, intervalDays, localDay, maxCards, newQueue, normalizeCards,
  packVersion, progressKey, readPack, schedule, shuffled, sortCards, isDue } from "./cards.mjs";
import { setupCapture } from "./capture.mjs";
import { saveCollectionPdf, saveDownload } from "./exports.mjs";

const element = id => document.getElementById(id);
const storageKey = `bahasa-cards:${new URL(".", location.href).pathname}:v1`;
const number = new Intl.NumberFormat("en");
const languageName = { id: "Indonesian", en: "English" };
const languageKey = { id: "indonesian", en: "english" };
const otherLanguage = language => language === "id" ? "en" : "id";
const count = (value, noun) => `${number.format(value)} ${noun}${value === 1 ? "" : "s"}`;

let vault = { cards: [], progress: {} };
let sampleProgress = {};
let selectedDeck = "all";
let direction = "id";
let mode = "due";
let view = "study";
let queue = [];
let roundSize = 0;
let day = localDay();
let revealed = false;
let libraryLimit = 50;
let quiz = null;

function loadVault() {
  const record = JSON.parse(localStorage.getItem(storageKey) || "null");
  if (!record) return { cards: [], progress: {} };
  return { cards: normalizeCards(record.cards).sort(sortCards), progress: record.progress ?? {} };
}

function reportStorageError() {
  element("storage-message").hidden = false;
}

function saveVault(change) {
  let latest;
  try { latest = loadVault(); } catch (error) {
    reportStorageError();
    throw new Error("The collection could not be opened. Keep your last card backup.", { cause: error });
  }
  const next = change(latest);
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
    vault = next;
    element("storage-message").hidden = true;
  } catch (error) {
    reportStorageError();
    throw new Error("The collection could not be saved. Make a Backup from the Library before changing browser storage.", { cause: error });
  }
}

function activeCards() {
  return vault.cards.length ? vault.cards : examples;
}

function deckCards() {
  return activeCards().filter(card => selectedDeck === "all" || String(card.deck) === selectedDeck);
}

function studyCards() {
  return deckCards().filter(card => !card.needsReview);
}

function activeProgress() {
  return vault.cards.length ? vault.progress : sampleProgress;
}

function deckName(deck = selectedDeck) {
  return deck === "all" ? "All decks" : `Deck ${deck}`;
}

function setMessage(message = "") {
  const box = element("message");
  box.textContent = message;
  box.hidden = !message;
}

function renderDecks() {
  const cards = activeCards();
  const deckCounts = new Map([["all", cards.length]]);
  for (const card of cards) {
    const deck = String(card.deck);
    deckCounts.set(deck, 1 + (deckCounts.get(deck) ?? 0));
  }
  if (!deckCounts.has(selectedDeck)) selectedDeck = "all";
  element("sample-note").hidden = !!vault.cards.length;
  element("total-cards").textContent = count(cards.length, vault.cards.length ? "card" : "sample");
  const buttons = [];
  const options = [];
  for (const [deck, total] of deckCounts) {
    const button = document.createElement("button");
    const totalLabel = document.createElement("span");
    button.type = "button";
    button.dataset.deck = deck;
    button.append(deckName(deck), totalLabel);
    totalLabel.className = "deck-count";
    totalLabel.textContent = number.format(total);
    buttons.push(button);
    options.push(new Option(`${deckName(deck)} · ${count(total, "card")}`, deck));
  }
  element("deck-list").replaceChildren(...buttons);
  element("deck-picker").replaceChildren(...options);
  renderDeckChoice();
}

function renderDeckChoice() {
  element("deck-picker").value = selectedDeck;
  for (const button of element("deck-list").children) {
    button.setAttribute("aria-pressed", String(button.dataset.deck === selectedDeck));
  }
}

function startRound(shuffle = false) {
  day = localDay();
  const candidates = studyCards();
  queue = newQueue(candidates, activeProgress(), direction, mode, day);
  if (shuffle) queue = shuffled(queue);
  roundSize = queue.length;
  element("study-context").textContent = `${deckName()} · ${count(candidates.length, "card")}`;
  revealed = false;
  renderRound();
}

function renderRound() {
  element("study-round").hidden = !queue.length;
  element("round-done").hidden = !!queue.length;
  if (!queue.length) {
    const reviewed = studyCards();
    if (!reviewed.length && deckCards().length) {
      element("done-title").textContent = "Review your scans";
      element("done-text").textContent = "Check each scan in the Library to make it available for study.";
      element("next-round").textContent = "Review scans";
      return;
    }
    const ready = reviewed.filter(card => isDue(activeProgress(), direction, card, localDay())).length;
    element("done-title").textContent = roundSize ? "Round complete" : "You’re caught up";
    element("done-text").textContent = ready
      ? `${count(ready, "card")} ready for review.`
      : "Try a different deck, switch the prompt language or practice any card.";
    element("next-round").textContent = ready && mode === "due" ? "Start next round" : "Practice all cards";
    return;
  }
  element("round-status").textContent = `${number.format(queue.length)} of ${number.format(roundSize)} left this round`;
  element("round-progress").max = roundSize;
  element("round-progress").value = roundSize - queue.length;
  element("shuffle").hidden = mode !== "all" || queue.length < 2;
  const card = queue[0];
  const language = revealed ? otherLanguage(direction) : direction;
  const prompt = card[languageKey[language]];
  element("flashcard").dataset.answer = String(revealed);
  element("card-side").textContent = languageName[language];
  const face = element("card-text");
  face.textContent = prompt;
  face.lang = language;
  face.classList.toggle("long", prompt.length > 51);
  element("card-hint").textContent = revealed ? "Tap to show prompt" : "Tap to reveal";
  element("again").disabled = !revealed;
  element("remember").disabled = !revealed;
  const step = activeProgress()[progressKey(direction, card)]?.step ?? 0;
  const next = intervalDays[Math.min(step, intervalDays.length - 1)];
  element("remember-note").textContent = `Review in ${count(next, "day")}`;
}

function advance(remembered) {
  const card = queue[0];
  if (!card || (remembered !== null && !revealed)) return;
  if (remembered !== null) {
    const key = progressKey(direction, card);
    if (vault.cards.length) {
      try {
        saveVault(latest => ({
          ...latest,
          progress: { ...latest.progress, [key]: schedule(latest.progress[key], remembered, localDay()) },
        }));
      } catch {
        setMessage("This review could not be saved. You can skip the card and keep studying.");
        return;
      }
    } else {
      sampleProgress[key] = schedule(sampleProgress[key], remembered, localDay());
    }
  }
  queue.shift();
  if (remembered === false) queue.push(card);
  revealed = false;
  renderRound();
  element(queue.length ? "flashcard" : "done-title").focus();
}

function renderLibrary() {
  const query = element("card-search").value.trim().toLocaleLowerCase();
  const cards = deckCards();
  const pending = cards.filter(card => card.needsReview).length;
  element("review-field").hidden = !pending;
  element("review-label").textContent = `Show scans to review (${pending})`;
  if (!pending) element("only-review").checked = false;
  const results = cards.filter(card => (!element("only-review").checked || card.needsReview) &&
    (!query || [card.indonesian, card.english].some(text => text.toLocaleLowerCase().includes(query))));
  element("library-count").textContent = `${deckName()} · ${count(results.length, "card")}`;
  for (const id of ["export-cards", "export-excel", "export-pdf"]) element(id).hidden = !vault.cards.length;
  const entries = results.slice(0, libraryLimit).map(card => {
    const item = document.createElement("li");
    item.className = "library-card";
    const left = document.createElement("p");
    left.lang = "id";
    left.textContent = card.indonesian;
    const right = document.createElement("p");
    right.textContent = card.english;
    const info = document.createElement("div");
    info.className = "card-end";
    const label = document.createElement("span");
    label.textContent = deckName(card.deck);
    info.append(label);
    if (card.needsReview) {
      const review = document.createElement("span");
      review.className = "review-tag";
      review.textContent = "Needs review";
      info.append(review);
    }
    if (vault.cards.length) {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "text-button edit-card";
      edit.dataset.edit = card.id;
      const action = card.needsReview ? "Review" : "Edit";
      edit.textContent = action;
      edit.setAttribute("aria-label", `${action} card ${card.indonesian}`);
      info.append(edit);
    }
    item.append(left, right, info);
    return item;
  });
  if (!entries.length) {
    const empty = document.createElement("li");
    empty.className = "no-results";
    empty.textContent = "No cards match this search.";
    entries.push(empty);
  }
  element("library-cards").replaceChildren(...entries);
  element("show-more").hidden = results.length <= libraryLimit;
}

function startQuiz() {
  quiz = {
    cards: shuffled(studyCards()).slice(0, 10), index: 0, correct: 0,
    direction: element("quiz-direction").value, checked: false,
  };
  renderQuiz();
}

function renderQuiz() {
  const card = quiz.cards[quiz.index];
  const prompt = element("quiz-prompt");
  element("quiz-context").textContent = `${deckName()} · Translate into ${languageName[otherLanguage(quiz.direction)]}`;
  element("quiz-feedback").hidden = true;
  element("quiz-form").hidden = !card;
  element("quiz-restart").hidden = !!card;
  element("quiz-position").textContent = card ? `Question ${quiz.index + 1} of ${quiz.cards.length}`
    : quiz.cards.length ? "Quiz complete" : "This deck has scans to review";
  prompt.lang = card ? quiz.direction : "en";
  prompt.textContent = card ? card[languageKey[quiz.direction]]
    : quiz.cards.length ? `${quiz.correct} of ${quiz.cards.length} correct` : "Review scans to start";
  element("quiz-restart").textContent = quiz.cards.length ? "New quiz" : "Review scans";
  const answer = element("quiz-answer");
  answer.value = "";
  answer.lang = otherLanguage(quiz.direction);
}

function comparableAnswer(text) {
  return text.normalize("NFC").toLocaleLowerCase().replace(/[\p{P}\p{S}]/gu, "").trim().replace(/\s+/g, " ");
}

function checkAnswer(revealOnly = false) {
  if (quiz.checked || !quiz.cards[quiz.index]) return;
  const typed = element("quiz-answer").value.trim();
  if (!revealOnly && !typed) {
    element("quiz-answer").focus();
    return;
  }
  const language = otherLanguage(quiz.direction);
  const expected = quiz.cards[quiz.index][languageKey[language]];
  const correct = !revealOnly && comparableAnswer(typed) === comparableAnswer(expected);
  if (correct) quiz.correct += 1;
  quiz.checked = true;
  element("quiz-result").textContent = correct ? "Correct" : revealOnly ? "Answer revealed" : "Compare with the card";
  element("quiz-correct-answer").textContent = expected;
  element("quiz-correct-answer").lang = language;
  element("quiz-accept").hidden = correct || revealOnly;
  element("quiz-next").textContent = quiz.index + 1 === quiz.cards.length ? "See score" : "Next question";
  element("quiz-form").hidden = true;
  element("quiz-feedback").hidden = false;
  element("quiz-next").focus();
}

function switchView(next) {
  if (view === "capture" && next !== view) capture.stopCamera();
  view = next;
  for (const name of ["study", "library", "quiz", "capture"]) {
    element(`${name}-view`).hidden = name !== next;
    const tab = element(`${name}-tab`);
    if (name === next) tab?.setAttribute("aria-current", "page");
    else tab?.removeAttribute("aria-current");
  }
  if (next === "library") renderLibrary();
  if (next === "quiz") startQuiz();
}

function changeDeck(deck) {
  selectedDeck = deck;
  renderDeckChoice();
  libraryLimit = 50;
  startRound();
  if (view === "library") renderLibrary();
  if (view === "quiz") startQuiz();
}

function refreshCollection() {
  renderDecks();
  startRound();
  if (view === "library") renderLibrary();
  if (view === "quiz") startQuiz();
}

function mergeCards(cards) {
  let added = 0;
  let updated = 0;
  saveVault(latest => {
    const byId = new Map(latest.cards.map(card => [card.id, card]));
    for (const card of cards) {
      const previous = byId.get(card.id);
      if (!previous) added += 1;
      else if (previous.deck !== card.deck || previous.english !== card.english ||
        previous.indonesian !== card.indonesian || previous.needsReview !== card.needsReview) updated += 1;
      byId.set(card.id, card);
    }
    if (byId.size > maxCards) throw new RangeError(`The library can hold ${number.format(maxCards)} cards.`);
    return { ...latest, cards: [...byId.values()].sort(sortCards) };
  });
  refreshCollection();
  return { added, updated };
}

const capture = setupCapture(element, (card, editing) => {
  mergeCards([card]);
  if (editing) {
    capture.reset();
    switchView("library");
    setMessage(`Updated “${card.indonesian}” in ${deckName(card.deck)}.`);
  }
  return `Saved “${card.indonesian}” to ${deckName(card.deck)}${card.needsReview ? " for review" : ""}. Ready for the next card.`;
});

const dialog = element("import-dialog");
const importResult = element("import-result");
function openImport() {
  importResult.hidden = true;
  element("card-file").value = "";
  dialog.showModal();
}
element("import-open").addEventListener("click", openImport);
element("import-first").addEventListener("click", openImport);

element("import-start").addEventListener("click", async () => {
  const button = element("import-start");
  const file = element("card-file").files[0];
  button.disabled = true;
  try {
    if (!file) throw new Error("Choose a JSON or CSV file first.");
    if (file.size > 25 * 1024 * 1024) throw new Error("Choose a card file under 25 MB.");
    const cards = readPack(await file.text());
    if (!cards.length) throw new Error("This file contains no cards.");
    const { added, updated } = mergeCards(cards);
    dialog.close();
    if (view === "study") element("flashcard").focus();
    const changes = [];
    if (added) changes.push(`imported ${count(added, "card")}`);
    if (updated) changes.push(`updated ${count(updated, "card")}`);
    const status = changes.join(" and ");
    setMessage(status ? status[0].toUpperCase() + status.slice(1) + "." : "Those cards are already in your library.");
  } catch (error) {
    importResult.textContent = error instanceof SyntaxError ? "This JSON file could not be read." : error.message;
    importResult.classList.add("error");
    importResult.hidden = false;
  } finally {
    button.disabled = false;
  }
});

element("export-cards").addEventListener("click", () => {
  const body = JSON.stringify({ version: packVersion, cards: vault.cards }, null, 2) + "\n";
  saveDownload(new Blob([body], { type: "application/json" }), "bahasa-cards.json");
});
element("export-pdf").addEventListener("click", () => {
  const reviewed = vault.cards.filter(card => !card.needsReview);
  if (!reviewed.length) {
    setMessage("Review your scans before making the study PDF.");
    return;
  }
  if (reviewed.length < vault.cards.length) setMessage(`The PDF includes ${count(reviewed.length, "reviewed card")}.`);
  saveCollectionPdf(reviewed);
});
element("export-excel").addEventListener("click", async () => {
  const button = element("export-excel");
  button.disabled = true;
  try {
    const { makeWorkbook } = await import("./xlsx.mjs");
    saveDownload(await makeWorkbook(vault.cards), "bahasa-cards.xlsx");
  } catch {
    setMessage("Excel export failed. Try again or save a card pack using Backup.");
  } finally {
    button.disabled = false;
  }
});

for (const name of ["study", "library", "quiz"]) {
  element(`${name}-tab`).addEventListener("click", () => {
    setMessage();
    if (name !== view) switchView(name);
  });
}
element("capture-open").addEventListener("click", () => {
  setMessage();
  if (capture.editing || view === "capture") capture.reset();
  switchView("capture");
});
element("capture-cancel").addEventListener("click", () => switchView("library"));
element("library-cards").addEventListener("click", event => {
  const edit = event.target.closest("[data-edit]");
  const card = vault.cards.find(item => item.id === edit?.dataset.edit);
  if (card) {
    capture.reset(card);
    switchView("capture");
  }
});
element("deck-list").addEventListener("click", event => {
  const button = event.target.closest("[data-deck]");
  if (button && button.dataset.deck !== selectedDeck) changeDeck(button.dataset.deck);
});
element("deck-picker").addEventListener("change", event => changeDeck(event.target.value));
element("direction").addEventListener("change", event => {
  direction = event.target.value;
  startRound();
});
element("study-mode").addEventListener("change", event => {
  mode = event.target.value;
  startRound();
});
element("shuffle").addEventListener("click", () => {
  queue = shuffled(queue);
  revealed = false;
  renderRound();
});
element("flashcard").addEventListener("click", () => {
  revealed = !revealed;
  renderRound();
});
element("again").addEventListener("click", () => advance(false));
element("remember").addEventListener("click", () => advance(true));
element("skip").addEventListener("click", () => advance(null));
function openReview() {
  element("only-review").checked = true;
  element("card-search").value = "";
  libraryLimit = 50;
  switchView("library");
}
element("next-round").addEventListener("click", () => {
  if (!studyCards().length) {
    openReview();
    return;
  }
  if (!studyCards().some(card => isDue(activeProgress(), direction, card, localDay())) || mode === "all") {
    mode = "all";
    element("study-mode").value = mode;
  }
  startRound();
  if (queue.length) element("flashcard").focus();
});
element("card-search").addEventListener("input", () => {
  libraryLimit = 50;
  renderLibrary();
});
element("only-review").addEventListener("change", () => {
  libraryLimit = 50;
  renderLibrary();
});
element("show-more").addEventListener("click", () => {
  libraryLimit += 50;
  renderLibrary();
});
element("quiz-direction").addEventListener("change", startQuiz);
element("quiz-form").addEventListener("submit", event => {
  event.preventDefault();
  checkAnswer();
});
element("quiz-reveal").addEventListener("click", () => checkAnswer(true));
element("quiz-next").addEventListener("click", () => {
  quiz.index += 1;
  quiz.checked = false;
  renderQuiz();
  element("quiz-prompt").focus();
});
element("quiz-accept").addEventListener("click", () => {
  quiz.correct += 1;
  element("quiz-accept").hidden = true;
  element("quiz-result").textContent = "Counted as correct";
  element("quiz-next").focus();
});
element("quiz-restart").addEventListener("click", () => {
  if (quiz.cards.length) startQuiz();
  else openReview();
});

try { vault = loadVault(); } catch { reportStorageError(); }
window.addEventListener("storage", event => {
  if (event.key !== storageKey && event.key !== null) return;
  try {
    vault = loadVault();
    refreshCollection();
  } catch { reportStorageError(); }
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && day !== localDay()) startRound();
});
capture.reset();
refreshCollection();
if ("serviceWorker" in navigator && !["localhost", "127.0.0.1"].includes(location.hostname)) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
