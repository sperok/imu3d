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

export type SensorSample = {
  ts: number; // timestamp in ms
  dt: number; // delta time in ms
  acc: {
    x: number; // acceleration in g
    y: number; // acceleration in g
    z: number; // acceleration in g
  };
  gyro: {
    x: number; // gyro in deg/s
    y: number; // gyro in deg/s
    z: number; // gyro in deg/s
  };
};

// FIX: Add WebHID types to fix compilation errors in App.tsx.
// These are minimal definitions based on usage in the app.
export interface HIDDevice {
  vendorId: number;
  productId: number;
  productName: string;
  collections: ReadonlyArray<any>;
  opened: boolean;
  receiveFeatureReport(reportId: number): Promise<DataView>;
  sendFeatureReport(reportId: number, data: Uint8Array): Promise<void>;
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
