"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createOrbScene, type OrbSceneApi, type VisualState } from "@/lib/orbScene";
import { HandTracker, type TrackerStatus, type DetectedGesture } from "@/lib/handTracker";
import { ClapDetector } from "@/lib/clapDetector";
import { SpeechService } from "@/lib/speechService";
import { ActionExecutor, type ActionPayload } from "@/lib/actionExecutor";

type CameraState = "off" | "starting" | "on" | "error";
type AgentState = "idle" | "listening" | "processing" | "speaking";

interface SubtitleState {
  speaker: "USER" | "JARVIS" | "SYSTEM";
  text: string;
}

interface AdbDevice {
  serial: string;
  model: string;
}

const MODE_LABEL: Record<TrackerStatus["mode"], string> = {
  idle: "STANDBY",
  spin: "SPIN",
  zoom: "ZOOM",
  stop: "STOP",
  status: "STATUS",
  wake: "WAKE",
  reset: "RESET",
};

export default function JarvisOrb() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<OrbSceneApi | null>(null);

  const trackerRef = useRef<HandTracker | null>(null);
  const clapDetectorRef = useRef<ClapDetector | null>(null);
  // Speech service is created ONCE and never recreated — callbacks are updated via ref
  const speechServiceRef = useRef<SpeechService | null>(null);
  const actionExecutorRef = useRef<ActionExecutor | null>(null);

  const [camera, setCamera] = useState<CameraState>("off");
  const [status, setStatus] = useState<TrackerStatus>({ hands: 0, mode: "idle", detectedGesture: "NONE" });
  const [error, setError] = useState<string | null>(null);

  const [clapEnabled, setClapEnabled] = useState<boolean>(true);
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const agentStateRef = useRef<AgentState>("idle");
  const [visualState, setVisualState] = useState<VisualState>("idle");
  const [subtitle, setSubtitle] = useState<SubtitleState>({
    speaker: "JARVIS",
    text: "ULTRON Command Center online. Clap to wake me up, sir.",
  });

  const [timerDisplay, setTimerDisplay] = useState<string | null>(null);
  const [telemetryBadge, setTelemetryBadge] = useState<string | null>(null);

  // Android ADB state
  const [adbDevices, setAdbDevices] = useState<AdbDevice[]>([]);
  const [adbStatus, setAdbStatus] = useState<string>("SCANNING...");
  const [selectedSerial, setSelectedSerial] = useState<string>("");
  const [devicePin, setDevicePin] = useState<string>("");
  const [connectIp, setConnectIp] = useState<string>("");
  const [showAndroidPanel, setShowAndroidPanel] = useState<boolean>(false);

  // Wake-up transition state
  const [wakeAnim, setWakeAnim] = useState<"idle" | "waking" | "online">("idle");
  const wakeAnimRef = useRef<"idle" | "waking" | "online">("idle");

  // ─── VISUAL STATE ──────────────────────────────────────────────────────────
  const updateOrbVisualState = useCallback((state: VisualState) => {
    setVisualState(state);
    sceneRef.current?.setVisualState(state);
  }, []);

  // ─── JARVIS WAKE TRANSITION ────────────────────────────────────────────────
  const triggerWakeUpSequence = useCallback(() => {
    // Guard: don't stack animations
    if (wakeAnimRef.current !== "idle") return;
    if (agentStateRef.current !== "idle") return;

    wakeAnimRef.current = "waking";
    setWakeAnim("waking");
    updateOrbVisualState("listening");
    speechServiceRef.current?.playJarvisStartupSound();

    // After 2.5s bloom animation completes → show "ONLINE" stamp
    setTimeout(() => {
      wakeAnimRef.current = "online";
      setWakeAnim("online");
      setSubtitle({ speaker: "JARVIS", text: "Online and listening, sir." });

      // After another 1.2s → collapse overlay and start listening
      setTimeout(() => {
        wakeAnimRef.current = "idle";
        setWakeAnim("idle");
        speechServiceRef.current?.listen();
        agentStateRef.current = "listening";
        setAgentState("listening");
      }, 1200);
    }, 2500);
  }, [updateOrbVisualState]);

  // ─── ADB HELPERS ──────────────────────────────────────────────────────────
  const scanAdbDevices = useCallback(async () => {
    setAdbStatus("SCANNING...");
    try {
      const res = await fetch("/api/adb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "DEVICES" }),
      });
      const data = await res.json();
      if (data.devices && data.devices.length > 0) {
        setAdbDevices(data.devices);
        setSelectedSerial(data.devices[0].serial);
        setAdbStatus(`${data.devices.length} DEVICE(S) ONLINE`);
      } else {
        setAdbDevices([]);
        setAdbStatus("NO DEVICES");
      }
    } catch (e) {
      setAdbStatus("ADB ERROR");
    }
  }, []);

  const connectWireless = useCallback(async () => {
    if (!connectIp.trim()) return;
    setAdbStatus("CONNECTING...");
    setSubtitle({ speaker: "JARVIS", text: `Initiating wireless ADB to ${connectIp}...` });
    updateOrbVisualState("processing");
    try {
      const res = await fetch("/api/adb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CONNECT", ip: connectIp }),
      });
      const data = await res.json();
      setSubtitle({ speaker: data.success ? "JARVIS" : "SYSTEM", text: data.message });
      updateOrbVisualState(data.success ? "success" : "error");
      if (data.success) setTimeout(() => void scanAdbDevices(), 1500);
    } catch (e) {
      setAdbStatus("CONN FAILED");
      updateOrbVisualState("error");
    }
  }, [connectIp, updateOrbVisualState, scanAdbDevices]);

  const unlockAndroid = useCallback(async (serial?: string) => {
    const target = serial || selectedSerial;
    updateOrbVisualState("executing");
    setSubtitle({ speaker: "JARVIS", text: "Dispatching ADB unlock sequence, sir..." });
    try {
      const res = await fetch("/api/adb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "UNLOCK", serial: target, pin: devicePin }),
      });
      const data = await res.json();
      setSubtitle({ speaker: data.success ? "JARVIS" : "SYSTEM", text: data.message });
      updateOrbVisualState(data.success ? "success" : "error");
      speechServiceRef.current?.speak(data.message);
    } catch (e) {
      updateOrbVisualState("error");
    }
  }, [selectedSerial, devicePin, updateOrbVisualState]);

  const lockAndroid = useCallback(async () => {
    updateOrbVisualState("executing");
    try {
      const res = await fetch("/api/adb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "LOCK", serial: selectedSerial }),
      });
      const data = await res.json();
      setSubtitle({ speaker: "JARVIS", text: data.message });
      updateOrbVisualState("success");
      speechServiceRef.current?.speak(data.message);
    } catch (e) {
      updateOrbVisualState("error");
    }
  }, [selectedSerial, updateOrbVisualState]);

  // ─── QUERY JARVIS AGENT ────────────────────────────────────────────────────
  const queryJarvisAgent = useCallback(async (userPrompt: string) => {
    agentStateRef.current = "processing";
    setAgentState("processing");
    updateOrbVisualState("processing");
    setSubtitle({ speaker: "JARVIS", text: "Processing..." });

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: userPrompt }),
      });
      const data = await res.json();
      let replyText = data.reply || "At your service, sir.";

      if (data.action?.type === "UNLOCK_DEVICE") { await unlockAndroid(); return; }
      if (data.action?.type === "LOCK_DEVICE") { await lockAndroid(); return; }

      if (data.action && data.action.type !== "NONE" && actionExecutorRef.current) {
        updateOrbVisualState("executing");
        const result = await actionExecutorRef.current.execute(data.action as ActionPayload);
        if (result) replyText = result;
        setTimeout(() => updateOrbVisualState("success"), 600);
      } else {
        updateOrbVisualState("success");
      }

      setSubtitle({ speaker: "JARVIS", text: replyText });
      speechServiceRef.current?.speak(replyText);
    } catch (err) {
      updateOrbVisualState("error");
      const errReply = "My apologies, sir. Command dispatch failed.";
      setSubtitle({ speaker: "JARVIS", text: errReply });
      speechServiceRef.current?.speak(errReply);
    }
  }, [updateOrbVisualState, unlockAndroid, lockAndroid]);

  // Store queryJarvisAgent in a ref so the speech service never needs recreation
  const queryRef = useRef(queryJarvisAgent);
  useEffect(() => { queryRef.current = queryJarvisAgent; }, [queryJarvisAgent]);

  // ─── SPEECH SERVICE (created ONCE, callbacks updated via ref) ──────────────
  useEffect(() => {
    const makeCallbacks = () => ({
      onUserTranscript: (text: string, isFinal: boolean) => {
        setSubtitle({ speaker: "USER", text });
        if (isFinal && text.trim()) void queryRef.current(text);
      },
      onJarvisSpeak: (text: string) => setSubtitle({ speaker: "JARVIS", text }),
      onStateChange: (st: "idle" | "listening" | "processing" | "speaking") => {
        agentStateRef.current = st;
        setAgentState(st);
        if (st === "listening") updateOrbVisualState("listening");
        else if (st === "idle") updateOrbVisualState("idle");
      },
      onError: (errMsg: string) => {
        updateOrbVisualState("error");
        setSubtitle({ speaker: "SYSTEM", text: errMsg });
      },
    });

    const speech = new SpeechService(makeCallbacks());
    speechServiceRef.current = speech;

    return () => {
      speech.dispose();
    };
    // Empty deps — only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep callbacks fresh without recreating the service
  useEffect(() => {
    if (!speechServiceRef.current) return;
    speechServiceRef.current.updateCallbacks({
      onUserTranscript: (text: string, isFinal: boolean) => {
        setSubtitle({ speaker: "USER", text });
        if (isFinal && text.trim()) void queryRef.current(text);
      },
      onJarvisSpeak: (text: string) => setSubtitle({ speaker: "JARVIS", text }),
      onStateChange: (st: "idle" | "listening" | "processing" | "speaking") => {
        agentStateRef.current = st;
        setAgentState(st);
        if (st === "listening") updateOrbVisualState("listening");
        else if (st === "idle") updateOrbVisualState("idle");
      },
      onError: (errMsg: string) => {
        updateOrbVisualState("error");
        setSubtitle({ speaker: "SYSTEM", text: errMsg });
      },
    });
  }, [updateOrbVisualState]);

  // ─── ACTION EXECUTOR ──────────────────────────────────────────────────────
  useEffect(() => {
    const executor = new ActionExecutor({
      onTimerUpdate: (remaining) => {
        if (remaining === null) {
          setTimerDisplay(null);
        } else {
          const mins = Math.floor(remaining / 60);
          const secs = remaining % 60;
          setTimerDisplay(`${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`);
        }
      },
      onNotesUpdate: (notes) => setTelemetryBadge(notes.length > 0 ? `NOTES: ${notes.length}` : null),
      onTelemetryUpdate: (info) => setSubtitle({ speaker: "JARVIS", text: info }),
      onSpeak: (text) => {
        setSubtitle({ speaker: "JARVIS", text });
        speechServiceRef.current?.speak(text);
      },
    });
    actionExecutorRef.current = executor;
  }, []);

  // ─── ADB AUTO-SCAN ────────────────────────────────────────────────────────
  useEffect(() => {
    void scanAdbDevices();
    const iv = setInterval(() => void scanAdbDevices(), 15000);
    return () => clearInterval(iv);
  }, [scanAdbDevices]);

  // ─── GESTURE TRIGGER ──────────────────────────────────────────────────────
  const handleGestureTrigger = useCallback((gesture: DetectedGesture) => {
    switch (gesture) {
      case "OPEN_PALM":
        speechServiceRef.current?.stopSpeaking();
        speechServiceRef.current?.stopListening();
        updateOrbVisualState("idle");
        setSubtitle({ speaker: "SYSTEM", text: "[PALM] Speech interrupted." });
        break;
      case "THUMBS_UP":
        void queryRef.current("system status");
        break;
      case "PEACE":
        triggerWakeUpSequence();
        break;
      case "FIST":
        sceneRef.current?.resetView();
        setSubtitle({ speaker: "SYSTEM", text: "[FIST] Orb view reset." });
        break;
    }
  }, [triggerWakeUpSequence, updateOrbVisualState]);

  // ─── CLAP DETECTOR (wake-up with Jarvis transition) ───────────────────────
  useEffect(() => {
    if (!clapEnabled) {
      clapDetectorRef.current?.stop();
      clapDetectorRef.current = null;
      return;
    }
    const detector = new ClapDetector({
      onClap: () => {
        // Guards use refs (not state) to avoid stale closures
        triggerWakeUpSequence();
      },
    });
    clapDetectorRef.current = detector;
    void detector.start().catch(() => {});
    return () => { detector.stop(); clapDetectorRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clapEnabled, triggerWakeUpSequence]);

  // ─── 3D ORB SCENE ─────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = createOrbScene(container);
    sceneRef.current = scene;
    return () => {
      trackerRef.current?.stop();
      trackerRef.current = null;
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // ─── GESTURE CAMERA ──────────────────────────────────────────────────────
  const stopGestures = useCallback(() => {
    trackerRef.current?.stop();
    trackerRef.current = null;
    setCamera("off");
    setStatus({ hands: 0, mode: "idle", detectedGesture: "NONE" });
  }, []);

  const startGestures = useCallback(async () => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay || trackerRef.current) return;
    setCamera("starting");
    setError(null);
    const tracker = new HandTracker(video, overlay, {
      onRotate: (dt, dp) => sceneRef.current?.rotateBy(dt, dp),
      onZoom: (factor) => sceneRef.current?.zoomBy(factor),
      onStatus: setStatus,
      onGestureTrigger: handleGestureTrigger,
    });
    trackerRef.current = tracker;
    try {
      await tracker.start();
      setCamera("on");
    } catch (err) {
      trackerRef.current = null;
      tracker.stop();
      setCamera("error");
      setError(err instanceof DOMException && err.name === "NotAllowedError" ? "CAMERA ACCESS DENIED" : "TRACKING INIT FAILED");
    }
  }, [handleGestureTrigger]);

  const toggleGestures = useCallback(() => {
    if (trackerRef.current) stopGestures();
    else void startGestures();
  }, [startGestures, stopGestures]);

  const toggleVoiceListen = useCallback(() => {
    if (agentState === "listening") {
      speechServiceRef.current?.stopListening();
      updateOrbVisualState("idle");
    } else {
      triggerWakeUpSequence();
    }
  }, [agentState, triggerWakeUpSequence, updateOrbVisualState]);

  // ─── KEYBOARD SHORTCUTS ──────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "+": case "=": sceneRef.current?.zoomIn(); break;
        case "-": case "_": sceneRef.current?.zoomOut(); break;
        case "r": case "R": sceneRef.current?.resetView(); break;
        case "g": case "G": toggleGestures(); break;
        case "v": case "V": toggleVoiceListen(); break;
        case "c": case "C": setClapEnabled((p) => !p); break;
        case "u": case "U": void unlockAndroid(); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleGestures, toggleVoiceListen, unlockAndroid]);

  const cameraOn = camera === "on";

  return (
    <>
      <div ref={containerRef} className="orb-root" />
      <div className="overlay-vignette" />
      <div className="overlay-grain" />
      <div className="overlay-scanlines" />

      {/* ─── JARVIS WAKE-UP TRANSITION ─────────────────────────────────── */}
      {wakeAnim !== "idle" && (
        <div className={`jarvis-wake-overlay ${wakeAnim}`}>
          <div className="jarvis-wake-rings">
            <div className="wake-ring wake-ring-1" />
            <div className="wake-ring wake-ring-2" />
            <div className="wake-ring wake-ring-3" />
            <div className="wake-ring wake-ring-4" />
          </div>
          <div className="jarvis-wake-center">
            <div className="wake-logo">U</div>
            <div className="wake-label">
              {wakeAnim === "waking" ? "INITIALIZING..." : "ONLINE"}
            </div>
            <div className="wake-subtext">
              {wakeAnim === "waking" ? "ULTRON COMMAND SYSTEM" : "READY, SIR."}
            </div>
          </div>
          <div className="wake-scanbar" />
        </div>
      )}

      <div className="hud hud-title">U.L.T.R.O.N.</div>

      {/* Top Right HUD Badges */}
      <div className="hud-top-right">
        <div className={`hud-badge ${adbDevices.length > 0 ? "active" : ""}`}>
          📱 ADB: {adbStatus}
        </div>
        <div className={`hud-badge ${visualState !== "idle" ? "active" : ""}`}>
          ORB: {visualState.toUpperCase()}
        </div>
        {timerDisplay && (
          <div className="hud-badge active listening">⏱️ {timerDisplay}</div>
        )}
        {telemetryBadge && (
          <div className="hud-badge active">📝 {telemetryBadge}</div>
        )}
        <div className={`hud-badge ${clapEnabled ? "active" : ""}`}>
          {clapEnabled ? "🎤 CLAP: ON" : "🔇 CLAP: OFF"}
        </div>
        <div className={`hud-badge ${agentState === "listening" ? "listening" : agentState !== "idle" ? "active" : ""}`}>
          VOICE: {agentState.toUpperCase()}
        </div>
      </div>

      {/* Voice Subtitles */}
      {subtitle.text && (
        <div className="hud-subtitles">
          <div className="subtitle-box">
            <div className={`subtitle-speaker ${subtitle.speaker.toLowerCase()}`}>[{subtitle.speaker}]</div>
            <div className="subtitle-text">{subtitle.text}</div>
          </div>
        </div>
      )}

      <div className="hud hud-hint">
        <div>
          <span className="key">CLAP</span> wake up&nbsp;&nbsp;
          <span className="key">V</span> voice&nbsp;&nbsp;
          <span className="key">C</span> clap toggle&nbsp;&nbsp;
          <span className="key">U</span> unlock phone
        </div>
        <div>
          <span className="key">SAY</span>&nbsp;"Unlock phone" · "Lock phone" · "Volume up" · "Open YouTube"
        </div>
      </div>

      <div className="hud hud-controls">
        {/* Android Panel */}
        {showAndroidPanel && (
          <div className="android-panel">
            <div className="android-panel-title">📱 ANDROID ADB BRIDGE</div>
            {adbDevices.length > 0 ? (
              <div className="android-device-list">
                {adbDevices.map((d) => (
                  <div
                    key={d.serial}
                    className={`android-device-item ${selectedSerial === d.serial ? "selected" : ""}`}
                    onClick={() => setSelectedSerial(d.serial)}
                  >
                    <span className="device-dot" />
                    {d.model || d.serial}
                  </div>
                ))}
              </div>
            ) : (
              <div className="android-no-devices">
                No devices. Connect via USB (USB Debugging ON) or enter IP below.
              </div>
            )}
            <div className="android-input-row">
              <input
                type="text"
                className="android-input"
                placeholder="IP:5555 (Wi-Fi ADB)"
                value={connectIp}
                onChange={(e) => setConnectIp(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void connectWireless()}
              />
              <button className="hud-btn" onClick={() => void connectWireless()}>CONNECT</button>
            </div>
            <div className="android-input-row">
              <input
                type="password"
                className="android-input"
                placeholder="PIN / Password (optional)"
                value={devicePin}
                onChange={(e) => setDevicePin(e.target.value)}
              />
            </div>
            <div className="hud-row">
              <button className="hud-btn unlock-btn" onClick={() => void unlockAndroid()}>🔓 UNLOCK</button>
              <button className="hud-btn" onClick={() => void lockAndroid()}>🔒 LOCK</button>
              <button className="hud-btn" onClick={() => void scanAdbDevices()}>🔄 SCAN</button>
            </div>
          </div>
        )}

        {/* Camera */}
        <div className={`camera-panel${cameraOn ? " visible" : ""}`}>
          <video ref={videoRef} muted playsInline className="camera-video" />
          <canvas ref={overlayRef} width={208} height={156} className="camera-overlay" />
          <div className="camera-status">
            {status.hands > 0
              ? `${status.hands} HAND${status.hands > 1 ? "S" : ""} · ${status.detectedGesture && status.detectedGesture !== "NONE" ? status.detectedGesture : MODE_LABEL[status.mode]}`
              : "SHOW HANDS"}
          </div>
        </div>

        {error && <div className="hud-error">{error}</div>}

        <div className="hud-row">
          <button className="hud-btn unlock-btn" onClick={() => setShowAndroidPanel((p) => !p)}>
            {showAndroidPanel ? "HIDE ANDROID" : "📱 ANDROID"}
          </button>
          <button
            className="hud-btn"
            aria-pressed={agentState === "listening"}
            onClick={toggleVoiceListen}
          >
            {agentState === "listening" ? "🔴 LISTENING" : "🎤 VOICE"}
          </button>
          <button className="hud-btn" onClick={() => setClapEnabled((p) => !p)}>
            {clapEnabled ? "👏 CLAP ON" : "🔇 CLAP OFF"}
          </button>
        </div>
        <div className="hud-row">
          <button className="hud-btn" aria-pressed={cameraOn} onClick={toggleGestures} disabled={camera === "starting"}>
            {camera === "starting" ? "INIT…" : cameraOn ? "✋ GESTURES ON" : "✋ GESTURES"}
          </button>
          <button className="hud-btn" onClick={() => sceneRef.current?.zoomIn()}>+</button>
          <button className="hud-btn" onClick={() => sceneRef.current?.zoomOut()}>−</button>
          <button className="hud-btn" onClick={() => sceneRef.current?.resetView()}>RESET</button>
        </div>
      </div>
    </>
  );
}
