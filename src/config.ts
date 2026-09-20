export const APP_CONFIG = {
  gestureHoldMs: 480,
  lockHoldMs: 720,
  gestureCooldownMs: 850,
  inferenceIntervalMs: 34,
  handLostCancelMs: 650,
  cursorSmoothing: 0.42,
  pinch: {
    engageRatio: 0.38,
    releaseRatio: 0.52,
    debounceMs: 65
  },
  scoring: {
    correct: 100,
    fastestBonus: 25,
    matchPair: 50,
    matchPerfectBonus: 50,
    multiCorrectPick: 50,
    multiWrongPick: -25,
    multiPerfectBonus: 50
  },
  mediapipe: {
    wasmRoot: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm",
    modelUrl: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
  }
} as const;
