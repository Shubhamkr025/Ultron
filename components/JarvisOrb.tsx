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
  speaker: "USER" | "JARVIS" | "SYSTEM" | "ULTRON";
  text: string;
}

interface AdbDevice {
  serial: string;
  model: string;
  state?: string;
  isAuthorized?: boolean;
  isWireless?: boolean;
}

interface ChatItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  time: string;
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
    text: "J.A.R.V.I.S. Command Matrix initializing...",
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
  const [adbMessage, setAdbMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [showWifiGuide, setShowWifiGuide] = useState<boolean>(false);
  const [customAppInput, setCustomAppInput] = useState<string>("");

  // Startup & Wake transition state
  const [wakeAnim, setWakeAnim] = useState<"idle" | "waking" | "online">("idle");
  const wakeAnimRef = useRef<"idle" | "waking" | "online">("idle");

  // One-time startup enforcement refs and states
  const startupInitiatedRef = useRef<boolean>(false);
  const startupCompletedRef = useRef<boolean>(false);
  const [hasStartedUp, setHasStartedUp] = useState<boolean>(false);
  const [needsUserClickToBoot, setNeedsUserClickToBoot] = useState<boolean>(false);

  // Natural Conversation States
  const [conversationMode, setConversationMode] = useState<boolean>(true);
  const conversationModeRef = useRef<boolean>(true);
  useEffect(() => {
    conversationModeRef.current = conversationMode;
  }, [conversationMode]);

  const [chatOpen, setChatOpen] = useState<boolean>(false);
  const [chatInput, setChatInput] = useState<string>("");
  const [chatHistory, setChatHistory] = useState<ChatItem[]>([
    {
      id: "init",
      role: "assistant",
      content: "J.A.R.V.I.S. Command Matrix online. Workshop telemetry and multi-device systems active, sir.",
      time: "ONLINE",
    },
  ]);
  const chatHistoryRef = useRef<ChatItem[]>(chatHistory);
  useEffect(() => {
    chatHistoryRef.current = chatHistory;
  }, [chatHistory]);

  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ─── VISUAL STATE ──────────────────────────────────────────────────────────
  const updateOrbVisualState = useCallback((state: VisualState) => {
    setVisualState(state);
    sceneRef.current?.setVisualState(state);
  }, []);

  // ─── ONE-TIME STARTUP BOOT SEQUENCE ────────────────────────────────────────
  const executeInitialStartup = useCallback(() => {
    if (startupCompletedRef.current) return;
    startupInitiatedRef.current = true;

    wakeAnimRef.current = "waking";
    setWakeAnim("waking");
    updateOrbVisualState("listening");

    // Mute clap detector during startup sound playback so it never triggers feedback
    clapDetectorRef.current?.setMuted(true);

    speechServiceRef.current?.playJarvisStartupSound(() => {
      // Completed sound
    });

    // 2.5s: Bloom explosion finishes → Show "ONLINE" stamp
    setTimeout(() => {
      wakeAnimRef.current = "online";
      setWakeAnim("online");
      setSubtitle({ speaker: "ULTRON", text: "Online and operational. Ready for your command, sir." });

      // After 1.2s: Collapse boot overlay and mark startup finished forever
      setTimeout(() => {
        wakeAnimRef.current = "idle";
        setWakeAnim("idle");
        startupCompletedRef.current = true;
        setHasStartedUp(true);
        setNeedsUserClickToBoot(false);
        updateOrbVisualState("idle");

        // Unmute clap detector now that initial startup audio has finished
        clapDetectorRef.current?.setMuted(false);
      }, 1200);
    }, 2500);
  }, [updateOrbVisualState]);

  // Trigger startup ONCE on initial mount
  useEffect(() => {
    if (startupInitiatedRef.current || startupCompletedRef.current) return;

    // Check if autoplay is supported or if user gesture is needed
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const testCtx = new AudioCtx();
        if (testCtx.state === "suspended") {
          // Browser requires user click for sound; show sleek sci-fi boot gate
          setNeedsUserClickToBoot(true);
          testCtx.close().catch(() => {});
          return;
        }
        testCtx.close().catch(() => {});
      }
    } catch {
      // ignore
    }

    executeInitialStartup();
  }, [executeInitialStartup]);

  const handleManualBootClick = () => {
    setNeedsUserClickToBoot(false);
    executeInitialStartup();
  };

  // ─── POST-STARTUP WAKE TRIGGER (CLAP / VOICE / GESTURE) ────────────────────
  const triggerNormalWakeUp = useCallback(() => {
    // If initial startup has not happened yet, trigger the one-time boot
    if (!startupCompletedRef.current) {
      executeInitialStartup();
      return;
    }

    // Guard: don't double wake if already active
    if (agentStateRef.current === "listening" || agentStateRef.current === "processing") return;

    // Play quick sci-fi wake chime (NOT the heavy 4s boot MP3)
    speechServiceRef.current?.playWakeChime();
    updateOrbVisualState("listening");
    setSubtitle({ speaker: "ULTRON", text: "Listening, sir..." });
    agentStateRef.current = "listening";
    setAgentState("listening");
    speechServiceRef.current?.listen();
  }, [executeInitialStartup, updateOrbVisualState]);

  // ─── ADB HELPERS ──────────────────────────────────────────────────────────
  const scanAdbDevices = useCallback(async () => {
    setAdbStatus("SCANNING...");
    setAdbMessage(null);
    try {
      const res = await fetch("/api/adb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "DEVICES" }),
      });
      const data = await res.json();
      if (data.devices && data.devices.length > 0) {
        setAdbDevices(data.devices);
        setSelectedSerial((curr) => {
          if (curr && data.devices.some((d: AdbDevice) => d.serial === curr)) return curr;
          return data.devices[0].serial;
        });
        if (data.hasUnauthorized) {
          setAdbStatus("⚠️ TAP ALLOW ON PHONE");
          setAdbMessage({ text: "Unauthorized device — tap 'Allow USB Debugging' on your phone screen.", type: "info" });
        } else {
          setAdbStatus(`${data.count || data.devices.length} ONLINE`);
        }
      } else {
        setAdbDevices([]);
        setAdbStatus("NO DEVICES");
      }
    } catch {
      setAdbStatus("ADB ERROR");
      setAdbMessage({ text: "Could not reach ADB daemon. Is ADB installed and accessible?", type: "error" });
    }
  }, []);

  const connectWireless = useCallback(async () => {
    const ip = connectIp.trim();
    if (!ip) {
      setAdbMessage({ text: "Enter a device IP address first (e.g. 192.168.1.15:5555).", type: "info" });
      return;
    }
    setAdbStatus("CONNECTING...");
    setAdbMessage({ text: `Connecting to ${ip}...`, type: "info" });
    setSubtitle({ speaker: "ULTRON", text: `Initiating wireless ADB link to ${ip}...` });
    updateOrbVisualState("processing");
    try {
      const res = await fetch("/api/adb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CONNECT", ip }),
      });
      const data = await res.json();
      setSubtitle({ speaker: data.success ? "ULTRON" : "SYSTEM", text: data.message });
      setAdbMessage({ text: data.message, type: data.success ? "success" : "error" });
      updateOrbVisualState(data.success ? "success" : "error");
      if (data.success) {
        setTimeout(() => void scanAdbDevices(), 1200);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAdbStatus("CONN FAILED");
      setAdbMessage({ text: `Connection failed: ${msg}`, type: "error" });
      updateOrbVisualState("error");
    }
  }, [connectIp, updateOrbVisualState, scanAdbDevices]);

  const switchToWifi = useCallback(async () => {
    if (!selectedSerial) {
      setAdbMessage({ text: "No USB device selected. Connect a device via USB first, then click WI-FI.", type: "info" });
      setShowWifiGuide(true);
      return;
    }
    updateOrbVisualState("processing");
    setAdbMessage({ text: "Switching device to Wi-Fi ADB mode (port 5555)...", type: "info" });
    setSubtitle({ speaker: "ULTRON", text: "Configuring USB device for wireless ADB, sir..." });
    try {
      const res = await fetch("/api/adb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "TCPIP", serial: selectedSerial }),
      });
      const data = await res.json();
      setSubtitle({ speaker: data.success ? "ULTRON" : "SYSTEM", text: data.message });
      updateOrbVisualState(data.success ? "success" : "error");
      if (data.ip) {
        setConnectIp(`${data.ip}:5555`);
        setAdbMessage({ text: `Device IP detected: ${data.ip}:5555. Unplug USB, then click LINK!`, type: "success" });
      } else {
        setAdbMessage({ text: data.message, type: data.success ? "success" : "error" });
      }
      setTimeout(() => void scanAdbDevices(), 1000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAdbMessage({ text: `Wi-Fi switch failed: ${msg}`, type: "error" });
      updateOrbVisualState("error");
    }
  }, [selectedSerial, updateOrbVisualState, scanAdbDevices]);

  const unlockAndroid = useCallback(async (serial?: string) => {
    const target = serial || selectedSerial;
    if (!target) {
      setAdbMessage({ text: "No device selected. Connect a device first.", type: "info" });
      return;
    }
    updateOrbVisualState("executing");
    setAdbMessage({ text: "Dispatching unlock sequence...", type: "info" });
    setSubtitle({ speaker: "ULTRON", text: "Dispatching ADB unlock sequence, sir..." });
    try {
      const res = await fetch("/api/adb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "UNLOCK", serial: target, pin: devicePin }),
      });
      const data = await res.json();
      setSubtitle({ speaker: data.success ? "ULTRON" : "SYSTEM", text: data.message });
      setAdbMessage({ text: data.message, type: data.success ? "success" : "error" });
      updateOrbVisualState(data.success ? "success" : "error");
      speechServiceRef.current?.speak(data.message);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAdbMessage({ text: `Unlock failed: ${msg}`, type: "error" });
      updateOrbVisualState("error");
    }
  }, [selectedSerial, devicePin, updateOrbVisualState]);

  const lockAndroid = useCallback(async () => {
    if (!selectedSerial) {
      setAdbMessage({ text: "No device selected.", type: "info" });
      return;
    }
    updateOrbVisualState("executing");
    setAdbMessage({ text: "Sleeping device display...", type: "info" });
    try {
      const res = await fetch("/api/adb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "LOCK", serial: selectedSerial }),
      });
      const data = await res.json();
      setSubtitle({ speaker: "ULTRON", text: data.message });
      setAdbMessage({ text: data.message, type: data.success ? "success" : "error" });
      updateOrbVisualState("success");
      speechServiceRef.current?.speak(data.message);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAdbMessage({ text: `Lock failed: ${msg}`, type: "error" });
      updateOrbVisualState("error");
    }
  }, [selectedSerial, updateOrbVisualState]);

  const launchApp = useCallback(
    async (appName: string, query?: string) => {
      const target = selectedSerial || (adbDevices.length > 0 ? adbDevices[0].serial : undefined);
      updateOrbVisualState("executing");
      setAdbMessage({ text: `Launching ${appName}...`, type: "info" });
      setSubtitle({ speaker: "ULTRON", text: `Launching ${appName} on phone...` });
      try {
        const res = await fetch("/api/adb", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "OPEN_APP", app: appName, query, serial: target }),
        });
        const data = await res.json();
        setSubtitle({ speaker: "ULTRON", text: data.message });
        setAdbMessage({ text: data.message, type: data.success ? "success" : "error" });
        updateOrbVisualState(data.success ? "success" : "error");
        speechServiceRef.current?.speak(data.message);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setAdbMessage({ text: `Launch failed: ${msg}`, type: "error" });
        updateOrbVisualState("error");
      }
    },
    [selectedSerial, adbDevices, updateOrbVisualState]
  );

  const navigateDevice = useCallback(
    async (navAction: "HOME" | "BACK" | "RECENTS" | "VOLUME_UP" | "VOLUME_DOWN") => {
      const target = selectedSerial || (adbDevices.length > 0 ? adbDevices[0].serial : undefined);
      try {
        const res = await fetch("/api/adb", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: navAction, serial: target }),
        });
        const data = await res.json();
        setAdbMessage({ text: data.message, type: data.success ? "success" : "error" });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setAdbMessage({ text: `Navigation failed: ${msg}`, type: "error" });
      }
    },
    [selectedSerial, adbDevices]
  );

  // ─── QUERY ULTRON AGENT WITH NATURAL CONVERSATION ─────────────────────────
  const queryUltronAgent = useCallback(
    async (userPrompt: string) => {
      if (!userPrompt.trim()) return;

      // Clear any pending silence timer
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = null;
      }

      agentStateRef.current = "processing";
      setAgentState("processing");
      updateOrbVisualState("processing");
      setSubtitle({ speaker: "ULTRON", text: "Processing..." });

      // Append user utterance to chat history
      const nowStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const userItem: ChatItem = {
        id: `u-${Date.now()}`,
        role: "user",
        content: userPrompt,
        time: nowStr,
      };

      setChatHistory((prev) => [...prev, userItem]);

      try {
        const historyPayload = chatHistoryRef.current.slice(-8).map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: userPrompt, history: historyPayload }),
        });
        const data = await res.json();
        let replyText = data.reply || "At your service, sir.";

        if (data.action?.type === "UNLOCK_DEVICE") {
          await unlockAndroid();
          return;
        }
        if (data.action?.type === "LOCK_DEVICE") {
          await lockAndroid();
          return;
        }
        if (data.action?.type === "OPEN_APP" || data.action?.type === "NAVIGATE_PHONE") {
          updateOrbVisualState("executing");
          setTimeout(() => updateOrbVisualState("success"), 600);
        } else if (data.action && data.action.type !== "NONE" && actionExecutorRef.current) {
          updateOrbVisualState("executing");
          const result = await actionExecutorRef.current.execute(data.action as ActionPayload);
          if (result) replyText = result;
          setTimeout(() => updateOrbVisualState("success"), 600);
        } else {
          updateOrbVisualState("success");
        }

        // Append assistant response to chat history
        const assistantItem: ChatItem = {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: replyText,
          time: nowStr,
        };
        setChatHistory((prev) => [...prev, assistantItem]);

        setSubtitle({ speaker: "ULTRON", text: replyText });

        // If user asked to exit/standby, handle transition
        if (data.shouldExitConversation) {
          speechServiceRef.current?.speak(replyText);
          return;
        }

        // Speak reply via speech synthesis
        speechServiceRef.current?.speak(replyText);
      } catch {
        updateOrbVisualState("error");
        const errReply = "My apologies, sir. Command dispatch encountered an anomaly.";
        setSubtitle({ speaker: "ULTRON", text: errReply });
        speechServiceRef.current?.speak(errReply);
      }
    },
    [updateOrbVisualState, unlockAndroid, lockAndroid]
  );

  const queryRef = useRef(queryUltronAgent);
  useEffect(() => {
    queryRef.current = queryUltronAgent;
  }, [queryUltronAgent]);

  // ─── SPEECH SERVICE (Created ONCE, live-updated via ref) ───────────────────
  useEffect(() => {
    const makeCallbacks = () => ({
      onUserTranscript: (text: string, isFinal: boolean) => {
        setSubtitle({ speaker: "USER", text });
        if (isFinal && text.trim()) void queryRef.current(text);
      },
      onJarvisSpeak: (text: string) => {
        setSubtitle({ speaker: "ULTRON", text });
        // Mute clap detector while Ultron is speaking so speaker output is never mistaken for a clap
        clapDetectorRef.current?.setMuted(true);
      },
      onJarvisSpeakEnd: () => {
        // Unmute clap detector once speech is finished
        clapDetectorRef.current?.setMuted(false);

        // NATURAL CONVERSATION TURN-TAKING:
        // If continuous conversation mode is active, smoothly resume listening for user follow-up!
        if (conversationModeRef.current) {
          setTimeout(() => {
            if (agentStateRef.current === "idle" || agentStateRef.current === "speaking") {
              agentStateRef.current = "listening";
              setAgentState("listening");
              updateOrbVisualState("listening");
              setSubtitle({ speaker: "ULTRON", text: "Listening..." });
              speechServiceRef.current?.listen();

              // Set a graceful 8-second silence timer: if user doesn't respond, return to quiet standby
              if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
              silenceTimeoutRef.current = setTimeout(() => {
                if (agentStateRef.current === "listening") {
                  speechServiceRef.current?.stopListening();
                  speechServiceRef.current?.playStandbyChime();
                  updateOrbVisualState("idle");
                  setSubtitle({ speaker: "ULTRON", text: "Standing by, sir." });
                }
              }, 8000);
            }
          }, 350);
        }
      },
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
      if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update speech callbacks dynamically
  useEffect(() => {
    if (!speechServiceRef.current) return;
    speechServiceRef.current.updateCallbacks({
      onUserTranscript: (text: string, isFinal: boolean) => {
        setSubtitle({ speaker: "USER", text });
        if (isFinal && text.trim()) void queryRef.current(text);
      },
      onJarvisSpeak: (text: string) => {
        setSubtitle({ speaker: "ULTRON", text });
        clapDetectorRef.current?.setMuted(true);
      },
      onJarvisSpeakEnd: () => {
        clapDetectorRef.current?.setMuted(false);
        if (conversationModeRef.current) {
          setTimeout(() => {
            if (agentStateRef.current === "idle" || agentStateRef.current === "speaking") {
              agentStateRef.current = "listening";
              setAgentState("listening");
              updateOrbVisualState("listening");
              setSubtitle({ speaker: "ULTRON", text: "Listening..." });
              speechServiceRef.current?.listen();

              if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
              silenceTimeoutRef.current = setTimeout(() => {
                if (agentStateRef.current === "listening") {
                  speechServiceRef.current?.stopListening();
                  speechServiceRef.current?.playStandbyChime();
                  updateOrbVisualState("idle");
                  setSubtitle({ speaker: "ULTRON", text: "Standing by, sir." });
                }
              }, 8000);
            }
          }, 350);
        }
      },
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
      onTelemetryUpdate: (info) => setSubtitle({ speaker: "ULTRON", text: info }),
      onSpeak: (text) => {
        setSubtitle({ speaker: "ULTRON", text });
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
  const handleGestureTrigger = useCallback(
    (gesture: DetectedGesture) => {
      switch (gesture) {
        case "OPEN_PALM":
          speechServiceRef.current?.stopSpeaking();
          speechServiceRef.current?.stopListening();
          updateOrbVisualState("idle");
          setSubtitle({ speaker: "SYSTEM", text: "[PALM] Standby engaged." });
          break;
        case "THUMBS_UP":
          void queryRef.current("system status");
          break;
        case "PEACE":
          triggerNormalWakeUp();
          break;
        case "FIST":
          sceneRef.current?.resetView();
          setSubtitle({ speaker: "SYSTEM", text: "[FIST] Orb view reset." });
          break;
      }
    },
    [triggerNormalWakeUp, updateOrbVisualState]
  );

  // ─── CLAP DETECTOR (Wake trigger with strict echo immunity) ───────────────
  useEffect(() => {
    if (!clapEnabled) {
      clapDetectorRef.current?.stop();
      clapDetectorRef.current = null;
      return;
    }

    const detector = new ClapDetector({
      onClap: () => {
        triggerNormalWakeUp();
      },
    });

    clapDetectorRef.current = detector;
    void detector.start().catch(() => {});

    return () => {
      detector.stop();
      clapDetectorRef.current = null;
    };
  }, [clapEnabled, triggerNormalWakeUp]);

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
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "CAMERA ACCESS DENIED"
          : "TRACKING INIT FAILED"
      );
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
      triggerNormalWakeUp();
    }
  }, [agentState, triggerNormalWakeUp, updateOrbVisualState]);

  // ─── KEYBOARD SHORTCUTS ──────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't capture shortcuts when user is typing in chat input
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;

      switch (e.key) {
        case "+":
        case "=":
          sceneRef.current?.zoomIn();
          break;
        case "-":
        case "_":
          sceneRef.current?.zoomOut();
          break;
        case "r":
        case "R":
          sceneRef.current?.resetView();
          break;
        case "g":
        case "G":
          toggleGestures();
          break;
        case "v":
        case "V":
          toggleVoiceListen();
          break;
        case "c":
        case "C":
          setClapEnabled((p) => !p);
          break;
        case "u":
        case "U":
          void unlockAndroid();
          break;
        case "t":
        case "T":
          setChatOpen((p) => !p);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleGestures, toggleVoiceListen, unlockAndroid]);

  const handleSendChat = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim()) return;
    const text = chatInput.trim();
    setChatInput("");
    void queryRef.current(text);
  };

  const cameraOn = camera === "on";

  return (
    <>
      <div ref={containerRef} className="orb-root" />
      <div className="overlay-vignette" />
      <div className="overlay-grain" />
      <div className="overlay-scanlines" />

      {/* ─── INTERACTIVE BOOT GATE (When browser autoplay requires 1st click) ── */}
      {needsUserClickToBoot && !hasStartedUp && (
        <div className="startup-gate" onClick={handleManualBootClick}>
          <div className="startup-gate-ring">
            <div className="startup-gate-icon">⚡</div>
          </div>
          <div className="startup-gate-title">ENGAGE ULTRON COMMAND CORE</div>
          <div className="startup-gate-subtext">[ CLICK TO INITIALIZE NEURAL INTERFACE ]</div>
        </div>
      )}

      {/* ─── ONE-TIME JARVIS WAKE-UP TRANSITION ─────────────────────────── */}
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

      {/* ─── TOP LEFT HOLOGRAPHIC BRANDING & TELEMETRY ─── */}
      <div className="hud hud-title-matrix">
        <div className="hud-title-prefix">// STARK INDUSTRIES TACTICAL HUD</div>
        <div className="hud-title-main">
          <span className="hud-title-glow">U.L.T.R.O.N.</span>
          <span className="hud-title-version">CORE v2.4</span>
        </div>
        <div className="hud-title-sub">NEURAL COMMAND & CONTROL MATRIX</div>
        <div className="hud-title-line" />
      </div>

      {/* ─── TOP RIGHT HOLOGRAPHIC TELEMETRY MATRIX ─── */}
      <div className="hud-telemetry-deck">
        <div className="telemetry-bracket tl" />
        <div className="telemetry-bracket tr" />
        <div className="telemetry-bracket bl" />
        <div className="telemetry-bracket br" />
        <div className="telemetry-shimmer" />

        {/* Panel Header */}
        <div className="telemetry-header">
          <div className="telemetry-header-title">
            <span className="telemetry-pulse-dot" />
            <span>SYS.TELEMETRY</span>
          </div>
          <span className="telemetry-id">ULTRON//CORE</span>
        </div>

        {/* Telemetry Rows Grid */}
        <div className="telemetry-grid">
          {/* Row 1: Voice Core State */}
          <div className={`telemetry-row voice-row ${agentState === "listening" ? "listening" : agentState !== "idle" ? "active" : ""}`}>
            <div className="telemetry-row-label">
              <span className={`status-pip ${agentState === "listening" ? "pulse-cyan" : agentState !== "idle" ? "online" : ""}`} />
              VOICE LINK
            </div>
            <div className="telemetry-row-val">{agentState.toUpperCase()}</div>
          </div>

          {/* Row 2: Orb Core State */}
          <div className={`telemetry-row ${visualState !== "idle" ? "active" : ""}`}>
            <div className="telemetry-row-label">
              <span className={`status-pip ${visualState !== "idle" ? "online" : ""}`} />
              ORB MATRIX
            </div>
            <div className="telemetry-row-val">{visualState.toUpperCase()}</div>
          </div>

          {/* Row 3: Dialogue Turn Mode (Interactive) */}
          <div
            className={`telemetry-row interactive ${conversationMode ? "active" : ""}`}
            onClick={() => setConversationMode((p) => !p)}
            title="Click to toggle continuous turn-taking dialogue"
          >
            <div className="telemetry-row-label">
              <span className="status-pip online" />
              DIALOGUE
            </div>
            <div className="telemetry-row-val toggle-val">
              <span>{conversationMode ? "AUTO" : "MANUAL"}</span>
              <span className="toggle-indicator">⇄</span>
            </div>
          </div>

          {/* Row 4: Acoustic / Clap Sensor */}
          <div
            className={`telemetry-row interactive ${clapEnabled ? "active" : "muted"}`}
            onClick={() => setClapEnabled((p) => !p)}
            title="Click to toggle acoustic clap trigger"
          >
            <div className="telemetry-row-label">
              <span className={`status-pip ${clapEnabled ? "online" : "off"}`} />
              ACOUSTIC
            </div>
            <div className="telemetry-row-val">{clapEnabled ? "ARMED" : "MUTED"}</div>
          </div>

          {/* Row 5: ADB Link */}
          <div
            className={`telemetry-row interactive ${adbDevices.length > 0 ? "active" : ""}`}
            onClick={() => setShowAndroidPanel((p) => !p)}
            title="Click to toggle Android ADB Bridge"
          >
            <div className="telemetry-row-label">
              <span className={`status-pip ${adbDevices.length > 0 ? "online" : ""}`} />
              ADB LINK
            </div>
            <div className="telemetry-row-val">{adbStatus}</div>
          </div>

          {/* Optional Timer Row */}
          {timerDisplay && (
            <div className="telemetry-row timer-row active">
              <div className="telemetry-row-label">
                <span className="status-pip pulse-cyan" />
                TIMER
              </div>
              <div className="telemetry-row-val timer-val">{timerDisplay}</div>
            </div>
          )}

          {/* Optional Telemetry Badge */}
          {telemetryBadge && (
            <div className="telemetry-row data-row active">
              <div className="telemetry-row-label">
                <span className="status-pip online" />
                TELEMETRY
              </div>
              <div className="telemetry-row-val">{telemetryBadge}</div>
            </div>
          )}
        </div>
      </div>

      {/* ─── VOICE SUBTITLES ─── */}
      {subtitle.text && (
        <div className="hud-subtitles">
          <div className="subtitle-box">
            <div className="subtitle-header">
              <span className={`subtitle-speaker ${subtitle.speaker.toLowerCase()}`}>
                [{subtitle.speaker}]
              </span>
              <span className="subtitle-indicator" />
            </div>
            <div className="subtitle-text">{subtitle.text}</div>
          </div>
        </div>
      )}

      {/* ─── HOLOGRAPHIC CONVERSATION CONSOLE ───────────────────────────── */}
      {chatOpen && (
        <div className="chat-console">
          <div className="chat-console-header">
            <div className="chat-console-title">
              <span className={`chat-status-dot ${agentState === "listening" ? "listening" : ""}`} />
              NEURAL DIALOGUE STREAM
            </div>
            <button
              className="chat-close-btn"
              onClick={() => setChatOpen(false)}
              title="Close Chat"
            >
              ✕
            </button>
          </div>

          <div className="chat-history">
            {chatHistory.map((item) => (
              <div key={item.id} className={`chat-msg ${item.role}`}>
                <div className="chat-msg-role">
                  [{item.role === "user" ? "YOU" : "ULTRON"}] · {item.time}
                </div>
                <div>{item.content}</div>
              </div>
            ))}
          </div>

          <div className="chat-chips">
            <button className="chat-chip" onClick={() => void queryRef.current("system status")}>
              System Status
            </button>
            <button className="chat-chip" onClick={() => void queryRef.current("tell me a joke")}>
              Tell Joke
            </button>
            <button className="chat-chip" onClick={() => void queryRef.current("what can you do")}>
              Capabilities
            </button>
            <button className="chat-chip" onClick={() => void queryRef.current("how are you doing")}>
              Check In
            </button>
            <button className="chat-chip" onClick={() => void queryRef.current("check weather")}>
              Weather
            </button>
          </div>

          <form onSubmit={handleSendChat} className="chat-input-row">
            <input
              type="text"
              className="chat-input"
              placeholder="Ask Ultron anything or command..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
            />
            <button type="submit" className="chat-send-btn">
              TRANSMIT
            </button>
          </form>
        </div>
      )}

      {/* ─── TACTICAL KEYBOARD HINTS (BOTTOM LEFT) ─── */}
      <div className="hud hud-hint">
        <div className="hud-hint-title">// KEYBOARD OVERRIDES</div>
        <div className="hud-hint-keys">
          <span className="key-chip"><span className="key">V</span> VOICE</span>
          <span className="key-chip"><span className="key">T</span> CHAT</span>
          <span className="key-chip"><span className="key">C</span> CLAP</span>
          <span className="key-chip"><span className="key">U</span> UNLOCK</span>
        </div>
        <div className="hud-hint-phrases">
          <span className="key-say">VOICE CUES:</span> "Hello Ultron" · "Tell me a joke" · "Unlock phone" · "Open YouTube"
        </div>
      </div>

      {/* ─── STATE-OF-THE-ART COMMAND DECK CONTAINER ─── */}
      <div className="hud-command-container">
        {/* Flyout Android ADB Terminal */}
        {showAndroidPanel && (
          <div className="android-panel">
            <div className="android-panel-header">
              <div className="android-panel-title">
                <span className="tech-bracket">[</span>
                <span className="title-icon">📱</span>
                ANDROID ADB MATRIX
                <span className="tech-bracket">]</span>
              </div>
              <div style={{ display: "flex", gap: "4px" }}>
                <button
                  className="deck-mini-btn close-panel-btn"
                  onClick={() => setShowWifiGuide((p) => !p)}
                  title="Show Wi-Fi Connection Guide"
                  style={{ color: "#66e0ff" }}
                >
                  {showWifiGuide ? "▲" : "📶"}
                </button>
                <button
                  className="deck-mini-btn close-panel-btn"
                  onClick={() => setShowAndroidPanel(false)}
                  title="Close"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Wi-Fi ADB Guide */}
            {showWifiGuide && (
              <div className="android-wifi-guide">
                <div className="guide-step"><span className="step-num">[A]</span><span><b>USB first:</b> Plug in USB, enable Developer Options → USB Debugging</span></div>
                <div className="guide-step"><span className="step-num">[B]</span><span>Click <b>WI-FI</b> button — switches device to port 5555 &amp; reads IP</span></div>
                <div className="guide-step"><span className="step-num">[C]</span><span>Unplug USB, click <b>LINK IP</b> to connect wirelessly</span></div>
                <div className="guide-step"><span className="step-num">[D]</span><span><b>Android 11+:</b> Dev Options → Wireless Debugging → enter IP:port manually</span></div>
              </div>
            )}

            {/* Status Message */}
            {adbMessage && (
              <div className={`android-status-bar ${adbMessage.type}`}>
                <span>{adbMessage.type === "success" ? "✓" : adbMessage.type === "error" ? "✗" : "ℹ"}</span>
                <span>{adbMessage.text}</span>
              </div>
            )}

            {/* Device List */}
            {adbDevices.length > 0 ? (
              <div className="android-device-list">
                {adbDevices.map((d) => (
                  <div
                    key={d.serial}
                    className={`android-device-item ${selectedSerial === d.serial ? "selected" : ""} ${d.state === "unauthorized" ? "unauthorized" : ""}`}
                    onClick={() => setSelectedSerial(d.serial)}
                    title={d.serial}
                  >
                    <span className={`device-dot ${d.state === "unauthorized" ? "warning" : "online"}`} />
                    <span className="device-name">{d.model || d.serial}</span>
                    <span className={`device-tag ${d.state === "unauthorized" ? "warning" : ""}`}>
                      {d.state === "unauthorized" ? "⚠ TAP ALLOW" : d.isWireless ? "📶 WI-FI" : "🔌 USB"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="android-no-devices">
                NO DEVICES FOUND · Connect USB (Debug ON) or enter IP below
              </div>
            )}

            {/* Wi-Fi IP Connection */}
            <div className="android-input-row">
              <input
                type="text"
                className="android-input"
                placeholder="192.168.x.x:5555"
                value={connectIp}
                onChange={(e) => setConnectIp(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void connectWireless();
                }}
              />
              <button
                className="android-action-btn connect-btn"
                onClick={() => void connectWireless()}
                title="Connect wirelessly via IP"
              >
                LINK
              </button>
            </div>

            {/* PIN input */}
            <div className="android-input-row">
              <input
                type="password"
                className="android-input"
                placeholder="Screen PIN / Password (for unlock)"
                value={devicePin}
                onChange={(e) => setDevicePin(e.target.value)}
              />
            </div>

            {/* Tactical Navigation Bar */}
            <div className="android-section-title">
              <span>// PHONE NAVIGATION</span>
            </div>
            <div className="android-nav-row">
              <button
                className="android-nav-btn"
                onClick={() => void navigateDevice("BACK")}
                title="Back button (Keyevent 4)"
              >
                ◀ BACK
              </button>
              <button
                className="android-nav-btn"
                onClick={() => void navigateDevice("HOME")}
                title="Home button (Keyevent 3)"
              >
                ⌂ HOME
              </button>
              <button
                className="android-nav-btn"
                onClick={() => void navigateDevice("RECENTS")}
                title="Recent apps overview (Keyevent 187)"
              >
                ▢ TASKS
              </button>
              <button
                className="android-nav-btn"
                onClick={() => void navigateDevice("VOLUME_DOWN")}
                title="Volume Down"
              >
                🔉 VOL-
              </button>
              <button
                className="android-nav-btn"
                onClick={() => void navigateDevice("VOLUME_UP")}
                title="Volume Up"
              >
                🔊 VOL+
              </button>
            </div>

            {/* Quick App Launcher Matrix */}
            <div className="android-section-title">
              <span>// LAUNCH APPS ON PHONE</span>
              <span style={{ fontSize: "9px", opacity: 0.7 }}>TAP TO OPEN</span>
            </div>
            <div className="android-app-grid">
              <button className="android-app-chip yt" onClick={() => void launchApp("youtube")} title="Open YouTube">
                <span className="app-icon">▶️</span>
                <span>YOUTUBE</span>
              </button>
              <button className="android-app-chip wa" onClick={() => void launchApp("whatsapp")} title="Open WhatsApp">
                <span className="app-icon">💬</span>
                <span>WHATSAPP</span>
              </button>
              <button className="android-app-chip ig" onClick={() => void launchApp("instagram")} title="Open Instagram">
                <span className="app-icon">📸</span>
                <span>INSTAGRAM</span>
              </button>
              <button className="android-app-chip" onClick={() => void launchApp("chrome")} title="Open Chrome">
                <span className="app-icon">🌐</span>
                <span>CHROME</span>
              </button>
              <button className="android-app-chip" onClick={() => void launchApp("camera")} title="Open Camera">
                <span className="app-icon">📷</span>
                <span>CAMERA</span>
              </button>
              <button className="android-app-chip sp" onClick={() => void launchApp("spotify")} title="Open Spotify">
                <span className="app-icon">🎵</span>
                <span>SPOTIFY</span>
              </button>
              <button className="android-app-chip" onClick={() => void launchApp("settings")} title="Open Settings">
                <span className="app-icon">⚙️</span>
                <span>SETTINGS</span>
              </button>
              <button className="android-app-chip" onClick={() => void launchApp("maps")} title="Open Maps">
                <span className="app-icon">🗺️</span>
                <span>MAPS</span>
              </button>
              <button className="android-app-chip" onClick={() => void launchApp("calculator")} title="Open Calculator">
                <span className="app-icon">🧮</span>
                <span>CALC</span>
              </button>
              <button className="android-app-chip" onClick={() => void launchApp("playstore")} title="Open Play Store">
                <span className="app-icon">🛍️</span>
                <span>STORE</span>
              </button>
              <button className="android-app-chip" onClick={() => void launchApp("gallery")} title="Open Gallery">
                <span className="app-icon">🖼️</span>
                <span>GALLERY</span>
              </button>
              <button className="android-app-chip" onClick={() => void launchApp("clock")} title="Open Clock/Alarm">
                <span className="app-icon">⏰</span>
                <span>CLOCK</span>
              </button>
            </div>

            {/* Custom App Launch input */}
            <div className="android-input-row">
              <input
                type="text"
                className="android-input"
                placeholder="Launch app (e.g. youtube, camera)..."
                value={customAppInput}
                onChange={(e) => setCustomAppInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && customAppInput.trim()) {
                    void launchApp(customAppInput.trim());
                    setCustomAppInput("");
                  }
                }}
              />
              <button
                className="android-action-btn connect-btn"
                onClick={() => {
                  if (customAppInput.trim()) {
                    void launchApp(customAppInput.trim());
                    setCustomAppInput("");
                  }
                }}
                title="Launch entered app on phone"
              >
                OPEN
              </button>
            </div>

            {/* Action Buttons */}
            <div className="android-action-row">
              <button
                className="android-action-btn unlock-btn"
                onClick={() => void unlockAndroid()}
                title="Wake + swipe unlock (+ PIN if set)"
              >
                🔓 UNLOCK
              </button>
              <button
                className="android-action-btn lock-btn"
                onClick={() => void lockAndroid()}
                title="Sleep the screen"
              >
                🔒 LOCK
              </button>
              <button
                className="android-action-btn wifi-btn"
                onClick={() => void switchToWifi()}
                title="Enable Wi-Fi ADB on port 5555 (USB must be connected)"
              >
                📶 WI-FI
              </button>
              <button
                className="android-action-btn scan-btn"
                onClick={() => void scanAdbDevices()}
                title="Rescan for connected devices"
              >
                🔄 SCAN
              </button>
            </div>
          </div>
        )}

        {/* Flyout Camera / Vision HUD Visor */}
        <div className={`camera-panel${cameraOn ? " visible" : ""}`}>
          <div className="camera-visor-bracket visor-tl" />
          <div className="camera-visor-bracket visor-tr" />
          <div className="camera-visor-bracket visor-bl" />
          <div className="camera-visor-bracket visor-br" />
          <div className="camera-scanline" />
          <div className="camera-reticle" />

          <video ref={videoRef} muted playsInline className="camera-video" />
          <canvas ref={overlayRef} width={208} height={156} className="camera-overlay" />
          
          <div className="camera-status">
            <span className="camera-status-dot" />
            <span className="camera-status-text">
              {status.hands > 0
                ? `${status.hands} HAND${status.hands > 1 ? "S" : ""} · ${
                    status.detectedGesture && status.detectedGesture !== "NONE"
                      ? status.detectedGesture
                      : MODE_LABEL[status.mode]
                  }`
                : "AWAITING HAND GESTURE"}
            </span>
          </div>
        </div>

        {error && (
          <div className="hud-deck-error">
            <span className="error-icon">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* ─── THE STATE-OF-THE-ART COMMAND DECK ─── */}
        <nav className="hud-command-deck" aria-label="Ultron Command Matrix">
          <div className="deck-corner-bracket corner-tl" />
          <div className="deck-corner-bracket corner-tr" />
          <div className="deck-corner-bracket corner-bl" />
          <div className="deck-corner-bracket corner-br" />
          <div className="deck-shimmer" />

          {/* Module Left: Comms, Network & Acoustic Link */}
          <div className="deck-section deck-comms">
            <span className="deck-section-tag">// SYS.COMMS</span>
            <div className="deck-section-buttons">
              {/* Chat Console Toggle */}
              <button
                type="button"
                className={`deck-btn ${chatOpen ? "active" : ""}`}
                onClick={() => setChatOpen((p) => !p)}
                title="Toggle Holographic Chat Console (Key: T)"
              >
                <span className="deck-btn-glow" />
                <span className="deck-btn-icon">💬</span>
                <span className="deck-btn-info">
                  <span className="deck-btn-title">{chatOpen ? "CLOSE" : "CHAT"}</span>
                  <span className="deck-btn-shortcut">[T]</span>
                </span>
                <span className={`deck-btn-dot ${chatOpen ? "active" : ""}`} />
              </button>

              {/* Android Bridge Toggle */}
              <button
                type="button"
                className={`deck-btn ${showAndroidPanel ? "active" : ""} ${
                  adbDevices.length > 0 ? "linked" : ""
                }`}
                onClick={() => setShowAndroidPanel((p) => !p)}
                title="Android ADB Bridge (Key: U)"
              >
                <span className="deck-btn-glow" />
                <span className="deck-btn-icon">📱</span>
                <span className="deck-btn-info">
                  <span className="deck-btn-title">ANDROID</span>
                  <span className="deck-btn-shortcut">
                    {adbDevices.length > 0 ? `${adbDevices.length} LINKED` : "[U]"}
                  </span>
                </span>
                <span className={`deck-btn-dot ${adbDevices.length > 0 ? "active" : ""}`} />
              </button>

              {/* Acoustic Clap Toggle */}
              <button
                type="button"
                className={`deck-btn ${clapEnabled ? "active" : "muted"}`}
                onClick={() => setClapEnabled((p) => !p)}
                title="Toggle Acoustic Clap Wake (Key: C)"
              >
                <span className="deck-btn-glow" />
                <span className="deck-btn-icon">{clapEnabled ? "👏" : "🔇"}</span>
                <span className="deck-btn-info">
                  <span className="deck-btn-title">CLAP</span>
                  <span className="deck-btn-shortcut">{clapEnabled ? "ON [C]" : "OFF"}</span>
                </span>
                <span className={`deck-btn-dot ${clapEnabled ? "active" : ""}`} />
              </button>
            </div>
          </div>

          {/* Module Center: Arc-Core Voice Engine */}
          <div className="deck-core-wrapper">
            <button
              type="button"
              className={`deck-core-btn ${
                agentState === "listening"
                  ? "listening"
                  : agentState === "speaking"
                  ? "speaking"
                  : agentState === "processing"
                  ? "processing"
                  : ""
              }`}
              aria-pressed={agentState === "listening"}
              onClick={toggleVoiceListen}
              title="Activate Ultron Voice Link (Key: V)"
            >
              <div className="core-reactor-glow" />
              <div className="core-reactor-ring outer" />
              <div className="core-reactor-ring inner" />
              
              <div className="core-content">
                <div className="core-soundwave">
                  <span className="sound-bar b1" />
                  <span className="sound-bar b2" />
                  <span className="sound-bar b3" />
                  <span className="sound-bar b4" />
                  <span className="sound-bar b5" />
                </div>
                <div className="core-status-text">
                  {agentState === "listening"
                    ? "LISTENING"
                    : agentState === "speaking"
                    ? "SPEAKING"
                    : agentState === "processing"
                    ? "THINKING"
                    : "VOICE LINK"}
                </div>
                <div className="core-subtext">
                  {agentState === "idle" ? "[V] ENGAGE" : "ACTIVE"}
                </div>
              </div>
            </button>
          </div>

          {/* Module Right: Optics, Gesture Vision & Zoom Cluster */}
          <div className="deck-section deck-optics">
            <span className="deck-section-tag">// OPTICS.NAV</span>
            <div className="deck-section-buttons">
              {/* Hand Gestures / Camera Toggle */}
              <button
                type="button"
                className={`deck-btn ${cameraOn ? "active" : ""}`}
                aria-pressed={cameraOn}
                onClick={toggleGestures}
                disabled={camera === "starting"}
                title="Toggle Hand Gesture Tracking"
              >
                <span className="deck-btn-glow" />
                <span className="deck-btn-icon">✋</span>
                <span className="deck-btn-info">
                  <span className="deck-btn-title">
                    {camera === "starting" ? "BOOT" : cameraOn ? "VISION ON" : "VISION"}
                  </span>
                  <span className="deck-btn-shortcut">
                    {cameraOn ? (status.hands > 0 ? `${status.hands} HANDS` : "TRACKING") : "GESTURES"}
                  </span>
                </span>
                <span className={`deck-btn-dot ${cameraOn ? "active" : ""}`} />
              </button>

              {/* Viewport Zoom & Reset Micro-Cluster */}
              <div className="deck-micro-cluster" title="Orb Camera Zoom & Reset Controls">
                <button
                  type="button"
                  className="deck-micro-btn"
                  onClick={() => sceneRef.current?.zoomIn()}
                  title="Zoom In"
                >
                  +
                </button>
                <button
                  type="button"
                  className="deck-micro-btn"
                  onClick={() => sceneRef.current?.zoomOut()}
                  title="Zoom Out"
                >
                  −
                </button>
                <button
                  type="button"
                  className="deck-micro-btn reset-btn"
                  onClick={() => sceneRef.current?.resetView()}
                  title="Reset Camera View"
                >
                  ⟲
                </button>
              </div>
            </div>
          </div>
        </nav>
      </div>
    </>
  );
}
