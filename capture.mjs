import { normalizeCards } from "./cards.mjs";
import { saveDownload } from "./exports.mjs";

const sideCodes = ["id", "en"];
const cardRatio = 85 / 55;
const equivalentLetters = {
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P",
  С: "C", Т: "T", Х: "X", а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x",
};

function cardFrame(width, height) {
  const frameWidth = Math.min(width * 0.85, height * 0.84 * cardRatio);
  const frameHeight = frameWidth / cardRatio;
  return { x: (width - frameWidth) / 2, y: (height - frameHeight) / 2, width: frameWidth, height: frameHeight };
}

function jpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("The photo could not be prepared."));
    }, "image/jpeg", 0.92);
  });
}

async function preparePhoto(source, width, height, area = { x: 0, y: 0, width, height }) {
  if (width < 1 || height < 1) throw new Error("Wait for the camera preview to become ready.");
  const scale = Math.min(1, 1600 / Math.max(area.width, area.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(area.width * scale));
  canvas.height = Math.max(1, Math.round(area.height * scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
  return jpeg(canvas);
}

function readSuggestion(lines, side) {
  const entries = [...lines].sort((first, second) => first.top - second.top || first.left - second.left);
  let deck = "";
  if (side === "en") {
    const markIndex = entries.findIndex(entry => /^#?\s*[1-9]\d*\.?$/.test(entry.text.trim()));
    if (markIndex >= 0) {
      deck = entries[markIndex].text.match(/\d+/)[0];
      entries.splice(markIndex, 1);
    }
  }
  const text = entries.map(entry => entry.text.trim()).filter(Boolean).join("\n");
  return {
    text: /[a-z]/i.test(text) ? text.replace(/[АВЕКМНОРСТХаеорсух]/gu, letter => equivalentLetters[letter]) : text,
    deck,
  };
}

export function setupCapture(element, saveCard) {
  const video = element("camera-video");
  const frame = element("camera-frame");
  const picker = element("camera-select");
  const cameraStatus = element("camera-status");
  const formStatus = element("capture-status");
  const deck = element("capture-deck");
  const archive = element("photo-archive");
  const keepPhotos = element("keep-photos");
  const sides = Object.fromEntries(sideCodes.map(code => [code, {
    input: element(`${code}-text`),
    photo: element(`${code}-photo`),
    shutter: element(`${code}-snap`),
    file: element(`${code}-file`),
    ticket: 0,
    suggestion: "",
  }]));
  let editedId = null;
  let draftId = "";
  let stream = null;
  let cameraTicket = 0;
  let deckSuggestion = "";
  const loopback = ["127.0.0.1", "localhost"].includes(location.hostname);
  const mac = loopback
    ? fetch("./api/recognition").then(response => response.ok ? response.json() : {}).catch(() => ({}))
    : Promise.resolve({});

  async function photoBundle() {
    const zip = new globalThis.JSZip();
    if (sides.id.blob) zip.file("indonesian.jpg", sides.id.blob);
    if (sides.en.blob) zip.file("english.jpg", sides.en.blob);
    return zip.generateAsync({ type: "blob", mimeType: "application/zip" });
  }

  function photoPrefix(cardDeck) {
    return /^\d+$/.test(String(cardDeck)) ? `deck-${cardDeck}-` : "";
  }

  function cameraButtons(ready) {
    for (const side of Object.values(sides)) side.shutter.disabled = !ready;
  }

  function stopCamera() {
    cameraTicket += 1;
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
    frame.hidden = true;
    element("camera-start").hidden = false;
    element("camera-start").disabled = false;
    element("camera-stop").hidden = true;
    element("camera-field").hidden = true;
    cameraStatus.textContent = "";
    cameraButtons(false);
  }

  async function startCamera(deviceId) {
    stopCamera();
    const ticket = cameraTicket;
    if (!navigator.mediaDevices?.getUserMedia) {
      cameraStatus.textContent = "To use the camera, open this app on the Mac or over HTTPS. You can also choose photos.";
      return;
    }
    element("camera-start").disabled = true;
    cameraStatus.textContent = "Opening camera…";
    const settings = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    if (deviceId) settings.deviceId = { exact: deviceId };
    else settings.facingMode = { ideal: "environment" };
    try {
      const opened = await navigator.mediaDevices.getUserMedia({ audio: false, video: settings });
      if (ticket !== cameraTicket) {
        opened.getTracks().forEach(track => track.stop());
        return;
      }
      stream = opened;
      video.srcObject = opened;
      await video.play();
      if (ticket !== cameraTicket) return;
      const {width, height} = cardFrame(video.videoWidth, video.videoHeight);
      frame.style.setProperty("--camera-aspect", video.videoWidth / video.videoHeight);
      frame.style.setProperty("--guide-width", `${100 * width / video.videoWidth}%`);
      frame.style.setProperty("--guide-height", `${100 * height / video.videoHeight}%`);
      frame.hidden = false;
      element("camera-start").hidden = true;
      element("camera-stop").hidden = false;
      cameraButtons(true);
      cameraStatus.textContent = "Fit the whole card inside the guide. Capture its Indonesian side, then its English side.";
      const track = opened.getVideoTracks()[0];
      track.addEventListener("ended", () => {
        if (stream === opened) stopCamera();
      }, { once: true });
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      if (ticket !== cameraTicket) return;
      const cameras = devices.filter(device => device.kind === "videoinput" && device.deviceId);
      picker.replaceChildren(...cameras.map((device, index) =>
        new Option(device.label || `Camera ${index + 1}`, device.deviceId)));
      picker.value = track.getSettings().deviceId || deviceId || cameras[0]?.deviceId || "";
      element("camera-field").hidden = cameras.length < 2;
    } catch (error) {
      if (ticket !== cameraTicket) return;
      stopCamera();
      cameraStatus.textContent = error.name === "NotAllowedError"
        ? "Allow camera access in your browser, or choose photos from your device."
        : "This camera is unavailable. Try the camera again or choose photos.";
    }
  }

  function clearPhoto(side) {
    side.ticket += 1;
    if (side.url) URL.revokeObjectURL(side.url);
    side.url = "";
    side.blob = null;
    side.photo.removeAttribute("src");
    side.photo.hidden = true;
    side.file.value = "";
  }

  function reset(card = null) {
    editedId = card?.id ?? null;
    draftId = editedId || `card-${crypto.randomUUID()}`;
    element("capture-title").textContent = card ? "Edit card" : "Add a card";
    formStatus.textContent = "";
    deck.value = card?.deck ?? "";
    deckSuggestion = "";
    archive.hidden = true;
    for (const code of sideCodes) {
      const side = sides[code];
      clearPhoto(side);
      side.suggestion = "";
      side.input.value = code === "id" ? card?.indonesian ?? "" : card?.english ?? "";
    }
    mac.then(features => {
      element("keep-photos-field").hidden = !features.archive;
      if (!formStatus.textContent) {
        formStatus.textContent = features.available
          ? "The Mac can suggest text from photos. Check both sides and the deck number before saving."
          : "Enter the wording from each photo. On iPhone or iPad you can also paste text copied with Live Text.";
      }
    });
  }

  async function receivePhoto(code, producer) {
    const side = sides[code];
    const ticket = ++side.ticket;
    const originalText = side.input.value;
    const originalDeck = deck.value;
    try {
      const blob = await producer();
      if (ticket !== side.ticket) return;
      if (side.url) URL.revokeObjectURL(side.url);
      side.blob = blob;
      side.url = URL.createObjectURL(blob);
      side.photo.src = side.url;
      side.photo.hidden = false;
      archive.hidden = false;
      if (!(await mac).available) {
        formStatus.textContent = "Photo ready. Enter or paste the wording and check the deck number.";
        return;
      }
      if (ticket !== side.ticket) return;
      formStatus.textContent = "Reading handwriting on this Mac…";
      const response = await fetch(`./api/recognize?side=${code}`, {
        method: "POST", body: blob, signal: AbortSignal.timeout(35000),
      });
      const result = await response.json();
      if (ticket !== side.ticket) return;
      if (!response.ok) throw new Error(result.error);
      const suggested = readSuggestion(result.lines, code);
      if (side.input.value === originalText && (!originalText || originalText === side.suggestion) && suggested.text) {
        side.input.value = suggested.text.slice(0, 1200);
        side.suggestion = side.input.value;
      }
      if (code === "en" && deck.value === originalDeck && (!originalDeck || originalDeck === deckSuggestion) && suggested.deck) {
        deck.value = suggested.deck;
        deckSuggestion = suggested.deck;
      }
      formStatus.textContent = "Check the photo and fill in any missing fields before saving.";
    } catch (error) {
      if (ticket === side.ticket) formStatus.textContent = error.message || "Enter the text beside the photo.";
    }
  }

  for (const code of sideCodes) {
    const side = sides[code];
    side.shutter.addEventListener("click", () => receivePhoto(code, () => {
      const {videoWidth, videoHeight} = video;
      return preparePhoto(video, videoWidth, videoHeight, cardFrame(videoWidth, videoHeight));
    }));
    side.file.addEventListener("change", () => {
      const file = side.file.files[0];
      if (!file) return;
      receivePhoto(code, async () => {
        const url = URL.createObjectURL(file);
        const source = new Image();
        source.src = url;
        try {
          await source.decode();
          return await preparePhoto(source, source.naturalWidth, source.naturalHeight);
        } catch {
          throw new Error("This image could not be opened. Try a JPEG or PNG photo.");
        } finally {
          URL.revokeObjectURL(url);
          side.file.value = "";
        }
      });
    });
  }

  element("camera-start").addEventListener("click", () => startCamera());
  element("camera-stop").addEventListener("click", stopCamera);
  picker.addEventListener("change", () => startCamera(picker.value));
  window.addEventListener("pagehide", stopCamera);
  element("download-photos").addEventListener("click", async () => {
    try {
      const filename = `${photoPrefix(deck.value)}${draftId}-photos.zip`;
      saveDownload(await photoBundle(), filename);
    } catch {
      formStatus.textContent = "The photo file could not be created. Try saving it again.";
    }
  });
  element("capture-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = element("capture-save");
    if (button.disabled) return;
    button.disabled = true;
    try {
      const editing = !!editedId;
      const [card] = normalizeCards([{
        id: draftId,
        deck: deck.value,
        indonesian: sides.id.input.value,
        english: sides.en.input.value,
      }]);
      let archived = false;
      if ((await mac).archive && keepPhotos.checked && !archive.hidden) {
        const response = await fetch(`./api/archive?deck=${card.deck}&id=${encodeURIComponent(card.id)}`, {
          method: "POST", body: await photoBundle(), signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error("Photos could not be saved on the Mac. Try again or clear Keep photos.");
        archived = true;
      }
      const label = saveCard(card, editing);
      if (!editing) {
        reset();
        formStatus.textContent = archived ? `${label} Photos saved on this Mac.` : label;
        (stream ? sides.id.shutter : sides.id.input).focus();
      }
    } catch (error) {
      formStatus.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  return { reset, stopCamera, get editing() { return editedId !== null; } };
}
