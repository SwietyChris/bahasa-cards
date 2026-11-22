const pauseBetweenReads = 480;

function matchKey(result, side) {
  const text = result.text.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (!text || (side === "en" ? !result.deck : result.deck)) return "";
  return `${text}/${result.deck}`;
}

export function setupAutoScan({ button, status, nextSide, sample, recognize, accept, pairReady }) {
  let active = false;
  let timer;
  let ticket = 0;
  let audio = null;

  function enableSound() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    try {
      audio ??= new Audio();
      audio.resume().catch(() => {});
    } catch { /* The on-screen messages also mark each capture. */ }
  }

  function beep(side) {
    if (audio?.state !== "running") return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const now = audio.currentTime;
    oscillator.frequency.value = side === "id" ? 660 : 880;
    gain.gain.setValueAtTime(.001, now);
    gain.gain.exponentialRampToValueAtTime(.13, now + .012);
    gain.gain.exponentialRampToValueAtTime(.001, now + .12);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(now);
    oscillator.stop(now + .13);
  }

  function stop() {
    active = false;
    ticket += 1;
    clearTimeout(timer);
    status.textContent = "";
    button.textContent = "Start auto-scan";
  }

  function resume(completed) {
    ticket += 1;
    clearTimeout(timer);
    if (!active) return;
    const side = nextSide();
    if (!side) {
      status.textContent = "Both sides captured. Check the text and deck number, then save.";
      if (completed) pairReady();
      return;
    }
    const next = side === "id" ? "the Indonesian side" : "the English side and deck number";
    status.textContent = completed
      ? `Side captured. Flip the card and show ${next}.`
      : `Ready to scan. Hold ${next} still inside the guide.`;
    const current = ticket;
    let previous = "";

    async function scan() {
      if (current !== ticket) return;
      if (!document.hidden) {
        try {
          const image = await sample();
          const result = await recognize(image, side);
          if (current !== ticket) return;
          const key = matchKey(result, side);
          if (key && key === previous) {
            accept(side, image, result);
            beep(side);
            resume(side);
            return;
          }
          previous = key;
        } catch {
          previous = "";
        }
      }
      if (current === ticket) timer = setTimeout(scan, pauseBetweenReads);
    }

    timer = setTimeout(scan, 150);
  }

  button.addEventListener("click", () => {
    if (active) {
      stop();
      return;
    }
    enableSound();
    active = true;
    button.textContent = "Stop auto-scan";
    resume();
  });

  return { stop, resume };
}
