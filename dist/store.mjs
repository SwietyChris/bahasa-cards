import { normalizeCollection, packVersion, schedule } from "./cards.mjs";

export const macStudio = ["127.0.0.1", "localhost"].includes(location.hostname);
const storageKey = `bahasa-cards:${new URL(".", location.href).pathname}:v1`;

function browserRecord() {
  return JSON.parse(localStorage.getItem(storageKey) ?? "{}") ?? {};
}

function persistBrowser(record) {
  localStorage.setItem(storageKey, JSON.stringify(record));
}

async function macCollection() {
  const response = await fetch("./api/collection", { cache: "no-store" });
  if (!response.ok) throw new Error("Studio could not open your collection file on the Mac.");
  return response.json();
}

async function writeMac(revision, data) {
  const response = await fetch("./api/collection", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision, collection: { version: packVersion, ...data } }),
  });
  if (response.status === 409) return false;
  if (!response.ok) throw new Error("Studio could not save your collection file. Try again.");
  return true;
}

export function createStore(onChange) {
  let data = { decks: [], cards: [] };
  let progress = {};
  let saving = Promise.resolve();

  async function load() {
    if (macStudio) {
      const record = await macCollection();
      if (record.collection) {
        data = normalizeCollection(record.collection);
      } else {
        const legacy = normalizeCollection(browserRecord());
        if (legacy.cards.length || legacy.decks.length) {
          const migrated = await writeMac(record.revision, legacy);
          data = migrated ? legacy : normalizeCollection((await macCollection()).collection);
        }
      }
      try { progress = browserRecord().progress ?? {}; } catch { progress = {}; }
    } else {
      const record = browserRecord();
      data = normalizeCollection(record);
      progress = record.progress ?? {};
    }
    onChange();
  }

  function change(update) {
    const operation = saving.then(async () => {
      if (macStudio) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const latest = await macCollection();
          const next = normalizeCollection(update(normalizeCollection(latest.collection)));
          if (await writeMac(latest.revision, next)) {
            data = next;
            onChange();
            return;
          }
        }
        throw new Error("Another window is editing the collection. Try saving again.");
      }
      const record = browserRecord();
      const next = normalizeCollection(update(normalizeCollection(record)));
      persistBrowser({ ...record, ...next });
      data = next;
      onChange();
    });
    saving = operation.catch(() => {});
    return operation;
  }

  function grade(key, remembered, day) {
    const record = browserRecord();
    const latest = record.progress ?? {};
    const next = { ...latest, [key]: schedule(latest[key], remembered, day) };
    persistBrowser({ ...record, progress: next });
    progress = next;
  }

  window.addEventListener("storage", event => {
    if (!macStudio && (event.key === null || event.key === storageKey)) load().catch(() => {});
  });
  return { load, change, grade, get data() { return data; }, get progress() { return progress; } };
}
