import { macStudio } from "./store.mjs";

const sideNames = { en: "English", id: "Bahasa Indonesia" };
const cardRatio = 85 / 55;
const similarLetters = {
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X",
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x",
};

function framing(width, height) {
  const framedWidth = Math.min(width * 0.87, height * 0.86 * cardRatio);
  const framedHeight = framedWidth / cardRatio;
  return { x: (width - framedWidth) / 2, y: (height - framedHeight) / 2, width: framedWidth, height: framedHeight };
}

function takeFrame(video) {
  const { videoWidth, videoHeight } = video;
  if (!videoWidth || !videoHeight) throw new Error("The camera is still starting.");
  const area = framing(videoWidth, videoHeight);
  const scale = Math.min(1, 1600 / area.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(area.width * scale);
  canvas.height = Math.round(area.height * scale);
  const context = canvas.getContext("2d");
  context.drawImage(video, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not capture this frame.")), "image/jpeg", 0.94);
  });
}

async function recognize(blob, side) {
  const response = await fetch("./api/recognize?side=" + side, {
    method: "POST", body: blob, signal: AbortSignal.timeout(12000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  const lines = result.lines.map(line => ({ ...line, text: line.text.trim() })).filter(line => line.text);
  lines.sort((a, b) => a.top - b.top || a.left - b.left);
  const hasNumber = lines.length > 1 && /^#?\s*\d+\.?$/.test(lines[0].text) && lines[1].top - lines[0].top > 0.04;
  if (hasNumber) lines.shift();
  const raw = lines.map(line => line.text).join("\n");
  const text = /[a-z]/i.test(raw) ? raw.replace(/[АВЕКМНОРСТХаеорсух]/gu, letter => similarLetters[letter]) : raw;
  const key = text.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return { text, key, hasNumber };
}

export async function saveCardPhotos(id, photos) {
  if (!macStudio || (!photos.en && !photos.id)) return;
  const zip = new globalThis.JSZip();
  if (photos.en) zip.file("english.jpg", photos.en);
  if (photos.id) zip.file("indonesian.jpg", photos.id);
  const body = await zip.generateAsync({ type: "blob", mimeType: "application/zip" });
  const response = await fetch("./api/archive?id=" + encodeURIComponent(id), {
    method: "POST", body, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Studio could not save the photos. The capture is still here. Try saving again.");
}

export async function loadCardPhotos(id) {
  if (!macStudio) return {};
  const response = await fetch("./api/archive?id=" + encodeURIComponent(id));
  if (!response.ok) return {};
  const zip = await globalThis.JSZip.loadAsync(await response.arrayBuffer());
  const photos = {};
  for (const [side, name] of [["en", "english.jpg"], ["id", "indonesian.jpg"]]) {
    const bytes = await zip.file(name)?.async("uint8array");
    if (bytes) photos[side] = new Blob([bytes], { type: "image/jpeg" });
  }
  return photos;
}

export function createScanner(element, { save, manual, edit }) {
  const video = element("camera-video");
  const frame = element("camera-frame");
  const camera = element("camera-select");
  const status = element("scan-status");
  const step = element("scan-step");
  const prompt = element("scan-prompt");
  let stream, timer, audio, current, lastSaved, generation = 0;
  let saving = false;
  const health = macStudio ? fetch("./api/recognition").then(response => response.json()).catch(() => ({})) : Promise.resolve({});

  function enableSound() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    try {
      audio ??= new Audio();
      audio.resume().catch(() => {});
    } catch { /* The screen also shows each capture. */ }
  }

  function beep(side) {
    if (audio?.state !== "running") return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const now = audio.currentTime;
    oscillator.frequency.value = side === "en" ? 650 : 880;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.15, now + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.14);
  }

  function pause() {
    generation += 1;
    clearTimeout(timer);
  }

  function closeCamera() {
    pause();
    const closing = stream;
    stream = undefined;
    closing?.getTracks().forEach(track => track.stop());
    video.srcObject = null;
    frame.hidden = true;
    element("camera-field").hidden = true;
    element("use-frame").hidden = true;
  }

  function stop() {
    closeCamera();
    current = undefined;
  }

  function newCard(deck, lastKey = "") {
    return { deck, id: "card-" + crypto.randomUUID(), sides: {}, lastKey };
  }

  function updateGuide() {
    const { videoWidth, videoHeight } = video;
    if (!videoWidth || !videoHeight) return;
    const area = framing(videoWidth, videoHeight);
    frame.style.setProperty("--camera-aspect", videoWidth / videoHeight);
    frame.style.setProperty("--guide-width", 100 * area.width / videoWidth + "%");
    frame.style.setProperty("--guide-height", 100 * area.height / videoHeight + "%");
  }

  function nextSide() {
    return current?.sides.en ? "id" : "en";
  }

  function beginReading() {
    pause();
    if (!current || !stream) return;
    const side = nextSide();
    const starting = generation;
    const previous = side === "en" ? current.lastKey : current.sides.en.key;
    let lastRead = "";
    let unreadable = 0;
    step.textContent = side === "en" ? "1 of 2 · English" : "2 of 2 · Bahasa Indonesia";
    prompt.textContent = side === "en" ? "Hold up the English side" : "Flip the card to Bahasa Indonesia";
    status.textContent = "Keep the writing inside the guide and hold the card still.";
    element("use-frame").hidden = false;

    async function read() {
      if (starting !== generation) return;
      if (!document.hidden) {
        try {
          const blob = await takeFrame(video);
          const result = await recognize(blob, side);
          if (starting !== generation) return;
          const hasText = result.key && (side !== "en" || !/^\d+$/.test(result.key));
          if (hasText && result.key === previous) {
            lastRead = "";
            unreadable = 0;
            status.textContent = side === "en" ? "Show the next card’s English side."
              : "English captured. Flip the same card.";
          } else if (hasText && !(side === "id" && result.hasNumber)) {
            if (lastRead === result.key) {
              accept(side, blob, result);
              return;
            }
            lastRead = result.key;
          } else {
            lastRead = "";
            unreadable += 1;
          }
        } catch {
          lastRead = "";
          unreadable += 1;
        }
        if (unreadable >= 8) status.textContent = "Move the card closer, improve the light, or choose Use this frame.";
      }
      if (starting === generation) timer = setTimeout(read, 470);
    }
    timer = setTimeout(read, 220);
  }

  function draft() {
    return {
      id: current.id, deck: current.deck,
      english: current.sides.en?.text ?? "",
      indonesian: current.sides.id?.text ?? "",
      photos: { en: current.sides.en?.blob, id: current.sides.id?.blob },
    };
  }

  async function savePair() {
    if (!current || saving) return;
    const entry = current;
    saving = true;
    camera.disabled = true;
    element("scan-retry").hidden = true;
    prompt.textContent = "Saving card…";
    status.textContent = "";
    try {
      const result = await save(draft());
      if (entry !== current) return;
      lastSaved = result.card.id;
      element("scan-success").textContent = result.message;
      element("saved-english").textContent = result.card.english;
      element("saved-indonesian").textContent = result.card.indonesian;
      element("scan-result").hidden = false;
      current = newCard(entry.deck, entry.sides.id.key);
      beginReading();
    } catch (error) {
      if (entry !== current) return;
      prompt.textContent = "The card is ready to save";
      status.textContent = error.message;
      element("scan-retry").hidden = false;
    } finally {
      saving = false;
      camera.disabled = false;
    }
  }

  function accept(side, blob, result) {
    pause();
    current.sides[side] = { ...result, blob };
    beep(side);
    if (side === "en") beginReading();
    else if (current.sides.en.text && current.sides.id.text) savePair();
    else manual(draft());
  }

  async function openCamera(deviceId) {
    if (saving) return;
    closeCamera();
    const starting = generation;
    element("camera-start").hidden = true;
    element("mac-scanner-help").hidden = true;
    step.textContent = "";
    prompt.textContent = "Opening camera…";
    status.textContent = "";
    const features = await health;
    if (starting !== generation) return;
    if (!features.available || !navigator.mediaDevices?.getUserMedia) {
      prompt.textContent = "Camera scanning is unavailable here";
      element("mac-scanner-help").hidden = macStudio;
      status.textContent = macStudio ? "Restart Mac Studio to reconnect handwriting recognition, or type the text." : "";
      return;
    }
    try {
      const requested = { width: { ideal: 1920 }, height: { ideal: 1080 } };
      if (deviceId) requested.deviceId = { exact: deviceId };
      const opened = await navigator.mediaDevices.getUserMedia({ video: requested, audio: false });
      if (starting !== generation) {
        opened.getTracks().forEach(track => track.stop());
        return;
      }
      stream = opened;
      video.srcObject = opened;
      frame.hidden = false;
      await video.play();
      if (starting !== generation) return;
      updateGuide();
      const track = opened.getVideoTracks()[0];
      track.addEventListener("ended", () => {
        if (stream !== opened) return;
        closeCamera();
        prompt.textContent = "Camera disconnected";
        element("camera-start").hidden = false;
      }, { once: true });
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      if (starting !== generation) return;
      const cameras = devices.filter(device => device.kind === "videoinput" && device.deviceId);
      camera.replaceChildren(...cameras.map((device, index) =>
        new Option(device.label || "Camera " + (index + 1), device.deviceId)));
      camera.value = track.getSettings().deviceId || deviceId || cameras[0]?.deviceId || "";
      element("camera-field").hidden = cameras.length < 2;
      beginReading();
    } catch (error) {
      if (starting !== generation) return;
      closeCamera();
      prompt.textContent = "Could not open the camera";
      status.textContent = error.name === "NotAllowedError"
        ? "Allow camera access for Mac Studio in your browser, then retry."
        : "Check that your camera is connected and available, then retry.";
      element("camera-start").hidden = false;
    }
  }

  function start(deck) {
    stop();
    enableSound();
    current = newCard(deck);
    lastSaved = undefined;
    element("scan-result").hidden = true;
    element("scan-retry").hidden = true;
    openCamera();
  }

  element("use-frame").addEventListener("click", async () => {
    if (!current || !stream) return;
    pause();
    const starting = generation;
    const side = nextSide();
    element("use-frame").hidden = true;
    try {
      const blob = await takeFrame(video);
      const result = await recognize(blob, side).catch(() => ({ text: "", key: "" }));
      if (starting === generation) accept(side, blob, result);
    } catch (error) {
      if (starting === generation) {
        beginReading();
        status.textContent = error.message;
      }
    }
  });
  element("camera-start").addEventListener("click", () => { enableSound(); openCamera(); });
  element("scan-retry").addEventListener("click", savePair);
  element("type-instead").addEventListener("click", () => current && manual(draft()));
  element("edit-last-card").addEventListener("click", () => lastSaved && edit(lastSaved));
  camera.addEventListener("change", () => openCamera(camera.value));
  video.addEventListener("resize", updateGuide);
  window.addEventListener("pagehide", stop);
  return { start, stop };
}
