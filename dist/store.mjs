import { normalizeCollection, packVersion, schedule } from "./cards.mjs?v=13";
import {
  browserRecord, collectionWithProgress, mergeLibraries, persistBrowser, readShared, sameLibrary, storageKey, writeShared,
} from "./sync.mjs?v=16";

export const macStudio = ["127.0.0.1", "localhost"].includes(location.hostname);

function hasBrowserCollection(record) {
  return record.decks !== undefined || record.cards !== undefined;
}

async function readPublishedCollection() {
  try {
    const response = await fetch("./study-pack.json");
    if (!response.ok) throw new Error(`Study pack request failed (${response.status}).`);
    const pack = await response.json();
    if (pack?.version !== packVersion || !Array.isArray(pack.decks) || !Array.isArray(pack.cards)) {
      throw new Error("Invalid study pack.");
    }
    return normalizeCollection(pack);
  } catch (error) {
    throw new Error("Studio couldn’t load the published decks. Check your connection and reload.", { cause: error });
  }
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

export function createStore(onChange, onSyncStatus = () => {}) {
  let data = { decks: [], cards: [] };
  let progress = {};
  let published;
  let useMacBackend = false;
  let saving = Promise.resolve();
  let syncing = null;

  function savedLibrary(record) {
    return hasBrowserCollection(record)
      ? collectionWithProgress(record)
      : { ...published, progress: record.progress ?? {} };
  }

  async function ensurePublished() {
    if (!published) published = await readPublishedCollection();
    return published;
  }

  async function reconcile(token, base, connecting = false) {
    await ensurePublished();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const before = browserRecord();
      if (!connecting && before.sync?.token !== token) return;
      const local = savedLibrary(before);
      const common = connecting ? base : collectionWithProgress(before.sync.base);
      const shared = await readShared(token);
      const remote = shared.collection;
      const merged = remote ? mergeLibraries(common, local, remote) : local;
      const latestBeforeWrite = browserRecord();
      if (!sameLibrary(savedLibrary(latestBeforeWrite), local) ||
          (!connecting && latestBeforeWrite.sync?.revision !== before.sync?.revision)) continue;
      let revision = shared.revision;
      if (!remote || !sameLibrary(merged, remote)) {
        try {
          revision = (await writeShared(token, revision, merged)).revision;
        } catch (error) {
          if (error.status === 409) continue;
          throw error;
        }
      }
      const latest = browserRecord();
      if (!connecting && latest.sync?.token !== token) return;
      const rebased = mergeLibraries(local, savedLibrary(latest), merged);
      persistBrowser({
        ...latest,
        ...rebased,
        sync: { token, base: merged, revision, mistralReady: !!shared.mistralReady },
      });
      data = normalizeCollection(rebased);
      progress = rebased.progress;
      onChange({ preserveRound: true });
      onSyncStatus("Synced across devices");
      return;
    }
    throw new Error("The library is being updated on another device. Sync will retry.");
  }

  function syncNow() {
    if (useMacBackend) return Promise.resolve();
    const saved = browserRecord().sync;
    if (!saved?.token || !saved.base) return Promise.resolve();
    if (syncing) return syncing;
    onSyncStatus("Syncing…");
    syncing = reconcile(saved.token, saved.base)
      .catch(error => {
        onSyncStatus(error.message.includes("Sync is paused")
          ? error.message : "Waiting to sync. Changes are saved on this device.");
        throw error;
      })
      .finally(() => { syncing = null; });
    return syncing;
  }

  async function connect(code) {
    if (useMacBackend) throw new Error("Open the public Studio to connect devices.");
    const token = code.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Enter the connection code from the administrator.");
    const record = browserRecord();
    if (record.sync?.token && record.sync.token !== token) {
      throw new Error("This device is already connected to a different library.");
    }
    await ensurePublished();
    if (record.sync?.token) return syncNow();
    await reconcile(token, { ...published, progress: {} }, true);
  }

  async function detectMacBackend() {
    if (!macStudio) return false;
    try {
      const response = await fetch("./api/recognition", { cache: "no-store" });
      if (!response.ok) return false;
      const info = await response.json().catch(() => null);
      return info?.app === "bahasa-studio";
    } catch {
      return false;
    }
  }

  async function load() {
    useMacBackend = await detectMacBackend();
    if (useMacBackend) {
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
      let record = browserRecord();
      if (!published && !hasBrowserCollection(record)) {
        published = await readPublishedCollection();
        record = browserRecord();
      }
      data = hasBrowserCollection(record) ? normalizeCollection(record) : published;
      progress = record.progress ?? {};
    }
    onChange();
    if (!useMacBackend && browserRecord().sync?.token) syncNow().catch(() => {});
  }

  function change(update, options = {}) {
    const operation = saving.then(async () => {
      if (useMacBackend) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const latest = await macCollection();
          const next = normalizeCollection(update(normalizeCollection(latest.collection)));
          if (await writeMac(latest.revision, next)) {
            data = next;
            onChange(options);
            return;
          }
        }
        throw new Error("Another window is editing the collection. Try saving again.");
      }
      let record = browserRecord();
      if (!published && !hasBrowserCollection(record)) {
        published = await readPublishedCollection();
        record = browserRecord();
      }
      const current = hasBrowserCollection(record) ? normalizeCollection(record) : published;
      const next = normalizeCollection(update(current));
      persistBrowser({ ...record, ...next });
      data = next;
      onChange(options);
      syncNow().catch(() => {});
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
    syncNow().catch(() => {});
  }

  window.addEventListener("storage", event => {
    if (!useMacBackend && (event.key === null || event.key === storageKey)) load().catch(() => {});
  });
  window.addEventListener("online", () => syncNow().catch(() => {}));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncNow().catch(() => {});
  });
  window.setInterval(() => {
    if (document.visibilityState === "visible") syncNow().catch(() => {});
  }, 15000);
  return {
    load, change, grade, connect, syncNow,
    get data() { return data; },
    get progress() { return progress; },
    get isMacBackend() { return useMacBackend; },
  };
}
