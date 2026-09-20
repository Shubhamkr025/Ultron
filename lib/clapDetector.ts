/**
 * Web Audio API Clap Detector for Ultron / Jarvis Wake-Up Trigger
 */
export interface ClapDetectorOptions {
  onClap: () => void;
  threshold?: number; // Volume threshold 0-255 (default ~110)
  cooldownMs?: number; // Minimum time between claps (default 600ms)
}

export class ClapDetector {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private animationFrameId = 0;
  private listening = false;

  private onClapCallback: () => void;
  private threshold: number;
  private cooldownMs: number;
  private lastClapTime = 0;

  constructor(options: ClapDetectorOptions) {
    this.onClapCallback = options.onClap;
    this.threshold = options.threshold ?? 110;
    this.cooldownMs = options.cooldownMs ?? 600;
  }

  public async start(): Promise<void> {
    if (this.listening) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    this.mediaStream = stream;

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.audioContext = new AudioContextClass();
    const source = this.audioContext.createMediaStreamSource(stream);
    this.analyser = this.audioContext.createAnalyser();

    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.2;
    source.connect(this.analyser);

    this.listening = true;
    this.analyze();
  }

  public stop(): void {
    this.listening = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = 0;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.audioContext && this.audioContext.state !== "closed") {
      void this.audioContext.close();
      this.audioContext = null;
    }
    this.analyser = null;
  }

  public isListening(): boolean {
    return this.listening;
  }

  private analyze = (): void => {
    if (!this.listening || !this.analyser) return;

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);

    // Calculate maximum amplitude & average amplitude
    let max = 0;
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const val = dataArray[i];
      if (val > max) max = val;
      sum += val;
    }
    const avg = sum / dataArray.length;

    const now = Date.now();
    // A clap is characterized by a sharp transient spike (high max amplitude relative to average background noise)
    if (
      max > this.threshold &&
      max > avg * 2.8 &&
      now - this.lastClapTime > this.cooldownMs
    ) {
      this.lastClapTime = now;
      this.onClapCallback();
    }

    this.animationFrameId = requestAnimationFrame(this.analyze);
  };
}
