import "./styles.css";
import questionsRaw from "./data/questions.json";
import { APP_CONFIG } from "./config";
import { HandTracker } from "./vision/HandTracker";
import type {
  BooleanQuestion,
  HandFrame,
  MatchingQuestion,
  MultiQuestion,
  PlayerId,
  Question,
  SingleQuestion
} from "./types";

const allQuestions = questionsRaw as Question[];
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app tidak ditemukan");

type PreparedSingle = Omit<SingleQuestion, "options" | "correct"> & { options: string[]; correct: number };
type PreparedMulti = Omit<MultiQuestion, "options" | "correct"> & { options: string[]; correct: number[] };
type PreparedQuestion = PreparedSingle | BooleanQuestion | MatchingQuestion | PreparedMulti;
type ChapterSequences = Record<PlayerId, PreparedQuestion[][]>;
type MatchMap = Record<string, string>;

interface PlayerState {
  submitted: boolean;
  answer: unknown;
  multiSelected: Set<number>;
  matchMap: MatchMap;
}
interface SubTeamState { name: string; score: number; }
interface TeamState { name: string; subteams: SubTeamState[]; }
interface HoldState { key: string; accumulatedMs: number; lastUpdateAt: number; lastActiveAt: number; fired: boolean; }
interface DragState { leftId: string; ghost: HTMLElement; }

const players: Record<PlayerId, PlayerState> = {
  1: { submitted: false, answer: null, multiSelected: new Set(), matchMap: {} },
  2: { submitted: false, answer: null, multiSelected: new Set(), matchMap: {} }
};
const teams: Record<PlayerId, TeamState> = {
  1: { name: "Tim A", subteams: [1,2,3,4].map(n => ({ name: `A${n}`, score: 0 })) },
  2: { name: "Tim B", subteams: [1,2,3,4].map(n => ({ name: `B${n}`, score: 0 })) }
};

let sequences: ChapterSequences = { 1: [[],[],[],[]], 2: [[],[],[],[]] };
let currentChapter = 1;
let questionIndex: Record<PlayerId, number> = { 1: 0, 2: 0 };
let chapterDone: Record<PlayerId, boolean> = { 1: false, 2: false };
let chapterWaiting = false;
let chapterTransitionPending = false;
let cameraReady = false;
let mouseMode = false;
let lastSeen: Record<PlayerId, number> = { 1: 0, 2: 0 };
let previousPinch: Record<PlayerId, boolean> = { 1: false, 2: false };
let gestureHold: Record<PlayerId, HoldState> = {
  1: { key: "", accumulatedMs: 0, lastUpdateAt: 0, lastActiveAt: 0, fired: false },
  2: { key: "", accumulatedMs: 0, lastUpdateAt: 0, lastActiveAt: 0, fired: false }
};
let gestureCooldownUntil: Record<PlayerId, number> = { 1: 0, 2: 0 };
const gestureDrag: Partial<Record<PlayerId, DragState>> = {};
const pointerSelected: Partial<Record<PlayerId, string>> = {};
const AUTO_ADVANCE_MS = 500;
const CHAPTER_DURATION_MS = 7 * 60 * 1000;
let chapterTimerId: number | null = null;
let chapterEndsAt = 0;
let chapterTimedOut = false;

app.innerHTML = `
<main class="game-shell">
  <section id="stage" class="stage" aria-label="Profesi Kependidikan Versus">
    <video id="cameraVideo" class="camera-video" autoplay muted playsinline></video>
    <div class="camera-dim"></div>
    <canvas id="handCanvas" class="hand-canvas" aria-hidden="true"></canvas>
    <div class="center-line" aria-hidden="true"></div>

    <header class="topbar">
      <div class="brand-block">
        <span class="brand-icon">PK</span>
        <div><strong>Profesi Kependidikan Versus</strong><small>Profesionalisme • Etika • Ekosistem Tenaga Kependidikan</small></div>
      </div>
      <div class="top-actions">
        <span id="roundMeta" class="pill">Belum dimulai</span>
        <span id="chapterTimer" class="timer-pill">07:00</span>
        <button id="fullscreenButton" class="icon-btn" type="button" aria-label="Layar penuh">⛶</button>
      </div>
    </header>

    <section class="score-row" aria-label="Skor tim">
      ${scoreCard(1)}
      <div class="vs-medallion">VS</div>
      ${scoreCard(2)}
    </section>

    <section id="playerArea" class="player-area hidden">
      ${playerPanel(1)}
      ${playerPanel(2)}
    </section>

    <div id="cursor1" class="gesture-cursor p1" aria-hidden="true"><span>A</span></div>
    <div id="cursor2" class="gesture-cursor p2" aria-hidden="true"><span>B</span></div>

    <section id="startOverlay" class="overlay">
      <div class="dialog start-dialog">
        <span class="eyebrow">STATIC WEB • MEDIAPIPE • 2 TIM • 8 SUB-TIM</span>
        <h1>Professional & Ethics Battle</h1>
        <p class="lead">Setiap babak mempertemukan satu sub-tim dari Tim A dan Tim B. <strong>Soal kedua sisi berbeda</strong>, dan setiap sisi otomatis lanjut setelah jawaban terkunci.</p>
        <div class="team-setup-grid">
          ${teamSetupCard(1)}
          ${teamSetupCard(2)}
        </div>
        <div class="round-list">
          <div><b>1</b><span><strong>Pilihan Ganda</strong><small>10 soal/sisi • ☝️ A • ✌️ B • 🤟 C • ✋ D • ✊ kunci</small></span></div>
          <div><b>2</b><span><strong>Benar / Salah</strong><small>10 soal/sisi • 👍 / 👎 pilih • ✊ kunci</small></span></div>
          <div><b>3</b><span><strong>Menjodohkan</strong><small>5 soal/sisi • 🤏 drag & drop • ✊ kunci</small></span></div>
          <div><b>4</b><span><strong>Pilihan Lebih dari 1</strong><small>10 soal/sisi • pointer + 🤏 pilih • ✊ kunci</small></span></div>
        </div>
        <div id="setupStatus" class="setup-status">MediaPipe belum dimuat.</div>
        <div class="start-actions">
          <button id="cameraButton" class="button primary" type="button">Aktifkan Kamera & MediaPipe</button>
          <button id="startButton" class="button success" type="button" disabled>Mulai Pertandingan</button>
        </div>
        <button id="mouseButton" class="text-btn" type="button">Uji tanpa kamera (mouse/touch)</button>
        <p class="privacy">Video kamera diproses di browser dan tidak diunggah ke server.</p>
      </div>
    </section>

    <section id="chapterOverlay" class="overlay hidden">
      <div class="dialog chapter-dialog">
        <span id="chapterEyebrow" class="eyebrow">BABAK 1</span>
        <div id="chapterEmoji" class="chapter-emoji">☝️</div>
        <h2 id="chapterName">Pilihan Ganda</h2>
        <div id="chapterMatchup" class="chapter-matchup">A1 VS B1</div>
        <p id="chapterInstruction"></p>
        <p class="chapter-note">Soal Tim A dan Tim B berbeda. Setiap babak berdurasi 7 menit. Pilihan masih dapat diubah sampai ✊ KUNCI; setelah dikunci, sisi tersebut otomatis masuk soal berikutnya.</p>
        <button id="chapterStartButton" class="button success" type="button">Mulai Babak</button>
      </div>
    </section>

    <section id="finishOverlay" class="overlay hidden">
      <div class="dialog result-dialog">
        <span class="eyebrow">PERTANDINGAN SELESAI</span>
        <div class="trophy">🏆</div>
        <h2 id="winnerTitle">Pemenang</h2>
        <div class="final-grid">
          <div><span id="finalName1">Tim A</span><strong id="finalScore1">0</strong></div>
          <span class="final-vs">VS</span>
          <div><span id="finalName2">Tim B</span><strong id="finalScore2">0</strong></div>
        </div>
        <div id="finalBreakdown" class="final-breakdown"></div>
        <div class="result-actions">
          <button id="againButton" class="button success" type="button">Main Lagi</button>
          <button id="homeButton" class="button secondary" type="button">Kembali</button>
        </div>
      </div>
    </section>
  </section>
</main>`;

function scoreCard(id: PlayerId): string {
  const prefix = id === 1 ? "A" : "B";
  return `<article class="score-card player-${id}">
    <div class="team-score-main"><span>TIM ${prefix}</span><strong id="playerName${id}">Tim ${prefix}</strong><small>Aktif: <b id="activeSubName${id}">${prefix}1</b> • <b id="activeSubScore${id}">0</b> poin</small></div>
    <div class="score-value"><span>TOTAL</span><strong id="score${id}">0</strong></div>
    <div class="subteam-mini">${[1,2,3,4].map(n => `<span id="mini${id}_${n}">${prefix}${n}: <b>0</b></span>`).join("")}</div>
  </article>`;
}

function teamSetupCard(id: PlayerId): string {
  const prefix = id === 1 ? "A" : "B";
  return `<section class="team-setup-card team-${id}">
    <label class="team-name-input"><span>Nama Tim ${prefix}</span><input id="teamName${id}" value="Tim ${prefix}" maxlength="24" /></label>
    <div class="subteam-inputs">
      ${[1,2,3,4].map(n => `<label><span>${prefix}${n} • Babak ${n}</span><input id="sub${id}_${n}" value="${prefix}${n}" maxlength="20" /></label>`).join("")}
    </div>
  </section>`;
}

function playerPanel(id: PlayerId): string {
  const side = id === 1 ? "A" : "B";
  return `<article class="player-panel player-${id}" data-player="${id}">
    <div class="player-status-row">
      <strong id="panelSubteam${id}" class="panel-subteam">${side}1</strong>
      <span id="playerQuestionCounter${id}" class="side-counter">1/10</span>
      <span id="handDot${id}" class="hand-dot"></span><span id="handText${id}">Tangan belum terdeteksi</span>
      <span id="lockState${id}" class="lock-state">SIAP</span>
    </div>
    <section id="questionCard${id}" class="side-question-card">
      <div class="side-question-head"><span id="sideChapter${id}">BABAK 1</span><strong id="sideTitle${id}">Soal</strong></div>
      <p id="sideStimulus${id}" class="side-stimulus"></p>
      <h2 id="sidePrompt${id}" class="side-prompt"></h2>
      <div id="sideGestureHint${id}" class="gesture-hint"></div>
    </section>
    <div id="answerMount${id}" class="answer-mount"></div>
    <div class="gesture-progress"><span id="gestureLabel${id}">Tunjukkan gesture</span><i><b id="gestureBar${id}"></b></i></div>
  </article>`;
}

const stage = must<HTMLElement>("#stage");
const video = must<HTMLVideoElement>("#cameraVideo");
const canvas = must<HTMLCanvasElement>("#handCanvas");
const startOverlay = must<HTMLElement>("#startOverlay");
const chapterOverlay = must<HTMLElement>("#chapterOverlay");
const finishOverlay = must<HTMLElement>("#finishOverlay");
const playerArea = must<HTMLElement>("#playerArea");
const setupStatus = must<HTMLElement>("#setupStatus");
const chapterTimer = must<HTMLElement>("#chapterTimer");
const cameraButton = must<HTMLButtonElement>("#cameraButton");
const startButton = must<HTMLButtonElement>("#startButton");
const cursorEls: Record<PlayerId, HTMLElement> = { 1: must("#cursor1"), 2: must("#cursor2") };

const tracker = new HandTracker(video, stage, canvas, {
  onFrames: handleFrames,
  onStatus: message => setupStatus.textContent = message,
  onError: (message, error) => { console.error(message, error); setupStatus.textContent = message; }
});

cameraButton.addEventListener("click", async () => {
  cameraButton.disabled = true;
  try {
    await tracker.startCamera();
    cameraReady = true;
    mouseMode = false;
    startButton.disabled = false;
    cameraButton.textContent = "Kamera Aktif ✓";
  } catch (error) {
    console.error(error);
    cameraButton.disabled = false;
    cameraButton.textContent = "Coba Aktifkan Kamera Lagi";
    setupStatus.textContent = friendlyCameraError(error);
  }
});

must<HTMLButtonElement>("#mouseButton").addEventListener("click", () => {
  mouseMode = true;
  startButton.disabled = false;
  setupStatus.textContent = "Mode mouse/touch aktif. Semua soal tetap dapat diuji tanpa kamera.";
});

startButton.addEventListener("click", () => {
  if (!cameraReady && !mouseMode) return;
  for (const id of [1,2] as const) {
    const prefix = id === 1 ? "A" : "B";
    teams[id].name = must<HTMLInputElement>(`#teamName${id}`).value.trim() || `Tim ${prefix}`;
    for (let n = 1; n <= 4; n += 1) {
      teams[id].subteams[n - 1]!.name = must<HTMLInputElement>(`#sub${id}_${n}`).value.trim() || `${prefix}${n}`;
    }
    must(`#playerName${id}`).textContent = teams[id].name;
  }
  startMatch();
});

must<HTMLButtonElement>("#chapterStartButton").addEventListener("click", () => {
  chapterOverlay.classList.add("hidden");
  chapterWaiting = false;
  startChapter();
});

must<HTMLButtonElement>("#againButton").addEventListener("click", startMatch);
must<HTMLButtonElement>("#homeButton").addEventListener("click", () => {
  stopChapterTimer();
  finishOverlay.classList.add("hidden");
  playerArea.classList.add("hidden");
  startOverlay.classList.remove("hidden");
});

must<HTMLButtonElement>("#fullscreenButton").addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (error) { console.warn(error); }
});

function startMatch(): void {
  stopChapterTimer();
  chapterTimedOut = false;
  for (const id of [1,2] as const) for (const sub of teams[id].subteams) sub.score = 0;
  sequences = buildSequences();
  currentChapter = 1;
  questionIndex = { 1: 0, 2: 0 };
  chapterDone = { 1: false, 2: false };
  chapterTransitionPending = false;
  updateScore(1); updateScore(2);
  startOverlay.classList.add("hidden");
  finishOverlay.classList.add("hidden");
  playerArea.classList.remove("hidden");
  showChapterIntro(1);
}

function buildSequences(): ChapterSequences {
  const byChapter: Question[][] = [1,2,3,4].map(ch => allQuestions.filter(q => q.chapter === ch));
  const result: ChapterSequences = { 1: [[],[],[],[]], 2: [[],[],[],[]] };
  byChapter.forEach((pool, chapterIdx) => {
    const limit = chapterIdx === 2 ? 5 : 10;
    const originalsA = shuffle(pool).slice(0, limit);
    const originalsB = derangedFrom(originalsA);
    result[1][chapterIdx] = originalsA.map(prepareQuestion);
    result[2][chapterIdx] = originalsB.map(prepareQuestion);
  });
  return result;
}

function derangedFrom<T>(items: readonly T[]): T[] {
  if (items.length <= 1) return [...items];
  const shift = 1 + Math.floor(Math.random() * (items.length - 1));
  return items.map((_, index) => items[(index + shift) % items.length]!);
}

function prepareQuestion(q: Question): PreparedQuestion {
  if (q.type === "single") return prepareSingle(q);
  if (q.type === "multi") return prepareMulti(q);
  return { ...q };
}

function prepareSingle(q: SingleQuestion): PreparedSingle {
  const items = q.options.map((text, index) => ({ text, correct: index === q.correct }));
  const randomized = shuffle(items);
  return { ...q, options: randomized.map(i => i.text), correct: randomized.findIndex(i => i.correct) };
}

function prepareMulti(q: MultiQuestion): PreparedMulti {
  const correctSet = new Set(q.correct);
  const items = q.options.map((text, index) => ({ text, correct: correctSet.has(index) }));
  const randomized = shuffle(items);
  return {
    ...q,
    options: randomized.map(i => i.text),
    correct: randomized.map((item, index) => item.correct ? index : -1).filter(index => index >= 0)
  };
}

function showChapterIntro(chapter: number): void {
  stopChapterTimer();
  chapterTimedOut = false;
  updateChapterTimerDisplay(CHAPTER_DURATION_MS);
  chapterWaiting = true;
  currentChapter = chapter;
  const info = chapterInfo(chapter);
  activateChapter(chapter);
  must("#chapterEyebrow").textContent = `BABAK ${chapter} DARI 4`;
  must("#chapterEmoji").textContent = info.emoji;
  must("#chapterName").textContent = info.name;
  must("#chapterMatchup").textContent = `${teams[1].subteams[chapter - 1]!.name}  VS  ${teams[2].subteams[chapter - 1]!.name}`;
  must("#chapterInstruction").textContent = info.instruction;
  chapterOverlay.classList.remove("hidden");
}

function startChapter(): void {
  questionIndex = { 1: 0, 2: 0 };
  chapterTimedOut = false;
  chapterDone = { 1: false, 2: false };
  chapterTransitionPending = false;
  activateChapter(currentChapter);
  must("#roundMeta").textContent = `BABAK ${currentChapter} • ${teams[1].subteams[currentChapter - 1]!.name} VS ${teams[2].subteams[currentChapter - 1]!.name} • soal berbeda`;
  for (const id of [1,2] as const) renderPlayerQuestion(id);
  startChapterTimer();
}

function currentQuestionFor(id: PlayerId): PreparedQuestion | null {
  return sequences[id][currentChapter - 1]?.[questionIndex[id]] ?? null;
}


function avoidCurrentCollision(id: PlayerId): void {
  const other: PlayerId = id === 1 ? 2 : 1;
  const mine = sequences[id][currentChapter - 1];
  const theirs = currentQuestionFor(other);
  const idx = questionIndex[id];
  const current = mine?.[idx];
  if (!mine || !current || !theirs || current.id !== theirs.id) return;
  const swapIndex = mine.findIndex((q, i) => i > idx && q.id !== theirs.id);
  if (swapIndex > idx) [mine[idx], mine[swapIndex]] = [mine[swapIndex]!, mine[idx]!];
}

function resetPlayerForQuestion(id: PlayerId): void {
  const p = players[id];
  p.submitted = false;
  p.answer = null;
  p.multiSelected = new Set();
  p.matchMap = {};
  pointerSelected[id] = undefined;
  resetGestureHold(id);
  lockPlayerPanel(id, false);
  setLockState(id, "SIAP", false);
  setGestureMessage(id, "Tunjukkan gesture", 0);
}

function renderPlayerQuestion(id: PlayerId): void {
  if (chapterDone[id]) return renderWaiting(id);
  avoidCurrentCollision(id);
  const q = currentQuestionFor(id);
  if (!q) return markChapterDone(id);
  resetPlayerForQuestion(id);

  const total = sequences[id][currentChapter - 1]!.length;
  must(`#playerQuestionCounter${id}`).textContent = `${questionIndex[id] + 1}/${total}`;
  must(`#sideChapter${id}`).textContent = `BABAK ${currentChapter}`;
  must(`#sideTitle${id}`).textContent = q.title;
  must(`#sideStimulus${id}`).textContent = q.stimulus;
  must(`#sidePrompt${id}`).textContent = q.prompt;
  must(`#sideGestureHint${id}`).innerHTML = gestureHint(q.type);
  must<HTMLElement>(`#questionCard${id}`).classList.remove("waiting-card");

  const mount = must<HTMLElement>(`#answerMount${id}`);
  mount.replaceChildren();
  if (q.type === "single") renderSingle(id, q, mount);
  else if (q.type === "boolean") renderBoolean(id, mount);
  else if (q.type === "matching") renderMatching(id, q, mount);
  else renderMulti(id, q, mount);
}

function renderSingle(id: PlayerId, q: PreparedSingle, mount: HTMLElement): void {
  const wrap = document.createElement("div"); wrap.className = "choice-grid";
  q.options.forEach((text, index) => {
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "choice-option";
    btn.dataset.index = String(index); btn.innerHTML = `<b>${letter(index)}</b><span>${escapeHtml(text)}</span>`;
    btn.addEventListener("click", () => selectSingle(id, index)); wrap.appendChild(btn);
  });
  const submit = document.createElement("button"); submit.type = "button"; submit.className = "submit-answer"; submit.dataset.action = "submit-single"; submit.textContent = "✊ Kunci Jawaban"; submit.addEventListener("click", () => lockSingle(id));
  mount.append(wrap, submit);
}

function renderBoolean(id: PlayerId, mount: HTMLElement): void {
  const wrap = document.createElement("div"); wrap.className = "boolean-grid";
  const yes = document.createElement("button"); yes.type = "button"; yes.className = "boolean-option true"; yes.dataset.value = "true"; yes.innerHTML = `<b>👍</b><span>BENAR</span>`; yes.addEventListener("click", () => selectBoolean(id, true));
  const no = document.createElement("button"); no.type = "button"; no.className = "boolean-option false"; no.dataset.value = "false"; no.innerHTML = `<b>👎</b><span>SALAH</span>`; no.addEventListener("click", () => selectBoolean(id, false));
  const submit = document.createElement("button"); submit.type = "button"; submit.className = "submit-answer"; submit.dataset.action = "submit-boolean"; submit.textContent = "✊ Kunci Jawaban"; submit.addEventListener("click", () => lockBoolean(id));
  wrap.append(yes, no); mount.append(wrap, submit);
}

function renderMatching(id: PlayerId, q: MatchingQuestion, mount: HTMLElement): void {
  const leftOrder = shuffle(q.pairs.map(pair => pair.id));
  const rightOrder = shuffle(q.pairs.map(pair => pair.id));
  const layout = document.createElement("div"); layout.className = "matching-layout";
  const left = document.createElement("div"); left.className = "match-left";
  leftOrder.forEach(pairId => {
    const pair = q.pairs.find(p => p.id === pairId); if (!pair) return;
    const card = document.createElement("button"); card.type = "button"; card.className = "match-card"; card.dataset.player = String(id); card.dataset.leftId = pair.id; card.textContent = pair.left;
    card.addEventListener("click", () => selectMatchCard(id, pair.id)); left.appendChild(card);
  });
  const right = document.createElement("div"); right.className = "match-right";
  rightOrder.forEach(pairId => {
    const pair = q.pairs.find(p => p.id === pairId); if (!pair) return;
    const target = document.createElement("button"); target.type = "button"; target.className = "match-target"; target.dataset.player = String(id); target.dataset.rightId = pair.id;
    target.innerHTML = `<span class="target-text">${escapeHtml(pair.right)}</span><small>Tarik pasangan ke sini</small>`;
    target.addEventListener("click", () => clickMatchTarget(id, pair.id)); right.appendChild(target);
  });
  const submit = document.createElement("button"); submit.type = "button"; submit.className = "submit-answer"; submit.dataset.action = "submit-match"; submit.textContent = "🔒 Kunci Jawaban"; submit.addEventListener("click", () => submitMatching(id));
  layout.append(left, right); mount.append(layout, submit);
}

function renderMulti(id: PlayerId, q: PreparedMulti, mount: HTMLElement): void {
  const wrap = document.createElement("div"); wrap.className = "multi-list";
  q.options.forEach((text, index) => {
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "multi-option"; btn.dataset.index = String(index);
    btn.innerHTML = `<span class="check-box">✓</span><span>${escapeHtml(text)}</span>`;
    btn.addEventListener("click", () => toggleMulti(id, index)); wrap.appendChild(btn);
  });
  const submit = document.createElement("button"); submit.type = "button"; submit.className = "submit-answer"; submit.dataset.action = "submit-multi"; submit.textContent = "✊ Kunci Jawaban"; submit.addEventListener("click", () => submitMulti(id));
  mount.append(wrap, submit);
}

function selectSingle(id: PlayerId, index: number): void {
  const q = currentQuestionFor(id); if (!canSubmit(id) || q?.type !== "single") return;
  players[id].answer = index;
  const mount = must<HTMLElement>(`#answerMount${id}`);
  mount.querySelectorAll<HTMLElement>(".choice-option").forEach(el => el.classList.toggle("selected", Number(el.dataset.index) === index));
  setLockState(id, `PILIHAN ${letter(index)} • BELUM DIKUNCI`, false);
  setGestureMessage(id, `${letter(index)} dipilih • ✊ untuk KUNCI`, 0);
}

function lockSingle(id: PlayerId): void {
  const q = currentQuestionFor(id); if (!canSubmit(id) || q?.type !== "single") return;
  if (typeof players[id].answer !== "number") { setGestureMessage(id, "Pilih A/B/C/D terlebih dahulu", 0); return; }
  const index = players[id].answer as number;
  finalizePlayerSubmission(id, index === q.correct);
}

function selectBoolean(id: PlayerId, value: boolean): void {
  const q = currentQuestionFor(id); if (!canSubmit(id) || q?.type !== "boolean") return;
  players[id].answer = value;
  const mount = must<HTMLElement>(`#answerMount${id}`);
  mount.querySelectorAll<HTMLElement>(".boolean-option").forEach(el => el.classList.toggle("selected", el.dataset.value === String(value)));
  setLockState(id, `${value ? "BENAR" : "SALAH"} • BELUM DIKUNCI`, false);
  setGestureMessage(id, `${value ? "BENAR" : "SALAH"} dipilih • ✊ untuk KUNCI`, 0);
}

function lockBoolean(id: PlayerId): void {
  const q = currentQuestionFor(id); if (!canSubmit(id) || q?.type !== "boolean") return;
  if (typeof players[id].answer !== "boolean") { setGestureMessage(id, "Pilih 👍 BENAR atau 👎 SALAH terlebih dahulu", 0); return; }
  const value = players[id].answer as boolean;
  finalizePlayerSubmission(id, value === q.correct);
}

function toggleMulti(id: PlayerId, index: number): void {
  const q = currentQuestionFor(id); if (!canSubmit(id) || q?.type !== "multi") return;
  const set = players[id].multiSelected;
  if (set.has(index)) set.delete(index); else set.add(index);
  const el = must<HTMLElement>(`#answerMount${id}`).querySelector<HTMLElement>(`.multi-option[data-index="${index}"]`);
  el?.classList.toggle("selected", set.has(index));
}

function submitMulti(id: PlayerId): void {
  const q = currentQuestionFor(id); if (!canSubmit(id) || q?.type !== "multi") return;
  if (players[id].multiSelected.size === 0) { setGestureMessage(id, "Pilih minimal satu jawaban", 0); return; }
  const selected = [...players[id].multiSelected].sort((a,b)=>a-b);
  players[id].answer = selected;
  const correctSet = new Set(q.correct);
  const pickedCorrect = selected.filter(i => correctSet.has(i)).length;
  const pickedWrong = selected.filter(i => !correctSet.has(i)).length;
  const perfect = pickedWrong === 0 && pickedCorrect === correctSet.size;
  const gained = Math.max(0, pickedCorrect * APP_CONFIG.scoring.multiCorrectPick + pickedWrong * APP_CONFIG.scoring.multiWrongPick + (perfect ? APP_CONFIG.scoring.multiPerfectBonus : 0));
  finalizePlayerSubmission(id, perfect, gained, `${pickedCorrect}/${correctSet.size} tepat`);
}

function selectMatchCard(id: PlayerId, leftId: string): void {
  const q = currentQuestionFor(id); if (!canSubmit(id) || q?.type !== "matching") return;
  pointerSelected[id] = leftId;
  const mount = must<HTMLElement>(`#answerMount${id}`);
  mount.querySelectorAll(".match-card").forEach(el => el.classList.toggle("selected", (el as HTMLElement).dataset.leftId === leftId));
}

function clickMatchTarget(id: PlayerId, rightId: string): void {
  const q = currentQuestionFor(id); const leftId = pointerSelected[id];
  if (!leftId || !canSubmit(id) || q?.type !== "matching") return;
  assignMatch(id, leftId, rightId); pointerSelected[id] = undefined;
}

function assignMatch(id: PlayerId, leftId: string, rightId: string): void {
  const q = currentQuestionFor(id); if (q?.type !== "matching") return;
  const map = players[id].matchMap;
  for (const key of Object.keys(map)) if (map[key] === rightId || key === leftId) delete map[key];
  map[leftId] = rightId;
  refreshMatchingUI(id);
  if (Object.keys(map).length === q.pairs.length && canSubmit(id)) {
    setGestureMessage(id, "Semua pasangan terisi • ✊ untuk KUNCI", 0);
    setLockState(id, "SIAP DIKUNCI", false);
  }
}

function refreshMatchingUI(id: PlayerId): void {
  const q = currentQuestionFor(id); if (q?.type !== "matching") return;
  const mount = must<HTMLElement>(`#answerMount${id}`);
  mount.querySelectorAll<HTMLElement>(".match-card").forEach(card => {
    card.classList.toggle("assigned", Boolean(players[id].matchMap[card.dataset.leftId!]));
    card.classList.remove("selected");
  });
  mount.querySelectorAll<HTMLElement>(".match-target").forEach(target => {
    const rightId = target.dataset.rightId!;
    const leftId = Object.keys(players[id].matchMap).find(key => players[id].matchMap[key] === rightId);
    const small = target.querySelector("small");
    if (leftId) {
      const pair = q.pairs.find(p => p.id === leftId);
      target.classList.add("filled"); if (small) small.textContent = pair?.left ?? "Terpasang";
    } else {
      target.classList.remove("filled"); if (small) small.textContent = "Tarik pasangan ke sini";
    }
  });
}

function submitMatching(id: PlayerId): void {
  const q = currentQuestionFor(id); if (!canSubmit(id) || q?.type !== "matching") return;
  const map = players[id].matchMap;
  if (Object.keys(map).length !== q.pairs.length) { setGestureMessage(id, "Lengkapi semua pasangan", 0); return; }
  players[id].answer = { ...map };
  const correctCount = q.pairs.filter(pair => map[pair.id] === pair.id).length;
  const perfect = correctCount === q.pairs.length;
  const gained = correctCount * APP_CONFIG.scoring.matchPair + (perfect ? APP_CONFIG.scoring.matchPerfectBonus : 0);
  finalizePlayerSubmission(id, perfect, gained, `${correctCount}/${q.pairs.length} tepat`);
}

function finalizePlayerSubmission(id: PlayerId, correct: boolean, customScore?: number, detail?: string): void {
  if (!canSubmit(id)) return;
  const p = players[id]; p.submitted = true;
  const gained = customScore ?? (correct ? APP_CONFIG.scoring.correct : 0);
  activeSubteam(id).score += gained;
  updateScore(id);
  lockPlayerPanel(id, true);
  setLockState(id, `TERKUNCI • +${gained}`, true);
  setGestureMessage(id, detail ? `${detail} • lanjut otomatis` : "Jawaban terkunci • lanjut otomatis", 100);
  window.setTimeout(() => advancePlayer(id), AUTO_ADVANCE_MS);
}

function advancePlayer(id: PlayerId): void {
  if (chapterWaiting || chapterDone[id]) return;
  questionIndex[id] += 1;
  const total = sequences[id][currentChapter - 1]!.length;
  if (questionIndex[id] >= total) markChapterDone(id);
  else renderPlayerQuestion(id);
}

function markChapterDone(id: PlayerId): void {
  if (chapterDone[id]) return;
  chapterDone[id] = true;
  renderWaiting(id);
  if (chapterDone[1] && chapterDone[2] && !chapterTransitionPending) {
    stopChapterTimer();
    chapterTransitionPending = true;
    window.setTimeout(() => {
      if (currentChapter >= 4) finishMatch();
      else showChapterIntro(currentChapter + 1);
    }, 900);
  }
}

function renderWaiting(id: PlayerId): void {
  const total = sequences[id][currentChapter - 1]!.length;
  must(`#playerQuestionCounter${id}`).textContent = `${total}/${total}`;
  must(`#sideChapter${id}`).textContent = `BABAK ${currentChapter} SELESAI`;
  must(`#sideTitle${id}`).textContent = chapterTimedOut ? "Waktu Habis" : "Menunggu lawan";
  must(`#sideStimulus${id}`).textContent = chapterTimedOut ? "Waktu 7 menit untuk babak ini telah habis. Skor jawaban yang sudah dikunci tetap disimpan." : "Semua soal untuk sub-tim ini sudah selesai. Skor telah disimpan.";
  must(`#sidePrompt${id}`).textContent = chapterTimedOut ? "Bersiap menuju babak berikutnya…" : (chapterDone[id === 1 ? 2 : 1] ? "Bersiap menuju babak berikutnya…" : "Tunggu sub-tim lawan menyelesaikan soal mereka.");
  must(`#sideGestureHint${id}`).textContent = "Tidak perlu melakukan gesture.";
  must<HTMLElement>(`#questionCard${id}`).classList.add("waiting-card");
  must<HTMLElement>(`#answerMount${id}`).replaceChildren();
  lockPlayerPanel(id, true);
  setLockState(id, "SELESAI", true);
  setGestureMessage(id, "Babak selesai", 100);
}

function finishMatch(): void {
  stopChapterTimer();
  chapterWaiting = true;
  playerArea.classList.add("hidden");
  const total1 = teamTotal(1), total2 = teamTotal(2);
  must("#finalName1").textContent = teams[1].name;
  must("#finalName2").textContent = teams[2].name;
  must("#finalScore1").textContent = String(total1);
  must("#finalScore2").textContent = String(total2);
  must("#winnerTitle").textContent = total1 === total2 ? "Hasil Seri!" : `${total1 > total2 ? teams[1].name : teams[2].name} Menang!`;
  must("#finalBreakdown").innerHTML = [1,2,3,4].map(chapter => {
    const left = teams[1].subteams[chapter - 1]!, right = teams[2].subteams[chapter - 1]!;
    return `<div><span>Babak ${chapter}</span><strong>${escapeHtml(left.name)} <b>${left.score}</b></strong><em>VS</em><strong>${escapeHtml(right.name)} <b>${right.score}</b></strong></div>`;
  }).join("");
  finishOverlay.classList.remove("hidden");
}

function canSubmit(id: PlayerId): boolean {
  return !chapterWaiting && !chapterDone[id] && !players[id].submitted && Boolean(currentQuestionFor(id));
}
function activeSubteam(id: PlayerId): SubTeamState { return teams[id].subteams[currentChapter - 1]!; }
function teamTotal(id: PlayerId): number { return teams[id].subteams.reduce((sum, sub) => sum + sub.score, 0); }

function activateChapter(chapter: number): void {
  for (const id of [1,2] as const) {
    const sub = teams[id].subteams[chapter - 1]!;
    must(`#activeSubName${id}`).textContent = sub.name;
    must(`#activeSubScore${id}`).textContent = String(sub.score);
    must(`#panelSubteam${id}`).textContent = sub.name;
  }
  updateScore(1); updateScore(2);
}

function updateScore(id: PlayerId): void {
  const el = must<HTMLElement>(`#score${id}`); el.textContent = String(teamTotal(id));
  el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop");
  const active = teams[id].subteams[currentChapter - 1]!;
  const activeName = document.querySelector<HTMLElement>(`#activeSubName${id}`);
  const activeScore = document.querySelector<HTMLElement>(`#activeSubScore${id}`);
  if (activeName) activeName.textContent = active.name;
  if (activeScore) activeScore.textContent = String(active.score);
  teams[id].subteams.forEach((sub, index) => {
    const mini = document.querySelector<HTMLElement>(`#mini${id}_${index + 1}`);
    if (!mini) return;
    mini.innerHTML = `${escapeHtml(sub.name)}: <b>${sub.score}</b>`;
    mini.classList.toggle("active", index === currentChapter - 1);
  });
}

function lockPlayerPanel(id: PlayerId, locked: boolean): void {
  must<HTMLElement>(`.player-panel[data-player="${id}"]`).classList.toggle("locked", locked);
  must<HTMLElement>(`#answerMount${id}`).querySelectorAll<HTMLButtonElement>("button").forEach(btn => btn.disabled = locked);
}
function setLockState(id: PlayerId, text: string, locked: boolean): void {
  const el = must<HTMLElement>(`#lockState${id}`); el.textContent = text; el.classList.toggle("locked", locked);
}

function handleFrames(frames: Map<PlayerId, HandFrame>): void {
  const now = performance.now();
  for (const id of [1,2] as const) {
    const frame = frames.get(id); const cursor = cursorEls[id];
    if (frame) {
      lastSeen[id] = now;
      cursor.classList.add("visible"); cursor.classList.toggle("pinching", frame.pinch);
      cursor.style.transform = `translate3d(${frame.cursor.x}px, ${frame.cursor.y}px, 0) translate(-50%, -50%)`;
      must(`#handDot${id}`).classList.add("online");
      must(`#handText${id}`).textContent = frame.fist
        ? `✊ Kunci terdeteksi (${Math.round(frame.fistScore * 100)}%)`
        : frame.pinch ? "Pinch terdeteksi" : "Tangan terdeteksi";
      if (!mouseMode && canSubmit(id)) handleGesture(id, frame, now);
      previousPinch[id] = frame.pinch;
    } else {
      const missingFor = now - lastSeen[id];
      if (gestureHold[id].key.startsWith("lock-") && missingFor > APP_CONFIG.lockDropoutGraceMs) {
        resetGestureHold(id);
      }
      if (missingFor > APP_CONFIG.handLostCancelMs) {
        cursor.classList.remove("visible", "pinching");
        must(`#handDot${id}`).classList.remove("online"); must(`#handText${id}`).textContent = "Tangan belum terdeteksi";
        if (gestureDrag[id]) cancelGestureDrag(id);
        previousPinch[id] = false; resetGestureHold(id);
      }
    }
  }
}

function handleGesture(id: PlayerId, frame: HandFrame, now: number): void {
  const q = currentQuestionFor(id); if (!q || now < gestureCooldownUntil[id]) return;
  const fist = frame.fist;

  if (q.type === "single") {
    if (fist) {
      handleHeldGesture(id, "lock-single", now, "✊ tahan untuk KUNCI", () => lockSingle(id), APP_CONFIG.lockHoldMs);
      return;
    }
    const choice = classifySingleChoiceGesture(frame.landmarks);
    handleHeldGesture(id, choice ? `single-${choice.index}` : "", now, choice ? `${choice.emoji} → ${letter(choice.index)} (belum dikunci)` : "☝️ A • ✌️ B • 🤟 C • ✋ D", () => selectSingle(id, choice!.index));
    return;
  }

  if (q.type === "boolean") {
    if (fist) {
      handleHeldGesture(id, "lock-boolean", now, "✊ tahan untuk KUNCI", () => lockBoolean(id), APP_CONFIG.lockHoldMs);
      return;
    }
    const dir = thumbDirection(frame.landmarks); const key = dir === 1 ? "true" : dir === -1 ? "false" : "";
    handleHeldGesture(id, key, now, dir === 1 ? "👍 BENAR (belum dikunci)" : dir === -1 ? "👎 SALAH (belum dikunci)" : "👍 BENAR • 👎 SALAH • ✊ KUNCI", () => selectBoolean(id, dir === 1));
    return;
  }

  if (q.type === "matching") {
    if (frame.pinch && !previousPinch[id]) startGestureDrag(id, frame.cursor.x, frame.cursor.y);
    if (frame.pinch && gestureDrag[id]) moveGestureDrag(id, frame.cursor.x, frame.cursor.y);
    if (!frame.pinch && previousPinch[id] && gestureDrag[id]) endGestureDrag(id, frame.cursor.x, frame.cursor.y);
    else if (frame.pinch && !previousPinch[id] && !gestureDrag[id]) triggerPinchTarget(id, frame.cursor.x, frame.cursor.y);
    if (!frame.pinch && !gestureDrag[id]) {
      handleHeldGesture(id, fist ? "lock-match" : "", now, fist ? "✊ tahan untuk KUNCI" : "🤏 susun pasangan • ✊ kunci", () => submitMatching(id), APP_CONFIG.lockHoldMs);
    }
    return;
  }

  if (q.type === "multi") {
    if (frame.pinch && !previousPinch[id]) triggerPinchTarget(id, frame.cursor.x, frame.cursor.y);
    handleHeldGesture(id, fist ? "lock-multi" : "", now, fist ? "✊ tahan untuk KUNCI" : "🤏 pilih/batalkan • ✊ kunci", () => submitMulti(id), APP_CONFIG.lockHoldMs);
  }
}

function handleHeldGesture(id: PlayerId, key: string, now: number, label: string, fire: () => void, durationMs: number = APP_CONFIG.gestureHoldMs): void {
  const hold = gestureHold[id];
  const continuingLock = hold.key.startsWith("lock-");

  if (!key) {
    if (continuingLock && now - hold.lastActiveAt <= APP_CONFIG.lockDropoutGraceMs) {
      hold.lastUpdateAt = now;
      const progress = Math.min(1, hold.accumulatedMs / durationMs);
      setGestureMessage(id, "✊ sinyal sesaat hilang • pertahankan kepalan", progress * 100);
      return;
    }
    resetGestureHold(id);
    setGestureMessage(id, label, 0);
    return;
  }

  if (hold.key !== key) {
    hold.key = key;
    hold.accumulatedMs = 0;
    hold.lastUpdateAt = now;
    hold.lastActiveAt = now;
    hold.fired = false;
  } else {
    const delta = Math.min(APP_CONFIG.maxHoldFrameDeltaMs, Math.max(0, now - hold.lastUpdateAt));
    hold.accumulatedMs += delta;
    hold.lastUpdateAt = now;
    hold.lastActiveAt = now;
  }

  const progress = Math.min(1, hold.accumulatedMs / durationMs);
  setGestureMessage(id, label, progress * 100);
  if (progress >= 1 && !hold.fired) {
    hold.fired = true;
    const cooldown = key.startsWith("lock-") ? APP_CONFIG.gestureCooldownMs : APP_CONFIG.selectionCooldownMs;
    gestureCooldownUntil[id] = now + cooldown;
    fire();
  }
}
function resetGestureHold(id: PlayerId): void {
  gestureHold[id] = { key: "", accumulatedMs: 0, lastUpdateAt: 0, lastActiveAt: 0, fired: false };
}
function setGestureMessage(id: PlayerId, label: string, pct: number): void {
  must(`#gestureLabel${id}`).textContent = label;
  must<HTMLElement>(`#gestureBar${id}`).style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

function triggerPinchTarget(id: PlayerId, x: number, y: number): void {
  const q = currentQuestionFor(id); if (!q) return;
  const target = document.elementFromPoint(x, y) as HTMLElement | null; if (!target) return;
  if (!target.closest<HTMLElement>(`.player-panel[data-player="${id}"]`)) return;
  if (q.type === "single" && target.closest<HTMLElement>("[data-action='submit-single']")) lockSingle(id);
  if (q.type === "boolean" && target.closest<HTMLElement>("[data-action='submit-boolean']")) lockBoolean(id);
  if (q.type === "multi") {
    const option = target.closest<HTMLElement>(".multi-option"); if (option) toggleMulti(id, Number(option.dataset.index));
    if (target.closest<HTMLElement>("[data-action='submit-multi']")) submitMulti(id);
  }
  if (q.type === "matching" && target.closest<HTMLElement>("[data-action='submit-match']")) submitMatching(id);
}

function startGestureDrag(id: PlayerId, x: number, y: number): void {
  const q = currentQuestionFor(id); if (q?.type !== "matching") return;
  const target = document.elementFromPoint(x, y) as HTMLElement | null;
  const card = target?.closest<HTMLElement>(`.match-card[data-player="${id}"]`);
  if (!card) { triggerPinchTarget(id, x, y); return; }
  const leftId = card.dataset.leftId!;
  const ghost = document.createElement("div"); ghost.className = `drag-ghost player-${id}`; ghost.textContent = card.textContent ?? ""; document.body.appendChild(ghost);
  gestureDrag[id] = { leftId, ghost }; moveGestureDrag(id, x, y); card.classList.add("dragging");
}
function moveGestureDrag(id: PlayerId, x: number, y: number): void {
  const drag = gestureDrag[id]; if (!drag) return; drag.ghost.style.left = `${x}px`; drag.ghost.style.top = `${y}px`;
}
function endGestureDrag(id: PlayerId, x: number, y: number): void {
  const drag = gestureDrag[id]; if (!drag) return;
  const target = document.elementFromPoint(x, y) as HTMLElement | null;
  const box = target?.closest<HTMLElement>(`.match-target[data-player="${id}"]`);
  if (box?.dataset.rightId) assignMatch(id, drag.leftId, box.dataset.rightId);
  cancelGestureDrag(id);
}
function cancelGestureDrag(id: PlayerId): void {
  const drag = gestureDrag[id]; if (!drag) return; drag.ghost.remove(); delete gestureDrag[id];
  must<HTMLElement>(`#answerMount${id}`).querySelectorAll(".match-card.dragging").forEach(el => el.classList.remove("dragging"));
}

interface SingleGestureChoice { index: number; emoji: string; }

function classifySingleChoiceGesture(points: {x:number;y:number}[]): SingleGestureChoice | null {
  const f = fingerFlags(points);
  const thumb = thumbDirection(points);
  if (f.index && !f.middle && !f.ring && !f.pinky) return { index: 0, emoji: "☝️" };
  if (f.index && f.middle && !f.ring && !f.pinky) return { index: 1, emoji: "✌️" };
  if (f.index && !f.middle && !f.ring && f.pinky && isThumbExtendedForILoveYou(points)) return { index: 2, emoji: "🤟" };
  if (f.index && f.middle && f.ring && f.pinky) return { index: 3, emoji: "✋" };
  return null;
}

function fingerFlags(points: {x:number;y:number}[]): {index:boolean;middle:boolean;ring:boolean;pinky:boolean} {
  const extended = (mcp:number, pip:number, tip:number): boolean => {
    const a = points[mcp], b = points[pip], c = points[tip], wrist = points[0];
    if (!a || !b || !c || !wrist) return false;
    const straight = angleDeg(a,b,c) > 150;
    const farther = distance(wrist,c) > distance(wrist,b) * 1.10;
    return straight && farther;
  };
  return {
    index: extended(5,6,8),
    middle: extended(9,10,12),
    ring: extended(13,14,16),
    pinky: extended(17,18,20)
  };
}

function isThumbExtendedForILoveYou(points: {x:number;y:number}[]): boolean {
  const wrist = points[0], thumbMcp = points[2], thumbIp = points[3], thumbTip = points[4];
  const indexMcp = points[5], pinkyMcp = points[17];
  if (!wrist || !thumbMcp || !thumbIp || !thumbTip || !indexMcp || !pinkyMcp) return false;

  // ILY: ibu jari harus benar-benar keluar dari telapak, tetapi boleh miring
  // ke samping/atas sehingga tidak bergantung pada tangan kiri/kanan.
  const palmWidth = Math.max(24, distance(indexMcp, pinkyMcp));
  const thumbReach = distance(thumbTip, thumbMcp);
  const thumbFromPalm = Math.min(distance(thumbTip, indexMcp), distance(thumbTip, pinkyMcp));
  const thumbStraight = angleDeg(thumbMcp, thumbIp, thumbTip) > 135;

  return thumbStraight && thumbReach > palmWidth * 0.42 && thumbFromPalm > palmWidth * 0.33;
}


function countExtendedFingers(points: {x:number;y:number}[]): number {
  const fingers = [[5,6,8],[9,10,12],[13,14,16],[17,18,20]] as const;
  let count = 0;
  for (const [mcp,pip,tip] of fingers) {
    const a = points[mcp], b = points[pip], c = points[tip]; if (!a || !b || !c) continue;
    if (angleDeg(a,b,c) > 155) count += 1;
  }
  return count;
}
function thumbDirection(points: {x:number;y:number}[]): -1|0|1 {
  const wrist = points[0], thumb = points[4], middleMcp = points[9]; if (!wrist || !thumb || !middleMcp) return 0;
  if (countExtendedFingers(points) > 1) return 0;
  const scale = Math.max(30, distance(wrist, middleMcp));
  if (thumb.y < wrist.y - scale * 0.65) return 1;
  if (thumb.y > wrist.y + scale * 0.35) return -1;
  return 0;
}
function angleDeg(a:{x:number;y:number}, b:{x:number;y:number}, c:{x:number;y:number}): number {
  const v1 = {x:a.x-b.x,y:a.y-b.y}, v2 = {x:c.x-b.x,y:c.y-b.y};
  const dot = v1.x*v2.x+v1.y*v2.y, mag = Math.hypot(v1.x,v1.y)*Math.hypot(v2.x,v2.y); if (!mag) return 0;
  return Math.acos(Math.max(-1,Math.min(1,dot/mag))) * 180 / Math.PI;
}
function distance(a:{x:number;y:number}, b:{x:number;y:number}): number { return Math.hypot(a.x-b.x,a.y-b.y); }


function startChapterTimer(): void {
  stopChapterTimer();
  chapterEndsAt = Date.now() + CHAPTER_DURATION_MS;
  updateChapterTimer();
  chapterTimerId = window.setInterval(updateChapterTimer, 250);
}

function stopChapterTimer(): void {
  if (chapterTimerId !== null) {
    window.clearInterval(chapterTimerId);
    chapterTimerId = null;
  }
}

function updateChapterTimer(): void {
  const remaining = Math.max(0, chapterEndsAt - Date.now());
  updateChapterTimerDisplay(remaining);
  if (remaining <= 0) handleChapterTimeout();
}

function updateChapterTimerDisplay(remainingMs: number): void {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  chapterTimer.textContent = `${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}`;
  chapterTimer.classList.toggle("warning", totalSeconds <= 60 && totalSeconds > 0);
  chapterTimer.classList.toggle("expired", totalSeconds === 0);
}

function handleChapterTimeout(): void {
  if (chapterTimedOut || chapterWaiting || (chapterDone[1] && chapterDone[2])) return;
  chapterTimedOut = true;
  stopChapterTimer();
  for (const id of [1,2] as const) {
    if (gestureDrag[id]) cancelGestureDrag(id);
    if (!chapterDone[id]) markChapterDone(id);
  }
}

function chapterInfo(chapter: number): {name:string;emoji:string;instruction:string} {
  if (chapter === 1) return { name:"Pilihan Ganda", emoji:"☝️", instruction:"Waktu 7 menit. Gunakan ☝️ untuk A, ✌️ untuk B, 👍 untuk C, dan ✋ untuk D. Pilihan dapat diganti. Tahan ✊ untuk mengunci; setelah terkunci otomatis lanjut." };
  if (chapter === 2) return { name:"Benar / Salah", emoji:"👍", instruction:"Waktu 7 menit. Gunakan 👍 untuk BENAR atau 👎 untuk SALAH. Pilihan dapat diganti sampai Anda menahan ✊ untuk mengunci." };
  if (chapter === 3) return { name:"Menjodohkan", emoji:"🤏", instruction:"Waktu 7 menit. Pinch kartu, geser ke pasangan, lalu lepas. Pasangan masih dapat diubah. Setelah yakin, tahan ✊ untuk mengunci dan lanjut." };
  return { name:"Pilihan Lebih dari 1", emoji:"✊", instruction:"Waktu 7 menit. Gunakan telunjuk sebagai pointer dan pinch untuk memilih atau membatalkan beberapa opsi. Tahan ✊ untuk mengunci dan lanjut." };
}
function gestureHint(type: PreparedQuestion["type"]): string {
  if (type === "single") return `<b>GESTURE:</b> ☝️ A &nbsp; ✌️ B &nbsp; 🤟 C &nbsp; ✋ D &nbsp; • &nbsp; ✊ KUNCI`;
  if (type === "boolean") return `<b>GESTURE:</b> 👍 BENAR &nbsp; • &nbsp; 👎 SALAH &nbsp; • &nbsp; ✊ KUNCI`;
  if (type === "matching") return `<b>GESTURE:</b> ☝️ arahkan → 🤏 ambil → geser → 🖐️ lepas &nbsp; • &nbsp; ✊ KUNCI`;
  return `<b>GESTURE:</b> ☝️ pointer + 🤏 pilih &nbsp; • &nbsp; ✊ kunci`;
}

function letter(index: number): string { return String.fromCharCode(65 + index); }
function shuffle<T>(items: readonly T[]): T[] {
  const a = [...items]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a;
}
function must<T extends Element = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector); if (!el) throw new Error(`Elemen tidak ditemukan: ${selector}`); return el;
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch] ?? ch));
}
function friendlyCameraError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") return "Izin kamera ditolak. Izinkan kamera lalu coba lagi.";
    if (error.name === "NotFoundError") return "Kamera tidak ditemukan.";
    if (error.name === "NotReadableError") return "Kamera sedang digunakan aplikasi lain.";
  }
  return `Gagal mengaktifkan kamera: ${error instanceof Error ? error.message : String(error)}`;
}

window.addEventListener("beforeunload", () => tracker.stop());
