import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { APP_CONFIG } from "../config";
import type { HandFrame, PlayerId, Point } from "../types";
import { clamp, distance } from "../utils/dom";

interface NormalizedPoint {
  x: number;
  y: number;
  z?: number;
}

interface ResultLike {
  landmarks?: NormalizedPoint[][];
}

interface PinchMemory {
  stable: boolean;
  candidate: boolean;
  candidateSince: number;
}

export interface HandTrackerCallbacks {
  onFrames: (frames: Map<PlayerId, HandFrame>) => void;
  onStatus: (message: string) => void;
  onError: (message: string, error?: unknown) => void;
}

const CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]
];

export class HandTracker {
  private readonly video: HTMLVideoElement;
  private readonly stage: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly callbacks: HandTrackerCallbacks;
  private handLandmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private rafId = 0;
  private running = false;
  private lastInferenceAt = 0;
  private lastVideoTime = -1;
  private smoothCursor: Partial<Record<PlayerId, Point>> = {};
  private pinchMemory: Record<PlayerId, PinchMemory> = {
    1: { stable: false, candidate: false, candidateSince: 0 },
    2: { stable: false, candidate: false, candidateSince: 0 }
  };

  constructor(
    video: HTMLVideoElement,
    stage: HTMLElement,
    canvas: HTMLCanvasElement,
    callbacks: HandTrackerCallbacks
  ) {
    this.video = video;
    this.stage = stage;
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D tidak tersedia.");
    this.ctx = ctx;
    this.callbacks = callbacks;
  }

  async initialize(): Promise<void> {
    this.callbacks.onStatus("Memuat MediaPipe…");
    const vision = await FilesetResolver.forVisionTasks(APP_CONFIG.mediapipe.wasmRoot);

    const options = {
      baseOptions: {
        modelAssetPath: APP_CONFIG.mediapipe.modelUrl,
        delegate: "GPU" as const
      },
      runningMode: "VIDEO" as const,
      numHands: 2,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    };

    try {
      this.handLandmarker = await HandLandmarker.createFromOptions(vision, options);
      this.callbacks.onStatus("MediaPipe siap (GPU).");
    } catch (gpuError) {
      this.callbacks.onStatus("GPU tidak tersedia, mencoba CPU…");
      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: {
          modelAssetPath: APP_CONFIG.mediapipe.modelUrl,
          delegate: "CPU" as const
        }
      });
      this.callbacks.onStatus("MediaPipe siap (CPU).");
      console.warn("MediaPipe GPU fallback:", gpuError);
    }
  }

  async startCamera(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Browser tidak mendukung akses kamera. Gunakan Chrome/Edge modern melalui HTTPS atau localhost.");
    }
    if (!this.handLandmarker) {
      await this.initialize();
    }

    this.callbacks.onStatus("Meminta izin kamera…");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 60 }
      }
    });

    this.video.srcObject = this.stream;
    await new Promise<void>((resolve) => {
      if (this.video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        resolve();
        return;
      }
      this.video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    });
    await this.video.play();

    this.running = true;
    this.callbacks.onStatus("Kamera aktif. Tunjukkan satu tangan per pemain.");
    this.resizeCanvas();
    window.addEventListener("resize", this.resizeCanvas);
    this.loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.resizeCanvas);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private loop = (): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);

    if (!this.handLandmarker || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    const now = performance.now();
    if (now - this.lastInferenceAt < APP_CONFIG.inferenceIntervalMs) return;
    if (this.video.currentTime === this.lastVideoTime) return;

    this.lastInferenceAt = now;
    this.lastVideoTime = this.video.currentTime;

    try {
      const raw = this.handLandmarker.detectForVideo(this.video, now) as unknown as ResultLike;
      const frames = this.process(raw.landmarks ?? [], now);
      this.draw(frames);
      this.callbacks.onFrames(frames);
    } catch (error) {
      this.callbacks.onError("Terjadi kesalahan saat membaca frame MediaPipe.", error);
    }
  };

  private process(hands: NormalizedPoint[][], now: number): Map<PlayerId, HandFrame> {
    const candidates = hands
      .filter((landmarks) => landmarks.length >= 21)
      .map((landmarks) => {
        const mapped = landmarks.map((landmark) => this.normalizedToClient(landmark));
        return { landmarks, mapped, cursor: mapped[8]! };
      })
      .sort((a, b) => a.cursor.x - b.cursor.x);

    const assigned = new Map<PlayerId, (typeof candidates)[number]>();
    if (candidates.length >= 2) {
      assigned.set(1, candidates[0]!);
      assigned.set(2, candidates[candidates.length - 1]!);
    } else if (candidates.length === 1) {
      const only = candidates[0]!;
      const center = this.stage.getBoundingClientRect().left + this.stage.getBoundingClientRect().width / 2;
      assigned.set(only.cursor.x < center ? 1 : 2, only);
    }

    const frames = new Map<PlayerId, HandFrame>();
    ([1, 2] as const).forEach((playerId) => {
      const hand = assigned.get(playerId);
      if (!hand) return;

      const previous = this.smoothCursor[playerId];
      const alpha = APP_CONFIG.cursorSmoothing;
      const cursor = previous
        ? {
            x: previous.x + (hand.cursor.x - previous.x) * alpha,
            y: previous.y + (hand.cursor.y - previous.y) * alpha
          }
        : hand.cursor;
      this.smoothCursor[playerId] = cursor;

      const thumb = hand.landmarks[4]!;
      const index = hand.landmarks[8]!;
      const wrist = hand.landmarks[0]!;
      const middleMcp = hand.landmarks[9]!;
      const handScale = Math.max(0.02, distance(wrist, middleMcp));
      const pinchRatio = distance(thumb, index) / handScale;
      const pinch = this.updatePinch(playerId, pinchRatio, now);

      frames.set(playerId, {
        playerId,
        cursor,
        pinch,
        pinchRatio,
        landmarks: hand.mapped,
        seenAt: now
      });
    });

    return frames;
  }

  private updatePinch(playerId: PlayerId, ratio: number, now: number): boolean {
    const memory = this.pinchMemory[playerId];
    const rawCandidate = memory.stable
      ? ratio < APP_CONFIG.pinch.releaseRatio
      : ratio < APP_CONFIG.pinch.engageRatio;

    if (rawCandidate !== memory.candidate) {
      memory.candidate = rawCandidate;
      memory.candidateSince = now;
    }

    if (memory.stable !== memory.candidate && now - memory.candidateSince >= APP_CONFIG.pinch.debounceMs) {
      memory.stable = memory.candidate;
    }

    return memory.stable;
  }

  private normalizedToClient(point: NormalizedPoint): Point {
    const rect = this.stage.getBoundingClientRect();
    const videoWidth = this.video.videoWidth || rect.width;
    const videoHeight = this.video.videoHeight || rect.height;
    const scale = Math.max(rect.width / videoWidth, rect.height / videoHeight);
    const renderedWidth = videoWidth * scale;
    const renderedHeight = videoHeight * scale;
    const offsetX = (rect.width - renderedWidth) / 2;
    const offsetY = (rect.height - renderedHeight) / 2;

    // Video is mirrored with CSS, therefore mirror the x coordinate as well.
    const unmirroredLocalX = point.x * renderedWidth + offsetX;
    const localX = rect.width - unmirroredLocalX;
    const localY = point.y * renderedHeight + offsetY;

    return {
      x: clamp(rect.left + localX, rect.left, rect.right),
      y: clamp(rect.top + localY, rect.top, rect.bottom)
    };
  }

  private draw(frames: Map<PlayerId, HandFrame>): void {
    const rect = this.stage.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);

    frames.forEach((frame) => {
      const color = frame.playerId === 1 ? "#6ee7ff" : "#f7a8ff";
      this.ctx.strokeStyle = color;
      this.ctx.fillStyle = color;
      this.ctx.lineWidth = 2.2;
      this.ctx.globalAlpha = 0.95;

      for (const [a, b] of CONNECTIONS) {
        const pa = frame.landmarks[a];
        const pb = frame.landmarks[b];
        if (!pa || !pb) continue;
        this.ctx.beginPath();
        this.ctx.moveTo(pa.x - rect.left, pa.y - rect.top);
        this.ctx.lineTo(pb.x - rect.left, pb.y - rect.top);
        this.ctx.stroke();
      }

      frame.landmarks.forEach((point, index) => {
        this.ctx.beginPath();
        this.ctx.arc(point.x - rect.left, point.y - rect.top, index === 8 || index === 4 ? 5 : 3, 0, Math.PI * 2);
        this.ctx.fill();
      });
    });
    this.ctx.globalAlpha = 1;
  }

  private resizeCanvas = (): void => {
    const rect = this.stage.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(rect.width));
    this.canvas.height = Math.max(1, Math.round(rect.height));
  };
}
