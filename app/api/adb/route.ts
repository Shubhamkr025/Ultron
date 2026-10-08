import { NextResponse } from "next/server";
import {
  resolveAdbPath,
  runAdb,
  getConnectedDevices,
  getPrimaryDeviceSerial,
  unlockPhone,
  lockPhone,
  openAppOnPhone,
  navigatePhone,
  DEFAULT_PATTERN,
  APP_PACKAGE_MAP,
} from "@/lib/adbService";

export { resolveAdbPath };

export async function POST(req: Request) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const action: string = (body.action || "STATUS").toUpperCase();
    const pin: string = body.pin || "";
    const deviceIp: string = body.ip || "";
    const requestedSerial: string = body.serial || "";
    const deviceSerial = await getPrimaryDeviceSerial(requestedSerial);

    const adbPath = resolveAdbPath();

    // ─── 1. LIST DEVICES & VERIFY STATUS ──────────────────────────────────
    if (action === "STATUS" || action === "DEVICES") {
      const devices = await getConnectedDevices();
      const hasUnauthorized = devices.some((d) => d.state === "unauthorized");
      const readyDevices = devices.filter((d) => d.isAuthorized);

      let statusMsg = "";
      if (devices.length === 0) {
        statusMsg = "NO DEVICES DETECTED · Connect via USB (Debugging ON) or Wi-Fi ADB";
      } else if (hasUnauthorized) {
        statusMsg = "⚠️ TAP 'ALLOW USB DEBUGGING' ON PHONE SCREEN";
      } else {
        statusMsg = `${readyDevices.length} DEVICE${readyDevices.length > 1 ? "S" : ""} ONLINE (${readyDevices.map((d) => d.model).join(", ")})`;
      }

      return NextResponse.json({
        success: true,
        devices,
        adbPath,
        count: readyDevices.length,
        hasUnauthorized,
        message: statusMsg,
      });
    }

    // ─── 2. WIRELESS ADB CONNECT ──────────────────────────────────────────
    if (action === "CONNECT") {
      if (!deviceIp.trim()) {
        return NextResponse.json({
          success: false,
          message: "Please enter your device's Wi-Fi IP address (e.g. 192.168.1.15:5555)",
        });
      }

      const targetAddress = deviceIp.includes(":") ? deviceIp.trim() : `${deviceIp.trim()}:5555`;

      try {
        const result = await runAdb("", `connect ${targetAddress}`, 10000);
        const isConnected =
          result.toLowerCase().includes("connected") && !result.toLowerCase().includes("unable");

        return NextResponse.json({
          success: isConnected,
          message: isConnected
            ? `Wireless link established to ${targetAddress}, sir. Device online.`
            : `ADB Connect: ${result}. Make sure 'Wireless Debugging' is active on your device.`,
          raw: result,
        });
      } catch (err: any) {
        return NextResponse.json({
          success: false,
          message: `Connection attempt to ${targetAddress} failed: ${err.message || String(err)}`,
        });
      }
    }

    // ─── 3. SWITCH USB TO TCPIP MODE & FETCH PHONE IP ─────────────────────
    if (action === "TCPIP") {
      try {
        const tcpResult = await runAdb(deviceSerial, "tcpip 5555");
        let deviceWifiIp = "";

        // Query device Wi-Fi IP using fallback methods
        if (!deviceWifiIp) {
          try {
            const ipOut = await runAdb(deviceSerial, "shell ip route");
            const match = ipOut.match(/src\s+([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/);
            if (match?.[1]) deviceWifiIp = match[1];
          } catch {}
        }
        if (!deviceWifiIp) {
          try {
            const ipAddrOut = await runAdb(deviceSerial, "shell ip addr show wlan0");
            const match = ipAddrOut.match(/inet\s+([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/);
            if (match?.[1]) deviceWifiIp = match[1];
          } catch {}
        }
        if (!deviceWifiIp) {
          try {
            const ifconfigOut = await runAdb(deviceSerial, "shell ifconfig wlan0");
            const match = ifconfigOut.match(/inet addr:([0-9.]+)/) || ifconfigOut.match(/inet ([0-9.]+)/);
            if (match?.[1]) deviceWifiIp = match[1];
          } catch {}
        }

        return NextResponse.json({
          success: true,
          ip: deviceWifiIp,
          message: deviceWifiIp
            ? `Device configured for Wireless ADB. Phone IP: ${deviceWifiIp}:5555. Unplug USB and click LINK!`
            : `Device configured for Wireless ADB on port 5555 (${tcpResult}). Check your phone's Wi-Fi settings for its IP.`,
        });
      } catch (err: any) {
        return NextResponse.json({
          success: false,
          message: `TCPIP config failed: ${err.message || String(err)}. Ensure USB device is connected with USB Debugging enabled.`,
        });
      }
    }

    // ─── 4. UNLOCK SEQUENCE (SMART WAKE, PIN, or PATTERN) ─────────────────
    if (action === "UNLOCK") {
      const pattern = body.pattern || DEFAULT_PATTERN;
      const res = await unlockPhone(deviceSerial, pattern, pin);
      return NextResponse.json(res);
    }

    // ─── 5. LOCK DEVICE ───────────────────────────────────────────────────
    if (action === "LOCK") {
      const res = await lockPhone(deviceSerial);
      return NextResponse.json(res);
    }

    // ─── 6. LAUNCH APPS ───────────────────────────────────────────────────
    if (action === "OPEN_APP" || action === "LAUNCH_APP") {
      const appName: string = body.app || body.appName || "youtube";
      const query: string = body.query || body.url || "";
      const res = await openAppOnPhone(appName, deviceSerial, query);
      return NextResponse.json(res);
    }

    // ─── 7. NAVIGATION & MEDIA CONTROLS ───────────────────────────────────
    if (
      action === "HOME" ||
      action === "BACK" ||
      action === "RECENTS" ||
      action === "VOLUME_UP" ||
      action === "VOLUME_DOWN" ||
      action === "MUTE" ||
      action === "PLAY_PAUSE"
    ) {
      const res = await navigatePhone(action as any, deviceSerial);
      return NextResponse.json(res);
    }

    // ─── 8. BATTERY TELEMETRY ─────────────────────────────────────────────
    if (action === "BATTERY") {
      try {
        const out = await runAdb(deviceSerial, "shell dumpsys battery");
        const levelMatch = out.match(/level:\s*([0-9]+)/);
        const tempMatch = out.match(/temperature:\s*([0-9]+)/);
        const statusMatch = out.match(/status:\s*([0-9]+)/);

        const level = levelMatch ? levelMatch[1] : "--";
        const temp = tempMatch ? (parseInt(tempMatch[1], 10) / 10).toFixed(1) : "--";
        const isCharging = statusMatch ? statusMatch[1] === "2" : false;

        return NextResponse.json({
          success: true,
          level,
          temp,
          isCharging,
          message: `Phone battery is at ${level}%, ${isCharging ? "charging" : "discharging"}, temperature ${temp}°C, sir.`,
        });
      } catch (err: any) {
        return NextResponse.json({
          success: false,
          message: `Failed to read device battery: ${err.message || String(err)}`,
        });
      }
    }

    // ─── 9. GET INSTALLED APPS LIST ───────────────────────────────────────
    if (action === "LIST_APPS") {
      try {
        const out = await runAdb(deviceSerial, "shell pm list packages -3");
        const thirdParty = out
          .split("\n")
          .map((l) => l.replace("package:", "").trim())
          .filter(Boolean);
        return NextResponse.json({
          success: true,
          packages: thirdParty,
          supportedQuickApps: Object.keys(APP_PACKAGE_MAP),
        });
      } catch (err: any) {
        return NextResponse.json({
          success: false,
          message: `Failed to list packages: ${err.message || String(err)}`,
        });
      }
    }

    return NextResponse.json({ success: false, message: `Unknown ADB action: ${action}` });
  } catch (error: any) {
    console.error("ADB API Error:", error);
    return NextResponse.json(
      { success: false, message: "ADB bridge error: " + (error?.message || String(error)) },
      { status: 500 }
    );
  }
}
