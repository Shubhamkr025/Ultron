/**
 * Speech Recognition, Voice Synthesis & Sci-Fi Audio Cues for Jarvis / Ultron UI
 * Includes:
 * - One-time Startup sound player with completion callback
 * - Wake chime & listening audio cues
 * - Voice synthesis with turn-taking callback
 * - Safe recognition lifecycle
 */

export interface SpeechServiceCallbacks {
  onUserTranscript: (text: string, isFinal: boolean) => void;
  onJarvisSpeak: (text: string) => void;
  onJarvisSpeakEnd?: () => void;
  onStateChange: (state: "idle" | "listening" | "processing" | "speaking") => void;
  onError?: (err: string) => void;
}

export class SpeechService {
  private recognition: any = null;
  private synthesis: SpeechSynthesis | null = null;
  private callbacks: SpeechServiceCallbacks;
  private isListening = false;
  private pendingFinal = ""; // deduplicate — only emit once per session
  private startupAudio: HTMLAudioElement | null = null;
  private synthToneTimeouts: NodeJS.Timeout[] = [];
  private isAudioPlaying = false;

  constructor(callbacks: SpeechServiceCallbacks) {
    this.callbacks = callbacks;

    if (typeof window !== "undefined") {
      this.synthesis = window.speechSynthesis;

      const SpeechRecognitionClass =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognitionClass) {
        this.recognition = new SpeechRecognitionClass();
        this.recognition.continuous = false; // one utterance per turn for natural turn-taking
        this.recognition.interimResults = true;
        this.recognition.lang = "en-US";
        this.recognition.maxAlternatives = 1;

        this.recognition.onstart = () => {
          this.isListening = true;
          this.pendingFinal = "";
          this.callbacks.onStateChange("listening");
          this.playAudioBeep(880, 0.08, "sine");
        };

        this.recognition.onresult = (event: any) => {
          let interim = "";

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript.trim();
            if (event.results[i].isFinal) {
              if (transcript && transcript !== this.pendingFinal) {
                this.pendingFinal = transcript;
                this.callbacks.onUserTranscript(transcript, true);
              }
            } else {
              interim = transcript;
            }
          }

          if (interim && !this.pendingFinal) {
            this.callbacks.onUserTranscript(interim, false);
          }
        };

        this.recognition.onerror = (event: any) => {
          this.isListening = false;
          this.callbacks.onStateChange("idle");
          if (event.error !== "no-speech" && event.error !== "aborted") {
            this.callbacks.onError?.(`Voice recognition note: ${event.error}`);
          }
        };

        this.recognition.onend = () => {
          this.isListening = false;
        };
      }
    }
  }

  public updateCallbacks(callbacks: SpeechServiceCallbacks): void {
    this.callbacks = callbacks;
  }

  public listen(): void {
    if (!this.recognition) {
      this.callbacks.onError?.("Speech recognition not supported in this browser.");
      return;
    }
    if (this.isListening) return;
    this.stopSpeaking();
    this.pendingFinal = "";
    try {
      this.recognition.start();
    } catch {
      // Already running or starting
    }
  }

  public stopListening(): void {
    if (this.recognition && this.isListening) {
      try {
        this.recognition.abort();
      } catch {
        // ignore
      }
      this.isListening = false;
      this.callbacks.onStateChange("idle");
    }
  }

  public speak(text: string): void {
    if (!this.synthesis) {
      this.callbacks.onJarvisSpeakEnd?.();
      return;
    }

    this.stopSpeaking();
    this.stopListening();

    this.callbacks.onJarvisSpeak(text);
    this.callbacks.onStateChange("speaking");
    this.playAudioBeep(520, 0.08, "triangle");

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 0.90;

    const voices = this.synthesis.getVoices();
    // Prioritize sophisticated British English voices (Paul Bettany / JARVIS style)
    const jarvisVoice =
      voices.find((v) =>
        (v.lang === "en-GB" || v.lang === "en_GB") &&
        (v.name.includes("George") ||
         v.name.includes("Daniel") ||
         v.name.includes("Oliver") ||
         v.name.includes("Arthur") ||
         v.name.includes("UK English Male") ||
         v.name.includes("Male") ||
         v.name.includes("Natural"))
      ) ||
      voices.find((v) => (v.lang === "en-GB" || v.lang === "en_GB")) ||
      voices.find((v) =>
        v.lang.startsWith("en") &&
        (v.name.includes("Daniel") ||
         v.name.includes("Google UK English Male") ||
         v.name.includes("Male") ||
         v.name.includes("Natural"))
      ) ||
      voices.find((v) => v.lang.startsWith("en"));

    if (jarvisVoice) utterance.voice = jarvisVoice;

    utterance.onend = () => {
      this.callbacks.onStateChange("idle");
      this.playAudioBeep(440, 0.05, "sine");
      this.callbacks.onJarvisSpeakEnd?.();
    };

    utterance.onerror = () => {
      this.callbacks.onStateChange("idle");
      this.callbacks.onJarvisSpeakEnd?.();
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
    } catch {
      // AudioContext policy
    }
  }

  /**
   * One-time Startup sound player for the initial application boot.
   */
  public playJarvisStartupSound(onComplete?: () => void): void {
    this.isAudioPlaying = true;
    try {
      if (this.startupAudio) {
        this.startupAudio.pause();
        this.startupAudio.currentTime = 0;
      }
      this.startupAudio = new Audio("/jarvis-startup.mp3");
      this.startupAudio.volume = 0.85;

      let called = false;
      const finish = () => {
        if (!called) {
          called = true;
          this.isAudioPlaying = false;
          onComplete?.();
        }
      };

      this.startupAudio.onended = finish;
      this.startupAudio.onerror = () => {
        this.playJarvisSynthTone(finish);
      };

      this.startupAudio.play().catch(() => {
        // Fallback tone if browser interaction blocked full MP3 autoplay
        this.playJarvisSynthTone(finish);
      });
    } catch {
      this.playJarvisSynthTone(onComplete);
    }
  }

  /** Futuristic wake chime for wake-up triggers after initial boot */
  public playWakeChime(): void {
    this.playAudioBeep(587.33, 0.12, "sine"); // D5
    setTimeout(() => {
      this.playAudioBeep(880, 0.18, "sine"); // A5
    }, 100);
  }

  /** Gentle descending chime for standby */
  public playStandbyChime(): void {
    this.playAudioBeep(659.25, 0.1, "sine"); // E5
    setTimeout(() => {
      this.playAudioBeep(440, 0.15, "sine"); // A4
    }, 90);
  }

  public getIsAudioPlaying(): boolean {
    return this.isAudioPlaying;
  }

  /** Synthetic Jarvis startup chord when MP3 can't play */
  private playJarvisSynthTone(onComplete?: () => void): void {
    this.synthToneTimeouts.forEach(clearTimeout);
    this.synthToneTimeouts = [];
    const freqs = [440, 554.37, 659.25, 880];
    freqs.forEach((f, i) => {
      const timeout = setTimeout(() => {
        this.playAudioBeep(f, 0.28, "sawtooth");
        if (i === freqs.length - 1) {
          setTimeout(() => {
            this.isAudioPlaying = false;
            onComplete?.();
          }, 350);
        }
      }, i * 85);
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
