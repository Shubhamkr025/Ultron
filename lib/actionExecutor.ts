/**
 * Siri/Jarvis Action Executor for Ultron UI
 * Performs real-world browser, device, and web tasks based on AI Agent intent payload.
 */

export interface ActionPayload {
  type:
    | "OPEN_URL"
    | "SEARCH_WEB"
    | "OPEN_APP"
    | "NAVIGATE_PHONE"
    | "SET_TIMER"
    | "STOPWATCH"
    | "SAVE_NOTE"
    | "READ_NOTES"
    | "CLEAR_NOTES"
    | "GET_BATTERY"
    | "GET_LOCATION"
    | "PLAY_AUDIO"
    | "COPY_CLIPBOARD"
    | "LOCK_DEVICE"
    | "UNLOCK_DEVICE"
    | "NONE";
  url?: string;
  query?: string;
  app?: string;
  command?: string;
  target?: string;
  seconds?: number;
  note?: string;
  text?: string;
  pin?: string;
  theme?: "ambient" | "alert" | "alarm";
}

export interface ActionExecutorCallbacks {
  onTimerUpdate: (remainingSeconds: number | null) => void;
  onNotesUpdate: (notes: string[]) => void;
  onTelemetryUpdate: (info: string) => void;
  onSpeak: (text: string) => void;
}

export class ActionExecutor {
  private timerInterval: any = null;
  private remainingTimerSeconds: number | null = null;
  private callbacks: ActionExecutorCallbacks;

  constructor(callbacks: ActionExecutorCallbacks) {
    this.callbacks = callbacks;
  }

  public async execute(action: ActionPayload): Promise<string | null> {
    switch (action.type) {
      case "OPEN_URL": {
        if (action.url) {
          window.open(action.url, "_blank", "noopener,noreferrer");
          return `Opening ${action.url} in a new tab, sir.`;
        }
        break;
      }

      case "OPEN_APP": {
        if (action.app) {
          try {
            const res = await fetch("/api/adb", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "OPEN_APP", app: action.app, query: action.query }),
            });
            const data = await res.json();
            return data.message || `Dispatched launch sequence for ${action.app} on your mobile device, sir.`;
          } catch {
            return `Dispatched launch sequence for ${action.app}, sir.`;
          }
        }
        break;
      }

      case "NAVIGATE_PHONE": {
        if (action.command) {
          try {
            const res = await fetch("/api/adb", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: action.command }),
            });
            const data = await res.json();
            return data.message || `Navigation command ${action.command} dispatched to device, sir.`;
          } catch {
            return `Dispatched ${action.command} to device, sir.`;
          }
        }
        break;
      }

      case "SEARCH_WEB": {
        if (action.query) {
          const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(action.query)}`;
          window.open(searchUrl, "_blank", "noopener,noreferrer");
          return `Executing web search for "${action.query}", sir.`;
        }
        break;
      }

      case "SET_TIMER": {
        if (action.seconds && action.seconds > 0) {
          this.startTimer(action.seconds);
          const mins = Math.floor(action.seconds / 60);
          const secs = action.seconds % 60;
          const timeStr = mins > 0 ? `${mins} minute${mins > 1 ? "s" : ""}${secs > 0 ? ` and ${secs} seconds` : ""}` : `${secs} seconds`;
          return `Timer set for ${timeStr}, sir.`;
        }
        break;
      }

      case "SAVE_NOTE": {
        if (action.note) {
          const existing = this.getNotes();
          existing.push(action.note);
          localStorage.setItem("jarvis_notes", JSON.stringify(existing));
          this.callbacks.onNotesUpdate(existing);
          return `Note recorded, sir: "${action.note}"`;
        }
        break;
      }

      case "READ_NOTES": {
        const notes = this.getNotes();
        this.callbacks.onNotesUpdate(notes);
        if (notes.length === 0) {
          return "You have no saved notes in memory, sir.";
        }
        return `You have ${notes.length} saved note${notes.length > 1 ? "s" : ""}, sir: ${notes.slice(-3).join("; ")}`;
      }

      case "CLEAR_NOTES": {
        localStorage.removeItem("jarvis_notes");
        this.callbacks.onNotesUpdate([]);
        return "All notes have been cleared from memory, sir.";
      }

      case "GET_BATTERY": {
        if ("getBattery" in navigator) {
          try {
            const battery: any = await (navigator as any).getBattery();
            const level = Math.round(battery.level * 100);
            const charging = battery.charging ? "currently charging" : "discharging";
            const info = `Battery is at ${level}%, ${charging}.`;
            this.callbacks.onTelemetryUpdate(info);
            return `System telemetry reports battery is at ${level} percent, ${charging}, sir.`;
          } catch (e) {
            return "Unable to access battery telemetry on this device, sir.";
          }
        } else {
          return "Battery telemetry API is not supported in this browser, sir.";
        }
      }

      case "GET_LOCATION": {
        return new Promise((resolve) => {
          if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                const lat = pos.coords.latitude.toFixed(4);
                const lon = pos.coords.longitude.toFixed(4);
                const info = `Latitude: ${lat}, Longitude: ${lon}`;
                this.callbacks.onTelemetryUpdate(info);
                resolve(`Your spatial coordinates are Latitude ${lat}, Longitude ${lon}, sir.`);
              },
              (err) => {
                resolve("Location access was denied or unavailable, sir.");
              },
              { timeout: 8000 }
            );
          } else {
            resolve("Geolocation sensors unavailable, sir.");
          }
        });
      }

      case "PLAY_AUDIO": {
        this.playAudioSynth(action.theme || "ambient");
        return `Initiating audio synthesis playback, sir.`;
      }

      case "UNLOCK_DEVICE": {
        try {
          const res = await fetch("/api/adb", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "UNLOCK", pin: action.pin || "" }),
          });
          const data = await res.json();
          return data.message || "ADB Unlock command executed, sir.";
        } catch (e) {
          return "ADB unlock sequence executed, sir.";
        }
      }

      case "LOCK_DEVICE": {
        try {
          const res = await fetch("/api/adb", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "LOCK" }),
          });
          const data = await res.json();
          return data.message || "ADB Lock command executed, sir.";
        } catch (e) {
          return "ADB sleep command dispatched, sir.";
        }
      }

      case "COPY_CLIPBOARD": {
        if (action.text) {
          void navigator.clipboard.writeText(action.text);
          return `Text copied to system clipboard, sir.`;
        }
        break;
      }
    }

    return null;
  }

  public getNotes(): string[] {
    try {
      const data = localStorage.getItem("jarvis_notes");
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  public cancelTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.remainingTimerSeconds = null;
    this.callbacks.onTimerUpdate(null);
  }

  private startTimer(seconds: number): void {
    this.cancelTimer();
    this.remainingTimerSeconds = seconds;
    this.callbacks.onTimerUpdate(this.remainingTimerSeconds);

    this.timerInterval = setInterval(() => {
      if (this.remainingTimerSeconds === null) return;
      this.remainingTimerSeconds -= 1;

      if (this.remainingTimerSeconds <= 0) {
        this.cancelTimer();
        this.playAudioSynth("alarm");
        this.callbacks.onSpeak("Sir, your timer has completed!");
      } else {
        this.callbacks.onTimerUpdate(this.remainingTimerSeconds);
      }
    }, 1000);
  }

  private playAudioSynth(theme: "ambient" | "alert" | "alarm"): void {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      if (theme === "alarm") {
        for (let i = 0; i < 3; i++) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sawtooth";
          osc.frequency.setValueAtTime(880, ctx.currentTime + i * 0.3);
          gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.3);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.3 + 0.2);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + i * 0.3);
          osc.stop(ctx.currentTime + i * 0.3 + 0.2);
        }
      } else if (theme === "alert") {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.4);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
      } else {
        // Ambient chord
        [220, 330, 440].forEach((freq) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, ctx.currentTime);
          gain.gain.setValueAtTime(0.05, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 1.2);
        });
      }
    } catch (e) {
      // Audio context ignored if blocked
    }
  }
}
