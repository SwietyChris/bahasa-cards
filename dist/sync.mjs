import { normalizeCollection } from "./cards.mjs?v=13";

export const syncOrigin = "https://wei-chien-bahasa-sync.sprightlyzinnia8.chatgpt.site";
export const storageKey = `bahasa-cards:${new URL(".", location.href).pathname}:v1`;
export const sharedMistralKey = "shared-mistral";

export function browserRecord() {
  return JSON.parse(localStorage.getItem(storageKey) ?? "{}") ?? {};
}

export function persistBrowser(record) {
  localStorage.setItem(storageKey, JSON.stringify(record));
}

export function connection() {
  try { return browserRecord().sync ?? null; } catch { return null; }
}

export function collectionWithProgress(record) {
  return { ...normalizeCollection(record), progress: record?.progress ?? {} };
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mergeValues(base, local, remote, label) {
  if (same(local, base)) return remote;
  if (same(remote, base) || same(local, remote)) return local;
  throw new Error(`The same ${label} changed on two devices. Sync is paused to preserve both copies.`);
}

function mergeItems(base, local, remote, label) {
  const before = new Map(base.map(item => [item.id, item]));
  const here = new Map(local.map(item => [item.id, item]));
  const there = new Map(remote.map(item => [item.id, item]));
  const ids = new Set([...there.keys(), ...here.keys(), ...before.keys()]);
  const result = [];
  for (const id of ids) {
    const item = mergeValues(before.get(id), here.get(id), there.get(id), label);
    if (item !== undefined) result.push(item);
  }
  return result;
}

export function mergeLibraries(base, local, remote) {
  const originalNames = new Set(base.decks.map(deck => deck.name.toLocaleLowerCase()));
  const deckMap = new Map();
  const cardMap = new Map();
  const normalizeText = text => text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  for (const incoming of remote.decks) {
    const name = incoming.name.toLocaleLowerCase();
    const matches = local.decks.filter(deck => deck.name.toLocaleLowerCase() === name);
    if (originalNames.has(name) || matches.length !== 1 || matches[0].id === incoming.id) continue;
    const localDeck = matches[0];
    const localCards = local.cards.filter(card => card.deck === localDeck.id);
    const remoteCards = remote.cards.filter(card => card.deck === incoming.id);
    if (!localCards.length || !remoteCards.length) continue;
    for (const card of remoteCards) {
      const candidates = localCards.filter(item => normalizeText(item.english) === normalizeText(card.english) &&
        normalizeText(item.indonesian) === normalizeText(card.indonesian));
      if (candidates.length !== 1) throw new Error("The same deck has different cards on two devices. Sync is paused to preserve both copies.");
      cardMap.set(card.id, candidates[0]);
    }
    deckMap.set(incoming.id, localDeck.id);
  }
  if (deckMap.size) {
    const progress = {};
    for (const [key, value] of Object.entries(remote.progress)) {
      const separator = key.indexOf(":");
      const replacement = cardMap.get(key.slice(separator + 1));
      const mapped = replacement ? key.slice(0, separator + 1) + replacement.id : key;
      if (progress[mapped] && !same(progress[mapped], value)) throw new Error("The same review changed on two devices. Sync is paused to preserve both copies.");
      progress[mapped] = value;
    }
    remote = {
      decks: remote.decks.map(deck => ({ ...deck, id: deckMap.get(deck.id) ?? deck.id })),
      cards: remote.cards.map(card => {
        const match = cardMap.get(card.id);
        return {
          ...card,
          ...(match ? { id: match.id, english: match.english, indonesian: match.indonesian } : {}),
          deck: deckMap.get(card.deck) ?? card.deck,
          ...("originDeck" in card ? { originDeck: deckMap.get(card.originDeck) ?? card.originDeck } : {}),
        };
      }),
      progress,
    };
  }
  const progress = {};
  const keys = new Set([...Object.keys(remote.progress), ...Object.keys(local.progress), ...Object.keys(base.progress)]);
  for (const key of keys) {
    const value = mergeValues(base.progress[key], local.progress[key], remote.progress[key], "review");
    if (value !== undefined) progress[key] = value;
  }
  return collectionWithProgress({
    decks: mergeItems(base.decks, local.decks, remote.decks, "deck"),
    cards: mergeItems(base.cards, local.cards, remote.cards, "card"),
    progress,
  });
}

export function sameLibrary(a, b) {
  return same(a, b);
}

async function request(token, options = {}) {
  const response = await fetch(syncOrigin + "/api/library", {
    ...options,
    headers: { Authorization: "Bearer " + token, ...(options.body ? { "Content-Type": "application/json" } : {}) },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Could not connect to shared storage.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function readShared(token) {
  const result = await request(token);
  return { ...result, collection: result.collection ? collectionWithProgress(result.collection) : null };
}

export async function writeShared(token, revision, collection) {
  return request(token, { method: "PUT", body: JSON.stringify({ revision, collection }) });
}
