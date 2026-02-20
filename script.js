const REAL_TARGET_UTC_ISO = "2026-02-20T16:00:00Z";
const TEST_DURATION_MS = 10_000;
const CONFETTI_MAX_RUNTIME_MS = 45_000;
const CONFETTI_BASE_PIECES = 120;
const CONFETTI_MIN_PIECES = 32;
const BIRTHDAY_REVEAL_WINDOW_MS = 24 * 60 * 60 * 1000;
const FALLBACK_TARGET_OFFSET_MS = 24 * 60 * 60 * 1000;
const TARGET_TEMPLATE_MS = Date.parse(REAL_TARGET_UTC_ISO);
const isTestMode = new URLSearchParams(window.location.search).get("test") === "true";
let targetMs = isTestMode ? Date.now() + TEST_DURATION_MS : computeActiveBirthdayStartMs(Date.now());
let targetUtcIso = new Date(targetMs).toISOString();

const countdownPanel = document.getElementById("countdownPanel");
const birthdaySection = document.getElementById("birthdaySection");
const cakeStage = document.getElementById("cakeStage");
const birthdayCake = document.getElementById("birthdayCake");
const birthdayMessage = document.getElementById("birthdayMessage");
const blowBtn = document.getElementById("blowBtn");
const ringProgress = document.getElementById("ringProgress");
const digitalMain = document.getElementById("digitalMain");
const daysValue = document.getElementById("daysValue");
const hoursValue = document.getElementById("hoursValue");
const minutesValue = document.getElementById("minutesValue");
const secondsValue = document.getElementById("secondsValue");
const metaText = document.getElementById("metaText");
const mysteryText = document.getElementById("mysteryText");
const glitchLayer = document.getElementById("glitchLayer");
const confettiCanvas = document.getElementById("confettiCanvas");
const confettiCtx = confettiCanvas ? confettiCanvas.getContext("2d") : null;
const clockAudio = document.getElementById("clockAudio");
const birthdayLoopAudio = document.getElementById("birthdayLoopAudio");
const requiredElements = [
  ["countdownPanel", countdownPanel],
  ["birthdaySection", birthdaySection],
  ["ringProgress", ringProgress],
  ["digitalMain", digitalMain],
  ["daysValue", daysValue],
  ["hoursValue", hoursValue],
  ["minutesValue", minutesValue],
  ["secondsValue", secondsValue],
  ["metaText", metaText],
];
const missingRequiredElementIds = requiredElements.filter(([, el]) => !el).map(([id]) => id);
const canRunApp = missingRequiredElementIds.length === 0;

document.body.classList.remove("reveal-active");
if (!canRunApp) {
  console.error(`Missing required DOM elements: ${missingRequiredElementIds.join(", ")}. Countdown initialization aborted.`);
}

let internetTimeOffsetMs = 0;
const RADIUS = 120;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
let initialRemainingMs = targetMs - trueNow();

function trueNow() {
  return Date.now() + internetTimeOffsetMs;
}
const mysteryMessages = [
  "Initializing event...",
  "Please wait.",
  "Processing something unavoidable.",
  "System preparing announcement.",
];
const confettiPalette = ["#22d3ee", "#6366f1", "#fbbf24", "#10b981", "#f87171", "#e2e8f0"];
let timerId = null;
let mysteryTimeoutId = null;
let lastMysteryIndex = -1;
let hasRevealed = false;
let hasBlown = false;
let confettiFrameId = null;
let confettiStopTimeoutId = null;
let confettiPieces = [];
let confettiWidth = 0;
let confettiHeight = 0;
let shouldAttemptClockAudio = true;
let waitingForClockAudioGesture = false;
let hasLoggedClockAudioFailure = false;
let hasLoggedBirthdayAudioFailure = false;
let hasSettledTimeSource = isTestMode;

if (canRunApp) {
  ringProgress.style.strokeDasharray = `${CIRCUMFERENCE}`;
  ringProgress.style.strokeDashoffset = "0";
}

function pad(value, size = 2) {
  return String(value).padStart(size, "0");
}

function computeActiveBirthdayStartMs(nowMs = Date.now()) {
  if (!Number.isFinite(TARGET_TEMPLATE_MS)) {
    console.warn("Invalid REAL_TARGET_UTC_ISO value; using 24-hour fallback target.");
    return nowMs + FALLBACK_TARGET_OFFSET_MS;
  }

  const templateDate = new Date(TARGET_TEMPLATE_MS);
  const templateMonth = templateDate.getUTCMonth();
  const templateDay = templateDate.getUTCDate();
  const templateHour = templateDate.getUTCHours();
  const templateMinute = templateDate.getUTCMinutes();
  const templateSecond = templateDate.getUTCSeconds();
  const templateMs = templateDate.getUTCMilliseconds();

  const nowUtcYear = new Date(nowMs).getUTCFullYear();
  const thisYearStartMs = Date.UTC(
    nowUtcYear,
    templateMonth,
    templateDay,
    templateHour,
    templateMinute,
    templateSecond,
    templateMs,
  );
  if (nowMs < thisYearStartMs + BIRTHDAY_REVEAL_WINDOW_MS) {
    return thisYearStartMs;
  }

  return Date.UTC(
    nowUtcYear + 1,
    templateMonth,
    templateDay,
    templateHour,
    templateMinute,
    templateSecond,
    templateMs,
  );
}

function refreshAnnualTarget(nowMs = trueNow()) {
  if (isTestMode) {
    return;
  }
  targetMs = computeActiveBirthdayStartMs(nowMs);
  targetUtcIso = new Date(targetMs).toISOString();
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getConfettiPieceBudget() {
  if (prefersReducedMotion()) {
    return 0;
  }

  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
  const areaRatio = Math.min(1, viewportArea / (1280 * 720));
  const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const lowMemoryDevice = Number.isFinite(navigator.deviceMemory) && navigator.deviceMemory <= 4;

  let budget = CONFETTI_MIN_PIECES + Math.round((CONFETTI_BASE_PIECES - CONFETTI_MIN_PIECES) * areaRatio);
  if (isCoarsePointer) {
    budget = Math.round(budget * 0.8);
  }
  if (lowMemoryDevice) {
    budget = Math.round(budget * 0.86);
  }

  return Math.max(CONFETTI_MIN_PIECES, Math.min(CONFETTI_BASE_PIECES, budget));
}

function getNextMysteryIndex() {
  if (mysteryMessages.length <= 1) {
    return 0;
  }

  let nextIndex = Math.floor(Math.random() * mysteryMessages.length);
  while (nextIndex === lastMysteryIndex) {
    nextIndex = Math.floor(Math.random() * mysteryMessages.length);
  }
  return nextIndex;
}

function rotateMysteryText() {
  if (!mysteryText) {
    return;
  }

  const nextIndex = getNextMysteryIndex();
  lastMysteryIndex = nextIndex;
  mysteryText.textContent = mysteryMessages[nextIndex];

  const nextDelayMs = 8000 + Math.floor(Math.random() * 4001);
  mysteryTimeoutId = setTimeout(rotateMysteryText, nextDelayMs);
}

function resizeConfettiCanvas() {
  if (!confettiCanvas || !confettiCtx) {
    return;
  }

  const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const dpr = Math.min(window.devicePixelRatio || 1, isCoarsePointer ? 1.75 : 2);
  confettiWidth = window.innerWidth;
  confettiHeight = window.innerHeight;
  confettiCanvas.width = Math.floor(confettiWidth * dpr);
  confettiCanvas.height = Math.floor(confettiHeight * dpr);
  confettiCtx.setTransform(1, 0, 0, 1, 0, 0);
  confettiCtx.scale(dpr, dpr);
}

function createConfettiPiece(yStart = -20, forceLayer) {
  const layer = forceLayer || (Math.random() < 0.4 ? "bg" : "fg");
  const isBg = layer === "bg";
  return {
    x: randomBetween(0, confettiWidth),
    y: yStart,
    w: randomBetween(isBg ? 3 : 4, isBg ? 6 : 9),
    h: randomBetween(isBg ? 4 : 6, isBg ? 8 : 12),
    speedY: randomBetween(isBg ? 0.8 : 1.4, isBg ? 2.1 : 3.8),
    speedX: randomBetween(-1.2, 1.2),
    drift: randomBetween(0.01, 0.05),
    tilt: randomBetween(0, Math.PI * 2),
    tiltSpeed: randomBetween(isBg ? 0.02 : 0.04, isBg ? 0.07 : 0.12),
    color: confettiPalette[Math.floor(Math.random() * confettiPalette.length)],
    layer,
  };
}

function rebalanceConfettiPieces() {
  const targetCount = getConfettiPieceBudget();
  if (targetCount <= 0) {
    stopConfetti();
    return;
  }

  if (confettiPieces.length > targetCount) {
    confettiPieces.length = targetCount;
    return;
  }

  while (confettiPieces.length < targetCount) {
    confettiPieces.push(createConfettiPiece(randomBetween(-confettiHeight, confettiHeight)));
  }
}

function startConfetti() {
  if (!confettiCanvas || !confettiCtx || confettiFrameId !== null) {
    return;
  }

  const targetCount = getConfettiPieceBudget();
  if (targetCount <= 0) {
    return;
  }

  if (confettiStopTimeoutId !== null) {
    clearTimeout(confettiStopTimeoutId);
    confettiStopTimeoutId = null;
  }

  confettiCanvas.classList.remove("hidden");
  resizeConfettiCanvas();
  confettiPieces = Array.from(
    { length: targetCount },
    () => createConfettiPiece(randomBetween(-confettiHeight, confettiHeight)),
  );

  const animate = () => {
    confettiCtx.clearRect(0, 0, confettiWidth, confettiHeight);
    const isBlown = birthdaySection.classList.contains("blown");
    const speedScale = isBlown ? 0.82 : 1;
    const activeCount = isBlown ? Math.floor(confettiPieces.length * 0.8) : confettiPieces.length;

    // Draw background layer first (behind)
    for (let i = 0; i < activeCount; i += 1) {
      const piece = confettiPieces[i];
      if (piece.layer !== "bg") continue;
      piece.y += piece.speedY * speedScale;
      piece.x += (piece.speedX + Math.sin(piece.y * piece.drift)) * speedScale;
      piece.tilt += piece.tiltSpeed * (0.68 + speedScale * 0.32);

      confettiCtx.save();
      confettiCtx.globalAlpha = isBlown ? 0.28 : 0.40;
      confettiCtx.translate(piece.x, piece.y);
      confettiCtx.rotate(piece.tilt);
      confettiCtx.fillStyle = piece.color;
      confettiCtx.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
      confettiCtx.restore();

      if (piece.y > confettiHeight + 20) {
        const resetPiece = createConfettiPiece(randomBetween(-120, -20), "bg");
        Object.assign(piece, resetPiece);
      }
    }

    // Draw foreground layer (in front)
    for (let i = 0; i < activeCount; i += 1) {
      const piece = confettiPieces[i];
      if (piece.layer !== "fg") continue;
      piece.y += piece.speedY * speedScale;
      piece.x += (piece.speedX + Math.sin(piece.y * piece.drift)) * speedScale;
      piece.tilt += piece.tiltSpeed * (0.68 + speedScale * 0.32);

      confettiCtx.save();
      confettiCtx.globalAlpha = isBlown ? 0.52 : 0.78;
      confettiCtx.translate(piece.x, piece.y);
      confettiCtx.rotate(piece.tilt);
      confettiCtx.fillStyle = piece.color;
      confettiCtx.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
      confettiCtx.restore();

      if (piece.y > confettiHeight + 20) {
        const resetPiece = createConfettiPiece(randomBetween(-120, -20), "fg");
        Object.assign(piece, resetPiece);
      }
    }

    confettiFrameId = requestAnimationFrame(animate);
  };

  confettiFrameId = requestAnimationFrame(animate);
  confettiStopTimeoutId = window.setTimeout(() => {
    stopConfetti();
  }, CONFETTI_MAX_RUNTIME_MS);
}

function stopConfetti() {
  if (confettiFrameId !== null) {
    cancelAnimationFrame(confettiFrameId);
    confettiFrameId = null;
  }
  if (confettiStopTimeoutId !== null) {
    clearTimeout(confettiStopTimeoutId);
    confettiStopTimeoutId = null;
  }
  confettiPieces = [];
  if (confettiCtx) {
    confettiCtx.clearRect(0, 0, confettiWidth, confettiHeight);
  }
  if (confettiCanvas) {
    confettiCanvas.classList.add("hidden");
  }
}

function removeClockAudioGestureListeners() {
  window.removeEventListener("pointerdown", onClockAudioGesture);
  window.removeEventListener("keydown", onClockAudioGesture);
}

function onClockAudioGesture() {
  waitingForClockAudioGesture = false;
  removeClockAudioGestureListeners();
  if (!canRunApp || hasRevealed) {
    return;
  }
  shouldAttemptClockAudio = true;
  updateCountdown();
}

function waitForClockAudioGesture() {
  if (waitingForClockAudioGesture || hasRevealed) {
    return;
  }
  waitingForClockAudioGesture = true;
  window.addEventListener("pointerdown", onClockAudioGesture, { passive: true });
  window.addEventListener("keydown", onClockAudioGesture);
}

function playBirthdayLoopAudio() {
  if (!birthdayLoopAudio) {
    return;
  }

  birthdayLoopAudio.loop = true;
  birthdayLoopAudio.currentTime = 0;
  const playPromise = birthdayLoopAudio.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch((err) => {
      if (!hasLoggedBirthdayAudioFailure) {
        console.warn("Birthday loop audio playback failed.", err);
        hasLoggedBirthdayAudioFailure = true;
      }
    });
  }
}

function typeWords(element, delayBetweenWords = 150) {
  // Collect all word-level units by walking the DOM tree
  const wordUnits = [];

  function walkNodes(parent) {
    const children = Array.from(parent.childNodes);
    children.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        // Split text into words and spaces
        const parts = node.textContent.split(/(\s+)/).filter(Boolean);
        parts.forEach(part => {
          const span = document.createElement("span");
          if (part.trim() === "") {
            span.innerHTML = "&nbsp;";
            span.style.opacity = "1";
          } else {
            span.textContent = part;
            span.style.opacity = "0";
            span.style.transition = "opacity 400ms ease";
            wordUnits.push(span);
          }
          node.parentNode.insertBefore(span, node);
        });
        node.parentNode.removeChild(node);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === "BR") {
          return;
        }
        // Recurse into child elements (like styled spans)
        walkNodes(node);
      }
    });
  }

  walkNodes(element);

  let i = 0;
  function revealNext() {
    if (i < wordUnits.length) {
      wordUnits[i].style.opacity = "1";
      i++;
      setTimeout(revealNext, delayBetweenWords);
    }
  }
  revealNext();
}

function handleBlowCandles() {
  if (!canRunApp || !hasRevealed || hasBlown) {
    return;
  }
  hasBlown = true;
  playBirthdayLoopAudio();

  birthdaySection.classList.add("blown");
  if (birthdayCake) {
    birthdayCake.classList.add("blown");
  }

  const stageTitle = document.querySelector(".stage-title");
  if (stageTitle) {
    stageTitle.classList.add("fade-out-fast");
  }

  if (blowBtn) {
    blowBtn.classList.add("is-used");
    blowBtn.classList.add("fade-out-fast");
  }
  document.body.classList.add("cinematic-dim");

  window.setTimeout(() => {
    if (stageTitle) {
      stageTitle.style.display = "none";
    }
    if (blowBtn) {
      blowBtn.style.display = "none";
    }
    if (birthdayMessage) {
      birthdayMessage.classList.remove("hidden");
      birthdayMessage.classList.add("show");

      const main = birthdayMessage.querySelector('.message-main');
      const final = birthdayMessage.querySelector('.message-final');
      const sig = birthdayMessage.querySelector('.signature');
      if (!main || !final || !sig) {
        console.warn("Birthday message nodes are missing; skipping typewriter effect.");
        document.body.classList.remove("cinematic-dim");
        return;
      }

      const originalMain = main.innerHTML;
      const originalFinal = final.innerHTML;
      const originalSig = sig.innerHTML;

      main.innerHTML = "";
      final.innerHTML = "";
      sig.innerHTML = "";

      main.innerHTML = originalMain;
      typeWords(main, 250);

      setTimeout(() => {
        final.innerHTML = originalFinal;
        typeWords(final, 200);
      }, 1500);

      setTimeout(() => {
        sig.innerHTML = originalSig;
        typeWords(sig, 300);
      }, 4500);
    }
    document.body.classList.remove("cinematic-dim");
  }, 1200);
}

function triggerReveal() {
  if (!canRunApp || hasRevealed) {
    return;
  }
  hasRevealed = true;
  shouldAttemptClockAudio = false;
  waitingForClockAudioGesture = false;
  removeClockAudioGestureListeners();

  if (clockAudio) {
    clockAudio.pause();
    clockAudio.currentTime = 0;
  }

  digitalMain.textContent = "00:00:00";
  daysValue.textContent = "000";
  hoursValue.textContent = "00";
  minutesValue.textContent = "00";
  secondsValue.textContent = "00";
  ringProgress.style.strokeDashoffset = `${CIRCUMFERENCE}`;

  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
  if (mysteryTimeoutId !== null) {
    clearTimeout(mysteryTimeoutId);
    mysteryTimeoutId = null;
  }

  countdownPanel.classList.add("fade-out");
  if (glitchLayer) {
    glitchLayer.classList.remove("hidden");
    glitchLayer.classList.add("active");
  }

  window.setTimeout(() => {
    countdownPanel.classList.add("hidden");
    birthdaySection.classList.remove("hidden");
    birthdaySection.classList.add("reveal-in");
    document.body.classList.add("reveal-active");
    birthdaySection.classList.remove("blown");
    if (birthdayCake) {
      birthdayCake.classList.remove("blown");
    }
    hasBlown = false;
    document.body.classList.remove("cinematic-dim");
    if (cakeStage) {
      cakeStage.classList.remove("hidden");
    }
    if (birthdayMessage) {
      birthdayMessage.classList.add("hidden");
      birthdayMessage.classList.remove("show");
    }
    if (blowBtn) {
      blowBtn.classList.remove("is-used");
    }

    if (glitchLayer) {
      glitchLayer.classList.remove("active");
      glitchLayer.classList.add("hidden");
    }

    startConfetti();
  }, 1100);
}

function updateCountdown() {
  if (!canRunApp || hasRevealed) {
    return;
  }

  if (clockAudio && shouldAttemptClockAudio && clockAudio.paused) {
    const playPromise = clockAudio.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch((err) => {
        // Browsers commonly reject autoplay without user interaction.
        if (err && err.name === "NotAllowedError") {
          shouldAttemptClockAudio = false;
          waitForClockAudioGesture();
          return;
        }
        shouldAttemptClockAudio = false;
        if (!hasLoggedClockAudioFailure) {
          console.warn("Clock audio playback failed.", err);
          hasLoggedClockAudioFailure = true;
        }
      });
    }
  }

  const now = trueNow();
  const distance = targetMs - now;
  const targetLocal = new Date(targetMs).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
  if (isTestMode) {
    metaText.textContent = `Developer test mode active (?test=true): reveal after 10 seconds (local target: ${targetLocal}).`;
  } else {
    metaText.textContent = `Target locked to UTC: ${targetUtcIso} (local: ${targetLocal}).`;
  }

  if (distance <= 0) {
    if (!hasSettledTimeSource) {
      digitalMain.textContent = "00:00:00";
      daysValue.textContent = "000";
      hoursValue.textContent = "00";
      minutesValue.textContent = "00";
      secondsValue.textContent = "00";
      ringProgress.style.strokeDashoffset = `${CIRCUMFERENCE}`;
      if (mysteryText) {
        mysteryText.textContent = "Verifying trusted time...";
      }
      return;
    }
    triggerReveal();
    return;
  }

  const totalSeconds = Math.floor(distance / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  digitalMain.textContent = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  daysValue.textContent = pad(days, 3);
  hoursValue.textContent = pad(hours);
  minutesValue.textContent = pad(minutes);
  secondsValue.textContent = pad(seconds);

  const progressRatio = initialRemainingMs > 0 ? distance / initialRemainingMs : 0;
  const clampedRatio = Math.min(1, Math.max(0, progressRatio));
  ringProgress.style.strokeDashoffset = `${CIRCUMFERENCE * (1 - clampedRatio)}`;
}

if (canRunApp) {
  updateCountdown();
  if (!hasRevealed && !countdownPanel.classList.contains("hidden")) {
    rotateMysteryText();
    timerId = setInterval(updateCountdown, 1000);
  }
}

if (canRunApp && blowBtn) {
  blowBtn.addEventListener("click", handleBlowCandles);
}

window.addEventListener("resize", () => {
  if (confettiFrameId !== null) {
    resizeConfettiCanvas();
    rebalanceConfettiPieces();
  }
});

window.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopConfetti();
  }
});

window.addEventListener("pagehide", () => {
  if (!birthdayLoopAudio) {
    return;
  }
  birthdayLoopAudio.pause();
  birthdayLoopAudio.currentTime = 0;
});

// Fetch true internet time to prevent local clock manipulation
async function syncInternetTime() {
  if (!canRunApp) {
    return;
  }

  const timeoutMs = 5000;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const startFetch = Date.now();
    const res = await fetch("https://worldtimeapi.org/api/timezone/Etc/UTC", {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error("Time fetch failed");

    const data = await res.json();
    const endFetch = Date.now();
    const roundTripDelay = (endFetch - startFetch) / 2;
    const trueUTC = Date.parse(data.utc_datetime);
    if (!Number.isFinite(trueUTC)) {
      throw new Error("Invalid UTC datetime from time service");
    }

    // Calculate the difference between the computer's time and the true internet time
    const nextOffset = trueUTC - (startFetch + roundTripDelay);
    if (!Number.isFinite(nextOffset)) {
      throw new Error("Computed invalid clock offset");
    }
    internetTimeOffsetMs = nextOffset;
    refreshAnnualTarget(trueNow());
    hasSettledTimeSource = true;

    console.log(`Clock offset applied: ${internetTimeOffsetMs}ms`);

    // Recalculate initial Remaining Ms based on the true time
    initialRemainingMs = Math.max(0, targetMs - trueNow());
    updateCountdown(); // force an immediate graphical update
  } catch (err) {
    hasSettledTimeSource = true;
    if (err && err.name === "AbortError") {
      console.warn("Internet time sync timed out after 5000ms; using local device clock.");
      updateCountdown();
      return;
    }
    console.warn("Failed to sync true internet time, falling back to local device clock.", err);
    updateCountdown();
  } finally {
    clearTimeout(timeoutId);
  }
}

if (canRunApp && !isTestMode) {
  syncInternetTime();
}
