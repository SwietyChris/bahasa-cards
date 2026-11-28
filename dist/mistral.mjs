import { connection, sharedMistralKey, syncOrigin } from "./sync.mjs?v=15";

const apiBase = "https://api.mistral.ai/v1";
const v2ApiBase = "https://api.mistral.ai/v2";
const resolvedTextModels = new Map();
const resolvedTtsModels = new Map();
const cachedVoicesByKey = new Map();

export const mistralTextModels = [
  { id: "mistral-small-latest", label: "Mistral Small Latest (fast, recommended)" },
  { id: "mistral-medium-latest", label: "Mistral Medium Latest (balanced)" },
  { id: "mistral-large-latest", label: "Mistral Large Latest (deepest)" },
];

export const mistralTtsModels = [
  { id: "voxtral-mini-tts-3-0", label: "Voxtral Mini TTS 3 (latest)" },
  { id: "voxtral-mini-tts-latest", label: "Voxtral Mini TTS Latest" },
  { id: "voxtral-mini-tts-2603", label: "Voxtral Mini TTS (2603)" },
];

export const mistralDefaultVoices = [
  { id: "auto", label: "Auto (best non-English / Indonesian voice)" },
  { id: "voice_483", label: "Elena · Warm neutral (Spanish phonetic base)" },
  { id: "voice_3145", label: "Lotte · Clear neutral (Dutch phonetic base)" },
  { id: "gb_jane_neutral", label: "Jane · British neutral (preset)" },
  { id: "en_paul_neutral", label: "Paul · US neutral (preset)" },
];

const allowedIpa = new Set([
  "a", "aɪ", "aʊ", "b", "d", "dʒ", "e", "f", "g", "h", "i", "j", "k", "l",
  "m", "n", "o", "p", "s", "t", "tʃ", "u", "v", "w", "z", "ŋ", "ɔ", "ɔɪ",
  "ə", "ɛ", "ɪ", "ɾ", "ʃ", "ʊ", "ʔ",
]);

const talingFirstStems = /^(?:bebas|bebek|becek|beda|bejat|bensin|benteng|beres|besok|cewek|cowok|derek|dewa|ejek|ekor|ember|enak|esok|etika|hebat|hemat|hewan|jelek|kakek|keke|keju|kerek|keren|leher|lewat|meja|merah|merek|mewah|nenek|netral|paket|pendek|peta|rehat|rela|resep|sehat|sewa|teko|telat|telepon|tenda|teras|tewas)/;
const vowelPrefixCount = word => (word.match(/[aeiou]/g) ?? []).length;

function wordToIndonesianIpa(word) {
  const lower = word.toLowerCase();
  if (word.length < 2 || (word === word.toUpperCase() && word.length <= 4)) return null;
  if (!/^[a-z]+$/.test(lower)) return null;
  const totalVowels = vowelPrefixCount(lower);
  if (!totalVowels) return null;

  const talingFirst = talingFirstStems.test(lower);
  const phones = [];
  let vowelIdx = 0;

  for (let i = 0; i < lower.length;) {
    const rest = lower.slice(i);
    if (rest.startsWith("ng")) {
      phones.push("ŋ");
      i += 2;
      continue;
    }
    if (rest.startsWith("ny")) {
      phones.push("n", "j");
      i += 2;
      continue;
    }
    if (rest.startsWith("sy")) {
      phones.push("ʃ");
      i += 2;
      continue;
    }
    if (rest.startsWith("kh")) {
      phones.push("h");
      i += 2;
      continue;
    }
    const ch = lower[i];
    if (/[aeiou]/.test(ch)) {
      const prevChar = i > 0 ? lower[i - 1] : "";
      if (i + 2 === lower.length && vowelIdx > 0 && !/[aeiou]/.test(prevChar)) {
        if (rest === "ai") { phones.push("aɪ"); break; }
        if (rest === "au") { phones.push("aʊ"); break; }
        if (rest === "oi") { phones.push("ɔɪ"); break; }
      }
      if (ch === "e") {
        const useTaling = vowelIdx === totalVowels - 1 || (vowelIdx === 0 && talingFirst);
        phones.push(useTaling ? "ɛ" : "ə");
      } else {
        phones.push(ch);
      }
      vowelIdx += 1;
      i += 1;
      continue;
    }
    if (ch === "c") phones.push("tʃ");
    else if (ch === "j") phones.push("dʒ");
    else if (ch === "y") phones.push("j");
    else if (ch === "r") phones.push("ɾ");
    else if (ch === "q") phones.push("k");
    else if (ch === "x") phones.push("k", "s");
    else phones.push(ch);
    i += 1;
  }

  return phones.length && phones.every(phone => allowedIpa.has(phone)) ? phones : null;
}

export function buildIndonesianPhonemeHints(text) {
  const words = String(text || "").match(/[A-Za-z]+/g) ?? [];
  if (!words.length || words.length > 3) return null;
  const hints = {};
  for (const word of words) {
    if (hints[word]) continue;
    const ipa = wordToIndonesianIpa(word);
    if (ipa) hints[word] = ipa;
  }
  return Object.keys(hints).length ? hints : null;
}

function cleanKey(value) {
  return typeof value === "string" ? value.trim().replace(/^["']+|["']+$/g, "").trim() : "";
}

function extractMistralError(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message.trim();
  if (typeof payload.error?.message === "string" && payload.error.message.trim()) return payload.error.message.trim();
  if (typeof payload.detail === "string" && payload.detail.trim()) return payload.detail.trim();
  if (Array.isArray(payload.detail) && payload.detail.length) {
    return payload.detail
      .map(item => {
        if (typeof item === "string") return item;
        const loc = Array.isArray(item?.loc) ? item.loc.slice(1).join(".") : "";
        return loc && item?.msg ? `${loc}: ${item.msg}` : item?.msg || "";
      })
      .filter(Boolean)
      .join("; ");
  }
  return "";
}

function buildHttpError(status, payload) {
  const serverMessage = extractMistralError(payload);
  const error = new Error();
  error.status = status;
  if (status === 401 || status === 403) {
    error.message = serverMessage
      ? `Mistral rejected this API key (${status}): ${serverMessage}`
      : `Mistral rejected this API key (${status}). Check your key in console.mistral.ai.`;
    error.needsKeyFix = true;
  } else if (status === 402) {
    error.message = serverMessage
      ? `Mistral billing/credits required: ${serverMessage}`
      : "Mistral account requires active API credits or plan billing.";
  } else if (status === 429) {
    error.message = serverMessage
      ? `Mistral rate limit reached: ${serverMessage}`
      : "Mistral rate limit reached. Wait a moment and try again.";
  } else {
    error.message = serverMessage || `Mistral request failed (${status}).`;
  }
  return error;
}

async function fetchMistralJson(path, apiKey, options = {}, timeoutMs = 45000, base = apiBase) {
  const key = cleanKey(apiKey);
  if (!key) {
    const err = new Error("Add your Mistral API key in AI & Voice settings first.");
    err.needsKeyFix = true;
    throw err;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("You appear to be offline. Connect to the internet to use Mistral.");
  }
  let response;
  try {
    const shared = key === sharedMistralKey;
    const token = shared ? connection()?.token : key;
    if (!token) throw new Error("This device is not connected.");
    const address = shared ? `${syncOrigin}/api/mistral/${base === v2ApiBase ? "v2" : "v1"}${path}` : `${base}${path}`;
    response = await fetch(address, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`,
        ...(options.headers ?? {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error?.name === "TimeoutError") {
      throw new Error("Mistral took too long to respond. Try again in a moment.");
    }
    throw new Error("Could not reach Mistral AI. Check your connection and try again.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw buildHttpError(response.status, payload);
  return payload;
}

export function clearMistralCaches() {
  resolvedTextModels.clear();
  resolvedTtsModels.clear();
  cachedVoicesByKey.clear();
}

function isModelUnavailableError(error) {
  return error?.status === 404 || /unknown_model|model.*not.*found|not.*found.*model|invalid model/i.test(error?.message ?? "");
}

function isVoiceRejectionError(error) {
  return (error?.status === 400 || error?.status === 404 || error?.status === 422)
    && /voice/i.test(error?.message ?? "");
}

async function listAvailableModels(apiKey) {
  try {
    const payload = await fetchMistralJson("/models", apiKey, { method: "GET" }, 15000);
    return Array.isArray(payload?.data) ? payload.data : [];
  } catch {
    return [];
  }
}

async function listAvailableChatModels(apiKey) {
  const models = await listAvailableModels(apiKey);
  const chat = models
    .filter(model => model?.id && model?.capabilities?.completion_chat !== false && !/embed|tts|transcribe|ocr|moderation/i.test(model.id))
    .map(model => model.id);
  const preferred = chat.filter(id => /mistral-small|mistral-medium|ministral/i.test(id));
  return [...new Set([...preferred, ...chat])];
}

async function listAvailableTtsModels(apiKey) {
  const models = await listAvailableModels(apiKey);
  return models
    .filter(model => model?.id && /tts|speech/i.test(model.id) && !/realtime|transcribe/i.test(model.id))
    .map(model => model.id);
}

function formatVoiceLabel(voice) {
  const name = voice?.name || voice?.slug || voice?.id || "Voice";
  const langs = Array.isArray(voice?.languages) && voice.languages.length
    ? voice.languages.slice(0, 2).join(", ")
    : "";
  const meta = [voice?.gender, langs, voice?.type === "custom" ? "custom" : ""].filter(Boolean).join(" · ");
  return meta ? `${name} (${meta})` : name;
}

export async function listMistralVoices(apiKey, { force = false } = {}) {
  const key = cleanKey(apiKey);
  if (!key) return [];
  if (!force && cachedVoicesByKey.has(key)) return cachedVoicesByKey.get(key);
  let items = [];
  for (const [base, makePath] of [
    [v2ApiBase, token => token ? `/audio/voices?page_size=50&page_token=${encodeURIComponent(token)}` : "/audio/voices?page_size=50"],
    [v2ApiBase, token => token ? `/audio/voices?page_token=${encodeURIComponent(token)}` : "/audio/voices"],
    [apiBase, (_token, offset) => `/audio/voices?limit=50&offset=${offset}`],
    [apiBase, () => "/audio/voices"],
  ]) {
    try {
      let pageToken = "";
      let offset = 0;
      const collected = [];
      for (let page = 0; page < 8; page += 1) {
        const payload = await fetchMistralJson(makePath(pageToken, offset), key, { method: "GET" }, 15000, base);
        const batch = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.data) ? payload.data : [];
        collected.push(...batch);
        pageToken = payload?.next_page_token || "";
        offset += batch.length;
        const hasMoreOffset = typeof payload?.total === "number" && offset < payload.total && base === apiBase;
        if ((!pageToken && !hasMoreOffset) || !batch.length) break;
      }
      if (collected.length) {
        items = collected;
        break;
      }
    } catch (error) {
      if (error?.needsKeyFix) throw error;
    }
  }
  const normalized = items
    .map(voice => {
      const identifier = voice?.slug || voice?.id;
      if (!identifier) return null;
      return {
        id: identifier,
        rawId: voice.id || identifier,
        name: voice.name || identifier,
        label: formatVoiceLabel(voice),
        languages: Array.isArray(voice.languages) ? voice.languages : [],
        gender: voice.gender || "",
        type: voice.type || "preset",
      };
    })
    .filter(Boolean);
  // Prioritize Indonesian/Malay or custom voices, then pure-vowel non-English presets, keeping English last.
  normalized.sort((a, b) => {
    const score = voice => {
      const langs = voice.languages.map(l => l.toLowerCase());
      const tag = `${voice.name} ${voice.id}`.toLowerCase();
      if (langs.some(l => /^(id|ms)([_-]|$)|indonesian|malay/.test(l)) || /indones|bahasa|malay/.test(tag)) return 0;
      if (voice.type === "custom") return 1;
      const isEnglish = langs.some(l => /^en([_-]|$)/.test(l)) || /^(en|gb|us)[_-]/.test(voice.id.toLowerCase());
      if (!isEnglish && (langs.some(l => /^(es|it|nl|ja|hi|pt)([_-]|$)/.test(l)) || /^(voice_483|voice_3145|voice_482)$/.test(voice.id))) return 2;
      if (!isEnglish) return 3;
      if (/^gb[_-]|british/i.test(tag)) return 4;
      return 5;
    };
    return score(a) - score(b);
  });
  cachedVoicesByKey.set(key, normalized);
  return normalized;
}

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function generateChatWithFallback(apiKey, preferredModel, makeBody, timeoutMs = 45000) {
  const key = cleanKey(apiKey);
  const cacheKey = `${key}:${preferredModel}`;
  const cached = resolvedTextModels.get(cacheKey);
  const tried = new Set();
  const initialQueue = [cached, preferredModel, ...mistralTextModels.map(m => m.id)].filter(Boolean);
  let lastError;

  async function tryList(list) {
    for (const model of list) {
      if (!model || tried.has(model)) continue;
      tried.add(model);
      try {
        const payload = await fetchMistralJson(
          "/chat/completions",
          key,
          { method: "POST", body: JSON.stringify(makeBody(model)) },
          timeoutMs,
        );
        resolvedTextModels.set(cacheKey, model);
        return { model, payload };
      } catch (error) {
        lastError = error;
        if (!isModelUnavailableError(error)) throw error;
      }
    }
    return null;
  }

  let result = await tryList(initialQueue);
  if (!result && isModelUnavailableError(lastError)) {
    const discovered = await listAvailableChatModels(key);
    result = await tryList(discovered);
  }
  if (!result) throw lastError ?? new Error("No compatible Mistral chat model was available.");
  return result;
}

export async function testMistralConnection(candidateKey, preferredModel = "mistral-small-latest") {
  const key = cleanKey(candidateKey);
  const started = performance.now();
  const { model, payload } = await generateChatWithFallback(
    key,
    preferredModel,
    targetModel => ({
      model: targetModel,
      messages: [{ role: "user", content: "Reply with just: OK" }],
      max_tokens: 16,
      temperature: 0,
    }),
    20000,
  );
  const content = payload?.choices?.[0]?.message?.content;
  const text = typeof content === "string"
    ? content.trim()
    : Array.isArray(content)
      ? content.map(part => part?.text || "").join("").trim()
      : "";
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  return { ok: Boolean(text || payload?.choices?.length), model, text, seconds };
}

export async function coachWithMistral({
  apiKey,
  model,
  systemInstruction,
  recentHistory = [],
  promptText,
  schema,
  parseResponse,
  summarizeForHistory,
}) {
  const key = cleanKey(apiKey);
  const messages = [
    { role: "system", content: systemInstruction },
    ...recentHistory.map(turn => ({
      role: turn.role === "model" ? "assistant" : "user",
      content: turn.parts?.[0]?.text ?? String(turn.content ?? ""),
    })),
    { role: "user", content: promptText },
  ];

  let response;
  try {
    response = await generateChatWithFallback(
      key,
      model,
      targetModel => ({
        model: targetModel,
        messages,
        temperature: 0.4,
        max_tokens: 550,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "practice_feedback",
            strict: true,
            schema,
          },
        },
      }),
      45000,
    );
  } catch (error) {
    if ((error?.status === 400 || error?.status === 422) && !error?.needsKeyFix) {
      response = await generateChatWithFallback(
        key,
        model,
        targetModel => ({
          model: targetModel,
          messages: [
            {
              role: "system",
              content: systemInstruction
                + '\nRespond ONLY as valid JSON with keys: "badge", "reply", "corrected_indonesian", "corrected_english", "bali_context", "examples" (array of {indonesian, english, note}).',
            },
            ...messages.slice(1),
          ],
          temperature: 0.4,
          max_tokens: 550,
          response_format: { type: "json_object" },
        }),
        45000,
      );
    } else {
      throw error;
    }
  }

  const content = response.payload?.choices?.[0]?.message?.content;
  const rawText = typeof content === "string"
    ? content.trim()
    : Array.isArray(content)
      ? content.map(part => part?.text || "").join("").trim()
      : "";
  if (!rawText) throw new Error("Mistral returned an empty response. Try again.");
  const parsed = parseResponse(rawText);
  const nextHistory = [
    ...recentHistory.slice(-6),
    { role: "user", parts: [{ text: promptText }] },
    { role: "model", parts: [{ text: summarizeForHistory(parsed) || rawText }] },
  ];
  return {
    model: response.model,
    history: nextHistory,
    result: parsed,
  };
}

export async function generateMistralSpeech(text, { apiKey, ttsModel = "voxtral-mini-tts-3-0", ttsVoice = "auto" } = {}) {
  const key = cleanKey(apiKey);
  if (!key) {
    const err = new Error("Add your Mistral API key in AI & Voice settings first.");
    err.needsKeyFix = true;
    throw err;
  }

  const cachedModel = resolvedTtsModels.get(key);
  const candidateModels = [...new Set([
    cachedModel,
    ttsModel,
    ...mistralTtsModels.map(m => m.id),
  ].filter(Boolean))];

  let voiceCandidates = [];
  if (ttsVoice && ttsVoice !== "auto") {
    voiceCandidates.push(ttsVoice);
  }
  const fetchedVoices = await listMistralVoices(key).catch(error => {
    if (error?.needsKeyFix) throw error;
    return [];
  });
  for (const voice of fetchedVoices) {
    if (!voiceCandidates.includes(voice.id)) voiceCandidates.push(voice.id);
    if (voice.rawId && !voiceCandidates.includes(voice.rawId)) voiceCandidates.push(voice.rawId);
  }
  for (const fallbackId of ["voice_483", "voice_3145", "gb_jane_neutral", "en_paul_neutral", null]) {
    if (!voiceCandidates.includes(fallbackId)) voiceCandidates.push(fallbackId);
  }

  const selectedVoiceObj = fetchedVoices.find(v => v.id === ttsVoice || v.rawId === ttsVoice);
  const autoHasNativeIndonesian = ttsVoice === "auto"
    && fetchedVoices[0]
    && (fetchedVoices[0].languages.some(l => /^id([_-]|$)|indonesian/i.test(l)) || fetchedVoices[0].type === "custom");
  const isNativeIndonesianVoice = autoHasNativeIndonesian
    || Boolean(selectedVoiceObj?.languages?.some(l => /^id([_-]|$)|indonesian/i.test(l)));
  const phonemeHints = isNativeIndonesianVoice ? null : buildIndonesianPhonemeHints(text);

  let lastError;
  const triedModels = new Set();

  async function tryModel(model) {
    if (!model || triedModels.has(model)) return null;
    triedModels.add(model);
    for (const voiceId of voiceCandidates.slice(0, 6)) {
      let useHints = Boolean(phonemeHints);
      for (let pass = 0; pass < 2; pass += 1) {
        const body = {
          model,
          input: text,
          response_format: "wav",
          ...(voiceId ? { voice_id: voiceId } : {}),
          ...(useHints && phonemeHints ? { phoneme_hints: phonemeHints } : {}),
        };
        try {
          const payload = await fetchMistralJson(
            "/audio/speech",
            key,
            { method: "POST", body: JSON.stringify(body) },
            30000,
          );
          const audioBase64 = payload?.audio_data || payload?.audioData || payload?.data;
          if (typeof audioBase64 === "string" && audioBase64) {
            resolvedTtsModels.set(key, model);
            const label = fetchedVoices.find(v => v.id === voiceId || v.rawId === voiceId)?.name
              || voiceId
              || "Voxtral";
            return {
              bytes: decodeBase64(audioBase64),
              mimeType: "audio/wav",
              model,
              voice: label,
            };
          }
          break;
        } catch (error) {
          lastError = error;
          if (error?.needsKeyFix) throw error;
          if (useHints && (error?.status === 400 || error?.status === 422) && !isVoiceRejectionError(error)) {
            useHints = false;
            continue;
          }
          if (isVoiceRejectionError(error)) break;
          return null;
        }
      }
    }
    return null;
  }

  for (const model of candidateModels) {
    const res = await tryModel(model);
    if (res) return res;
  }

  const discovered = await listAvailableTtsModels(key);
  for (const model of discovered) {
    const res = await tryModel(model);
    if (res) return res;
  }

  throw lastError ?? new Error("Mistral did not return pronunciation audio.");
}
