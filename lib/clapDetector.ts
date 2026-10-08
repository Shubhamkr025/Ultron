/**
 * Web Audio API Clap Detector for Ultron / Jarvis Wake-Up Trigger
 * Enhanced with:
 * - Disposal flag for React StrictMode async safety
 * - Audio ducking / muting during system speech & sound playback
 * - Startup grace period (ignores mic initialization pops)
 * - Anti-echo transient verification
 */
export interface ClapDetectorOptions {
  onClap: () => void;
  threshold?: number; // Volume threshold 0-255 (default ~125)
  cooldownMs?: number; // Minimum time between claps (default 1200ms)
}

export class ClapDetector {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private animationFrameId = 0;
  private listening = false;
  private isDisposed = false;
  private isMuted = false;
  private initTime = 0;

  private onClapCallback: () => void;
  private threshold: number;
  private cooldownMs: number;
  private lastClapTime = 0;

  constructor(options: ClapDetectorOptions) {
    this.onClapCallback = options.onClap;
    this.threshold = options.threshold ?? 125;
    this.cooldownMs = options.cooldownMs ?? 1200;
  }

  public async start(): Promise<void> {
    if (this.listening || this.isDisposed) return;
    this.initTime = Date.now();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
      });

      // If stopped while getUserMedia was pending, clean up immediately
      if (this.isDisposed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      this.mediaStream = stream;

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioContextClass();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();

      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.15;
      source.connect(this.analyser);

      this.listening = true;
      this.analyze();
    } catch (err) {
      this.listening = false;
      // Mic access denied or not available
    }
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
  }

  public stop(): void {
    this.isDisposed = true;
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
    if (!this.listening || !this.analyser || this.isDisposed) return;

    // If muted (e.g. system is speaking or playing startup sound), skip analysis
    if (this.isMuted) {
      this.animationFrameId = requestAnimationFrame(this.analyze);
      return;
    }

    const now = Date.now();
    // Warmup period: ignore initial 2.5 seconds to suppress hardware power-on transients
    if (now - this.initTime < 2500) {
      this.animationFrameId = requestAnimationFrame(this.analyze);
      return;
    }

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);

    let max = 0;
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const val = dataArray[i];
      if (val > max) max = val;
      sum += val;
    }
    const avg = sum / dataArray.length;

    // A real clap is an abrupt transient spike significantly above the ambient floor
    if (
      max > this.threshold &&
      max > avg * 3.0 &&
      now - this.lastClapTime > this.cooldownMs
    ) {
      this.lastClapTime = now;
      this.onClapCallback();
    }

    this.animationFrameId = requestAnimationFrame(this.analyze);
  };
}
