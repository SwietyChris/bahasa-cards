import {
  aiProviders,
  activeAiKey,
  coachCardPractice,
  fetchProviderVoices,
  getAiSettings,
  getProviderMeta,
  hasAiKey,
  providerLabel,
  saveAiSettings,
  testAiConnection,
} from "./ai.mjs?v=15";
import { listIndonesianVoices } from "./speech.mjs?v=15";
import { connection } from "./sync.mjs?v=15";

export function createTutorUI(element, { speakText, stopSpeech, getSlow, onSlowToggle, cardNavigation, navigateCard }) {
  const practiceDialog = element("practice-dialog");
  const aiDialog = element("ai-dialog");
  const thread = element("practice-thread");
  const practiceInput = element("practice-input");
  const practiceStatus = element("practice-status");
  const resetBtn = element("practice-reset");

  let state = { card: null, history: [], busy: false };
  const conversations = new Map();
  let activeModalProvider = getAiSettings().provider;
  let draftKeys = { gemini: "", mistral: "" };
  let voiceFetchToken = 0;

  function syncProviderLabels() {
    const label = providerLabel();
    const studyBtn = element("practice-card");
    if (studyBtn) studyBtn.textContent = `Practice with ${label}`;
    element("practice-title").textContent = `Practice with ${label}`;
    element("practice-send").textContent = `Check with ${label}`;
  }

  function populateSelect(select, options, selectedValue) {
    select.replaceChildren(...options.map(opt => new Option(opt.label, opt.id)));
    if (selectedValue && options.some(opt => opt.id === selectedValue)) {
      select.value = selectedValue;
    } else if (options.length) {
      select.value = options[0].id;
    }
  }

  async function refreshMistralVoices(key, selectedVoice) {
    if (!key) return;
    const token = ++voiceFetchToken;
    try {
      const voices = await fetchProviderVoices("mistral", key);
      if (token !== voiceFetchToken || activeModalProvider !== "mistral") return;
      populateSelect(element("ai-tts-voice"), voices, selectedVoice || element("ai-tts-voice").value);
    } catch { /* Ignore background voice refresh failures. */ }
  }

  function syncKeyToggle() {
    const input = element("ai-api-key");
    const toggle = element("ai-toggle-key");
    const hasDraft = Boolean(input.value);
    toggle.hidden = !hasDraft;
    if (!hasDraft) {
      input.type = "password";
      toggle.textContent = "Show";
    }
  }

  function syncSavedKeyHint(provider, settings = getAiSettings()) {
    const meta = getProviderMeta(provider);
    const hasSaved = Boolean(settings[meta.keyField]);
    element("ai-key-saved").hidden = !hasSaved;
    element("ai-api-key").placeholder = hasSaved
      ? "•••••••••••••••• (saved on this device — paste new key to replace)"
      : meta.keyPlaceholder;
    syncKeyToggle();
  }

  function applyProviderToAiForm(provider, settings = getAiSettings()) {
    activeModalProvider = provider;
    const meta = getProviderMeta(provider);
    element("ai-provider").value = provider;
    element("ai-key-help").textContent = meta.keyHelp;
    const shared = !!connection()?.token;
    element("ai-provider").disabled = shared;
    element("ai-local-key").hidden = shared;
    element("ai-shared-key").hidden = !shared;
    element("ai-clear-local").hidden = !(shared && connection()?.mistralReady && settings.mistralApiKey);
    if (shared) element("ai-key-help").textContent = "";
    element("ai-api-key-label").textContent = meta.keyLabel;
    element("ai-api-key").value = draftKeys[provider] ?? "";
    syncSavedKeyHint(provider, settings);
    const getLink = element("ai-get-key");
    getLink.href = meta.keyUrl;
    getLink.textContent = meta.keyLinkLabel;

    populateSelect(element("ai-tts-voice"), meta.voices, settings[meta.ttsVoiceField]);
    populateSelect(element("ai-tts-model"), meta.ttsModels, settings[meta.ttsModelField]);
    populateSelect(element("ai-text-model"), meta.textModels, settings[meta.textModelField]);

    const effectiveMistralKey = draftKeys.mistral?.trim() || activeAiKey({ ...settings, provider: "mistral" });
    if (provider === "mistral" && effectiveMistralKey) {
      refreshMistralVoices(effectiveMistralKey, settings[meta.ttsVoiceField]);
    }
  }

  function syncAiDialogFromStorage() {
    const settings = getAiSettings();
    draftKeys = { gemini: "", mistral: "" };
    populateSelect(element("ai-provider"), aiProviders, settings.provider);
    element("ai-voice-mode").value = settings.voiceMode;
    element("ai-speech-speed").value = settings.speechSpeed;
    element("ai-local-focus").value = settings.localFocus;
    applyProviderToAiForm(settings.provider, settings);
  }

  function updateDeviceVoiceInfo() {
    const voices = listIndonesianVoices();
    const info = element("ai-device-voice-info");
    if (!("speechSynthesis" in window)) {
      info.textContent = "Built-in browser speech is not supported here.";
    } else if (voices.length) {
      info.textContent = `Device Indonesian voice ready (${voices[0].name}).`;
    } else {
      info.textContent = "No Indonesian voice detected in this browser (device fallback sounds robotic). Edge includes free Natural Indonesian voices.";
    }
  }

  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.addEventListener("voiceschanged", updateDeviceVoiceInfo);
  }

  function syncPracticeSetupProvider(provider) {
    const meta = getProviderMeta(provider);
    element("practice-provider").value = provider;
    element("practice-key-label").textContent = meta.keyLabel;
    element("practice-key-input").placeholder = meta.keyPlaceholder;
    const link = element("practice-key-link");
    link.href = meta.keyUrl;
    link.textContent = meta.keyLinkLabel;
  }

  function syncPracticeMode() {
    const settings = getAiSettings();
    const ready = hasAiKey();
    syncProviderLabels();
    element("practice-setup").hidden = ready;
    element("practice-workspace").hidden = !ready;
    const shared = !!connection()?.token;
    element("practice-local-setup").hidden = shared;
    element("practice-setup-copy").textContent = shared
      ? "The administrator is setting up Mistral. Your cards are ready to study."
      : "Connect your Mistral AI or Google Gemini API key to get sentence feedback, AI pronunciation, and local Bali context.";
    element("practice-setup-status").classList.remove("error");
    element("practice-setup-status").textContent = "";
    element("practice-key-input").value = "";
    populateSelect(element("practice-provider"), aiProviders, settings.provider);
    syncPracticeSetupProvider(settings.provider);
  }

  function makeListenButton(text) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pill-button compact-pill";
    button.textContent = "🔊 Listen";
    button.addEventListener("click", () => speakText(text, button, practiceStatus));
    return button;
  }

  function appendUserTurn(label) {
    const bubble = document.createElement("div");
    bubble.className = "practice-turn practice-user";
    bubble.textContent = label;
    thread.append(bubble);
    bubble.scrollIntoView({ block: "nearest" });
  }

  function appendCoachTurn(result) {
    const card = document.createElement("div");
    card.className = "practice-turn practice-coach";

    const badge = document.createElement("span");
    badge.className = "practice-badge";
    badge.textContent = result.badge || "Coach Reply";
    card.append(badge);

    if (result.corrected_indonesian) {
      const box = document.createElement("div");
      box.className = "practice-correction";
      const row = document.createElement("div");
      row.className = "practice-phrase-row";
      const phrase = document.createElement("strong");
      phrase.lang = "id";
      phrase.textContent = result.corrected_indonesian;
      row.append(phrase, makeListenButton(result.corrected_indonesian));
      box.append(row);
      if (result.corrected_english) {
        const gloss = document.createElement("p");
        gloss.className = "practice-gloss";
        gloss.textContent = result.corrected_english;
        box.append(gloss);
      }
      card.append(box);
    }

    if (result.reply) {
      const reply = document.createElement("p");
      reply.className = "practice-reply";
      reply.textContent = result.reply;
      card.append(reply);
    }

    if (result.bali_context) {
      const bali = document.createElement("div");
      bali.className = "practice-bali";
      const heading = document.createElement("strong");
      heading.textContent = getAiSettings().localFocus + " context";
      const body = document.createElement("p");
      body.textContent = result.bali_context;
      bali.append(heading, body);
      card.append(bali);
    }

    if (result.examples?.length) {
      const list = document.createElement("ul");
      list.className = "practice-examples";
      for (const ex of result.examples) {
        const item = document.createElement("li");
        const row = document.createElement("div");
        row.className = "practice-phrase-row";
        const idLine = document.createElement("strong");
        idLine.lang = "id";
        idLine.textContent = ex.indonesian;
        row.append(idLine, makeListenButton(ex.indonesian));
        const enLine = document.createElement("p");
        enLine.textContent = ex.note ? `${ex.english} · ${ex.note}` : ex.english;
        item.append(row, enLine);
        list.append(item);
      }
      card.append(list);
    }

    thread.append(card);
    card.scrollIntoView({ block: "nearest" });
  }

  function appendErrorTurn(error, retryFn) {
    const label = providerLabel();
    const box = document.createElement("div");
    box.className = "practice-turn practice-error";
    const title = document.createElement("strong");
    title.textContent = `Could not get ${label} reply`;
    const msg = document.createElement("p");
    msg.textContent = error?.message || `Something went wrong calling ${label}.`;
    const actions = document.createElement("div");
    actions.className = "library-actions";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "pill-button compact-pill";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => {
      box.remove();
      retryFn();
    });
    const settingsBtn = document.createElement("button");
    settingsBtn.type = "button";
    settingsBtn.className = "text-button";
    settingsBtn.textContent = "AI & Voice settings";
    settingsBtn.addEventListener("click", () => {
      practiceDialog.close();
      openAiSettings();
    });
    actions.append(retry, settingsBtn);
    box.append(title, msg, actions);
    thread.append(box);
    box.scrollIntoView({ block: "nearest" });
  }

  function updateCardNavigation() {
    const navigation = cardNavigation();
    element("practice-previous").disabled = state.busy || !navigation.previous;
    element("practice-following").disabled = state.busy || !navigation.next;
  }

  function setBusy(busy, label = "") {
    state.busy = busy;
    practiceStatus.classList.remove("error");
    practiceStatus.textContent = label;
    for (const id of ["practice-send", "practice-ask-bali", "practice-ask-examples", "practice-reset"]) {
      element(id).disabled = busy;
    }
    updateCardNavigation();
  }

  async function runPractice(mode, userText = "", label = "", { skipUserBubble = false } = {}) {
    if (!state.card || state.busy) return;
    const requestState = state;
    const labelProvider = providerLabel();
    const isFollowup = state.history.length > 0;
    const effectiveMode = isFollowup && mode === "sentence" ? "followup" : mode;
    if (!skipUserBubble) appendUserTurn(label || userText);
    const pendingBubble = document.createElement("div");
    pendingBubble.className = "practice-turn practice-coach practice-loading";
    pendingBubble.textContent = `Asking ${labelProvider}…`;
    thread.append(pendingBubble);
    pendingBubble.scrollIntoView({ block: "nearest" });
    setBusy(true, `Asking ${labelProvider}…`);
    try {
      const response = await coachCardPractice({
        card: requestState.card,
        mode: effectiveMode,
        userText,
        history: requestState.history,
      });
      if (state !== requestState) return;
      if (Array.isArray(response.history)) {
        state.history = response.history;
        resetBtn.hidden = !state.history.length;
      }
      pendingBubble.remove();
      appendCoachTurn(response.result);
      practiceStatus.textContent = "";
    } catch (error) {
      if (state !== requestState) return;
      pendingBubble.remove();
      practiceStatus.classList.add("error");
      practiceStatus.textContent = error.message;
      appendErrorTurn(error, () => runPractice(mode, userText, label, { skipUserBubble: true }));
    } finally {
      pendingBubble.remove();
      if (state === requestState) {
        setBusy(false);
        if (practiceDialog.open) practiceInput.focus();
      } else {
        requestState.busy = false;
      }
    }
  }

  function resetConversation() {
    state.history = [];
    thread.replaceChildren();
    resetBtn.hidden = true;
    practiceStatus.classList.remove("error");
    practiceStatus.textContent = "";
  }

  function openPractice(card) {
    if (!card) return;
    stopSpeech();
    if (state.card?.id !== card.id) {
      if (state.card) {
        state.nodes = [...thread.childNodes];
        state.input = practiceInput.value;
        conversations.set(state.card.id, state);
      }
      state = conversations.get(card.id) ?? { card, history: [], busy: false };
      state.card = card;
      thread.replaceChildren(...(state.nodes ?? []));
      resetBtn.hidden = !state.history.length;
      practiceInput.value = state.input ?? "";
    }
    practiceStatus.classList.remove("error");
    practiceStatus.textContent = "";
    element("practice-id-word").textContent = card.indonesian;
    element("practice-en-word").textContent = card.english;
    element("practice-speak-slow").setAttribute("aria-pressed", String(getSlow()));
    syncPracticeMode();
    setBusy(state.busy, state.busy ? `Asking ${providerLabel()}…` : "");
    if (!practiceDialog.open) practiceDialog.showModal();
    if (hasAiKey()) practiceInput.focus();
    else element("practice-key-input").focus();
  }

  for (const [id, offset] of [["practice-previous", -1], ["practice-following", 1]]) {
    element(id).addEventListener("click", () => {
      if (state.busy) return;
      const card = navigateCard(offset);
      if (card) openPractice(card);
    });
  }

  function openAiSettings() {
    stopSpeech();
    syncAiDialogFromStorage();
    updateDeviceVoiceInfo();
    element("ai-status").classList.remove("error", "ok");
    element("ai-status").textContent = "";
    element("ai-api-key").type = "password";
    element("ai-toggle-key").textContent = "Show";
    aiDialog.showModal();
  }

  function maskSavedInputs(provider, saved) {
    draftKeys[provider] = "";
    element("ai-api-key").value = "";
    syncSavedKeyHint(provider, saved);
  }

  function readAiFormValues() {
    const current = getAiSettings();
    const provider = element("ai-provider").value === "gemini" ? "gemini" : "mistral";
    const meta = getProviderMeta(provider);
    draftKeys[provider] = element("ai-api-key").value;
    const typedGemini = draftKeys.gemini.trim();
    const typedMistral = draftKeys.mistral.trim();
    const typedCurrent = element("ai-api-key").value.trim();
    return {
      provider,
      voiceMode: element("ai-voice-mode").value,
      speechSpeed: element("ai-speech-speed").value,
      localFocus: element("ai-local-focus").value,
      geminiApiKey: typedGemini || current.geminiApiKey,
      mistralApiKey: typedMistral || current.mistralApiKey,
      [meta.keyField]: typedCurrent || current[meta.keyField],
      [meta.ttsVoiceField]: element("ai-tts-voice").value,
      [meta.ttsModelField]: element("ai-tts-model").value,
      [meta.textModelField]: element("ai-text-model").value,
    };
  }

  element("practice-close").addEventListener("click", () => { stopSpeech(); practiceDialog.close(); });
  practiceDialog.addEventListener("close", stopSpeech);
  element("practice-speak").addEventListener("click", () => {
    if (state.card) speakText(state.card.indonesian, element("practice-speak"), practiceStatus);
  });
  element("practice-speak-slow").addEventListener("click", () => onSlowToggle());
  element("practice-open-ai").addEventListener("click", () => {
    practiceDialog.close();
    openAiSettings();
  });
  element("practice-provider").addEventListener("change", event => {
    const provider = event.target.value === "gemini" ? "gemini" : "mistral";
    syncPracticeSetupProvider(provider);
    element("practice-setup-status").classList.remove("error");
    element("practice-setup-status").textContent = "";
  });
  element("practice-key-save").addEventListener("click", async () => {
    const provider = element("practice-provider").value === "gemini" ? "gemini" : "mistral";
    const meta = getProviderMeta(provider);
    const key = element("practice-key-input").value.trim();
    const status = element("practice-setup-status");
    status.classList.remove("error");
    if (!key) {
      status.classList.add("error");
      status.textContent = `Paste a ${meta.keyLabel} first.`;
      element("practice-key-input").focus();
      return;
    }
    const button = element("practice-key-save");
    button.disabled = true;
    status.textContent = `Checking ${meta.name} key…`;
    try {
      await testAiConnection(provider, key);
      saveAiSettings({ provider, [meta.keyField]: key });
      syncPracticeMode();
      practiceInput.focus();
    } catch (error) {
      status.classList.add("error");
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  element("practice-ask-bali").addEventListener("click", () => {
    runPractice("bali", "", "How do locals use this in Bali?");
  });
  element("practice-ask-examples").addEventListener("click", () => {
    runPractice("examples", "", "Show 3 everyday examples");
  });
  resetBtn.addEventListener("click", () => {
    resetConversation();
    practiceInput.focus();
  });
  element("practice-form").addEventListener("submit", event => {
    event.preventDefault();
    const text = practiceInput.value.trim();
    if (!text || state.busy) {
      practiceInput.focus();
      return;
    }
    practiceInput.value = "";
    runPractice("sentence", text, text);
  });
  practiceInput.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      element("practice-form").requestSubmit();
    }
  });

  element("ai-close").addEventListener("click", () => { stopSpeech(); aiDialog.close(); });
  aiDialog.addEventListener("close", stopSpeech);
  element("ai-provider").addEventListener("change", event => {
    draftKeys[activeModalProvider] = element("ai-api-key").value;
    const nextProvider = event.target.value === "gemini" ? "gemini" : "mistral";
    element("ai-status").classList.remove("error", "ok");
    element("ai-status").textContent = "";
    applyProviderToAiForm(nextProvider);
  });
  element("ai-api-key").addEventListener("input", syncKeyToggle);
  element("ai-toggle-key").addEventListener("click", () => {
    const input = element("ai-api-key");
    if (!input.value) return;
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    element("ai-toggle-key").textContent = reveal ? "Hide" : "Show";
  });
  element("ai-test-voice").addEventListener("click", () => {
    const values = readAiFormValues();
    const saved = saveAiSettings(values);
    maskSavedInputs(values.provider, saved);
    syncProviderLabels();
    if (values.provider === "mistral" && activeAiKey(saved)) {
      refreshMistralVoices(activeAiKey(saved), saved.mistralTtsVoice);
    }
    speakText("Selamat pagi, apa kabar?", element("ai-test-voice"), element("ai-status"));
  });
  element("ai-test-key").addEventListener("click", async () => {
    const status = element("ai-status");
    const button = element("ai-test-key");
    const values = readAiFormValues();
    const saved = saveAiSettings(values);
    maskSavedInputs(values.provider, saved);
    syncProviderLabels();
    const meta = getProviderMeta(values.provider);
    const key = activeAiKey(saved);
    if (!key) {
      status.classList.add("error");
      status.textContent = `Enter a ${meta.keyLabel} first to test the connection.`;
      element("ai-api-key").focus();
      return;
    }
    button.disabled = true;
    status.classList.remove("error", "ok");
    status.textContent = `Testing ${meta.name} connection…`;
    try {
      const info = await testAiConnection(values.provider, key);
      if (values.provider === "mistral") {
        await refreshMistralVoices(key, saved.mistralTtsVoice);
      }
      status.classList.add("ok");
      status.textContent = `Connected to ${meta.name} using ${info.model} (${info.seconds}s)! Voice and Bali Practice Coach are ready.`;
    } catch (error) {
      status.classList.add("error");
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  element("ai-clear-key").addEventListener("click", () => {
    const provider = element("ai-provider").value === "gemini" ? "gemini" : "mistral";
    const meta = getProviderMeta(provider);
    element("ai-api-key").value = "";
    draftKeys[provider] = "";
    const saved = saveAiSettings({ provider, [meta.keyField]: "" });
    maskSavedInputs(provider, saved);
    syncProviderLabels();
    element("ai-status").classList.remove("error", "ok");
    element("ai-status").textContent = `${meta.name} API key removed from this browser. Device voice remains available.`;
    if (practiceDialog.open) syncPracticeMode();
  });
  element("ai-clear-local").addEventListener("click", () => {
    if (!connection()?.mistralReady) return;
    const saved = saveAiSettings({ mistralApiKey: "" });
    applyProviderToAiForm("mistral", saved);
    element("ai-status").textContent = "The old device key was removed. The shared Mistral service is still available.";
    element("ai-status").classList.add("ok");
  });
  element("ai-form").addEventListener("submit", event => {
    event.preventDefault();
    const values = readAiFormValues();
    const saved = saveAiSettings(values);
    maskSavedInputs(values.provider, saved);
    syncProviderLabels();
    aiDialog.close();
    if (practiceDialog.open) syncPracticeMode();
  });

  syncProviderLabels();

  return {
    openPractice,
    openAiSettings,
    syncProviderLabels,
    syncSlowButtons(slow) {
      element("practice-speak-slow").setAttribute("aria-pressed", String(slow));
    },
  };
}
