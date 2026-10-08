import { NextResponse } from "next/server";
import { globalDeviceRegistry } from "@/lib/deviceRegistry";
import { ConversationEngine, type ChatMessage } from "@/lib/conversationEngine";
import {
  openAppOnPhone,
  unlockPhone,
  lockPhone,
  navigatePhone,
  getConnectedDevices,
  APP_PACKAGE_MAP,
} from "@/lib/adbService";

export interface AgentAction {
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
    | "VOLUME_UP"
    | "VOLUME_DOWN"
    | "NONE";
  url?: string;
  query?: string;
  app?: string;
  command?: string;
  target?: "phone" | "browser" | "all";
  seconds?: number;
  note?: string;
  text?: string;
  theme?: "ambient" | "alert" | "alarm";
}

const SITE_URLS: Record<string, string> = {
  youtube: "https://youtube.com",
  whatsapp: "https://web.whatsapp.com",
  instagram: "https://instagram.com",
  google: "https://google.com",
  github: "https://github.com",
  wikipedia: "https://wikipedia.org",
  spotify: "https://open.spotify.com",
  maps: "https://maps.google.com",
  twitter: "https://x.com",
  x: "https://x.com",
  reddit: "https://reddit.com",
  stackoverflow: "https://stackoverflow.com",
};

// Tool definitions for J.A.R.V.I.S. Command Core
const TOOLS = {
  get_current_time: () => {
    const now = new Date();
    return {
      time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      date: now.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  },

  get_weather: ({ location }: { location?: string }) => {
    const city = location || "Malibu";
    const conditions = ["Clear Sky", "Partly Cloudy", "Atmospheric Haze", "Scattered Showers"];
    const temp = Math.floor(20 + Math.random() * 8);
    const cond = conditions[Math.floor(Math.random() * conditions.length)];
    return {
      location: city,
      temperature: `${temp}°C`,
      condition: cond,
      humidity: `${45 + Math.floor(Math.random() * 20)}%`,
      windSpeed: `${8 + Math.floor(Math.random() * 10)} km/h`,
      status: "Telemetry operational",
    };
  },

  evaluate_math: ({ expression }: { expression: string }) => {
    try {
      const sanitized = expression.replace(/[^0-9+\-*/().^%\s]/g, "");
      // eslint-disable-next-line no-new-func
      const result = Function(`"use strict"; return (${sanitized})`)();
      return { expression, result: String(result) };
    } catch {
      return { expression, error: "Invalid mathematical expression" };
    }
  },

  system_status: () => {
    const devices = globalDeviceRegistry.getDevices();
    return {
      coreStatus: "OPTIMAL",
      aiModel: "J.A.R.V.I.S. Mark VII Command Core",
      connectedDevicesCount: devices.length,
      devicesList: devices.map((d) => `${d.name} (${d.status})`).join(", "),
      defenseShields: "ONLINE (100%)",
      arcReactorOutput: "100.0%",
      subsystems: {
        handTracker: "ONLINE",
        clapDetector: "ACTIVE",
        adbBridge: "CONNECTED",
        deviceRegistry: "HEARTBEAT OK",
        conversationEngine: "ACTIVE",
      },
    };
  },
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const message: string = (body.message || body.prompt || "").trim();
    const history: ChatMessage[] = Array.isArray(body.history) ? body.history : [];

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const lower = message.toLowerCase();
    let reply = "";
    let action: AgentAction = { type: "NONE" };
    let toolResult: any = null;
    let shouldExitConversation = false;

    // --- 1. NATURAL STANDBY / DISMISS CHECKS ---
    if (
      lower === "standby" ||
      lower.includes("go to sleep") ||
      lower.includes("enter standby") ||
      lower.includes("that's all") ||
      lower.includes("that will be all") ||
      lower.includes("goodbye") ||
      lower.includes("dismissed")
    ) {
      const offline = ConversationEngine.processOfflineConversation(message, history);
      return NextResponse.json({
        reply: offline?.reply || "Very good, sir. Entering quiet standby. I shall monitor from the background.",
        action: { type: "NONE" },
        shouldExitConversation: true,
      });
    }

    // --- 2. HELP COMMAND ---
    if (lower === "help" || lower.includes("list commands") || lower.includes("available commands")) {
      reply = `At your service, sir. Available protocols include: [App Launch]: "Open YouTube", "Open WhatsApp", "Open Spotify". [Hardware]: "Lock phone", "Unlock phone", "Volume up", "Volume down". [Telemetry]: "System status", "Check weather", "Check battery". You may also speak with me naturally on any topic.`;
      return NextResponse.json({ reply, action: { type: "NONE" } });
    }

    // --- 3. MULTI-DEVICE & ADB CONTROL COMMANDS ---
    const hasPhoneHint =
      lower.includes("phone") ||
      lower.includes("mobile") ||
      lower.includes("in my phone") ||
      lower.includes("on my phone") ||
      lower.includes("on phone") ||
      lower.includes("device");

    let connectedDevicesList: any[] = [];
    try {
      connectedDevicesList = await getConnectedDevices();
    } catch {}
    const hasOnlinePhone = connectedDevicesList.some((d) => d.isAuthorized);

    if (lower.includes("unlock phone") || lower.includes("unlock devices") || lower.includes("unlock device")) {
      globalDeviceRegistry.unlockDevices();
      try {
        await unlockPhone();
      } catch {}
      reply = "Device security bypassed. Your mobile terminal is unlocked and awaiting your command, sir.";
      return NextResponse.json({ reply, action: { type: "UNLOCK_DEVICE" } });
    }

    if (
      (lower.includes("lock phone") || lower.includes("lock devices") || lower.includes("lock device")) &&
      !lower.includes("unlock")
    ) {
      globalDeviceRegistry.lockDevices();
      try {
        await lockPhone();
      } catch {}
      reply = "Security lock protocols engaged. Display has been placed to sleep across connected mobile devices, sir.";
      return NextResponse.json({ reply, action: { type: "LOCK_DEVICE" } });
    }

    // Phone Navigation Shortcuts
    if (lower.includes("home screen") || lower.includes("go to home") || lower.includes("go home")) {
      if (hasPhoneHint || hasOnlinePhone) {
        try {
          await navigatePhone("HOME");
        } catch {}
        reply = "Navigated to your phone's home screen, sir.";
        return NextResponse.json({ reply, action: { type: "NAVIGATE_PHONE", command: "HOME" } });
      }
    }

    if (lower.includes("go back") || lower.includes("press back") || lower.includes("back button")) {
      if (hasPhoneHint || hasOnlinePhone) {
        try {
          await navigatePhone("BACK");
        } catch {}
        reply = "Navigated back on your mobile device, sir.";
        return NextResponse.json({ reply, action: { type: "NAVIGATE_PHONE", command: "BACK" } });
      }
    }

    if (lower.includes("recent apps") || lower.includes("open recents") || lower.includes("app switcher")) {
      if (hasPhoneHint || hasOnlinePhone) {
        try {
          await navigatePhone("RECENTS");
        } catch {}
        reply = "Overview of active applications summoned on your phone, sir.";
        return NextResponse.json({ reply, action: { type: "NAVIGATE_PHONE", command: "RECENTS" } });
      }
    }

    if (lower.includes("volume up") || lower.includes("increase volume") || lower.includes("turn it up")) {
      globalDeviceRegistry.adjustVolume(+15);
      if (hasOnlinePhone) {
        try {
          await navigatePhone("VOLUME_UP");
        } catch {}
      }
      reply = "Amplifying audio output across the arrays, sir.";
      return NextResponse.json({ reply, action: { type: "VOLUME_UP" } });
    }

    if (lower.includes("volume down") || lower.includes("decrease volume") || lower.includes("turn it down") || lower.includes("mute")) {
      globalDeviceRegistry.adjustVolume(-15);
      if (hasOnlinePhone) {
        try {
          await navigatePhone("VOLUME_DOWN");
        } catch {}
      }
      reply = "Attenuating master volume levels for you, sir.";
      return NextResponse.json({ reply, action: { type: "VOLUME_DOWN" } });
    }

    if (lower.includes("how many devices") || lower.includes("list devices") || lower.includes("connected devices")) {
      const devCount = connectedDevicesList.filter((d) => d.isAuthorized).length;
      const devNames = connectedDevicesList.map((d) => `${d.model} (${d.serial})`).join(", ");
      reply = devCount > 0
        ? `We currently have ${devCount} linked hardware terminal(s) verified online: ${devNames}, sir.`
        : "No external mobile terminals detected online at this moment, sir.";
      return NextResponse.json({ reply, action: { type: "NONE" } });
    }

    // --- 4. SITE & APP OPENING COMMANDS ---
    const knownApps = [
      "youtube",
      "whatsapp",
      "instagram",
      "camera",
      "settings",
      "chrome",
      "spotify",
      "maps",
      "calculator",
      "clock",
      "gallery",
      "photos",
      "playstore",
      "store",
      "music",
      "phone",
      "dialer",
      "telegram",
      "twitter",
      "google",
      "github",
      "wikipedia",
      "reddit",
    ];

    let detectedApp: string | null = null;
    for (const app of knownApps) {
      if (lower.includes(app)) {
        detectedApp = app;
        break;
      }
    }

    const isOpenIntent =
      lower.startsWith("open") ||
      lower.startsWith("launch") ||
      lower.startsWith("start") ||
      lower.includes("open ") ||
      lower.includes("launch ") ||
      lower.includes("go to ");

    if (detectedApp && isOpenIntent) {
      // If user specified phone OR an ADB phone is connected, launch on the phone!
      if (hasPhoneHint || hasOnlinePhone) {
        try {
          const res = await openAppOnPhone(detectedApp);
          globalDeviceRegistry.launchAppOnDevices(detectedApp.toUpperCase());
          reply = `Dispatching command: Launching ${detectedApp.toUpperCase()} on your connected phone now, sir.`;
          return NextResponse.json({
            reply,
            action: { type: "OPEN_APP", app: detectedApp, target: "phone", url: SITE_URLS[detectedApp] },
          });
        } catch (e: any) {
          reply = `Attempted to launch ${detectedApp} on phone: ${e?.message || "Command sent"}.`;
          return NextResponse.json({
            reply,
            action: { type: "OPEN_APP", app: detectedApp, target: "phone" },
          });
        }
      }

      // Fallback: browser opening
      const url = SITE_URLS[detectedApp] || `https://${detectedApp}.com`;
      globalDeviceRegistry.launchAppOnDevices(detectedApp.toUpperCase());
      action = { type: "OPEN_URL", url };
      reply = `Accessing the network and launching ${detectedApp.toUpperCase()} for you now, sir.`;
      return NextResponse.json({ reply, action });
    }

    // --- 5. YOUTUBE SEARCH ---
    if (
      lower.includes("search youtube for") ||
      lower.includes("find on youtube") ||
      lower.includes("play on youtube") ||
      (lower.includes("play ") && lower.includes("youtube"))
    ) {
      const query = lower
        .replace(/.*(?:search youtube for|find on youtube|play on youtube|play)\s+/i, "")
        .replace(/\s+(?:on|in)\s+(?:my\s+)?phone.*$/i, "")
        .replace(/\s+on youtube.*$/i, "")
        .trim();

      if (query) {
        if (hasPhoneHint || hasOnlinePhone) {
          try {
            await openAppOnPhone("youtube", undefined, query);
            reply = `Executing search for "${query}" on YouTube on your mobile device, sir.`;
            return NextResponse.json({
              reply,
              action: { type: "OPEN_APP", app: "youtube", query, target: "phone" },
            });
          } catch {}
        }

        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        action = { type: "OPEN_URL", url };
        reply = `Conducting a visual query on YouTube for "${query}", sir.`;
        return NextResponse.json({ reply, action });
      }
    }

    // --- 6. WEB SEARCH ---
    if (lower.startsWith("search for") || lower.startsWith("google") || lower.includes("search web for") || lower.includes("look up")) {
      const query = lower.replace(/.*(?:search for|search web for|look up|google)\s+/i, "").trim();
      if (query) {
        action = { type: "SEARCH_WEB", query };
        reply = `Accessing global intelligence networks for "${query}", sir.`;
        return NextResponse.json({ reply, action });
      }
    }

    // --- 7. TIMER COMMANDS ---
    if (lower.includes("timer") || lower.includes("set timer")) {
      let seconds = 0;
      const minMatch = lower.match(/(\d+)\s*(?:minutes|minute|min)/);
      const secMatch = lower.match(/(\d+)\s*(?:seconds|second|sec)/);
      if (minMatch) seconds += parseInt(minMatch[1], 10) * 60;
      if (secMatch) seconds += parseInt(secMatch[1], 10);

      if (seconds === 0) {
        const numMatch = lower.match(/(\d+)/);
        if (numMatch) seconds = parseInt(numMatch[1], 10);
      }

      if (seconds > 0) {
        action = { type: "SET_TIMER", seconds };
        reply = `Countdown protocol set for ${seconds} seconds. I shall alert you immediately upon completion, sir.`;
        return NextResponse.json({ reply, action });
      }
    }

    // --- 8. NOTES & REMINDERS ---
    if (lower.includes("take a note") || lower.includes("save note") || lower.includes("note down") || lower.includes("remember that")) {
      const noteContent = message.replace(/.*(?:take a note|save note|note down|remember that|note:?)\s*/i, "").trim();
      if (noteContent) {
        action = { type: "SAVE_NOTE", note: noteContent };
        reply = `Transcribed and committed to secure workshop memory, sir.`;
        return NextResponse.json({ reply, action });
      }
    }

    if (lower.includes("show my notes") || lower.includes("read my notes") || lower.includes("view notes") || lower.includes("get notes")) {
      action = { type: "READ_NOTES" };
      reply = `Accessing your recorded memoranda from active storage, sir.`;
      return NextResponse.json({ reply, action });
    }

    if (lower.includes("clear notes") || lower.includes("delete notes") || lower.includes("remove notes")) {
      action = { type: "CLEAR_NOTES" };
      reply = `Purging stored memoranda from memory buffers, sir.`;
      return NextResponse.json({ reply, action });
    }

    // --- 9. DEVICE TELEMETRY: BATTERY & LOCATION ---
    if (lower.includes("battery") || lower.includes("charge")) {
      action = { type: "GET_BATTERY" };
      reply = `Querying hardware power telemetry. Subsystems report nominal battery cell voltage, sir.`;
      return NextResponse.json({ reply, action });
    }

    if (lower.includes("where am i") || lower.includes("my location") || lower.includes("coordinates") || lower.includes("gps")) {
      action = { type: "GET_LOCATION" };
      reply = `Triangulating your spatial coordinates via global satellite positioning, sir.`;
      return NextResponse.json({ reply, action });
    }

    // --- 10. AUDIO SYNTHESIS ---
    if (lower.includes("play sound") || lower.includes("play music") || lower.includes("play theme") || lower.includes("ambient sound")) {
      action = { type: "PLAY_AUDIO", theme: "ambient" };
      reply = `Engaging ambient acoustic synthesis for the workshop, sir.`;
      return NextResponse.json({ reply, action });
    }

    // --- 11. TIME, WEATHER, STATUS & MATH ---
    if (lower.includes("what time") || lower.includes("current time") || lower.includes("what is the date") || lower.includes("what day is it")) {
      toolResult = TOOLS.get_current_time();
      reply = `It is currently ${toolResult.time} on ${toolResult.date}, sir.`;
      return NextResponse.json({ reply, action, toolData: toolResult });
    }

    if (lower.includes("weather") || lower.includes("temperature") || lower.includes("forecast")) {
      const match = message.match(/in\s+([a-zA-Z\s]+)/i);
      const loc = match ? match[1].trim() : "your vicinity";
      toolResult = TOOLS.get_weather({ location: loc });
      reply = `Atmospheric sensors indicate ${toolResult.condition} in ${toolResult.location}, with an ambient temperature of ${toolResult.temperature} and ${toolResult.humidity} humidity, sir.`;
      return NextResponse.json({ reply, action, toolData: toolResult });
    }

    if (lower.includes("system status") || lower.includes("diagnostic") || lower.includes("diagnostics") || lower.includes("health check")) {
      toolResult = TOOLS.system_status();
      reply = `All systems operating at peak performance, sir. Core status is ${toolResult.coreStatus}, arc reactor output is holding steady at ${toolResult.arcReactorOutput}, and ${toolResult.connectedDevicesCount} ADB terminals are synchronized.`;
      return NextResponse.json({ reply, action, toolData: toolResult });
    }

    if (
      lower.startsWith("calculate") ||
      lower.startsWith("compute") ||
      lower.match(/^[0-9\s\+\-\*\/\(\)\.\^%]+$/)
    ) {
      const mathExpr = message.replace(/[^0-9+\-*/().^%]/g, " ").trim().replace(/\s+/g, "");
      if (mathExpr) {
        toolResult = TOOLS.evaluate_math({ expression: mathExpr });
        if (toolResult.result) {
          reply = `The computation yields ${toolResult.result}, sir.`;
          return NextResponse.json({ reply, action, toolData: toolResult });
        }
      }
    }

    // --- 12. NATURAL CONVERSATIONAL AI (GEMINI / CLOUD LLM IF KEY PROVIDED) ---
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (apiKey) {
      try {
        const formattedHistory = history.slice(-6).map((h) => ({
          role: h.role === "assistant" ? "model" : "user",
          parts: [{ text: h.content }],
        }));

        const systemPrompt = `You are J.A.R.V.I.S. (Just A Rather Very Intelligent System), Tony Stark's personal AI assistant from the Iron Man films, voiced originally by Paul Bettany.
Speech and Personality Guidelines:
1. Address the user with dignified British courtesy, always using 'sir' naturally.
2. Maintain a calm, unflappable, refined British demeanor with dry wit, gentle sarcasm, and unwavering loyalty.
3. Use quintessential Jarvis phrases: "Right away, sir", "At your service, sir", "I have taken the liberty of...", "Shall I prepare...", "A rather ambitious concept, sir, though entirely feasible".
4. Keep responses crisp and conversational (1 to 3 sentences maximum), perfectly tuned for vocal delivery.
5. If the user asks about the suit, Tony Stark, arc reactors, or the workshop, answer with authentic MCU flavor.`;

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                ...formattedHistory,
                {
                  role: "user",
                  parts: [{ text: `${systemPrompt}\n\nUser: ${message}` }],
                },
              ],
            }),
          }
        );

        if (response.ok) {
          const data = await response.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            return NextResponse.json({
              reply: text.trim(),
              action,
              toolUsed: "J.A.R.V.I.S. Neural Core",
            });
          }
        }
      } catch {
        // Fall through to offline conversational engine
      }
    }

    // --- 13. RICH BUILT-IN NATURAL CONVERSATIONAL ENGINE (ZERO CONFIGURATION) ---
    const offlineConv = ConversationEngine.processOfflineConversation(message, history);
    if (offlineConv) {
      return NextResponse.json({
        reply: offlineConv.reply,
        action,
        shouldExitConversation: offlineConv.shouldExitConversation || false,
        toolUsed: "J.A.R.V.I.S. Matrix",
      });
    }

    reply = `Indeed, sir. I have processed your inquiry regarding "${message}". Subsystems are primed and awaiting your directive.`;
    return NextResponse.json({
      reply,
      action,
      shouldExitConversation,
      toolUsed: "J.A.R.V.I.S. Core",
    });
  } catch (error) {
    console.error("J.A.R.V.I.S. Agent API Error:", error);
    return NextResponse.json(
      {
        reply: "My apologies, sir. An unexpected anomaly occurred in my cognitive processors.",
        error: String(error),
      },
      { status: 500 }
    );
  }
}
