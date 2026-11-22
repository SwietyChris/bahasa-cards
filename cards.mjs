export const packVersion = 2;
export const maxCards = 10000;
export const intervalDays = [1, 3, 7, 14, 30, 60, 90];

export const examples = [
  { id: "demo-01", deck: 1, indonesian: "selamat pagi", english: "good morning" },
  { id: "demo-02", deck: 1, indonesian: "terima kasih", english: "thank you" },
  { id: "demo-03", deck: 1, indonesian: "sampai jumpa", english: "see you later" },
  { id: "demo-04", deck: 2, indonesian: "berapa harganya?", english: "how much does it cost?" },
  { id: "demo-05", deck: 2, indonesian: "air putih", english: "plain water" },
  { id: "demo-06", deck: 2, indonesian: "di mana toiletnya?", english: "where is the restroom?" },
];

export function localDay(date = new Date()) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

export function sortCards(first, second) {
  return String(first.deck ?? "").localeCompare(String(second.deck ?? ""), "en", { numeric: true }) ||
    first.id.localeCompare(second.id, "en", { numeric: true });
}

const validId = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

function deckId(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && validId.test(value.trim())) return value.trim();
  throw new Error("Choose a valid deck or leave the card unassigned.");
}

export function normalizeDeck(deck) {
  const id = deckId(deck?.id);
  const name = typeof deck?.name === "string" ? deck.name.trim().replace(/\s+/g, " ") : "";
  if (!id || !name || name.length > 80) throw new Error("Enter a deck name of 1–80 characters.");
  return { id, name };
}

export function hasNonLatinLetters(text) {
  const letters = text.match(/\p{Letter}/gu) ?? [];
  return letters.some(letter => !/\p{Script_Extensions=Latin}|\p{Script=Common}/u.test(letter));
}

export function normalizeCards(input) {
  if (!Array.isArray(input) || input.length > maxCards) {
    throw new Error(`A card pack can contain up to ${maxCards.toLocaleString("en")} cards.`);
  }
  const seen = new Set();
  return input.map((entry, index) => {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    const deck = deckId(entry?.deck);
    const indonesian = typeof entry?.indonesian === "string" ? entry.indonesian.trim() : "";
    const english = typeof entry?.english === "string" ? entry.english.trim() : "";
    const label = `Card ${index + 1}`;
    if (!validId.test(id)) {
      throw new Error(`${label} needs an ID of up to 64 letters, numbers, dots, underscores or hyphens.`);
    }
    if (!indonesian || !english || indonesian.length > 1200 || english.length > 1200) {
      throw new Error(`${label} (${id}) needs 1–1,200 characters on each side.`);
    }
    if (seen.has(id)) throw new Error(`Card ID ${id} appears twice in this file.`);
    seen.add(id);
    const needsReview = entry.needsReview === true || hasNonLatinLetters(english) || hasNonLatinLetters(indonesian);
    return {
      id, deck, indonesian, english,
      ...(needsReview ? { needsReview: true } : {}),
      ...(typeof entry.batch === "string" && entry.batch ? { batch: entry.batch } : {}),
      ...(Number.isSafeInteger(entry.position) ? { position: entry.position } : {}),
    };
  });
}

export function normalizeCollection(record) {
  const cards = normalizeCards(record?.cards ?? []);
  const supplied = record?.decks ?? [];
  if (!Array.isArray(supplied)) throw new Error("The deck list could not be read.");
  const decks = new Map();
  for (const entry of supplied) {
    const deck = normalizeDeck(entry);
    if (decks.has(deck.id)) throw new Error(`Deck ID ${deck.id} appears twice.`);
    decks.set(deck.id, deck);
  }
  for (const {deck} of cards) {
    if (deck && !decks.has(deck)) decks.set(deck, { id: deck, name: `Deck ${deck}` });
  }
  return { decks: [...decks.values()], cards };
}

export function combineCollections(current, incoming, legacy = false) {
  const decks = new Map(current.decks.map(deck => [deck.id, deck]));
  const deckIds = new Map();
  for (const deck of incoming.decks) {
    const sameId = decks.get(deck.id);
    const sameName = [...decks.values()].find(item => item.name.toLowerCase() === deck.name.toLowerCase());
    if (sameId) {
      if (!legacy && (!sameName || sameName.id === sameId.id)) decks.set(deck.id, deck);
      deckIds.set(deck.id, deck.id);
    } else if (sameName) {
      deckIds.set(deck.id, sameName.id);
    } else {
      decks.set(deck.id, deck);
      deckIds.set(deck.id, deck.id);
    }
  }
  const cards = new Map(current.cards.map(card => [card.id, card]));
  for (const card of incoming.cards) {
    const previous = cards.get(card.id);
    cards.set(card.id, { ...previous, ...card, deck: deckIds.get(card.deck) ?? null, needsReview: card.needsReview });
  }
  return normalizeCollection({ decks: [...decks.values()], cards: [...cards.values()] });
}

function csvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let closed = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        closed = true;
      } else {
        field += character;
      }
      continue;
    }
    if (character === "," || character === "\n" || character === "\r") {
      row.push(field);
      field = "";
      closed = false;
      if (character !== ",") {
        rows.push(row);
        row = [];
        if (character === "\r" && text[index + 1] === "\n") index += 1;
      }
      continue;
    }
    if (closed || (character === '"' && field !== "")) throw new Error("Check the quotation marks in the CSV.");
    if (character === '"') quoted = true;
    else field += character;
  }
  if (quoted) throw new Error("A quoted field in the CSV is missing its closing quote.");
  rows.push([...row, field]);
  return rows;
}

export function readPack(text) {
  const source = text.trimStart();
  if (source.startsWith("{")) {
    const pack = JSON.parse(source);
    if (![1, packVersion].includes(pack.version)) throw new Error("This card pack uses an unsupported version.");
    return { ...normalizeCollection(pack), legacy: pack.version === 1 };
  }
  const [headings, ...rows] = csvRows(source);
  const headingNames = headings.map(heading => heading.trim().toLowerCase());
  const columns = ["id", "deck", "indonesian", "english"];
  const indexes = columns.map(column => column === "id" && !headingNames.includes("id")
    ? headingNames.indexOf("card id") : headingNames.indexOf(column));
  if (indexes.includes(-1)) {
    throw new Error("Choose a Bahasa Cards JSON pack or a CSV with ID, Deck, Indonesian and English columns.");
  }
  const reviewIndex = headingNames.indexOf("review");
  const deckIdIndex = headingNames.indexOf("deck id");
  const decks = new Map();
  const cards = rows.filter(row => row.some(field => field.trim())).map(row => {
    const values = Object.fromEntries(columns.map((column, index) => [column, row[indexes[index]]]));
    const name = values.deck?.trim();
    const savedId = row[deckIdIndex]?.trim();
    if (!name || (!savedId && name.toLowerCase() === "unassigned")) {
      values.deck = null;
    } else if (deckIdIndex < 0 && /^\d+$/.test(name)) {
      values.deck = name;
    } else {
      let existing = [...decks.values()].find(deck => deck.name === name);
      if (!existing) {
        existing = { id: savedId || `deck-${crypto.randomUUID()}`, name };
        decks.set(existing.id, existing);
      }
      values.deck = savedId || existing.id;
    }
    return { ...values, needsReview: row[reviewIndex]?.trim().toLowerCase() === "needs review" };
  });
  return { ...normalizeCollection({ decks: [...decks.values()], cards }), legacy: deckIdIndex < 0 };
}

export function progressKey(direction, card) {
  return `${direction}:${card.id}`;
}

export function isDue(progress, direction, card, day) {
  return (progress[progressKey(direction, card)]?.due ?? day) <= day;
}

export function schedule(previous, remembered, day) {
  const step = remembered ? Math.min((previous?.step ?? 0) + 1, intervalDays.length) : 0;
  return { step, due: day + (intervalDays[step - 1] ?? 0) };
}

export function newQueue(cards, progress, direction, mode, day) {
  if (mode === "all") return [...cards];
  return cards.filter(card => isDue(progress, direction, card, day)).sort((first, second) => {
    const firstReview = progress[progressKey(direction, first)]?.due ?? Infinity;
    const secondReview = progress[progressKey(direction, second)]?.due ?? Infinity;
    return firstReview - secondReview || sortCards(first, second);
  }).slice(0, 20);
}

export function shuffled(cards) {
  const copy = [...cards];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const earlier = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[earlier]] = [copy[earlier], copy[index]];
  }
  return copy;
}
