import { NextResponse } from "next/server";
import { globalDeviceRegistry } from "@/lib/deviceRegistry";

export interface AgentAction {
  type:
    | "OPEN_URL"
    | "SEARCH_WEB"
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

// Tool definitions for Jarvis Agent
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
    const city = location || "New York";
    const conditions = ["Clear Sky", "Partly Cloudy", "Atmospheric Haze", "Scattered Showers"];
    const temp = Math.floor(18 + Math.random() * 12);
    const cond = conditions[Math.floor(Math.random() * conditions.length)];
    return {
      location: city,
      temperature: `${temp}°C`,
      condition: cond,
      humidity: `${45 + Math.floor(Math.random() * 30)}%`,
      windSpeed: `${10 + Math.floor(Math.random() * 15)} km/h`,
      status: "Telemetry operational",
    };
  },

  evaluate_math: ({ expression }: { expression: string }) => {
    try {
      const sanitized = expression.replace(/[^0-9+\-*/().^%\s]/g, "");
      // eslint-disable-next-line no-new-func
      const result = Function(`"use strict"; return (${sanitized})`)();
      return { expression, result: String(result) };
    } catch (err) {
      return { expression, error: "Invalid mathematical expression" };
    }
  },

  system_status: () => {
    const devices = globalDeviceRegistry.getDevices();
    return {
      coreStatus: "OPTIMAL",
      aiModel: "ULTRON Multi-Device Engine v6.0",
      connectedDevicesCount: devices.length,
      devicesList: devices.map((d) => `${d.name} (${d.status})`).join(", "),
      defenseShields: "ONLINE (100%)",
      arcReactorOutput: "100.0%",
      subsystems: {
        handTracker: "ONLINE",
        clapDetector: "ACTIVE",
        adbBridge: "CONNECTED",
        deviceRegistry: "HEARTBEAT OK",
      },
    };
  },
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const message: string = (body.message || body.prompt || "").trim();

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const lower = message.toLowerCase();
    let reply = "";
    let action: AgentAction = { type: "NONE" };
    let toolResult: any = null;

    // --- PDF SLIDE 9: HELP COMMAND ---
    if (lower === "help" || lower.includes("list commands") || lower.includes("available commands")) {
      reply = `Supported Commands: [App Control]: "Open YouTube", "Open WhatsApp", "Open Instagram". [Device State]: "Lock phone", "Unlock phone", "Volume up", "Volume down", "Mute". [System Info]: "How many devices?", "System status", "Check battery".`;
      return NextResponse.json({ reply, action: { type: "NONE" } });
    }

    // --- PDF SLIDE 9: MULTI-DEVICE & ADB CONTROL COMMANDS ---
    if (lower.includes("lock phone") || lower.includes("lock devices") || lower.includes("lock device")) {
      reply = globalDeviceRegistry.lockDevices();
      return NextResponse.json({ reply, action: { type: "LOCK_DEVICE" } });
    }

    if (lower.includes("unlock phone") || lower.includes("unlock devices") || lower.includes("unlock device")) {
      reply = globalDeviceRegistry.unlockDevices();
      return NextResponse.json({ reply, action: { type: "UNLOCK_DEVICE" } });
    }

    if (lower.includes("volume up") || lower.includes("increase volume")) {
      reply = globalDeviceRegistry.adjustVolume(+15);
      return NextResponse.json({ reply, action: { type: "VOLUME_UP" } });
    }

    if (lower.includes("volume down") || lower.includes("decrease volume")) {
      reply = globalDeviceRegistry.adjustVolume(-15);
      return NextResponse.json({ reply, action: { type: "VOLUME_DOWN" } });
    }

    if (lower.includes("how many devices") || lower.includes("list devices") || lower.includes("connected devices")) {
      const devices = globalDeviceRegistry.getDevices();
      reply = `Ultron Command Center is connected to ${devices.length} devices: ${devices.map((d) => `${d.name} (${d.ip})`).join(", ")}, sir.`;
      return NextResponse.json({ reply, action: { type: "NONE" } });
    }

    // --- 1. SITE & APP OPENING COMMANDS ---
    const openMatch = lower.match(/(?:open|launch|go to)\s+([a-z\s]+)/i);
    if (openMatch) {
      const target = openMatch[1].trim();
      for (const [key, url] of Object.entries(SITE_URLS)) {
        if (target.includes(key)) {
          globalDeviceRegistry.launchAppOnDevices(key.toUpperCase());
          action = { type: "OPEN_URL", url };
          reply = `Launching ${key.toUpperCase()} across connected devices, sir.`;
          return NextResponse.json({ reply, action });
        }
      }
    }

    // --- 2. YOUTUBE SEARCH ---
    if (lower.includes("search youtube for") || lower.includes("find on youtube")) {
      const query = lower.replace(/.*(?:search youtube for|find on youtube)\s+/i, "").trim();
      if (query) {
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        action = { type: "OPEN_URL", url };
        reply = `Searching YouTube for "${query}", sir.`;
        return NextResponse.json({ reply, action });
      }
    }

    // --- 3. WEB SEARCH ---
    if (lower.startsWith("search for") || lower.startsWith("google") || lower.includes("search web for") || lower.includes("look up")) {
      const query = lower.replace(/.*(?:search for|search web for|look up|google)\s+/i, "").trim();
      if (query) {
        action = { type: "SEARCH_WEB", query };
        reply = `Initiating web search query for "${query}", sir.`;
        return NextResponse.json({ reply, action });
      }
    }

    // --- 4. TIMER COMMANDS ---
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
        reply = `Setting countdown timer for ${seconds} seconds, sir.`;
        return NextResponse.json({ reply, action });
      }
    }

    // --- 5. NOTES & REMINDERS COMMANDS ---
    if (lower.includes("take a note") || lower.includes("save note") || lower.includes("note down") || lower.includes("remember that")) {
      const noteContent = message.replace(/.*(?:take a note|save note|note down|remember that|note:?)\s*/i, "").trim();
      if (noteContent) {
        action = { type: "SAVE_NOTE", note: noteContent };
        reply = `Note recorded into local memory, sir.`;
        return NextResponse.json({ reply, action });
      }
    }

    if (lower.includes("show my notes") || lower.includes("read my notes") || lower.includes("view notes") || lower.includes("get notes")) {
      action = { type: "READ_NOTES" };
      reply = `Accessing your stored voice notes, sir.`;
      return NextResponse.json({ reply, action });
    }

    if (lower.includes("clear notes") || lower.includes("delete notes") || lower.includes("remove notes")) {
      action = { type: "CLEAR_NOTES" };
      reply = `Purging stored voice notes from memory, sir.`;
      return NextResponse.json({ reply, action });
    }

    // --- 6. DEVICE TELEMETRY: BATTERY & LOCATION ---
    if (lower.includes("battery") || lower.includes("charge")) {
      action = { type: "GET_BATTERY" };
      reply = `Fetching battery telemetry from device interface, sir.`;
      return NextResponse.json({ reply, action });
    }

    if (lower.includes("where am i") || lower.includes("my location") || lower.includes("coordinates") || lower.includes("gps")) {
      action = { type: "GET_LOCATION" };
      reply = `Accessing spatial geolocation positioning sensors, sir.`;
      return NextResponse.json({ reply, action });
    }

    // --- 7. AUDIO & ALERTS ---
    if (lower.includes("play sound") || lower.includes("play music") || lower.includes("play theme") || lower.includes("ambient sound")) {
      action = { type: "PLAY_AUDIO", theme: "ambient" };
      reply = `Playing synthesized ambient audio frequency, sir.`;
      return NextResponse.json({ reply, action });
    }

    // --- 8. TIME, WEATHER, STATUS, MATH FALLBACKS ---
    if (lower.includes("time") || lower.includes("date") || lower.includes("day") || lower.includes("clock")) {
      toolResult = TOOLS.get_current_time();
      reply = `It is currently ${toolResult.time} on ${toolResult.date}, sir.`;
    } else if (lower.includes("weather") || lower.includes("temperature") || lower.includes("forecast")) {
      const match = message.match(/in\s+([a-zA-Z\s]+)/i);
      const loc = match ? match[1].trim() : "your current location";
      toolResult = TOOLS.get_weather({ location: loc });
      reply = `Telemetry reports ${toolResult.condition} in ${toolResult.location} with a temperature of ${toolResult.temperature} and ${toolResult.humidity} humidity, sir.`;
    } else if (lower.includes("status") || lower.includes("diagnostic") || lower.includes("system") || lower.includes("health")) {
      toolResult = TOOLS.system_status();
      reply = `All systems operating at nominal parameters, sir. Core status is ${toolResult.coreStatus}, ${toolResult.connectedDevicesCount} devices connected via ADB, arc reactor at ${toolResult.arcReactorOutput}.`;
    } else if (
      lower.includes("calculate") ||
      lower.includes("compute") ||
      lower.includes("plus") ||
      lower.includes("minus") ||
      lower.includes("times") ||
      lower.match(/[0-9]+\s*[\+\-\*\/]\s*[0-9]+/)
    ) {
      const mathExpr = message.replace(/[^0-9+\-*/().^%]/g, " ").trim().replace(/\s+/g, "");
      if (mathExpr) {
        toolResult = TOOLS.evaluate_math({ expression: mathExpr });
        if (toolResult.result) {
          reply = `The calculation yields ${toolResult.result}, sir.`;
        } else {
          reply = `I attempted the computation, but encountered a mathematical anomaly, sir.`;
        }
      }
    } else if (lower.includes("who are you") || lower.includes("your name") || lower.includes("what are you")) {
      reply = `I am ULTRON Orb, your Personal Multi-Device AI Command Center. I bridge voice, spatial hand gestures, and multi-device ADB execution, sir.`;
    } else if (lower.includes("hello") || lower.includes("hi") || lower.includes("jarvis") || lower.includes("ultron") || lower.includes("hey")) {
      reply = `At your service, sir. All core systems and connected devices are online and awaiting your command.`;
    } else {
      // Gemini API Fallback if available
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        try {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [
                  {
                    role: "user",
                    parts: [
                      {
                        text: `You are ULTRON Orb, a Personal Multi-Device AI Command Center. Speak formally and concisely ("At your service, sir", "Right away, sir"). Keep answers under 3 sentences. Query: ${message}`,
                      },
                    ],
                  },
                ],
              }),
            }
          );
          if (response.ok) {
            const data = await response.json();
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              return NextResponse.json({ reply: text, action, toolUsed: "Gemini API" });
            }
          }
        } catch (e) {
          // Fall through
        }
      }

      reply = `I have processed your query regarding "${message}", sir. Systems are online and monitoring your commands.`;
    }

    return NextResponse.json({
      reply,
      action,
      toolData: toolResult,
    });
  } catch (error) {
    console.error("Jarvis Agent API Error:", error);
    return NextResponse.json(
      {
        reply: "My apologies, sir. An unexpected error occurred in my action processing units.",
        error: String(error),
      },
      { status: 500 }
    );
  }
}
