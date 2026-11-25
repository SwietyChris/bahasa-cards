import { activeAiKey, generateIndonesianSpeech, getAiSettings, providerLabel } from "./ai.mjs?v=12";

const dbName = "bahasa-tts-cache";
const storeName = "clips";
const maxMemoryEntries = 120;
const memoryCache = new Map();

export function speakableIndonesian(text) {
  if (!text) return "";
  return String(text)
    .replace(/\((?:from|lit\.?|literally|informal|formal)\s+[^)]*\)/gi, "")
    .replace(/\(([^)]+)\)/g, ", $1")
    .replace(/(?<=[^\d])\s*\/\s*(?=[^\d])/g, ", ")
    .replace(/\r?\n+/g, ". ")
    .replace(/\s*([,.])\s*/g, "$1 ")
    .replace(/([,.]\s*){2,}/g, "$1")
    .replace(/^[,.\s]+|[,.\s]+$/g, "")
    .trim();
}

function openAudioDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readCachedClip(key) {
  if (memoryCache.has(key)) return memoryCache.get(key);
  const db = await openAudioDb();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => {
        const bytes = req.result?.bytes ?? null;
        if (bytes) rememberClip(key, bytes);
        resolve(bytes);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function rememberClip(key, bytes) {
  if (memoryCache.size >= maxMemoryEntries) {
    const oldest = memoryCache.keys().next().value;
    if (oldest !== undefined) memoryCache.delete(oldest);
  }
  memoryCache.set(key, bytes);
}

async function writeCachedClip(key, bytes) {
  rememberClip(key, bytes);
  const db = await openAudioDb();
  if (!db) return;
  try {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put({ key, bytes, savedAt: Date.now() });
  } catch { /* Ignore quota or private-browsing IndexedDB restrictions. */ }
}

export function listIndonesianVoices() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  return window.speechSynthesis.getVoices().filter(voice => /^id([_-]|$)/i.test(voice.lang));
}

function pickIndonesianVoice() {
  const candidates = listIndonesianVoices();
  if (!candidates.length) return null;
  return candidates.find(v => /natural|neural|online|google|siri|enhanced|premium|damayanti/i.test(v.name))
    ?? candidates.find(v => !v.localService)
    ?? candidates.find(v => v.localService)
    ?? candidates[0];
}

export function createSpeaker() {
  let audioCtx = null;
  let activeSource = null;
  let activeUtterance = null;
  let activeToken = 0;

  // Warm voice list early so Safari/Chrome populate getVoices().
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.getVoices();
  }

  function unlockAudioContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!audioCtx || audioCtx.state === "closed") {
      audioCtx = new AudioCtx();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    try {
      // A silent 1-sample buffer unlocks playback on iOS Safari across async awaits.
      const buffer = audioCtx.createBuffer(1, 1, 22050);
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);
      source.start(0);
    } catch { /* Best-effort unlock. */ }
    return audioCtx;
  }

  function stop() {
    activeToken += 1;
    if (activeSource) {
      try { activeSource.stop(); } catch {}
      activeSource.disconnect();
      activeSource = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        window.speechSynthesis.cancel();
      }
    }
    activeUtterance = null;
  }

  function speakWithBrowser(cleaned, { slow = false, token, onState }) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      onState?.("error", "Speech is unavailable in this browser.");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.lang = "id-ID";
    utterance.rate = slow ? 0.72 : 0.92;
    const voice = pickIndonesianVoice();
    if (voice) utterance.voice = voice;
    activeUtterance = utterance;
    onState?.("playing", "device");
    utterance.onend = () => {
      if (activeToken === token) {
        activeUtterance = null;
        onState?.("idle");
      }
    };
    utterance.onerror = () => {
      if (activeToken === token) {
        activeUtterance = null;
        onState?.("error", "Could not play voice on this device.");
      }
    };
    window.speechSynthesis.speak(utterance);
  }

  function ensureWavBytes(bytes, mimeType = "audio/wav") {
    const isRiff = bytes.length >= 4
      && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
    if (isRiff || /mpeg|mp3|ogg|opus|webm|aac|mp4|flac/i.test(mimeType)) return bytes;
    const rateMatch = /rate=(\d+)/i.exec(mimeType);
    const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
    const wav = new Uint8Array(44 + bytes.length);
    const view = new DataView(wav.buffer);
    wav.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    view.setUint32(4, 36 + bytes.length, true);
    wav.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
    wav.set([0x66, 0x6d, 0x74, 0x20], 12); // fmt
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    wav.set([0x64, 0x61, 0x74, 0x61], 36); // data
    view.setUint32(40, bytes.length, true);
    wav.set(bytes, 44);
    return wav;
  }

  async function playBytes(bytes, token, onState, { detail = "ai", playbackRate = 1 } = {}) {
    const ctx = audioCtx ?? unlockAudioContext();
    if (!ctx) throw new Error("Web Audio is unavailable.");
    if (ctx.state === "suspended") await ctx.resume();
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const decoded = await ctx.decodeAudioData(copy);
    if (activeToken !== token) return;
    const source = ctx.createBufferSource();
    source.buffer = decoded;
    source.playbackRate.value = playbackRate;
    source.connect(ctx.destination);
    activeSource = source;
    onState?.("playing", detail);
    source.onended = () => {
      if (activeSource === source) activeSource = null;
      if (activeToken === token) onState?.("idle");
    };
    source.start(0);
  }

  async function speak(rawText, { slow = false, onState } = {}) {
    const cleaned = speakableIndonesian(rawText);
    if (!cleaned) return;
    stop();
    const token = activeToken;
    const settings = getAiSettings();
    const provider = settings.provider;
    const pName = providerLabel(provider);
    const selectedVoice = provider === "gemini" ? settings.geminiTtsVoice : settings.mistralTtsVoice;
    const selectedModel = provider === "gemini" ? settings.geminiTtsModel : settings.mistralTtsModel;
    const effectiveSlow = slow || settings.speechSpeed === "slow";
    const useAi = settings.voiceMode !== "browser" && Boolean(activeAiKey(settings)) && navigator.onLine !== false;

    if (!useAi) {
      speakWithBrowser(cleaned, { slow: effectiveSlow, token, onState });
      return;
    }

    // Unlock AudioContext synchronously during tap gesture before async cache/fetch calls.
    unlockAudioContext();
    onState?.("loading", provider);
    const cacheKey = `v5|${provider}|${selectedVoice}|${cleaned}`;
    try {
      let bytes = await readCachedClip(cacheKey);
      if (activeToken !== token) return;
      let modelUsed = selectedModel;
      let voiceUsed = selectedVoice;
      const fromCache = Boolean(bytes);
      if (!bytes) {
        const audio = await generateIndonesianSpeech(cleaned, { slow: false });
        if (activeToken !== token) return;
        bytes = ensureWavBytes(audio.bytes, audio.mimeType);
        modelUsed = audio.model || selectedModel;
        voiceUsed = audio.voice || selectedVoice;
      }
      await playBytes(bytes, token, onState, {
        detail: `${pName} (${voiceUsed} · ${modelUsed})`,
        playbackRate: effectiveSlow ? 0.84 : 1,
      });
      if (!fromCache && activeToken === token) {
        await writeCachedClip(cacheKey, bytes);
      }
    } catch (error) {
      if (activeToken !== token) return;
      // Gracefully fall back to the device voice if AI TTS fails.
      if ("speechSynthesis" in window) {
        speakWithBrowser(cleaned, { slow: effectiveSlow, token, onState });
        onState?.("fallback", {
          providerName: pName,
          message: error?.message || "",
          status: error?.status ?? null,
        });
      } else {
        onState?.("error", error?.message || "Could not play pronunciation.");
      }
    }
  }

  return { speak, stop };
}
