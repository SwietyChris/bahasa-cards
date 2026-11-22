import { examples, intervalDays, localDay, newQueue, normalizeCollection, progressKey, schedule, shuffled, isDue } from "./cards.mjs";
import { createAuthoring } from "./authoring.mjs";
import { createStore, macStudio } from "./store.mjs";

const element = id => document.getElementById(id);
const number = new Intl.NumberFormat("en");
const languageName = { id: "Indonesian", en: "English" };
const languageKey = { id: "indonesian", en: "english" };
const otherLanguage = language => language === "id" ? "en" : "id";
const count = (value, noun) => number.format(value) + " " + noun + (value === 1 ? "" : noun === "match" ? "es" : "s");
const allCards = ":all";
const sample = normalizeCollection({ cards: examples });
const sampleProgress = {};
let selectedDeck = allCards;
let direction = "id";
let mode = "due";
let view = "decks";
let queue = [];
let roundSize = 0;
let day = localDay();
let revealed = false;
let quiz;

const store = createStore(refreshCollection);
const authoring = createAuthoring(element, {
  store, show: switchView, currentView: () => view, setMessage, count,
  study(deck) {
    changeDeck(deck);
    switchView("study");
  },
});

function demo() {
  return !store.data.cards.length && !store.data.decks.length;
}

function studyData() {
  return demo() ? sample : store.data;
}

function deckCards() {
  return studyData().cards.filter(card => selectedDeck === allCards || card.deck === selectedDeck);
}

function studyCards() {
  return deckCards().filter(card => !card.needsReview);
}

function activeProgress() {
  return demo() ? sampleProgress : store.progress;
}

function deckName(id = selectedDeck) {
  return id === allCards ? "All cards" : studyData().decks.find(deck => deck.id === id)?.name ?? "Deck";
}

function setMessage(message = "") {
  const box = element("message");
  box.textContent = message;
  box.hidden = !message;
}

function renderDecks() {
  const data = studyData();
  const totals = new Map([[allCards, data.cards.length]]);
  for (const card of data.cards) totals.set(card.deck, (totals.get(card.deck) ?? 0) + 1);
  const items = [...data.decks].sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  if (selectedDeck !== allCards && !items.some(deck => deck.id === selectedDeck)) selectedDeck = allCards;
  element("total-cards").textContent = count(data.cards.length, demo() ? "sample" : "card");
  const full = [{ id: allCards, name: "All cards" }, ...items];
  const buttons = full.map(({id, name}) => {
    const button = document.createElement("button");
    const total = document.createElement("span");
    button.type = "button";
    button.dataset.deck = id;
    total.className = "deck-count";
    total.textContent = number.format(totals.get(id) ?? 0);
    button.append(name, total);
    return button;
  });
  element("deck-list").replaceChildren(...buttons);
  element("deck-picker").replaceChildren(...full.map(({ id, name }) =>
    new Option(name + " · " + count(totals.get(id) ?? 0, "card"), id)));
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
    if (!reviewed.length) {
      const pending = !!deckCards().length;
      element("done-title").textContent = pending ? "Review your scans" : "No cards to study yet";
      element("done-text").textContent = pending ? "Check each scan in the Library to make it available for study."
        : "Add cards or choose another deck.";
      element("next-round").textContent = pending ? "Review scans" : "Add cards";
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
    if (demo()) sampleProgress[key] = schedule(sampleProgress[key], remembered, localDay());
    else {
      try { store.grade(key, remembered, localDay()); }
      catch { setMessage("This review could not be saved. You can skip the card and keep studying."); return; }
    }
  }
  queue.shift();
  if (remembered === false) queue.push(card);
  revealed = false;
  renderRound();
  element(queue.length ? "flashcard" : "done-title").focus();
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
    : quiz.cards.length ? "Quiz complete" : "";
  prompt.lang = card ? quiz.direction : "en";
  prompt.textContent = card ? card[languageKey[quiz.direction]]
    : quiz.cards.length ? `${quiz.correct} of ${quiz.cards.length} correct` : "No cards to quiz yet";
  element("quiz-restart").textContent = quiz.cards.length ? "New quiz" : deckCards().length ? "Review scans" : "Add cards";
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
  if (view === "capture" && next !== view) authoring.leaveCapture();
  view = next;
  const studying = next === "study" || next === "quiz";
  document.querySelector(".decks").hidden = !studying;
  document.querySelector("main").classList.toggle("manage-layout", !studying);
  for (const name of ["decks", "library", "study", "quiz", "capture"]) {
    element(name + "-view").hidden = name !== next;
    const tab = element(name + "-tab");
    const onDeck = next === "library" && authoring.deckOpen;
    if (onDeck ? name === "decks" : name === next) tab?.setAttribute("aria-current", "page");
    else tab?.removeAttribute("aria-current");
  }
  authoring.refresh();
  if (next === "quiz") startQuiz();
}

function changeDeck(deck) {
  selectedDeck = deck ?? allCards;
  renderDeckChoice();
  startRound();
  if (view === "quiz") startQuiz();
}

function refreshCollection() {
  renderDecks();
  startRound();
  authoring.refresh();
  if (view === "quiz") startQuiz();
}

for (const name of ["decks", "library", "study", "quiz"]) {
  element(name + "-tab").addEventListener("click", () => {
    setMessage();
    if (name === "library") authoring.openCollection();
    else if (name !== view) switchView(name);
  });
}
element("deck-list").addEventListener("click", event => {
  const deck = event.target.closest("[data-deck]")?.dataset.deck;
  if (deck && deck !== selectedDeck) changeDeck(deck);
});
element("deck-picker").addEventListener("change", event => changeDeck(event.target.value));
element("direction").addEventListener("change", event => { direction = event.target.value; startRound(); });
element("study-mode").addEventListener("change", event => { mode = event.target.value; startRound(); });
element("shuffle").addEventListener("click", () => {
  queue = shuffled(queue);
  revealed = false;
  renderRound();
});
element("flashcard").addEventListener("click", () => { revealed = !revealed; renderRound(); });
element("again").addEventListener("click", () => advance(false));
element("remember").addEventListener("click", () => advance(true));
element("skip").addEventListener("click", () => advance(null));

function openReview() {
  authoring.openCollection(selectedDeck === allCards ? null : selectedDeck, { review: deckCards().length > 0 });
}
element("next-round").addEventListener("click", () => {
  if (!studyCards().length) { openReview(); return; }
  if (!studyCards().some(card => isDue(activeProgress(), direction, card, localDay())) || mode === "all") {
    mode = "all";
    element("study-mode").value = mode;
  }
  startRound();
  if (queue.length) element("flashcard").focus();
});
element("quiz-direction").addEventListener("change", startQuiz);
element("quiz-form").addEventListener("submit", event => { event.preventDefault(); checkAnswer(); });
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
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && day !== localDay()) startRound();
});
element("storage-footer").textContent = macStudio ? "Your collection is stored on this Mac." : "Your collection and review progress are saved on this device.";
try {
  await store.load();
} catch (error) {
  const notification = element("storage-message");
  notification.textContent = error.message;
  notification.hidden = false;
  refreshCollection();
}
if ("serviceWorker" in navigator && !macStudio) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
