declare module "@mediapipe/tasks-vision" {
  export class FilesetResolver {
    static forVisionTasks(path: string): Promise<unknown>;
  }
  export class HandLandmarker {
    static createFromOptions(vision: unknown, options: unknown): Promise<HandLandmarker>;
    detectForVideo(video: HTMLVideoElement, timestamp: number): unknown;
  }
}
