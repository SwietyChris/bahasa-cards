import {
  examples, intervalDays, isDue, localDay, moveCardToReview, newQueue, normalizeCollection,
  progressKey, restoreCardPlacement, returnCardFromReview, reviewDeckId, reviewDeckName, schedule, shuffled,
} from "./cards.mjs?v=13";
import { createAuthoring } from "./authoring.mjs?v=14";
import { createSpeaker } from "./speech.mjs?v=15";
import { createStore, macStudio } from "./store.mjs?v=16";
import { connection } from "./sync.mjs?v=15";
import { createTutorUI } from "./tutor.mjs?v=15";

const element = id => document.getElementById(id);
const number = new Intl.NumberFormat("en");
const languageName = { id: "Indonesian", en: "English" };
const languageKey = { id: "indonesian", en: "english" };
const otherLanguage = language => language === "id" ? "en" : "id";
const count = (value, noun) => number.format(value) + " " + noun + (value === 1 ? "" : noun === "match" ? "es" : "s");
const allCards = ":all";
const prefsKey = "bahasa-cards:prefs:v1";
const sample = normalizeCollection({ cards: examples });
const sampleProgress = {};

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(prefsKey) ?? "{}");
    return {
      direction: saved?.direction === "en" ? "en" : "id",
      mode: saved?.mode === "due" ? "due" : "all",
      order: saved?.order === "shuffled" ? "shuffled" : "ordered",
      slowSpeech: Boolean(saved?.slowSpeech),
    };
  } catch {
    return { direction: "id", mode: "all", order: "ordered", slowSpeech: false };
  }
}

function savePrefs() {
  try {
    localStorage.setItem(prefsKey, JSON.stringify({ direction, mode, order, slowSpeech }));
  } catch {}
}

const initialPrefs = loadPrefs();
let selectedDeck = allCards;
let direction = initialPrefs.direction;
let mode = initialPrefs.mode;
let order = initialPrefs.order;
let slowSpeech = initialPrefs.slowSpeech;
let view = "decks";
let queue = [];
let roundEntries = [];
let cardIndex = -1;
let roundSize = 0;
let day = localDay();
let revealed = false;
let transferring = false;
let undoHandler = null;
let activeSpeakButton = null;
let activeSpeakLabel = "";
let quiz;

element("direction").value = direction;
element("study-mode").value = mode;
element("study-order").value = order;

const speaker = createSpeaker();

function resetSpeakButton() {
  if (!activeSpeakButton) return;
  activeSpeakButton.textContent = activeSpeakLabel;
  activeSpeakButton.classList.remove("is-speaking");
  activeSpeakButton = null;
  activeSpeakLabel = "";
}

function stopSpeech() {
  speaker.stop();
  resetSpeakButton();
}

function speakText(text, button, statusElement = element("speech-status")) {
  if (!text) return;
  resetSpeakButton();
  if (statusElement) {
    statusElement.classList.remove("error", "ok");
    statusElement.textContent = "";
    statusElement.hidden = statusElement === element("speech-status");
  }
  const original = button.dataset.label || button.textContent;
  button.dataset.label = original;
  activeSpeakButton = button;
  activeSpeakLabel = original;
  speaker.speak(text, {
    slow: slowSpeech,
    onState(state, detail) {
      if (state === "loading") {
        button.textContent = "Loading…";
        button.classList.add("is-speaking");
      } else if (state === "playing") {
        button.textContent = "Speaking…";
        button.classList.add("is-speaking");
        if (statusElement && detail && detail !== "device" && statusElement === element("ai-status")) {
          statusElement.classList.add("ok");
          statusElement.textContent = `Playing ${detail}`;
          statusElement.hidden = false;
        }
      } else if (state === "fallback") {
        if (statusElement && detail) {
          const providerName = typeof detail === "object" ? detail.providerName || "AI" : "AI";
          const rawMessage = typeof detail === "object" ? detail.message || "" : String(detail);
          const isRateLimit = typeof detail === "object" && detail.status === 429;
          statusElement.classList.remove("ok");
          statusElement.classList.add("error");
          statusElement.textContent = statusElement === element("speech-status") && isRateLimit
            ? `${providerName} voice limit reached — played device voice instead. Check AI & Voice settings.`
            : `${providerName} voice error: ${rawMessage} (played device voice instead)`;
          statusElement.hidden = false;
        }
      } else if (state === "error") {
        if (activeSpeakButton === button) resetSpeakButton();
        if (statusElement && detail) {
          statusElement.classList.remove("ok");
          statusElement.classList.add("error");
          statusElement.textContent = detail;
          statusElement.hidden = false;
        }
      } else if (state === "idle") {
        if (activeSpeakButton === button) resetSpeakButton();
      }
    },
  });
}

function syncSlowUI() {
  element("speak-slow").setAttribute("aria-pressed", String(slowSpeech));
  tutor.syncSlowButtons(slowSpeech);
}

const tutor = createTutorUI(element, {
  speakText,
  stopSpeech,
  getSlow: () => slowSpeech,
  cardNavigation: () => ({ previous: cardIndex > 0, next: cardIndex < roundEntries.length - 1 }),
  navigateCard(offset) {
    showCard(cardIndex + offset);
    return currentEntry()?.card;
  },
  onSlowToggle() {
    slowSpeech = !slowSpeech;
    savePrefs();
    syncSlowUI();
  },
});

function updateSyncStatus(message) {
  element("sync-status").textContent = message;
  element("storage-footer").textContent = message === "Synced across devices"
    ? "Collection and review progress are synced across connected devices."
    : message;
}

const store = createStore(refreshCollection, updateSyncStatus);
const authoring = createAuthoring(element, {
  store, show: switchView, currentView: () => view, setMessage, count, speaker,
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
  if (id === allCards) return "All cards";
  if (id === reviewDeckId) return reviewDeckName;
  if (!id) return "Unassigned";
  return studyData().decks.find(deck => deck.id === id)?.name ?? "Deck";
}

function setMessage(message = "", { undo = null } = {}) {
  const box = element("message");
  const undoButton = element("message-undo");
  element("message-text").textContent = message;
  undoHandler = typeof undo === "function" ? undo : null;
  undoButton.hidden = !undoHandler;
  undoButton.disabled = false;
  box.hidden = !message;
}

function renderDecks() {
  const data = studyData();
  const totals = new Map([[allCards, data.cards.length]]);
  for (const card of data.cards) totals.set(card.deck, (totals.get(card.deck) ?? 0) + 1);
  const items = [...data.decks]
    .filter(deck => deck.id !== reviewDeckId)
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  if (selectedDeck !== allCards && selectedDeck !== reviewDeckId && !items.some(deck => deck.id === selectedDeck)) {
    selectedDeck = allCards;
  }
  element("total-cards").textContent = count(data.cards.length, demo() ? "sample" : "card");
  const full = [
    { id: allCards, name: "All cards" },
    { id: reviewDeckId, name: reviewDeckName },
    ...items,
  ];
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

function clearSpeechStatus() {
  const box = element("speech-status");
  box.textContent = "";
  box.hidden = true;
}

function currentEntry() {
  return roundEntries[cardIndex];
}

function nextPending(after) {
  const next = roundEntries.findIndex((entry, index) => index > after && entry.pending);
  return next >= 0 ? next : roundEntries.findIndex(entry => entry.pending);
}

function showCard(index) {
  if (transferring || !roundEntries[index]) return;
  stopSpeech();
  clearSpeechStatus();
  cardIndex = index;
  revealed = false;
  renderRound();
}

function startRound(forceShuffle = false) {
  stopSpeech();
  clearSpeechStatus();
  day = localDay();
  const candidates = studyCards();
  queue = newQueue(candidates, activeProgress(), direction, mode, day);
  if (forceShuffle || order === "shuffled") queue = shuffled(queue);
  roundEntries = queue.map(card => ({ card, pending: true }));
  cardIndex = roundEntries.length ? 0 : -1;
  roundSize = queue.length;
  element("study-context").textContent = `${deckName()} · ${count(candidates.length, "card")}`;
  revealed = false;
  renderRound();
}

function renderRound() {
  const entry = currentEntry();
  element("study-round").hidden = !entry;
  element("round-done").hidden = !!entry;
  element("back-to-cards").hidden = !roundEntries.length;
  syncSlowUI();
  if (!entry) {
    const reviewed = studyCards();
    if (!reviewed.length) {
      if (selectedDeck === reviewDeckId && !deckCards().length) {
        element("done-title").textContent = "Review deck is empty";
        element("done-text").textContent = "Tap Move to Review while studying any deck to collect words you want to practice here.";
        element("next-round").textContent = "Study all cards";
        return;
      }
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
      : "Try a different deck, switch the prompt language or study the whole deck again.";
    element("next-round").textContent = ready && mode === "due" ? "Start next round" : "Study all cards again";
    return;
  }
  element("round-status").textContent = `${number.format(queue.length)} of ${number.format(roundSize)} left this round`;
  element("round-progress").max = roundSize;
  element("round-progress").value = roundSize - queue.length;
  element("shuffle").hidden = queue.length < 2;
  element("shuffle").disabled = transferring;
  element("previous-card").disabled = transferring || cardIndex <= 0;
  element("following-card").disabled = transferring || cardIndex >= roundEntries.length - 1;
  const card = entry.card;
  const language = revealed ? otherLanguage(direction) : direction;
  const prompt = card[languageKey[language]];
  element("flashcard").dataset.answer = String(revealed);
  element("card-side").textContent = languageName[language];
  const face = element("card-text");
  face.textContent = prompt;
  face.lang = language;
  face.classList.toggle("long", prompt.length > 51);
  element("card-hint").textContent = revealed ? "Tap to show prompt" : "Tap to reveal";
  const canHearIndonesian = direction === "id" || revealed;
  element("speak-card").disabled = !canHearIndonesian;
  element("speak-card").title = canHearIndonesian
    ? "Hear Indonesian pronunciation"
    : "Tap the card to reveal Indonesian first";
  element("again").disabled = !revealed || !entry.pending || transferring;
  element("remember").disabled = !revealed || !entry.pending || transferring;
  element("skip").disabled = !entry.pending || transferring;
  element("again-note").textContent = entry.pending ? "Returns this round"
    : entry.skipped ? "Skipped this round" : "Already completed";
  const inReview = card.deck === reviewDeckId;
  const transferBtn = element("transfer-review");
  transferBtn.textContent = inReview
    ? "Return to " + (card.originDeck ? deckName(card.originDeck) : "Unassigned")
    : "Move to Review";
  transferBtn.disabled = transferring;
  const step = activeProgress()[progressKey(direction, card)]?.step ?? 0;
  const next = intervalDays[Math.min(step, intervalDays.length - 1)];
  element("remember-note").textContent = entry.pending ? `Review in ${count(next, "day")}` : "";
}


function advance(remembered) {
  const entry = currentEntry();
  const card = entry?.card;
  if (!card || !entry.pending || transferring || (remembered !== null && !revealed)) return;
  stopSpeech();
  clearSpeechStatus();
  if (remembered !== null) {
    const key = progressKey(direction, card);
    if (demo()) sampleProgress[key] = schedule(sampleProgress[key], remembered, localDay());
    else {
      try { store.grade(key, remembered, localDay()); }
      catch { setMessage("This review could not be saved. You can skip the card and keep studying."); return; }
    }
  }
  entry.pending = false;
  entry.skipped = remembered === null;
  queue = queue.filter(item => item.id !== card.id);
  if (remembered === false) {
    queue.push(card);
    roundEntries.push({ card, pending: true });
  }
  cardIndex = nextPending(cardIndex);
  revealed = false;
  renderRound();
  element(currentEntry() ? "flashcard" : "done-title").focus();
}

async function transferCard(card, { inQuiz = false } = {}) {
  if (!card || transferring) return;
  if (demo()) {
    setMessage("Import or add your own cards to use the Review deck.");
    return;
  }
  stopSpeech();
  clearSpeechStatus();
  transferring = true;
  if (!inQuiz) renderRound();
  const snapshot = {
    id: card.id,
    deck: card.deck ?? null,
    originDeck: card.originDeck ?? null,
  };
  const returning = card.deck === reviewDeckId;
  const roundDeck = selectedDeck;
  try {
    let outcome;
    await store.change(latest => {
      outcome = returning
        ? returnCardFromReview(latest, card.id)
        : moveCardToReview(latest, card.id);
      return outcome.collection;
    }, { preserveRound: true });
    if (!inQuiz) {
      const earlierRemoved = roundEntries.slice(0, cardIndex).filter(entry => entry.card.id === card.id).length;
      const nextPosition = cardIndex - earlierRemoved;
      queue = queue.filter(item => item.id !== card.id);
      roundEntries = roundEntries.filter(entry => entry.card.id !== card.id);
      cardIndex = nextPending(nextPosition - 1);
      revealed = false;
      element("study-context").textContent = `${deckName()} · ${count(studyCards().length, "card")}`;
      renderRound();
      element(currentEntry() ? "flashcard" : "done-title").focus();
    } else if (quiz?.cards[quiz.index]?.id === card.id && outcome?.card) {
      quiz.cards[quiz.index] = outcome.card;
      syncQuizTransferButton(outcome.card);
    }
    const targetName = outcome?.card?.deck ? deckName(outcome.card.deck) : "Unassigned";
    const notice = returning
      ? (outcome?.lostOrigin ? "Original deck no longer exists; returned to Unassigned." : `Returned to ${targetName}.`)
      : "Moved to Review.";
    setMessage(notice, {
      undo: async () => {
        let restored;
        await store.change(latest => {
          restored = restoreCardPlacement(latest, snapshot);
          return restored.collection;
        }, { preserveRound: true });
        if (view === "study" && restored?.card) {
          const belongsHere = roundDeck === allCards || restored.card.deck === roundDeck;
          if (belongsHere && !queue.some(item => item.id === restored.card.id)) {
            queue.unshift(restored.card);
            roundEntries.unshift({ card: restored.card, pending: true });
            cardIndex = 0;
            roundSize = Math.max(roundSize, queue.length);
            revealed = false;
          }
          element("study-context").textContent = `${deckName()} · ${count(studyCards().length, "card")}`;
          renderRound();
        } else if (view === "quiz" && quiz?.cards[quiz.index]?.id === snapshot.id && restored?.card) {
          quiz.cards[quiz.index] = restored.card;
          syncQuizTransferButton(restored.card);
        }
        setMessage("Card restored.");
      },
    });
  } catch (error) {
    setMessage(error.message || "Could not move card.");
  } finally {
    transferring = false;
    if (!inQuiz) renderRound();
  }
}

function startQuiz() {
  stopSpeech();
  quiz = {
    cards: shuffled(studyCards()).slice(0, 10), index: 0, correct: 0,
    direction: element("quiz-direction").value, checked: false,
  };
  renderQuiz();
}

function syncQuizTransferButton(card) {
  const button = element("quiz-transfer-review");
  if (!card || demo()) {
    button.hidden = true;
    return;
  }
  button.hidden = false;
  button.textContent = card.deck === reviewDeckId
    ? "Return to " + (card.originDeck ? deckName(card.originDeck) : "Unassigned")
    : "Move to Review";
}

function renderQuiz() {
  stopSpeech();
  const card = quiz.cards[quiz.index];
  const prompt = element("quiz-prompt");
  element("quiz-context").textContent = `${deckName()} · Translate into ${languageName[otherLanguage(quiz.direction)]}`;
  element("quiz-feedback").hidden = true;
  element("quiz-form").hidden = !card;
  element("quiz-restart").hidden = !!card;
  element("quiz-speak").hidden = !card || quiz.direction !== "id";
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
  const card = quiz.cards[quiz.index];
  const language = otherLanguage(quiz.direction);
  const expected = card[languageKey[language]];
  const correct = !revealOnly && comparableAnswer(typed) === comparableAnswer(expected);
  if (correct) quiz.correct += 1;
  quiz.checked = true;
  element("quiz-result").textContent = correct ? "Correct" : revealOnly ? "Answer revealed" : "Compare with the card";
  element("quiz-correct-answer").textContent = expected;
  element("quiz-correct-answer").lang = language;
  element("quiz-speak-answer").hidden = language !== "id";
  element("quiz-accept").hidden = correct || revealOnly;
  syncQuizTransferButton(card);
  element("quiz-next").textContent = quiz.index + 1 === quiz.cards.length ? "See score" : "Next question";
  element("quiz-form").hidden = true;
  element("quiz-feedback").hidden = false;
  element("quiz-next").focus();
}

function switchView(next) {
  stopSpeech();
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

function refreshCollection(options = {}) {
  renderDecks();
  authoring.refresh();
  if (options.preserveRound && view === "study") {
    element("study-context").textContent = `${deckName()} · ${count(studyCards().length, "card")}`;
    renderRound();
    return;
  }
  startRound();
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
element("direction").addEventListener("change", event => {
  direction = event.target.value;
  savePrefs();
  startRound();
});
element("study-mode").addEventListener("change", event => {
  mode = event.target.value;
  savePrefs();
  startRound();
});
element("study-order").addEventListener("change", event => {
  order = event.target.value;
  savePrefs();
  startRound();
});
element("shuffle").addEventListener("click", () => {
  stopSpeech();
  queue = shuffled(queue);
  const completed = roundEntries.filter(entry => !entry.pending);
  roundEntries = [...completed, ...queue.map(card => ({ card, pending: true }))];
  cardIndex = completed.length;
  revealed = false;
  renderRound();
});
element("previous-card").addEventListener("click", () => showCard(cardIndex - 1));
element("following-card").addEventListener("click", () => showCard(cardIndex + 1));
element("back-to-cards").addEventListener("click", () => {
  showCard(roundEntries.length - 1);
  element("flashcard").focus();
});
element("flashcard").addEventListener("click", () => {
  stopSpeech();
  revealed = !revealed;
  renderRound();
});
element("speak-card").addEventListener("click", () => {
  const card = currentEntry()?.card;
  if (card && (direction === "id" || revealed)) speakText(card.indonesian, element("speak-card"));
});
element("speak-slow").addEventListener("click", () => {
  slowSpeech = !slowSpeech;
  savePrefs();
  syncSlowUI();
});
element("practice-card").addEventListener("click", () => {
  const card = currentEntry()?.card;
  if (card) tutor.openPractice(card);
});
element("transfer-review").addEventListener("click", () => {
  const card = currentEntry()?.card;
  if (card) transferCard(card);
});
element("message-undo").addEventListener("click", async () => {
  const action = undoHandler;
  if (!action) return;
  element("message-undo").disabled = true;
  await action().catch(error => setMessage(error.message));
});
function renderSyncDialog() {
  const connected = !!connection()?.token;
  element("sync-form").hidden = connected;
  element("sync-now").hidden = !connected;
  element("sync-explanation").textContent = connected
    ? "This device shares decks and review progress with your other connected devices."
    : "Enter the connection code from the administrator to share decks and review progress across devices.";
}
element("sync-open").addEventListener("click", () => {
  renderSyncDialog();
  element("sync-dialog").showModal();
  if (!connection()?.token) element("sync-code").focus();
});
element("sync-close").addEventListener("click", () => element("sync-dialog").close());
element("sync-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = element("sync-connect");
  button.disabled = true;
  updateSyncStatus("Connecting…");
  try {
    await store.connect(element("sync-code").value);
    element("sync-code").value = "";
    renderSyncDialog();
  } catch (error) {
    updateSyncStatus(error.message || "Could not connect. Try again.");
  } finally {
    button.disabled = false;
  }
});
element("sync-now").addEventListener("click", () => store.syncNow().catch(() => {}));
element("ai-settings-open").addEventListener("click", () => tutor.openAiSettings());
element("again").addEventListener("click", () => advance(false));
element("remember").addEventListener("click", () => advance(true));
element("skip").addEventListener("click", () => advance(null));

function openReview() {
  authoring.openCollection(selectedDeck === allCards ? null : selectedDeck, { review: deckCards().length > 0 });
}
element("next-round").addEventListener("click", () => {
  if (!studyCards().length) {
    if (selectedDeck === reviewDeckId) {
      changeDeck(allCards);
      return;
    }
    openReview();
    return;
  }
  if (!studyCards().some(card => isDue(activeProgress(), direction, card, localDay())) || mode === "all") {
    mode = "all";
    element("study-mode").value = mode;
    savePrefs();
  }
  startRound();
  if (currentEntry()) element("flashcard").focus();
});
element("quiz-direction").addEventListener("change", startQuiz);
element("quiz-speak").addEventListener("click", () => {
  const card = quiz?.cards[quiz.index];
  if (card) speakText(card.indonesian, element("quiz-speak"), null);
});
element("quiz-speak-answer").addEventListener("click", () => {
  const card = quiz?.cards[quiz.index];
  if (card) speakText(card.indonesian, element("quiz-speak-answer"), null);
});
element("quiz-transfer-review").addEventListener("click", () => {
  const card = quiz?.cards[quiz.index];
  if (card) transferCard(card, { inQuiz: true });
});
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
try {
  await store.load();
} catch (error) {
  const notification = element("storage-message");
  notification.textContent = error.message;
  notification.hidden = false;
  refreshCollection();
}
element("sync-open").hidden = store.isMacBackend;
element("storage-footer").textContent = store.isMacBackend ? "Your collection is stored on this Mac."
  : connection()?.token ? "Syncing connected devices…" : "Your collection and review progress are saved on this device.";
if ("serviceWorker" in navigator && !macStudio) {
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch(() => {});
}
