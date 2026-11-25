import {
  clearGeminiCaches,
  coachWithGemini,
  geminiVoices,
  generateGeminiSpeech,
  testGeminiConnection,
  textModels as geminiTextModels,
  ttsModels as geminiTtsModels,
} from "./gemini.mjs?v=13";
import {
  clearMistralCaches,
  coachWithMistral,
  generateMistralSpeech,
  listMistralVoices,
  mistralDefaultVoices,
  mistralTextModels,
  mistralTtsModels,
  testMistralConnection,
} from "./mistral.mjs?v=13";

const storageKey = "bahasa-cards:ai:v1";
const legacyGeminiKey = "bahasa-cards:gemini:v1";
const currentVersion = 1;

export const aiProviders = [
  { id: "mistral", label: "Mistral AI" },
  { id: "gemini", label: "Google Gemini" },
];

export const aiDefaults = {
  version: currentVersion,
  provider: "mistral",
  geminiApiKey: "",
  geminiTextModel: "gemini-3.5-flash-lite",
  geminiTtsModel: "gemini-3.8-flash-lite-tts",
  geminiTtsVoice: "Sulafat",
  mistralApiKey: "",
  mistralTextModel: "mistral-small-latest",
  mistralTtsModel: "voxtral-mini-tts-3-0",
  mistralTtsVoice: "auto",
  voiceMode: "auto",
  speechSpeed: "normal",
  localFocus: "Bali, Indonesia",
};

const practiceProperties = {
  badge: {
    type: "string",
    description: "Short 1-3 word label like 'Natural!', 'Small tweak', 'Needs correction', 'Bali Local Usage', or 'Examples'.",
  },
  reply: {
    type: "string",
    description: "Concise 1-3 sentence explanation in English covering correctness, grammar, and word choice.",
  },
  corrected_indonesian: {
    type: "string",
    description: "Best natural corrected Indonesian sentence or local phrasing; empty string if none applies.",
  },
  corrected_english: {
    type: "string",
    description: "English translation of corrected_indonesian, or empty string.",
  },
  bali_context: {
    type: "string",
    description: "Concise 1-2 sentence local cultural tip for daily life in Bali (casual vs polite register, warung/cafe/driver usage).",
  },
  examples: {
    type: "array",
    items: {
      type: "object",
      properties: {
        indonesian: { type: "string" },
        english: { type: "string" },
        note: { type: "string", description: "Short usage note, e.g. 'casual in Bali' or 'polite'." },
      },
      required: ["indonesian", "english", "note"],
      additionalProperties: false,
    },
  },
};

const mistralPracticeSchema = {
  type: "object",
  properties: practiceProperties,
  required: ["badge", "reply", "corrected_indonesian", "corrected_english", "bali_context", "examples"],
  additionalProperties: false,
};

function toGeminiSchema(node) {
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "additionalProperties") continue;
    if (key === "type" && typeof value === "string") {
      out.type = value.toUpperCase();
    } else if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(
        Object.entries(value).map(([propKey, propVal]) => [propKey, toGeminiSchema(propVal)]),
      );
    } else if (key === "items") {
      out.items = toGeminiSchema(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

const geminiPracticeSchema = toGeminiSchema(mistralPracticeSchema);

function cleanKey(value) {
  return typeof value === "string" ? value.trim().replace(/^["']+|["']+$/g, "").trim() : "";
}

function readJsonStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getAiSettings() {
  const saved = readJsonStorage(storageKey);
  if (saved && typeof saved === "object") {
    return {
      ...aiDefaults,
      ...saved,
      version: currentVersion,
      provider: saved.provider === "gemini" ? "gemini" : "mistral",
      geminiApiKey: cleanKey(saved.geminiApiKey),
      mistralApiKey: cleanKey(saved.mistralApiKey),
      localFocus: typeof saved.localFocus === "string" && saved.localFocus.trim()
        ? saved.localFocus.trim()
        : aiDefaults.localFocus,
    };
  }
  const legacy = readJsonStorage(legacyGeminiKey);
  if (legacy && typeof legacy === "object") {
    const legacyKey = cleanKey(legacy.apiKey);
    const migrated = {
      ...aiDefaults,
      provider: legacyKey ? "gemini" : aiDefaults.provider,
      geminiApiKey: legacyKey,
      geminiTextModel: legacy.textModel && legacy.textModel !== "gemini-3.8-flash"
        ? legacy.textModel
        : aiDefaults.geminiTextModel,
      geminiTtsModel: legacy.ttsModel || aiDefaults.geminiTtsModel,
      geminiTtsVoice: legacy.ttsVoice || aiDefaults.geminiTtsVoice,
      voiceMode: legacy.voiceMode || aiDefaults.voiceMode,
      speechSpeed: legacy.speechSpeed || aiDefaults.speechSpeed,
      localFocus: legacy.localFocus || aiDefaults.localFocus,
    };
    try { localStorage.setItem(storageKey, JSON.stringify(migrated)); } catch {}
    return migrated;
  }
  return { ...aiDefaults };
}

export function saveAiSettings(partial = {}) {
  const current = getAiSettings();
  const next = {
    ...current,
    ...partial,
    version: currentVersion,
  };
  next.provider = next.provider === "gemini" ? "gemini" : "mistral";
  next.geminiApiKey = cleanKey(next.geminiApiKey);
  next.mistralApiKey = cleanKey(next.mistralApiKey);
  next.localFocus = typeof next.localFocus === "string" && next.localFocus.trim()
    ? next.localFocus.trim()
    : aiDefaults.localFocus;

  if (next.geminiApiKey !== current.geminiApiKey) {
    clearGeminiCaches({ clearCooldowns: true });
  } else {
    clearGeminiCaches({ clearCooldowns: false });
  }
  if (next.mistralApiKey !== current.mistralApiKey || partial.mistralTtsModel || partial.mistralTtsVoice) {
    clearMistralCaches();
  }

  try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
  return next;
}

export function providerLabel(provider = getAiSettings().provider) {
  return provider === "gemini" ? "Gemini" : "Mistral";
}

export function activeAiKey(settings = getAiSettings()) {
  return settings.provider === "gemini" ? settings.geminiApiKey : settings.mistralApiKey;
}

export function hasAiKey(provider) {
  const settings = getAiSettings();
  if (provider === "gemini") return Boolean(settings.geminiApiKey);
  if (provider === "mistral") return Boolean(settings.mistralApiKey);
  return Boolean(activeAiKey(settings));
}

export function getProviderMeta(provider = getAiSettings().provider) {
  if (provider === "gemini") {
    return {
      id: "gemini",
      name: "Gemini",
      fullName: "Google Gemini",
      keyField: "geminiApiKey",
      textModelField: "geminiTextModel",
      ttsModelField: "geminiTtsModel",
      ttsVoiceField: "geminiTtsVoice",
      keyLabel: "Gemini API key",
      keyPlaceholder: "AIza...",
      keyUrl: "https://aistudio.google.com/apikey",
      keyLinkLabel: "Get Gemini API key",
      keyHelp: "Free tier limits voices to ~10 requests/day per model, auto-falling back across Gemini TTS models before using device voice.",
      textModels: geminiTextModels,
      ttsModels: geminiTtsModels,
      voices: geminiVoices,
    };
  }
  return {
    id: "mistral",
    name: "Mistral",
    fullName: "Mistral AI",
    keyField: "mistralApiKey",
    textModelField: "mistralTextModel",
    ttsModelField: "mistralTtsModel",
    ttsVoiceField: "mistralTtsVoice",
    keyLabel: "Mistral API key",
    keyPlaceholder: "Paste Mistral API key...",
    keyUrl: "https://console.mistral.ai/api-keys",
    keyLinkLabel: "Open Mistral console",
    keyHelp: "Connects directly to Mistral AI (chat completions + Voxtral speech) — key saved only on this device.",
    textModels: mistralTextModels,
    ttsModels: mistralTtsModels,
    voices: mistralDefaultVoices,
  };
}

export async function fetchProviderVoices(provider, candidateKey) {
  if (provider === "gemini") return geminiVoices;
  const list = await listMistralVoices(candidateKey);
  if (!list.length) return mistralDefaultVoices;
  const seen = new Set(["auto"]);
  const merged = [mistralDefaultVoices[0]];
  for (const voice of list) {
    if (seen.has(voice.id)) continue;
    seen.add(voice.id);
    merged.push(voice);
  }
  for (const preset of mistralDefaultVoices) {
    if (!seen.has(preset.id)) {
      seen.add(preset.id);
      merged.push(preset);
    }
  }
  return merged;
}

export async function testAiConnection(provider, candidateKey) {
  const settings = getAiSettings();
  const target = provider || settings.provider;
  if (target === "gemini") {
    const res = await testGeminiConnection(candidateKey ?? settings.geminiApiKey, settings.geminiTextModel);
    return { ...res, provider: "gemini", providerName: "Gemini" };
  }
  const res = await testMistralConnection(candidateKey ?? settings.mistralApiKey, settings.mistralTextModel);
  return { ...res, provider: "mistral", providerName: "Mistral" };
}

function buildSystemInstruction(card, localFocus) {
  return [
    `You are a warm, snappy Bahasa Indonesia language coach helping Wei-Chien practice vocabulary for everyday life in ${localFocus}.`,
    `Flashcard -> Indonesian: "${card.indonesian}" | English: "${card.english}".`,
    "Be brief and practical so responses load quickly on a phone: keep reply to 1–3 short sentences, bali_context to 1–2 short sentences, and examples to at most 2 short sentences (or [] on quick follow-up questions unless examples are requested).",
    "Tailor cultural tips to real daily life in Bali (casual spoken Indonesian vs polite speech at warungs, cafes, markets, or with drivers).",
  ].join("\n");
}

function buildUserPrompt(card, mode, userText) {
  if (mode === "bali") {
    return `Briefly explain how locals in Bali use "${card.indonesian}" ("${card.english}") in daily life (casual vs polite) and give 2 short examples.`;
  }
  if (mode === "examples") {
    return `Give 3 short, natural everyday Indonesian sentences using "${card.indonesian}" ("${card.english}") for life in Bali.`;
  }
  if (mode === "followup") {
    return userText.trim();
  }
  return `Check Wei-Chien's Indonesian sentence/question for "${card.indonesian}" ("${card.english}") and add a short Bali local note:\n"${userText.trim()}"`;
}

function parsePracticeResponse(rawText) {
  const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object") {
      return {
        badge: String(parsed.badge || "Coach Reply"),
        reply: String(parsed.reply || ""),
        corrected_indonesian: String(parsed.corrected_indonesian || ""),
        corrected_english: String(parsed.corrected_english || ""),
        bali_context: String(parsed.bali_context || ""),
        examples: Array.isArray(parsed.examples)
          ? parsed.examples.filter(ex => ex && ex.indonesian).map(ex => ({
            indonesian: String(ex.indonesian),
            english: String(ex.english || ""),
            note: String(ex.note || ""),
          }))
          : [],
      };
    }
  } catch { /* Fall back to plain text rendering below. */ }
  return {
    badge: "Coach Reply",
    reply: rawText,
    corrected_indonesian: "",
    corrected_english: "",
    bali_context: "",
    examples: [],
  };
}

function summarizeForHistory(parsed) {
  return [
    parsed.corrected_indonesian ? `Suggested: ${parsed.corrected_indonesian}` : "",
    parsed.reply,
    parsed.bali_context ? `Local context: ${parsed.bali_context}` : "",
  ].filter(Boolean).join("\n");
}

export async function coachCardPractice({ card, mode, userText = "", history = [] }) {
  const settings = getAiSettings();
  const promptText = buildUserPrompt(card, mode, userText);
  const recentHistory = history.slice(-6);
  const systemInstruction = buildSystemInstruction(card, settings.localFocus);

  if (settings.provider === "gemini") {
    return coachWithGemini({
      apiKey: settings.geminiApiKey,
      model: settings.geminiTextModel,
      systemInstruction,
      recentHistory,
      promptText,
      schema: geminiPracticeSchema,
      parseResponse: parsePracticeResponse,
      summarizeForHistory,
    });
  }

  return coachWithMistral({
    apiKey: settings.mistralApiKey,
    model: settings.mistralTextModel,
    systemInstruction,
    recentHistory,
    promptText,
    schema: mistralPracticeSchema,
    parseResponse: parsePracticeResponse,
    summarizeForHistory,
  });
}

export async function generateIndonesianSpeech(text, { slow = false } = {}) {
  const settings = getAiSettings();
  if (settings.provider === "gemini") {
    const res = await generateGeminiSpeech(text, {
      apiKey: settings.geminiApiKey,
      ttsModel: settings.geminiTtsModel,
      ttsVoice: settings.geminiTtsVoice,
      slow,
    });
    return { ...res, provider: "gemini", providerName: "Gemini" };
  }
  const res = await generateMistralSpeech(text, {
    apiKey: settings.mistralApiKey,
    ttsModel: settings.mistralTtsModel,
    ttsVoice: settings.mistralTtsVoice,
  });
  return { ...res, provider: "mistral", providerName: "Mistral" };
}
