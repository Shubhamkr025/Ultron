/**
 * Speech Recognition, Voice Synthesis & Sci-Fi Audio Cues for Jarvis UI
 * Fixed: callbacks are live-updated via ref so SpeechService is never recreated.
 */

export interface SpeechServiceCallbacks {
  onUserTranscript: (text: string, isFinal: boolean) => void;
  onJarvisSpeak: (text: string) => void;
  onStateChange: (state: "idle" | "listening" | "processing" | "speaking") => void;
  onError?: (err: string) => void;
}

export class SpeechService {
  private recognition: any = null;
  private synthesis: SpeechSynthesis | null = null;
  // Store callbacks as a mutable ref so they can be updated without recreating this class
  private callbacks: SpeechServiceCallbacks;
  private isListening = false;
  private pendingFinal = ""; // deduplicate — only emit once per session
  private startupAudio: HTMLAudioElement | null = null;
  private synthToneTimeouts: NodeJS.Timeout[] = [];

  constructor(callbacks: SpeechServiceCallbacks) {
    this.callbacks = callbacks;

    if (typeof window !== "undefined") {
      this.synthesis = window.speechSynthesis;

      const SpeechRecognitionClass =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognitionClass) {
        this.recognition = new SpeechRecognitionClass();
        this.recognition.continuous = false; // one utterance per session
        this.recognition.interimResults = true;
        this.recognition.lang = "en-US";
        this.recognition.maxAlternatives = 1;

        this.recognition.onstart = () => {
          this.isListening = true;
          this.pendingFinal = ""; // reset dedup buffer
          this.callbacks.onStateChange("listening");
          this.playAudioBeep(880, 0.1, "sine");
        };

        this.recognition.onresult = (event: any) => {
          let interim = "";

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript.trim();
            if (event.results[i].isFinal) {
              // Only emit the final result if it hasn't been emitted yet this session
              if (transcript && transcript !== this.pendingFinal) {
                this.pendingFinal = transcript;
                this.callbacks.onUserTranscript(transcript, true);
              }
            } else {
              interim = transcript;
            }
          }

          // Only emit interim if no final pending
          if (interim && !this.pendingFinal) {
            this.callbacks.onUserTranscript(interim, false);
          }
        };

        this.recognition.onerror = (event: any) => {
          console.warn("Speech recognition error:", event.error);
          this.isListening = false;
          this.callbacks.onStateChange("idle");
          if (event.error !== "no-speech" && event.error !== "aborted") {
            this.callbacks.onError?.(`Speech Error: ${event.error}`);
          }
        };

        this.recognition.onend = () => {
          this.isListening = false;
          // Don't call onStateChange here — avoids double idle when speak() already cancelled it
        };
      }
    }
  }

  /** Update callbacks without recreating the service — prevents double-firing */
  public updateCallbacks(callbacks: SpeechServiceCallbacks): void {
    this.callbacks = callbacks;
  }

  public listen(): void {
    if (!this.recognition) {
      this.callbacks.onError?.("Speech recognition not supported in this browser.");
      return;
    }
    if (this.isListening) return; // guard against double start
    this.stopSpeaking();
    this.pendingFinal = "";
    try {
      this.recognition.start();
    } catch (e) {
      // Already started — ignore
    }
  }

  public stopListening(): void {
    if (this.recognition && this.isListening) {
      this.recognition.abort();
      this.isListening = false;
      this.callbacks.onStateChange("idle");
    }
  }

  public speak(text: string): void {
    if (!this.synthesis) return;

    this.stopSpeaking();
    this.stopListening();

    this.callbacks.onJarvisSpeak(text);
    this.callbacks.onStateChange("speaking");
    this.playAudioBeep(520, 0.08, "triangle");

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.02;
    utterance.pitch = 0.9;

    const voices = this.synthesis.getVoices();
    const jarvisVoice =
      voices.find((v) =>
        v.lang.startsWith("en") &&
        (v.name.includes("Daniel") || v.name.includes("Google UK English Male") ||
         v.name.includes("Male") || v.name.includes("Natural"))
      ) || voices.find((v) => v.lang.startsWith("en"));

    if (jarvisVoice) utterance.voice = jarvisVoice;

    utterance.onend = () => {
      this.callbacks.onStateChange("idle");
      this.playAudioBeep(440, 0.05, "sine");
    };

    utterance.onerror = () => {
      this.callbacks.onStateChange("idle");
    };

    this.synthesis.speak(utterance);
  }

  public stopSpeaking(): void {
    if (this.synthesis?.speaking) {
      this.synthesis.cancel();
      this.callbacks.onStateChange("idle");
    }
  }

  public playAudioBeep(freq = 440, duration = 0.1, type: OscillatorType = "sine"): void {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {
      // ignore
    }
  }

  public playJarvisStartupSound(): void {
    try {
      if (this.startupAudio) {
        this.startupAudio.pause();
        this.startupAudio.currentTime = 0;
      }
      this.startupAudio = new Audio("/jarvis-startup.mp3");
      this.startupAudio.volume = 0.85;
      this.startupAudio.play().catch(() => {
        // Fallback if browser hasn't had user interaction yet
        this.playJarvisSynthTone();
      });
    } catch (e) {
      this.playJarvisSynthTone();
    }
  }

  /** Synthetic Jarvis startup chord when MP3 can't play */
  private playJarvisSynthTone(): void {
    this.synthToneTimeouts.forEach(clearTimeout);
    this.synthToneTimeouts = [];
    [440, 550, 660, 880].forEach((f, i) => {
      const timeout = setTimeout(() => this.playAudioBeep(f, 0.3, "sawtooth"), i * 80);
      this.synthToneTimeouts.push(timeout);
    });
  }

  public dispose(): void {
    this.stopSpeaking();
    this.stopListening();
    if (this.startupAudio) {
      this.startupAudio.pause();
      this.startupAudio.currentTime = 0;
      this.startupAudio = null;
    }
    this.synthToneTimeouts.forEach(clearTimeout);
    this.synthToneTimeouts = [];
  }

  public isSupported(): boolean {
    return !!this.recognition;
  }
}
