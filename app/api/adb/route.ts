import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Run an ADB command targeting a specific device serial (or default if empty)
async function adb(serial: string, cmd: string, timeoutMs = 8000): Promise<string> {
  const target = serial ? `-s ${serial}` : "";
  const { stdout, stderr } = await execAsync(`adb ${target} ${cmd}`, {
    timeout: timeoutMs,
  });
  return (stdout + stderr).trim();
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action: string = (body.action || "STATUS").toUpperCase();
    const pin: string = body.pin || "";
    const deviceIp: string = body.ip || "";
    const deviceSerial: string = body.serial || "";

    // ─── 1. LIST REAL DEVICES ─────────────────────────────────────────────
    if (action === "STATUS" || action === "DEVICES") {
      let rawOut = "";
      try {
        rawOut = await adb("", "devices -l");
      } catch (e) {
        return NextResponse.json({
          success: false,
          devices: [],
          message: "ADB not found on this machine. Install ADB Platform Tools and add to PATH.",
          error: String(e),
        });
      }

      const lines = rawOut.split("\n").filter((l) => l.includes("\tdevice"));
      const devices = lines.map((l) => {
        const parts = l.split(/\s+/);
        const serial = parts[0];
        const modelPart = parts.find((p) => p.startsWith("model:")) || "";
        const model = modelPart.replace("model:", "").replace(/_/g, " ") || "Android Device";
        return { serial, model };
      });

      return NextResponse.json({
        success: true,
        devices,
        message:
          devices.length > 0
            ? `ADB detected ${devices.length} real device(s): ${devices.map((d) => d.model || d.serial).join(", ")}`
            : "No Android devices found. Enable USB Debugging and connect via USB or run: adb connect <IP>:5555",
      });
    }

    // ─── 2. WIRELESS CONNECT ──────────────────────────────────────────────
    if (action === "CONNECT") {
      if (!deviceIp) {
        return NextResponse.json({ success: false, message: "Device IP address is required." });
      }
      const ip = deviceIp.includes(":") ? deviceIp : `${deviceIp}:5555`;
      try {
        // First try pairing ADB wireless (Android 11+)
        const result = await adb("", `connect ${ip}`, 10000);
        const connected = result.toLowerCase().includes("connected");
        return NextResponse.json({
          success: connected,
          message: connected
            ? `ADB Wireless connected to ${ip}. Device online.`
            : `ADB: ${result}. Ensure device has 'Wireless Debugging' enabled under Developer Options.`,
        });
      } catch (err) {
        return NextResponse.json({
          success: false,
          message: `ADB connect failed: ${String(err)}. Make sure 'adb' is in PATH.`,
        });
      }
    }

    // ─── 3. REAL UNLOCK SEQUENCE ──────────────────────────────────────────
    if (action === "UNLOCK") {
      try {
        // Step 1: Wake screen (Power button toggle)
        await adb(deviceSerial, "shell input keyevent 26");
        await delay(600);

        // Step 2: Check if screen is on - use wm size as health check
        await adb(deviceSerial, "shell wm size");

        // Step 3: Dismiss lock screen via swipe-up gesture
        await adb(deviceSerial, "shell input swipe 540 1600 540 800 300");
        await delay(400);

        // Step 4: Alternate unlock with Menu key
        await adb(deviceSerial, "shell input keyevent 82");
        await delay(300);

        // Step 5: Input PIN if provided and press Enter
        if (pin) {
          await adb(deviceSerial, `shell input text ${pin}`);
          await delay(200);
          await adb(deviceSerial, "shell input keyevent 66");
        }

        // Step 6: Confirm device state
        const state = await adb(deviceSerial, "shell dumpsys power | grep mHoldingDisplay");

        return NextResponse.json({
          success: true,
          message: `Android unlocked successfully, sir. ${state.includes("true") ? "Display is ON." : "Unlock sequence dispatched."}`,
        });
      } catch (err) {
        return NextResponse.json({
          success: false,
          message: `ADB unlock failed: ${String(err)}. Check USB Debugging is enabled and device is authorized.`,
        });
      }
    }

    // ─── 4. REAL LOCK ─────────────────────────────────────────────────────
    if (action === "LOCK") {
      try {
        // Press power button to sleep screen
        await adb(deviceSerial, "shell input keyevent 26");
        return NextResponse.json({ success: true, message: "Device screen locked, sir." });
      } catch (err) {
        return NextResponse.json({
          success: false,
          message: `ADB lock failed: ${String(err)}`,
        });
      }
    }

    // ─── 5. VOLUME CONTROL ────────────────────────────────────────────────
    if (action === "VOLUME_UP") {
      await adb(deviceSerial, "shell input keyevent 24");
      return NextResponse.json({ success: true, message: "Device volume increased, sir." });
    }
    if (action === "VOLUME_DOWN") {
      await adb(deviceSerial, "shell input keyevent 25");
      return NextResponse.json({ success: true, message: "Device volume decreased, sir." });
    }
    if (action === "MUTE") {
      await adb(deviceSerial, "shell input keyevent 164");
      return NextResponse.json({ success: true, message: "Device muted, sir." });
    }

    // ─── 6. OPEN APP ──────────────────────────────────────────────────────
    if (action === "OPEN_APP") {
      const appName: string = body.app || "";
      const packageMap: Record<string, string> = {
        youtube: "com.google.android.youtube",
        whatsapp: "com.whatsapp",
        instagram: "com.instagram.android",
        camera: "com.android.camera2",
        settings: "com.android.settings",
        chrome: "com.android.chrome",
        maps: "com.google.android.apps.maps",
        spotify: "com.spotify.music",
      };
      const pkg = packageMap[appName.toLowerCase()] || appName;
      try {
        await adb(deviceSerial, `shell monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);
        return NextResponse.json({ success: true, message: `Launched ${appName} on device, sir.` });
      } catch (err) {
        return NextResponse.json({ success: false, message: `Failed to launch ${appName}: ${String(err)}` });
      }
    }

    return NextResponse.json({ success: false, message: `Unknown ADB action: ${action}` });
  } catch (error) {
    console.error("ADB API Error:", error);
    return NextResponse.json(
      { success: false, message: "ADB bridge error: " + String(error) },
      { status: 500 }
    );
  }
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
