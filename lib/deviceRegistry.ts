/**
 * ULTRON Multi-Device Registry & ADB Execution Bridge
 * Manages connected devices, ADB wireless debugging status, and device actions.
 */

export interface DeviceInfo {
  id: string;
  name: string;
  type: "phone" | "tablet" | "workstation";
  ip: string;
  status: "ONLINE" | "OFFLINE" | "SYNCING";
  battery: number;
  locked: boolean;
  activeApp?: string;
  volume: number; // 0..100
}

export class DeviceRegistry {
  private devices: Map<string, DeviceInfo> = new Map();

  constructor() {
    // Initialize connected device registry (as per PDF Architecture)
    this.devices.set("dev-1", {
      id: "dev-1",
      name: "Pixel 8 Pro (ADB)",
      type: "phone",
      ip: "192.168.1.101:5555",
      status: "ONLINE",
      battery: 92,
      locked: false,
      activeApp: "System HUD",
      volume: 80,
    });

    this.devices.set("dev-2", {
      id: "dev-2",
      name: "Galaxy S24 Ultra",
      type: "phone",
      ip: "192.168.1.105:5555",
      status: "ONLINE",
      battery: 78,
      locked: true,
      activeApp: "Standby",
      volume: 65,
    });

    this.devices.set("dev-3", {
      id: "dev-3",
      name: "Ultron Workstation",
      type: "workstation",
      ip: "127.0.0.1:8080",
      status: "ONLINE",
      battery: 100,
      locked: false,
      activeApp: "Next.js Core",
      volume: 100,
    });
  }

  public getDevices(): DeviceInfo[] {
    return Array.from(this.devices.values());
  }

  public getDeviceCount(): number {
    return this.devices.size;
  }

  public lockDevices(): string {
    let count = 0;
    this.devices.forEach((dev) => {
      if (dev.type === "phone") {
        dev.locked = true;
        dev.activeApp = "Lockscreen";
        count++;
      }
    });
    return `ADB command dispatched: Locked ${count} connected mobile device${count > 1 ? "s" : ""}, sir.`;
  }

  public unlockDevices(): string {
    let count = 0;
    this.devices.forEach((dev) => {
      if (dev.type === "phone") {
        dev.locked = false;
        dev.activeApp = "Home Screen";
        count++;
      }
    });
    return `ADB command dispatched: Unlocked ${count} connected mobile device${count > 1 ? "s" : ""}, sir.`;
  }

  public adjustVolume(delta: number): string {
    let newVol = 50;
    this.devices.forEach((dev) => {
      dev.volume = Math.min(100, Math.max(0, dev.volume + delta));
      newVol = dev.volume;
    });
    return `Adjusted multi-device master volume to ${newVol}%, sir.`;
  }

  public launchAppOnDevices(appName: string): string {
    let count = 0;
    this.devices.forEach((dev) => {
      dev.activeApp = appName;
      dev.locked = false;
      count++;
    });
    return `Dispatched app launch payload "${appName}" across ${count} connected device${count > 1 ? "s" : ""}, sir.`;
  }
}

export const globalDeviceRegistry = new DeviceRegistry();
