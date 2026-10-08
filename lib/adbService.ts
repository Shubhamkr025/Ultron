import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execAsync = promisify(exec);

// Cache the resolved ADB binary path
let cachedAdbPath: string | null = null;

export const DEFAULT_PATTERN = [3, 2, 1, 4, 5, 6, 9, 8, 7];

export const APP_PACKAGE_MAP: Record<string, string> = {
  youtube: "com.google.android.youtube",
  whatsapp: "com.whatsapp",
  instagram: "com.instagram.android",
  camera: "com.android.camera",
  settings: "com.android.settings",
  chrome: "com.android.chrome",
  maps: "com.google.android.apps.maps",
  spotify: "com.spotify.music",
  calculator: "com.vivo.calculator",
  clock: "com.android.deskclock",
  gallery: "com.vivo.gallery",
  photos: "com.google.android.apps.photos",
  playstore: "com.android.vending",
  store: "com.android.vending",
  phone: "com.android.phone",
  dialer: "com.android.phone",
  music: "com.android.bbkmusic",
  browser: "com.android.chrome",
  gmail: "com.google.android.gm",
  telegram: "org.telegram.messenger",
  twitter: "com.twitter.android",
  x: "com.twitter.android",
};

export function resolveAdbPath(): string {
  if (cachedAdbPath && fs.existsSync(cachedAdbPath)) {
    return cachedAdbPath;
  }

  const userProfile = process.env.USERPROFILE || "C:\\Users\\HP";
  const localAppData = process.env.LOCALAPPDATA || path.join(userProfile, "AppData", "Local");

  const candidates = [
    path.join(userProfile, "Downloads", "platform-tools-latest-windows", "platform-tools", "adb.exe"),
    path.join(userProfile, "Downloads", "platform-tools", "adb.exe"),
    path.join(localAppData, "Android", "Sdk", "platform-tools", "adb.exe"),
    process.env.ANDROID_HOME ? path.join(process.env.ANDROID_HOME, "platform-tools", "adb.exe") : "",
    process.env.ANDROID_SDK_ROOT ? path.join(process.env.ANDROID_SDK_ROOT, "platform-tools", "adb.exe") : "",
    "C:\\platform-tools\\adb.exe",
    "D:\\platform-tools\\adb.exe",
    path.join(process.cwd(), "platform-tools", "adb.exe"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      cachedAdbPath = candidate;
      const adbDir = path.dirname(candidate);
      if (!process.env.PATH?.includes(adbDir)) {
        process.env.PATH = `${adbDir};${process.env.PATH || ""}`;
      }
      return candidate;
    }
  }

  return "adb";
}

export async function runAdb(serial?: string, cmd: string = "", timeoutMs = 9000, retries = 1): Promise<string> {
  const adbBin = resolveAdbPath();
  const target = serial ? `-s "${serial}"` : "";
  const executable = adbBin.includes(" ") ? `"${adbBin}"` : adbBin;
  const fullCommand = `${executable} ${target} ${cmd}`.trim();

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { stdout, stderr } = await execAsync(fullCommand, {
        timeout: timeoutMs,
        windowsHide: true,
      });
      return (stdout + (stderr ? `\n${stderr}` : "")).trim();
    } catch (err: any) {
      if (err && (err.stdout || err.stderr)) {
        const output = `${err.stdout || ""}\n${err.stderr || ""}`.trim();
        if (output) return output;
      }
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

export interface ConnectedAdbDevice {
  serial: string;
  state: string;
  model: string;
  isAuthorized: boolean;
  isWireless: boolean;
}

export async function getConnectedDevices(): Promise<ConnectedAdbDevice[]> {
  try {
    const rawOut = await runAdb("", "devices -l");
    const lines = rawOut
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("*") && !l.toLowerCase().includes("list of devices attached"));

    return lines.map((l) => {
      const parts = l.split(/\s+/);
      const serial = parts[0] || "";
      const state = parts[1] || "offline";

      const modelPart = parts.find((p) => p.startsWith("model:")) || "";
      const productPart = parts.find((p) => p.startsWith("product:")) || "";
      const devicePart = parts.find((p) => p.startsWith("device:")) || "";

      let model = modelPart.replace("model:", "").replace(/_/g, " ");
      if (!model) {
        model = productPart.replace("product:", "").replace(/_/g, " ") || devicePart.replace("device:", "") || serial;
      }

      return {
        serial,
        state,
        model: model || "Android Device",
        isAuthorized: state === "device",
        isWireless: serial.includes(":"),
      };
    });
  } catch {
    return [];
  }
}

export async function getPrimaryDeviceSerial(preferredSerial?: string): Promise<string> {
  if (preferredSerial && preferredSerial.trim()) {
    return preferredSerial.trim();
  }
  const devices = await getConnectedDevices();
  const ready = devices.find((d) => d.isAuthorized);
  return ready ? ready.serial : "";
}

export async function wakeAndDismissShade(serial?: string): Promise<void> {
  const s = await getPrimaryDeviceSerial(serial);
  await runAdb(s, "shell input keyevent 224");
  await new Promise((r) => setTimeout(r, 250));
  await runAdb(s, "shell input keyevent 82");
  await new Promise((r) => setTimeout(r, 200));
}

export async function isDeviceLocked(serial?: string): Promise<boolean> {
  const s = await getPrimaryDeviceSerial(serial);
  try {
    const trust = await runAdb(s, "shell dumpsys trust");
    if (trust.includes("deviceLocked=1") || trust.includes("deviceLocked=true")) {
      return true;
    }
    const win = await runAdb(s, "shell dumpsys window");
    if (win.includes("mDreamingLockscreen=true") || win.includes("NotificationShade")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function unlockPhone(serial?: string, pattern?: number[], pin?: string): Promise<{ success: boolean; message: string }> {
  const s = await getPrimaryDeviceSerial(serial);
  if (!s) {
    return { success: false, message: "No authorized device connected." };
  }

  // Wake screen & swipe up to reveal pattern/PIN grid
  await runAdb(s, "shell input keyevent 224");
  await new Promise((r) => setTimeout(r, 300));
  await runAdb(s, "shell input keyevent 82");
  await new Promise((r) => setTimeout(r, 300));
  await runAdb(s, "shell input swipe 360 1400 360 600 250");
  await new Promise((r) => setTimeout(r, 450));

  const patternDots = (pattern && pattern.length >= 2) ? pattern : DEFAULT_PATTERN;

  if (patternDots.length >= 2) {
    const left = 67, top = 762, side = 585;
    const col = [
      Math.round(left + side / 6),
      Math.round(left + side / 2),
      Math.round(left + 5 * side / 6),
    ];
    const row = [
      Math.round(top + side / 6),
      Math.round(top + side / 2),
      Math.round(top + 5 * side / 6),
    ];
    const dotXY: [number, number][] = [
      [col[0], row[0]], [col[1], row[0]], [col[2], row[0]],
      [col[0], row[1]], [col[1], row[1]], [col[2], row[1]],
      [col[0], row[2]], [col[1], row[2]], [col[2], row[2]],
    ];

    const coords = patternDots
      .filter((n) => n >= 1 && n <= 9)
      .map((n) => dotXY[n - 1]);

    if (coords.length >= 2) {
      const lines: string[] = [];
      const [x0, y0] = coords[0];
      lines.push(`input touchscreen motionevent DOWN ${x0} ${y0}`);

      let [px, py] = [x0, y0];
      for (let i = 1; i < coords.length; i++) {
        const [nx, ny] = coords[i];
        const STEPS = 8;
        for (let st = 1; st <= STEPS; st++) {
          const ix = Math.round(px + ((nx - px) * st) / STEPS);
          const iy = Math.round(py + ((ny - py) * st) / STEPS);
          lines.push(`input touchscreen motionevent MOVE ${ix} ${iy}`);
        }
        [px, py] = [nx, ny];
      }
      lines.push(`input touchscreen motionevent UP ${px} ${py}`);

      const localTmp = path.join(process.env.TEMP || process.env.TMP || "C:\\Windows\\Temp", "_ultron_pat.sh");
      const deviceTmp = "/data/local/tmp/_ultron_pat.sh";
      fs.writeFileSync(localTmp, lines.join("\n"), "utf8");

      const adbBin = resolveAdbPath();
      const exe = adbBin.includes(" ") ? `"${adbBin}"` : adbBin;
      const targetParam = s ? `-s "${s}"` : "";
      await execAsync(`${exe} ${targetParam} push "${localTmp}" ${deviceTmp}`, { timeout: 8000 });
      await runAdb(s, `shell "sh ${deviceTmp}"`, 15000);
      await new Promise((r) => setTimeout(r, 500));

      return {
        success: true,
        message: `Device unlocked successfully via pattern gesture, sir.`,
      };
    }
  }

  if (pin && pin.trim()) {
    const sanitizedPin = pin.replace(/[^a-zA-Z0-9]/g, "");
    await runAdb(s, `shell input text "${sanitizedPin}"`);
    await new Promise((r) => setTimeout(r, 200));
    await runAdb(s, "shell input keyevent 66");
    await new Promise((r) => setTimeout(r, 300));
    return { success: true, message: "Device unlocked via PIN code, sir." };
  }

  return { success: true, message: "Unlock pulse dispatched, sir." };
}

export async function lockPhone(serial?: string): Promise<{ success: boolean; message: string }> {
  const s = await getPrimaryDeviceSerial(serial);
  if (!s) return { success: false, message: "No device connected." };
  try {
    await runAdb(s, "shell input keyevent 223");
    return { success: true, message: "Device display placed in sleep mode, sir." };
  } catch {
    await runAdb(s, "shell input keyevent 26");
    return { success: true, message: "Device screen locked, sir." };
  }
}

export async function openAppOnPhone(
  appOrPackage: string,
  serial?: string,
  queryOrUrl?: string
): Promise<{ success: boolean; message: string; app: string }> {
  const s = await getPrimaryDeviceSerial(serial);
  if (!s) {
    return {
      success: false,
      message: "No mobile device currently connected via ADB.",
      app: appOrPackage,
    };
  }

  const cleanApp = appOrPackage.toLowerCase().trim();

  // 1. Wake screen up
  await wakeAndDismissShade(s);

  // 2. If locked, perform auto-unlock so the user immediately sees the app!
  try {
    const locked = await isDeviceLocked(s);
    if (locked) {
      await unlockPhone(s);
      await new Promise((r) => setTimeout(r, 400));
    }
  } catch {}

  // 3. Handle YouTube queries/intents
  if (cleanApp === "youtube" && queryOrUrl) {
    const ytUrl = queryOrUrl.startsWith("http")
      ? queryOrUrl
      : `https://www.youtube.com/results?search_query=${encodeURIComponent(queryOrUrl)}`;
    await runAdb(s, `shell "am start -a android.intent.action.VIEW -d '${ytUrl}'"`);
    return {
      success: true,
      message: `Opened YouTube for "${queryOrUrl}" on your phone, sir.`,
      app: "YouTube",
    };
  }

  // 4. Handle direct URLs
  if (queryOrUrl && queryOrUrl.startsWith("http")) {
    await runAdb(s, `shell "am start -a android.intent.action.VIEW -d '${queryOrUrl}'"`);
    return {
      success: true,
      message: `Loaded ${queryOrUrl} on your mobile device, sir.`,
      app: cleanApp,
    };
  }

  // 5. Package lookup
  let pkg = APP_PACKAGE_MAP[cleanApp] || cleanApp;

  // Camera fallback for OEM cameras like Vivo
  if (cleanApp === "camera") {
    try {
      await runAdb(s, `shell monkey -p com.android.camera -c android.intent.category.LAUNCHER 1`);
      return { success: true, message: `Camera activated on your phone, sir.`, app: "Camera" };
    } catch {
      pkg = "com.vivo.alphacamera";
    }
  }

  const displayName = cleanApp.charAt(0).toUpperCase() + cleanApp.slice(1);

  // Method 1: Launch via Android Monkey launcher (universal, handles inner classes with $)
  try {
    const monkeyOut = await runAdb(s, `shell monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);
    if (!monkeyOut.toLowerCase().includes("no activities found") && !monkeyOut.toLowerCase().includes("** error")) {
      return {
        success: true,
        message: `Launched ${displayName} on your phone, sir.`,
        app: displayName,
      };
    }
  } catch {}

  // Method 2: Resolve default launch activity and start directly
  try {
    const actOut = await runAdb(s, `shell "cmd package resolve-activity --brief ${pkg} | tail -n 1"`);
    const act = actOut.trim();
    if (act && act.includes("/") && !act.toLowerCase().includes("not found")) {
      // Escape $ in activity names
      const escapedAct = act.replace(/\$/g, "\\$");
      await runAdb(s, `shell "am start -n '${escapedAct}'"`);
      return {
        success: true,
        message: `Launched ${displayName} on your phone, sir.`,
        app: displayName,
      };
    }
  } catch {}

  // Method 3: Fallback am start with category LAUNCHER
  try {
    await runAdb(s, `shell am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -p ${pkg}`);
    return {
      success: true,
      message: `Launched ${displayName} on your phone, sir.`,
      app: displayName,
    };
  } catch (e: any) {
    return {
      success: false,
      message: `Could not launch ${displayName} on device: ${e?.message || String(e)}`,
      app: displayName,
    };
  }
}

export async function navigatePhone(
  navAction: "HOME" | "BACK" | "RECENTS" | "VOLUME_UP" | "VOLUME_DOWN" | "MUTE" | "PLAY_PAUSE",
  serial?: string
): Promise<{ success: boolean; message: string }> {
  const s = await getPrimaryDeviceSerial(serial);
  if (!s) return { success: false, message: "No device connected." };

  const KEY_MAP: Record<string, { code: number; label: string }> = {
    HOME: { code: 3, label: "Navigated to home screen" },
    BACK: { code: 4, label: "Navigated back" },
    RECENTS: { code: 187, label: "Opened recent applications overview" },
    VOLUME_UP: { code: 24, label: "Volume increased" },
    VOLUME_DOWN: { code: 25, label: "Volume decreased" },
    MUTE: { code: 164, label: "Audio muted" },
    PLAY_PAUSE: { code: 85, label: "Media playback toggled" },
  };

  const item = KEY_MAP[navAction];
  if (!item) return { success: false, message: `Unknown navigation command: ${navAction}` };

  await runAdb(s, `shell input keyevent ${item.code}`);
  return { success: true, message: `${item.label} on device, sir.` };
}
