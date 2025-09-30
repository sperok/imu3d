export interface IMUData {
  ax: number; // Accelerometer X
  ay: number; // Accelerometer Y
  az: number; // Accelerometer Z
  gx: number; // Gyroscope X
  gy: number; // Gyroscope Y
  gz: number; // Gyroscope Z
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Pose {
  position: Vector3;
  orientation: Quaternion;
}

// FIX: Add WebHID types to fix compilation errors in App.tsx.
// These are minimal definitions based on usage in the app.
export interface HIDDevice {
  vendorId: number;
  productId: number;
  productName: string;
  collections: ReadonlyArray<any>;
  open(): Promise<void>;
  close(): Promise<void>;
  addEventListener(type: string, listener: (ev: any) => any): void;
  removeEventListener(type: string, listener: (ev: any) => any): void;
}

export interface HIDInputReportEvent extends Event {
  readonly data: DataView;
  readonly device: HIDDevice;
  readonly reportId: number;
}

// Augment the global Navigator interface to include the WebHID API.
declare global {
  interface Navigator {
    hid: {
      requestDevice(options?: any): Promise<HIDDevice[]>;
      getDevices(): Promise<HIDDevice[]>;
    };
  }
}
