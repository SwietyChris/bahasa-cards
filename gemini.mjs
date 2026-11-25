const apiBase = "https://generativelanguage.googleapis.com/v1beta";
const interactionsUrl = `${apiBase}/interactions`;
const cooldownKey = "bahasa-cards:gemini-tts-cooldowns:v1";
const resolvedTextModels = new Map();
let resolvedTtsRoute = null;

export const geminiVoices = [
  { id: "Sulafat", label: "Sulafat · Warm" },
  { id: "Kore", label: "Kore · Clear" },
  { id: "Aoede", label: "Aoede · Breezy" },
  { id: "Achird", label: "Achird · Friendly" },
  { id: "Leda", label: "Leda · Youthful" },
  { id: "Charon", label: "Charon · Informative" },
  { id: "Puck", label: "Puck · Upbeat" },
];

export const textModels = [
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (fastest, recommended)" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash (balanced)" },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (deepest, slower)" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
];

export const ttsModels = [
  { id: "gemini-3.8-flash-lite-tts", label: "Gemini 3.8 Flash-Lite TTS (fast)" },
  { id: "gemini-3.8-flash-tts", label: "Gemini 3.8 Flash TTS (studio)" },
  { id: "gemini-3.1-flash-tts-preview", label: "Gemini 3.1 Flash TTS Preview" },
  { id: "gemini-2.5-flash-preview-tts", label: "Gemini 2.5 Flash TTS Preview" },
];

function cleanKey(value) {
  return typeof value === "string" ? value.trim().replace(/^["']+|["']+$/g, "").trim() : "";
}

export function clearGeminiCaches({ clearCooldowns = false } = {}) {
  resolvedTextModels.clear();
  resolvedTtsRoute = null;
  if (clearCooldowns) {
    try { localStorage.removeItem(cooldownKey); } catch {}
  }
}

function readTtsCooldowns() {
  try {
    const raw = JSON.parse(localStorage.getItem(cooldownKey) ?? "{}");
    const now = Date.now();
    const active = {};
    for (const [model, until] of Object.entries(raw || {})) {
      if (typeof until === "number" && until > now) active[model] = until;
    }
    return active;
  } catch {
    return {};
  }
}

function isTtsModelCooledDown(model) {
  const active = readTtsCooldowns();
  return typeof active[model] === "number" && active[model] > Date.now();
}

function parseRetryDelayMs(message) {
  const match = /retry in\s+(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/i.exec(message || "");
  if (match && (match[1] || match[2] || match[3])) {
    const ms = ((Number(match[1] || 0) * 3600) + (Number(match[2] || 0) * 60) + Number(match[3] || 0)) * 1000;
    if (ms > 0) return Math.min(ms, 12 * 3600 * 1000);
  }
  if (/per day|daily/i.test(message || "")) return 6 * 3600 * 1000;
  return 60 * 1000;
}

function recordTtsCooldown(model, message) {
  const active = readTtsCooldowns();
  active[model] = Date.now() + parseRetryDelayMs(message);
  try { localStorage.setItem(cooldownKey, JSON.stringify(active)); } catch {}
}

function extractApiError(payload) {
  const record = Array.isArray(payload) ? payload[0] : payload;
  return record?.error?.message || payload?.error?.message || "";
}

function buildHttpError(status, payload) {
  const serverMessage = extractApiError(payload);
  const error = new Error();
  error.status = status;
  if (status === 400 && /api key/i.test(serverMessage)) {
    error.message = `Invalid Gemini API key: ${serverMessage}`;
    error.needsKeyFix = true;
  } else if (status === 401 || status === 403) {
    error.message = serverMessage
      ? `Gemini rejected the API key (${status}): ${serverMessage}`
      : `Gemini rejected this API key (${status}). Check key restrictions in Google AI Studio.`;
    error.needsKeyFix = true;
  } else if (status === 429) {
    error.message = serverMessage
      ? `Rate limit reached: ${serverMessage}`
      : "Gemini rate limit reached. Wait a few seconds and try again.";
  } else {
    error.message = serverMessage || `Gemini request failed (${status}).`;
  }
  return error;
}

async function fetchGeminiJson(url, apiKey, options = {}, timeoutMs = 60000) {
  const key = cleanKey(apiKey);
  if (!key) {
    const err = new Error("Add your Gemini API key in AI & Voice settings first.");
    err.needsKeyFix = true;
    throw err;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("You appear to be offline. Connect to the internet to use Gemini.");
  }
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        "x-goog-api-key": key,
        ...(options.headers ?? {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error?.name === "TimeoutError") {
      throw new Error("Gemini took too long to respond. Try switching Coach model to Gemini 3.5 Flash-Lite in AI & Voice settings, or try again.");
    }
    throw new Error("Could not reach Gemini. Check your connection and try again.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw buildHttpError(response.status, payload);
  return payload;
}

async function listAvailableFlashModels(apiKey) {
  try {
    const payload = await fetchGeminiJson(`${apiBase}/models?pageSize=100`, apiKey, { method: "GET" }, 15000);
    const models = Array.isArray(payload?.models) ? payload.models : [];
    return models
      .filter(model =>
        Array.isArray(model.supportedGenerationMethods)
        && model.supportedGenerationMethods.includes("generateContent")
        && /gemini/i.test(model.name)
        && !/tts|image|embedding|live/i.test(model.name),
      )
      .map(model => model.name.replace(/^models\//, ""));
  } catch {
    return [];
  }
}

async function listAvailableTtsModels(apiKey) {
  try {
    const payload = await fetchGeminiJson(`${apiBase}/models?pageSize=100`, apiKey, { method: "GET" }, 15000);
    const models = Array.isArray(payload?.models) ? payload.models : [];
    return models
      .filter(model =>
        Array.isArray(model.supportedGenerationMethods)
        && model.supportedGenerationMethods.includes("generateContent")
        && /tts/i.test(model.name),
      )
      .map(model => model.name.replace(/^models\//, ""));
  } catch {
    return [];
  }
}

function isModelUnavailableError(error) {
  return error?.status === 404 || /not found|not supported for generatecontent|unknown model/i.test(error?.message ?? "");
}

function thinkingConfigForModel(modelId) {
  if (/^gemini-3\.8-/i.test(modelId) || /^gemini-4/i.test(modelId) || (/^gemini-3/i.test(modelId) && /pro/i.test(modelId))) {
    return { thinkingConfig: { thinkingLevel: "LOW" } };
  }
  if (/^gemini-(?:3|5|6|7|8|9)/i.test(modelId)) {
    return { thinkingConfig: { thinkingLevel: "MINIMAL" } };
  }
  if (/^gemini-2\.5-flash/i.test(modelId)) {
    return { thinkingConfig: { thinkingBudget: 0 } };
  }
  return {};
}

function extractCandidateText(payload) {
  const candidate = payload?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const text = parts.filter(part => typeof part?.text === "string" && !part.thought).map(part => part.text).join("").trim();
  if (text) return text;
  const fallback = parts.filter(part => typeof part?.text === "string").map(part => part.text).join("").trim();
  if (fallback) return fallback;
  const finishReason = candidate?.finishReason || payload?.promptFeedback?.blockReason;
  if (finishReason && finishReason !== "STOP") {
    throw new Error(`Gemini stopped early (${finishReason}). Try rephrasing slightly.`);
  }
  return "";
}

async function generateWithFallback(apiKey, preferredModel, makeRequestBody, timeoutMs = 60000) {
  const key = cleanKey(apiKey);
  const cacheKey = `${key}:${preferredModel}`;
  const cached = resolvedTextModels.get(cacheKey);
  const tried = new Set();
  const initialQueue = [cached, preferredModel, ...textModels.map(m => m.id)].filter(Boolean);
  let lastError;

  async function tryModels(list) {
    for (const model of list) {
      if (!model || tried.has(model)) continue;
      tried.add(model);
      try {
        const payload = await fetchGeminiJson(
          `${apiBase}/models/${encodeURIComponent(model)}:generateContent`,
          key,
          { method: "POST", body: JSON.stringify(makeRequestBody(model)) },
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

  let result = await tryModels(initialQueue);
  if (!result && isModelUnavailableError(lastError)) {
    const discovered = await listAvailableFlashModels(key);
    const preferred = discovered.filter(name => /flash-lite|flash/i.test(name)).concat(discovered);
    result = await tryModels(preferred);
  }
  if (!result) throw lastError ?? new Error("No compatible Gemini text model was available.");
  return result;
}

export async function testGeminiConnection(candidateKey, preferredModel = "gemini-3.5-flash-lite") {
  const key = cleanKey(candidateKey);
  const started = performance.now();
  const { model, payload } = await generateWithFallback(
    key,
    preferredModel,
    targetModel => ({
      contents: [{ role: "user", parts: [{ text: "Reply with just: OK" }] }],
      generationConfig: {
        maxOutputTokens: 32,
        ...thinkingConfigForModel(targetModel),
      },
    }),
    20000,
  );
  const text = extractCandidateText(payload);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  return { ok: Boolean(text || payload?.candidates?.length), model, text, seconds };
}

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function outputBlocks(interaction, blockType) {
  const steps = Array.isArray(interaction?.steps) ? interaction.steps : [];
  const blocks = [];
  for (const step of steps) {
    if (step?.type && step.type !== "model_output") continue;
    for (const content of step?.content ?? []) {
      if (content?.type === blockType) blocks.push(content);
    }
  }
  if (!blocks.length && Array.isArray(interaction?.outputs)) {
    for (const content of interaction.outputs) {
      if (content?.type === blockType) blocks.push(content);
    }
  }
  return blocks;
}

function extractInteractionAudio(interaction) {
  const audio = outputBlocks(interaction, "audio");
  const last = audio.length ? audio[audio.length - 1] : null;
  return last?.data ? { data: last.data, mimeType: last.mime_type || "audio/wav" } : null;
}

function extractGenerateContentAudio(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = part?.inlineData || part?.inline_data;
    if (inline?.data) {
      return { data: inline.data, mimeType: inline.mimeType || inline.mime_type || "audio/wav" };
    }
  }
  return null;
}

export async function generateGeminiSpeech(text, {
  apiKey,
  ttsModel = "gemini-3.8-flash-lite-tts",
  ttsVoice = "Sulafat",
  slow = false,
} = {}) {
  const key = cleanKey(apiKey);
  if (!key) {
    const err = new Error("Add your Gemini API key in AI & Voice settings first.");
    err.needsKeyFix = true;
    throw err;
  }
  const style = slow ? "Speak slowly and clearly in natural Indonesian." : "";
  const baseModels = [...new Set([
    resolvedTtsRoute?.model,
    ttsModel,
    ...ttsModels.map(m => m.id),
  ].filter(Boolean))];
  let lastError;
  const triedModels = new Set();

  async function tryInteractionTts(model) {
    const contentItem = style
      ? { type: "text", text, annotations: [{ type: "speech_metadata", style }] }
      : { type: "text", text };
    const payload = await fetchGeminiJson(interactionsUrl, key, {
      method: "POST",
      body: JSON.stringify({
        model,
        input: [{ type: "user_input", content: [contentItem] }],
        response_format: { type: "audio" },
        generation_config: {
          speech_config: [{ voice: ttsVoice }],
        },
      }),
    }, 25000);
    const audio = extractInteractionAudio(payload);
    if (audio?.data) {
      resolvedTtsRoute = { kind: "interactions", model };
      return { bytes: decodeBase64(audio.data), mimeType: audio.mimeType, model, voice: ttsVoice };
    }
    return null;
  }

  async function tryGenerateContentTts(model) {
    const isGemini38 = /^gemini-3\.8/i.test(model);
    const part = style && isGemini38
      ? { text, speech_metadata: { style } }
      : {
          text: slow && !isGemini38
            ? `Read this Indonesian phrase slowly and clearly without adding any extra words: ${text}`
            : text,
        };
    const payload = await fetchGeminiJson(
      `${apiBase}/models/${encodeURIComponent(model)}:generateContent`,
      key,
      {
        method: "POST",
        body: JSON.stringify({
          contents: [{ role: "user", parts: [part] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: ttsVoice },
              },
            },
          },
        }),
      },
      25000,
    );
    const audio = extractGenerateContentAudio(payload);
    if (audio?.data) {
      resolvedTtsRoute = { kind: "generateContent", model };
      return { bytes: decodeBase64(audio.data), mimeType: audio.mimeType, model, voice: ttsVoice };
    }
    return null;
  }

  async function tryModel(model) {
    if (!model || triedModels.has(model) || isTtsModelCooledDown(model)) return null;
    triedModels.add(model);
    const first = resolvedTtsRoute?.kind === "generateContent" && resolvedTtsRoute.model === model
      ? [tryGenerateContentTts, tryInteractionTts]
      : [tryInteractionTts, tryGenerateContentTts];
    for (const attempt of first) {
      try {
        const res = await attempt(model);
        if (res) return res;
      } catch (error) {
        lastError = error;
        if (error?.needsKeyFix) throw error;
        if (error?.status === 429) {
          recordTtsCooldown(model, error.message);
          break;
        }
      }
    }
    return null;
  }

  for (const model of baseModels) {
    const res = await tryModel(model);
    if (res) return res;
  }

  const discovered = await listAvailableTtsModels(key);
  for (const model of discovered) {
    if (triedModels.has(model)) continue;
    const res = await tryModel(model);
    if (res) return res;
  }

  if (!lastError && baseModels.every(isTtsModelCooledDown)) {
    throw new Error("All free-tier Gemini voice models hit their daily or per-minute limit. Resets later today, or switch AI provider to Mistral AI.");
  }
  throw lastError ?? new Error("Gemini did not return pronunciation audio.");
}

export async function coachWithGemini({
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
  const contents = [
    ...recentHistory,
    { role: "user", parts: [{ text: promptText }] },
  ];
  const systemPart = { parts: [{ text: systemInstruction }] };

  let response;
  try {
    response = await generateWithFallback(
      key,
      model,
      targetModel => ({
        systemInstruction: systemPart,
        contents,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
          ...thinkingConfigForModel(targetModel),
        },
      }),
      60000,
    );
  } catch (error) {
    if (error?.status === 400 && !error?.needsKeyFix) {
      response = await generateWithFallback(
        key,
        model,
        () => ({
          systemInstruction: {
            parts: [{
              text: systemInstruction
                + '\nRespond ONLY as valid JSON with keys: "badge", "reply", "corrected_indonesian", "corrected_english", "bali_context", "examples" (array of {indonesian, english, note}).',
            }],
          },
          contents,
        }),
        60000,
      );
    } else {
      throw error;
    }
  }

  const rawText = extractCandidateText(response.payload);
  if (!rawText) throw new Error("Gemini returned an empty response. Try again.");
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
