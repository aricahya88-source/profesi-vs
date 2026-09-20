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

type MatchMap = Record<string, string>;
interface PlayerState {
  submitted: boolean;
  submittedAt: number;
  answer: unknown;
  multiSelected: Set<number>;
  matchMap: MatchMap;
}

interface SubTeamState {
  name: string;
  score: number;
}

interface TeamState {
  name: string;
  subteams: SubTeamState[];
}

interface HoldState {
  key: string;
  since: number;
  fired: boolean;
}

const players: Record<PlayerId, PlayerState> = {
  1: { submitted: false, submittedAt: 0, answer: null, multiSelected: new Set(), matchMap: {} },
  2: { submitted: false, submittedAt: 0, answer: null, multiSelected: new Set(), matchMap: {} }
};

const teams: Record<PlayerId, TeamState> = {
  1: { name: "Tim A", subteams: [1, 2, 3, 4].map(n => ({ name: `A${n}`, score: 0 })) },
  2: { name: "Tim B", subteams: [1, 2, 3, 4].map(n => ({ name: `B${n}`, score: 0 })) }
};

let sequence: PreparedQuestion[] = [];
let roundIndex = 0;
let currentQuestion: PreparedQuestion | null = null;
let roundStartedAt = 0;
let cameraReady = false;
let mouseMode = false;
let chapterWaiting = false;
let fastestBonusApplied = false;
let lastSeen: Record<PlayerId, number> = { 1: 0, 2: 0 };
let previousPinch: Record<PlayerId, boolean> = { 1: false, 2: false };
let gestureHold: Record<PlayerId, HoldState> = {
  1: { key: "", since: 0, fired: false },
  2: { key: "", since: 0, fired: false }
};
let gestureCooldownUntil: Record<PlayerId, number> = { 1: 0, 2: 0 };

interface DragState {
  leftId: string;
  ghost: HTMLElement;
}
const gestureDrag: Partial<Record<PlayerId, DragState>> = {};
let pointerSelected: Partial<Record<PlayerId, string>> = {};
let matchingLeftOrder: string[] = [];
let matchingRightOrder: string[] = [];

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
        <button id="fullscreenButton" class="icon-btn" type="button" aria-label="Layar penuh">⛶</button>
      </div>
    </header>

    <section class="score-row" aria-label="Skor pemain">
      ${scoreCard(1)}
      <div class="vs-medallion">VS</div>
      ${scoreCard(2)}
    </section>

    <section id="questionPanel" class="question-panel hidden">
      <div class="question-head">
        <div><span id="chapterBadge" class="chapter-badge">BABAK 1</span><span id="questionTitle" class="question-title">Judul</span></div>
        <span id="questionCounter" class="counter">1 / 35</span>
      </div>
      <p id="stimulus" class="stimulus"></p>
      <h1 id="prompt" class="prompt"></h1>
      <div id="gestureHint" class="gesture-hint"></div>
    </section>

    <section id="playerArea" class="player-area hidden">
      ${playerPanel(1)}
      ${playerPanel(2)}
    </section>

    <div id="cursor1" class="gesture-cursor p1" aria-hidden="true"><span>1</span></div>
    <div id="cursor2" class="gesture-cursor p2" aria-hidden="true"><span>2</span></div>

    <section id="explanationPanel" class="explanation-panel hidden" aria-live="polite">
      <div class="explanation-head"><span>PEMBAHASAN</span><strong id="correctAnswerText"></strong></div>
      <p id="explanationText"></p>
      <div class="explanation-actions"><button id="nextButton" class="button primary" type="button">Soal Berikutnya →</button></div>
    </section>

    <section id="startOverlay" class="overlay">
      <div class="dialog start-dialog">
        <span class="eyebrow">STATIC WEB • MEDIAPIPE • 2 TIM • 8 SUB-TIM</span>
        <h1>Professional & Ethics Battle</h1>
        <p class="lead">Dua tim besar berkompetisi melalui empat sub-tim. <strong>A1 vs B1</strong> bermain Pilihan Ganda, <strong>A2 vs B2</strong> Benar/Salah, <strong>A3 vs B3</strong> Menjodohkan, dan <strong>A4 vs B4</strong> Pilihan Lebih dari 1. Skor sub-tim otomatis dijumlahkan ke tim besar.</p>
        <div class="team-setup-grid">
          ${teamSetupCard(1)}
          ${teamSetupCard(2)}
        </div>
        <div class="round-list">
          <div><b>1</b><span><strong>Pilihan Ganda</strong><small>10 soal • ☝️ 1–4 jari = A–D</small></span></div>
          <div><b>2</b><span><strong>Benar / Salah</strong><small>10 soal • 👍 / 👎</small></span></div>
          <div><b>3</b><span><strong>Menjodohkan</strong><small>5 soal • 🤏 drag & drop</small></span></div>
          <div><b>4</b><span><strong>Pilihan Lebih dari 1</strong><small>10 soal • pointer + 🤏</small></span></div>
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
  return `<article class="player-panel player-${id}" data-player="${id}">
    <div class="player-status-row"><strong id="panelSubteam${id}" class="panel-subteam">${id === 1 ? "A1" : "B1"}</strong><span id="handDot${id}" class="hand-dot"></span><span id="handText${id}">Tangan belum terdeteksi</span><span id="lockState${id}" class="lock-state">SIAP</span></div>
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
const questionPanel = must<HTMLElement>("#questionPanel");
const playerArea = must<HTMLElement>("#playerArea");
const explanationPanel = must<HTMLElement>("#explanationPanel");
const setupStatus = must<HTMLElement>("#setupStatus");
const cameraButton = must<HTMLButtonElement>("#cameraButton");
const startButton = must<HTMLButtonElement>("#startButton");
const cursorEls: Record<PlayerId, HTMLElement> = { 1: must("#cursor1"), 2: must("#cursor2") };

const tracker = new HandTracker(video, stage, canvas, {
  onFrames: handleFrames,
  onStatus: (message) => setupStatus.textContent = message,
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
  for (const id of [1, 2] as const) {
    const prefix = id === 1 ? "A" : "B";
    teams[id].name = must<HTMLInputElement>(`#teamName${id}`).value.trim() || `Tim ${prefix}`;
    for (let n = 1; n <= 4; n += 1) {
      teams[id].subteams[n - 1]!.name = must<HTMLInputElement>(`#sub${id}_${n}`).value.trim() || `${prefix}${n}`;
    }
  }
  must("#playerName1").textContent = teams[1].name;
  must("#playerName2").textContent = teams[2].name;
  startMatch();
});

must<HTMLButtonElement>("#chapterStartButton").addEventListener("click", () => {
  chapterOverlay.classList.add("hidden");
  chapterWaiting = false;
  renderRound();
});

must<HTMLButtonElement>("#nextButton").addEventListener("click", advanceRound);
must<HTMLButtonElement>("#againButton").addEventListener("click", startMatch);
must<HTMLButtonElement>("#homeButton").addEventListener("click", () => {
  finishOverlay.classList.add("hidden");
  questionPanel.classList.add("hidden");
  playerArea.classList.add("hidden");
  explanationPanel.classList.add("hidden");
  startOverlay.classList.remove("hidden");
});

must<HTMLButtonElement>("#fullscreenButton").addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (error) { console.warn(error); }
});

function startMatch(): void {
  for (const id of [1, 2] as const) for (const sub of teams[id].subteams) sub.score = 0;
  sequence = buildSequence();
  roundIndex = 0;
  currentQuestion = sequence[0] ?? null;
  updateScore(1); updateScore(2);
  startOverlay.classList.add("hidden");
  finishOverlay.classList.add("hidden");
  explanationPanel.classList.add("hidden");
  questionPanel.classList.remove("hidden");
  playerArea.classList.remove("hidden");
  showChapterIntro(1);
}

function buildSequence(): PreparedQuestion[] {
  const singles = shuffle(allQuestions.filter((q): q is SingleQuestion => q.type === "single")).map(prepareSingle);
  const bools = shuffle(allQuestions.filter((q): q is BooleanQuestion => q.type === "boolean"));
  const matches = shuffle(allQuestions.filter((q): q is MatchingQuestion => q.type === "matching"));
  const multis = shuffle(allQuestions.filter((q): q is MultiQuestion => q.type === "multi")).map(prepareMulti);
  return [...singles.slice(0, 10), ...bools.slice(0, 10), ...matches.slice(0, 5), ...multis.slice(0, 10)];
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
  return { ...q, options: randomized.map(i => i.text), correct: randomized.map((i, index) => i.correct ? index : -1).filter(i => i >= 0) };
}

function showChapterIntro(chapter: number): void {
  chapterWaiting = true;
  const info = chapterInfo(chapter);
  activateChapter(chapter);
  must("#chapterEyebrow").textContent = `BABAK ${chapter} DARI 4`;
  must("#chapterEmoji").textContent = info.emoji;
  must("#chapterName").textContent = info.name;
  must("#chapterMatchup").textContent = `${teams[1].subteams[chapter - 1]!.name}  VS  ${teams[2].subteams[chapter - 1]!.name}`;
  must("#chapterInstruction").textContent = info.instruction;
  chapterOverlay.classList.remove("hidden");
}

function renderRound(): void {
  currentQuestion = sequence[roundIndex] ?? null;
  if (!currentQuestion) return finishMatch();
  resetRoundState();
  roundStartedAt = performance.now();
  fastestBonusApplied = false;
  const q = currentQuestion;
  const info = chapterInfo(q.chapter);
  activateChapter(q.chapter);
  must("#roundMeta").textContent = `${teams[1].subteams[q.chapter - 1]!.name} VS ${teams[2].subteams[q.chapter - 1]!.name} • ${info.name} • ${roundInChapter(q.chapter)}`;
  must("#chapterBadge").textContent = `BABAK ${q.chapter}`;
  must("#questionTitle").textContent = q.title;
  must("#questionCounter").textContent = `${roundIndex + 1} / ${sequence.length}`;
  must("#stimulus").textContent = q.stimulus;
  must("#prompt").textContent = q.prompt;
  must("#gestureHint").innerHTML = gestureHint(q.type);
  if (q.type === "matching") {
    const pairIds = q.pairs.map(pair => pair.id);
    matchingLeftOrder = shuffle(pairIds);
    matchingRightOrder = shuffle(pairIds);
  } else {
    matchingLeftOrder = [];
    matchingRightOrder = [];
  }
  explanationPanel.classList.add("hidden");
  for (const id of [1, 2] as const) renderPlayerAnswer(id, q);
}

function resetRoundState(): void {
  for (const id of [1, 2] as const) {
    const p = players[id];
    p.submitted = false; p.submittedAt = 0; p.answer = null; p.multiSelected = new Set(); p.matchMap = {};
    pointerSelected[id] = undefined;
    resetGestureHold(id);
    lockPlayerPanel(id, false);
    setLockState(id, "SIAP", false);
    must<HTMLElement>(`#gestureBar${id}`).style.width = "0%";
    must(`#gestureLabel${id}`).textContent = "Tunjukkan gesture";
  }
}

function renderPlayerAnswer(id: PlayerId, q: PreparedQuestion): void {
  const mount = must<HTMLElement>(`#answerMount${id}`);
  mount.replaceChildren();
  if (q.type === "single") renderSingle(id, q, mount);
  if (q.type === "boolean") renderBoolean(id, q, mount);
  if (q.type === "matching") renderMatching(id, q, mount);
  if (q.type === "multi") renderMulti(id, q, mount);
}

function renderSingle(id: PlayerId, q: PreparedSingle, mount: HTMLElement): void {
  const wrap = document.createElement("div"); wrap.className = "choice-grid";
  q.options.forEach((text, index) => {
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "choice-option";
    btn.dataset.index = String(index); btn.innerHTML = `<b>${letter(index)}</b><span>${escapeHtml(text)}</span>`;
    btn.addEventListener("click", () => submitSingle(id, index)); wrap.appendChild(btn);
  });
  mount.appendChild(wrap);
}

function renderBoolean(id: PlayerId, q: BooleanQuestion, mount: HTMLElement): void {
  const wrap = document.createElement("div"); wrap.className = "boolean-grid";
  const trueBtn = document.createElement("button"); trueBtn.type = "button"; trueBtn.className = "boolean-option true"; trueBtn.innerHTML = `<b>👍</b><span>BENAR</span>`; trueBtn.addEventListener("click", () => submitBoolean(id, true));
  const falseBtn = document.createElement("button"); falseBtn.type = "button"; falseBtn.className = "boolean-option false"; falseBtn.innerHTML = `<b>👎</b><span>SALAH</span>`; falseBtn.addEventListener("click", () => submitBoolean(id, false));
  wrap.append(trueBtn, falseBtn); mount.appendChild(wrap);
  void q;
}

function renderMatching(id: PlayerId, q: MatchingQuestion, mount: HTMLElement): void {
  const layout = document.createElement("div"); layout.className = "matching-layout";
  const left = document.createElement("div"); left.className = "match-left";
  matchingLeftOrder.forEach(pairId => {
    const pair = q.pairs.find(item => item.id === pairId);
    if (!pair) return;
    const card = document.createElement("button"); card.type = "button"; card.className = "match-card"; card.dataset.player = String(id); card.dataset.leftId = pair.id; card.textContent = pair.left;
    card.addEventListener("click", () => selectMatchCard(id, pair.id)); left.appendChild(card);
  });
  const right = document.createElement("div"); right.className = "match-right";
  matchingRightOrder.forEach(pairId => {
    const pair = q.pairs.find(item => item.id === pairId);
    if (!pair) return;
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

function submitSingle(id: PlayerId, index: number): void {
  if (!canSubmit(id) || currentQuestion?.type !== "single") return;
  players[id].answer = index;
  finalizePlayerSubmission(id, index === currentQuestion.correct);
}

function submitBoolean(id: PlayerId, value: boolean): void {
  if (!canSubmit(id) || currentQuestion?.type !== "boolean") return;
  players[id].answer = value;
  finalizePlayerSubmission(id, value === currentQuestion.correct);
}

function toggleMulti(id: PlayerId, index: number): void {
  if (!canSubmit(id) || currentQuestion?.type !== "multi") return;
  const set = players[id].multiSelected;
  if (set.has(index)) set.delete(index); else set.add(index);
  const el = must<HTMLElement>(`#answerMount${id}`).querySelector<HTMLElement>(`.multi-option[data-index="${index}"]`);
  el?.classList.toggle("selected", set.has(index));
}

function submitMulti(id: PlayerId): void {
  if (!canSubmit(id) || currentQuestion?.type !== "multi") return;
  if (players[id].multiSelected.size === 0) { setGestureMessage(id, "Pilih minimal satu jawaban", 0); return; }
  const selected = [...players[id].multiSelected].sort((a,b)=>a-b);
  players[id].answer = selected;
  const correctSet = new Set(currentQuestion.correct);
  const pickedCorrect = selected.filter(i => correctSet.has(i)).length;
  const pickedWrong = selected.filter(i => !correctSet.has(i)).length;
  const perfect = pickedWrong === 0 && pickedCorrect === correctSet.size;
  const gained = Math.max(0, pickedCorrect * APP_CONFIG.scoring.multiCorrectPick + pickedWrong * APP_CONFIG.scoring.multiWrongPick + (perfect ? APP_CONFIG.scoring.multiPerfectBonus : 0));
  finalizePlayerSubmission(id, perfect, gained, `${pickedCorrect}/${correctSet.size} jawaban benar${pickedWrong ? ` • ${pickedWrong} pilihan salah` : ""}`);
}

function selectMatchCard(id: PlayerId, leftId: string): void {
  if (!canSubmit(id) || currentQuestion?.type !== "matching") return;
  pointerSelected[id] = leftId;
  const mount = must<HTMLElement>(`#answerMount${id}`);
  mount.querySelectorAll(".match-card").forEach(el => el.classList.toggle("selected", (el as HTMLElement).dataset.leftId === leftId));
}

function clickMatchTarget(id: PlayerId, rightId: string): void {
  const leftId = pointerSelected[id];
  if (!leftId || !canSubmit(id) || currentQuestion?.type !== "matching") return;
  assignMatch(id, leftId, rightId);
  pointerSelected[id] = undefined;
}

function assignMatch(id: PlayerId, leftId: string, rightId: string): void {
  const map = players[id].matchMap;
  for (const key of Object.keys(map)) if (map[key] === rightId || key === leftId) delete map[key];
  map[leftId] = rightId;
  refreshMatchingUI(id);
}

function refreshMatchingUI(id: PlayerId): void {
  if (currentQuestion?.type !== "matching") return;
  const q = currentQuestion;
  const mount = must<HTMLElement>(`#answerMount${id}`);
  mount.querySelectorAll<HTMLElement>(".match-card").forEach(card => {
    const leftId = card.dataset.leftId!;
    const assigned = players[id].matchMap[leftId];
    card.classList.toggle("assigned", Boolean(assigned));
    card.classList.remove("selected");
  });
  mount.querySelectorAll<HTMLElement>(".match-target").forEach(target => {
    const rightId = target.dataset.rightId!;
    const leftId = Object.keys(players[id].matchMap).find(key => players[id].matchMap[key] === rightId);
    const originalSmall = target.querySelector("small");
    if (leftId) {
      const pair = q.pairs.find(p => p.id === leftId);
      target.classList.add("filled");
      if (originalSmall) originalSmall.textContent = pair?.left ?? "Terpasang";
    } else {
      target.classList.remove("filled");
      if (originalSmall) originalSmall.textContent = "Tarik pasangan ke sini";
    }
  });
}

function submitMatching(id: PlayerId): void {
  if (!canSubmit(id) || currentQuestion?.type !== "matching") return;
  const map = players[id].matchMap;
  if (Object.keys(map).length !== currentQuestion.pairs.length) { setGestureMessage(id, "Lengkapi semua pasangan", 0); return; }
  players[id].answer = { ...map };
  const correctCount = currentQuestion.pairs.filter(pair => map[pair.id] === pair.id).length;
  const perfect = correctCount === currentQuestion.pairs.length;
  const gained = correctCount * APP_CONFIG.scoring.matchPair + (perfect ? APP_CONFIG.scoring.matchPerfectBonus : 0);
  finalizePlayerSubmission(id, perfect, gained, `${correctCount}/${currentQuestion.pairs.length} pasangan tepat`);
}

function finalizePlayerSubmission(id: PlayerId, correct: boolean, customScore?: number, detail?: string): void {
  const p = players[id];
  if (p.submitted) return;
  p.submitted = true;
  p.submittedAt = performance.now();
  const gained = customScore ?? (correct ? APP_CONFIG.scoring.correct : 0);
  activeSubteam(id).score += gained;
  updateScore(id);
  lockPlayerPanel(id, true);
  setLockState(id, correct ? `TERKUNCI • +${gained}` : `TERKUNCI • ${detail ?? "+0"}`, true);
  if (detail) setGestureMessage(id, detail, 100);
  else setGestureMessage(id, correct ? "Jawaban benar" : "Jawaban terkunci", 100);
  if (players[1].submitted && players[2].submitted) finishRound();
}

function finishRound(): void {
  if (!currentQuestion) return;
  if ((currentQuestion.type === "single" || currentQuestion.type === "boolean") && !fastestBonusApplied) {
    const c1 = isAnswerCorrect(1, currentQuestion); const c2 = isAnswerCorrect(2, currentQuestion);
    if (c1 && c2 && players[1].submittedAt !== players[2].submittedAt) {
      const faster: PlayerId = players[1].submittedAt < players[2].submittedAt ? 1 : 2;
      activeSubteam(faster).score += APP_CONFIG.scoring.fastestBonus;
      updateScore(faster);
      setLockState(faster, `TERCEPAT +${APP_CONFIG.scoring.fastestBonus}`, true);
    }
    fastestBonusApplied = true;
  }
  must("#correctAnswerText").textContent = correctAnswerSummary(currentQuestion);
  must("#explanationText").textContent = currentQuestion.explanation;
  explanationPanel.classList.remove("hidden");
  explanationPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function advanceRound(): void {
  explanationPanel.classList.add("hidden");
  const previousChapter = currentQuestion?.chapter ?? 1;
  roundIndex += 1;
  if (roundIndex >= sequence.length) return finishMatch();
  const next = sequence[roundIndex]!;
  currentQuestion = next;
  if (next.chapter !== previousChapter) showChapterIntro(next.chapter);
  else renderRound();
}

function finishMatch(): void {
  questionPanel.classList.add("hidden");
  playerArea.classList.add("hidden");
  explanationPanel.classList.add("hidden");
  const total1 = teamTotal(1);
  const total2 = teamTotal(2);
  must("#finalName1").textContent = teams[1].name;
  must("#finalName2").textContent = teams[2].name;
  must("#finalScore1").textContent = String(total1);
  must("#finalScore2").textContent = String(total2);
  must("#winnerTitle").textContent = total1 === total2 ? "Hasil Seri!" : `${total1 > total2 ? teams[1].name : teams[2].name} Menang!`;
  must("#finalBreakdown").innerHTML = [1,2,3,4].map(chapter => {
    const left = teams[1].subteams[chapter - 1]!;
    const right = teams[2].subteams[chapter - 1]!;
    return `<div><span>Babak ${chapter}</span><strong>${escapeHtml(left.name)} <b>${left.score}</b></strong><em>VS</em><strong>${escapeHtml(right.name)} <b>${right.score}</b></strong></div>`;
  }).join("");
  finishOverlay.classList.remove("hidden");
}

function isAnswerCorrect(id: PlayerId, q: PreparedQuestion): boolean {
  const answer = players[id].answer;
  if (q.type === "single") return answer === q.correct;
  if (q.type === "boolean") return answer === q.correct;
  return false;
}

function correctAnswerSummary(q: PreparedQuestion): string {
  if (q.type === "single") return `Jawaban: ${letter(q.correct)} — ${q.options[q.correct] ?? ""}`;
  if (q.type === "boolean") return `Jawaban: ${q.correct ? "BENAR" : "SALAH"}`;
  if (q.type === "matching") return `Pasangan benar: ${q.pairs.map(p => `${p.left} → ${p.right}`).join(" • ")}`;
  return `Jawaban benar: ${q.correct.map(i => q.options[i]).filter(Boolean).join(" • ")}`;
}

function canSubmit(id: PlayerId): boolean {
  return Boolean(currentQuestion) && !players[id].submitted && !chapterWaiting;
}

function lockPlayerPanel(id: PlayerId, locked: boolean): void {
  must<HTMLElement>(`.player-panel[data-player="${id}"]`).classList.toggle("locked", locked);
  must<HTMLElement>(`#answerMount${id}`).querySelectorAll<HTMLButtonElement>("button").forEach(btn => btn.disabled = locked);
}

function setLockState(id: PlayerId, text: string, locked: boolean): void {
  const el = must<HTMLElement>(`#lockState${id}`); el.textContent = text; el.classList.toggle("locked", locked);
}

function activeChapter(): number {
  return currentQuestion?.chapter ?? Math.min(4, Math.max(1, sequence[roundIndex]?.chapter ?? 1));
}

function activeSubteam(id: PlayerId): SubTeamState {
  return teams[id].subteams[activeChapter() - 1]!;
}

function teamTotal(id: PlayerId): number {
  return teams[id].subteams.reduce((sum, sub) => sum + sub.score, 0);
}

function activateChapter(chapter: number): void {
  for (const id of [1, 2] as const) {
    const sub = teams[id].subteams[chapter - 1]!;
    must(`#activeSubName${id}`).textContent = sub.name;
    must(`#activeSubScore${id}`).textContent = String(sub.score);
    must(`#panelSubteam${id}`).textContent = sub.name;
  }
  updateScore(1);
  updateScore(2);
}

function updateScore(id: PlayerId): void {
  const el = must<HTMLElement>(`#score${id}`);
  el.textContent = String(teamTotal(id));
  el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop");
  const chapter = activeChapter();
  const active = teams[id].subteams[chapter - 1]!;
  const activeName = document.querySelector<HTMLElement>(`#activeSubName${id}`);
  const activeScore = document.querySelector<HTMLElement>(`#activeSubScore${id}`);
  if (activeName) activeName.textContent = active.name;
  if (activeScore) activeScore.textContent = String(active.score);
  teams[id].subteams.forEach((sub, index) => {
    const mini = document.querySelector<HTMLElement>(`#mini${id}_${index + 1}`);
    if (mini) {
      mini.innerHTML = `${escapeHtml(sub.name)}: <b>${sub.score}</b>`;
      mini.classList.toggle("active", index === chapter - 1);
    }
  });
}

function handleFrames(frames: Map<PlayerId, HandFrame>): void {
  const now = performance.now();
  for (const id of [1, 2] as const) {
    const frame = frames.get(id);
    const cursor = cursorEls[id];
    if (frame) {
      lastSeen[id] = now;
      cursor.classList.add("visible"); cursor.classList.toggle("pinching", frame.pinch);
      cursor.style.transform = `translate3d(${frame.cursor.x}px, ${frame.cursor.y}px, 0) translate(-50%, -50%)`;
      must(`#handDot${id}`).classList.add("online");
      must(`#handText${id}`).textContent = frame.pinch ? "Pinch terdeteksi" : "Tangan terdeteksi";
      if (!mouseMode && canSubmit(id)) handleGesture(id, frame, now);
      previousPinch[id] = frame.pinch;
    } else if (now - lastSeen[id] > APP_CONFIG.handLostCancelMs) {
      cursor.classList.remove("visible", "pinching");
      must(`#handDot${id}`).classList.remove("online"); must(`#handText${id}`).textContent = "Tangan belum terdeteksi";
      if (gestureDrag[id]) cancelGestureDrag(id);
      previousPinch[id] = false; resetGestureHold(id);
    }
  }
}

function handleGesture(id: PlayerId, frame: HandFrame, now: number): void {
  if (!currentQuestion || now < gestureCooldownUntil[id]) return;
  if (currentQuestion.type === "single") {
    const count = countExtendedFingers(frame.landmarks);
    const key = count >= 1 && count <= 4 ? String(count) : "";
    handleHeldGesture(id, key, now, key ? `${key} jari → ${letter(count - 1)}` : "Tunjukkan 1–4 jari", () => submitSingle(id, count - 1));
    return;
  }
  if (currentQuestion.type === "boolean") {
    const dir = thumbDirection(frame.landmarks);
    const key = dir === 1 ? "true" : dir === -1 ? "false" : "";
    handleHeldGesture(id, key, now, dir === 1 ? "👍 BENAR" : dir === -1 ? "👎 SALAH" : "Tunjukkan 👍 / 👎", () => submitBoolean(id, dir === 1));
    return;
  }
  if (currentQuestion.type === "matching") {
    if (frame.pinch && !previousPinch[id]) startGestureDrag(id, frame.cursor.x, frame.cursor.y);
    if (frame.pinch && gestureDrag[id]) moveGestureDrag(id, frame.cursor.x, frame.cursor.y);
    if (!frame.pinch && previousPinch[id] && gestureDrag[id]) endGestureDrag(id, frame.cursor.x, frame.cursor.y);
    else if (frame.pinch && !previousPinch[id] && !gestureDrag[id]) triggerPinchTarget(id, frame.cursor.x, frame.cursor.y);
    return;
  }
  if (currentQuestion.type === "multi") {
    if (frame.pinch && !previousPinch[id]) triggerPinchTarget(id, frame.cursor.x, frame.cursor.y);
    const fist = countExtendedFingers(frame.landmarks) === 0;
    handleHeldGesture(id, fist ? "fist" : "", now, fist ? "✊ tahan untuk KUNCI" : "🤏 pilih • ✊ kunci", () => submitMulti(id));
  }
}

function handleHeldGesture(id: PlayerId, key: string, now: number, label: string, fire: () => void): void {
  const hold = gestureHold[id];
  if (!key) { resetGestureHold(id); setGestureMessage(id, label, 0); return; }
  if (hold.key !== key) { hold.key = key; hold.since = now; hold.fired = false; }
  const progress = Math.min(1, (now - hold.since) / APP_CONFIG.gestureHoldMs);
  setGestureMessage(id, label, progress * 100);
  if (progress >= 1 && !hold.fired) {
    hold.fired = true; gestureCooldownUntil[id] = now + APP_CONFIG.gestureCooldownMs; fire();
  }
}

function resetGestureHold(id: PlayerId): void { gestureHold[id] = { key: "", since: 0, fired: false }; }
function setGestureMessage(id: PlayerId, label: string, pct: number): void { must(`#gestureLabel${id}`).textContent = label; must<HTMLElement>(`#gestureBar${id}`).style.width = `${Math.max(0, Math.min(100, pct))}%`; }

function triggerPinchTarget(id: PlayerId, x: number, y: number): void {
  if (!currentQuestion) return;
  const target = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!target) return;
  const board = target.closest<HTMLElement>(`.player-panel[data-player="${id}"]`); if (!board) return;
  if (currentQuestion.type === "multi") {
    const option = target.closest<HTMLElement>(".multi-option");
    if (option) toggleMulti(id, Number(option.dataset.index));
    const submit = target.closest<HTMLElement>("[data-action='submit-multi']");
    if (submit) submitMulti(id);
  }
  if (currentQuestion.type === "matching") {
    const submit = target.closest<HTMLElement>("[data-action='submit-match']");
    if (submit) submitMatching(id);
  }
}

function startGestureDrag(id: PlayerId, x: number, y: number): void {
  if (currentQuestion?.type !== "matching") return;
  const target = document.elementFromPoint(x, y) as HTMLElement | null;
  const card = target?.closest<HTMLElement>(`.match-card[data-player="${id}"]`);
  if (!card) { triggerPinchTarget(id, x, y); return; }
  const leftId = card.dataset.leftId!;
  const ghost = document.createElement("div"); ghost.className = `drag-ghost player-${id}`; ghost.textContent = card.textContent ?? ""; document.body.appendChild(ghost);
  gestureDrag[id] = { leftId, ghost }; moveGestureDrag(id, x, y); card.classList.add("dragging");
}

function moveGestureDrag(id: PlayerId, x: number, y: number): void {
  const drag = gestureDrag[id]; if (!drag) return;
  drag.ghost.style.left = `${x}px`; drag.ghost.style.top = `${y}px`;
}

function endGestureDrag(id: PlayerId, x: number, y: number): void {
  const drag = gestureDrag[id]; if (!drag) return;
  const target = document.elementFromPoint(x, y) as HTMLElement | null;
  const box = target?.closest<HTMLElement>(`.match-target[data-player="${id}"]`);
  if (box?.dataset.rightId) assignMatch(id, drag.leftId, box.dataset.rightId);
  cancelGestureDrag(id);
}

function cancelGestureDrag(id: PlayerId): void {
  const drag = gestureDrag[id]; if (!drag) return;
  drag.ghost.remove(); delete gestureDrag[id];
  must<HTMLElement>(`#answerMount${id}`).querySelectorAll(".match-card.dragging").forEach(el => el.classList.remove("dragging"));
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
  const dot = v1.x*v2.x+v1.y*v2.y; const mag = Math.hypot(v1.x,v1.y)*Math.hypot(v2.x,v2.y); if (!mag) return 0;
  return Math.acos(Math.max(-1,Math.min(1,dot/mag))) * 180 / Math.PI;
}
function distance(a:{x:number;y:number}, b:{x:number;y:number}): number { return Math.hypot(a.x-b.x,a.y-b.y); }

function roundInChapter(chapter: number): string {
  const before = sequence.slice(0, roundIndex).filter(q => q.chapter === chapter).length;
  const total = sequence.filter(q => q.chapter === chapter).length;
  return `${before + 1}/${total}`;
}

function chapterInfo(chapter: number): {name:string;emoji:string;instruction:string} {
  if (chapter === 1) return { name:"Pilihan Ganda", emoji:"☝️", instruction:"Baca kasus. Tunjukkan 1 jari untuk A, 2 untuk B, 3 untuk C, atau 4 untuk D. Tahan gesture sekitar setengah detik sampai jawaban terkunci." };
  if (chapter === 2) return { name:"Benar / Salah", emoji:"👍", instruction:"Baca pernyataan berdasarkan kasus. Gunakan thumbs up untuk BENAR dan thumbs down untuk SALAH, lalu tahan sampai terkunci." };
  if (chapter === 3) return { name:"Menjodohkan", emoji:"🤏", instruction:"Arahkan telunjuk, pinch kartu di kolom kiri, geser ke pasangan di kanan, lalu buka tangan untuk melepas. Setelah semua terpasang, kunci jawaban." };
  return { name:"Pilihan Lebih dari 1", emoji:"✊", instruction:"Gunakan telunjuk sebagai pointer dan pinch untuk memilih beberapa opsi. Pinch lagi untuk membatalkan. Kepalkan tangan untuk mengunci jawaban." };
}

function gestureHint(type: PreparedQuestion["type"]): string {
  if (type === "single") return `<b>GESTURE:</b> ☝️ A &nbsp; ✌️ B &nbsp; <span>3 jari = C</span> &nbsp; <span>4 jari = D</span>`;
  if (type === "boolean") return `<b>GESTURE:</b> 👍 BENAR &nbsp; • &nbsp; 👎 SALAH`;
  if (type === "matching") return `<b>GESTURE:</b> ☝️ arahkan → 🤏 pinch/ambil → geser → 🖐️ lepas`;
  return `<b>GESTURE:</b> ☝️ pointer + 🤏 pilih &nbsp; • &nbsp; ✊ tahan untuk kunci`;
}

function letter(index: number): string { return String.fromCharCode(65 + index); }
function shuffle<T>(items: readonly T[]): T[] { const a=[...items]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j]!,a[i]!];} return a; }
function must<T extends Element = HTMLElement>(selector: string): T { const el=document.querySelector<T>(selector); if(!el) throw new Error(`Elemen tidak ditemukan: ${selector}`); return el; }
function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch] ?? ch)); }
function friendlyCameraError(error: unknown): string { if(error instanceof DOMException){ if(error.name==="NotAllowedError") return "Izin kamera ditolak. Izinkan kamera lalu coba lagi."; if(error.name==="NotFoundError") return "Kamera tidak ditemukan."; if(error.name==="NotReadableError") return "Kamera sedang digunakan aplikasi lain.";} return `Gagal mengaktifkan kamera: ${error instanceof Error ? error.message : String(error)}`; }

window.addEventListener("beforeunload", () => tracker.stop());
