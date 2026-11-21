export const packVersion = 1;
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
  return first.deck - second.deck || first.id.localeCompare(second.id, "en", { numeric: true });
}

export function normalizeCards(input) {
  if (!Array.isArray(input) || input.length > maxCards) {
    throw new Error(`A card pack can contain up to ${maxCards.toLocaleString("en")} cards.`);
  }
  const seen = new Set();
  return input.map((entry, index) => {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    const deck = Number(entry?.deck);
    const indonesian = typeof entry?.indonesian === "string" ? entry.indonesian.trim() : "";
    const english = typeof entry?.english === "string" ? entry.english.trim() : "";
    const label = `Card ${index + 1}`;
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id)) {
      throw new Error(`${label} needs an ID of up to 64 letters, numbers, dots, underscores or hyphens.`);
    }
    if (!Number.isSafeInteger(deck) || deck < 1 || !["number", "string"].includes(typeof entry.deck)) {
      throw new Error(`${label} (${id}) needs a positive whole-number deck.`);
    }
    if (!indonesian || !english || indonesian.length > 1200 || english.length > 1200) {
      throw new Error(`${label} (${id}) needs 1–1,200 characters on each side.`);
    }
    if (seen.has(id)) throw new Error(`Card ID ${id} appears twice in this file.`);
    seen.add(id);
    return { id, deck, indonesian, english };
  });
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
    if (pack.version !== packVersion) throw new Error("This card pack uses an unsupported version.");
    return normalizeCards(pack.cards);
  }
  const [headings, ...rows] = csvRows(source);
  const headingNames = headings.map(heading => heading.trim().toLowerCase());
  const columns = ["id", "deck", "indonesian", "english"];
  const indexes = columns.map(column => headingNames.indexOf(column));
  if (indexes.includes(-1)) {
    throw new Error("Choose a Bahasa Cards JSON pack or a CSV with ID, Deck, Indonesian and English columns.");
  }
  return normalizeCards(rows.filter(row => row.some(field => field.trim())).map(row =>
    Object.fromEntries(columns.map((column, index) => [column, row[indexes[index]]]))
  ));
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
