
import * as THREE from 'three';
import type { IMUData, Pose } from '../types';

// Constants for sensor data conversion.
// These values depend on the specific IMU's configuration (e.g., range).
// Using common values for a hypothetical IMU.
// Accelerometer: +/- 8g range for a 16-bit ADC.
const ACCEL_SENSITIVITY = (8 * 9.81) / 32768.0; 
// Gyroscope: +/- 2000 degrees/sec range for a 16-bit ADC.
const GYRO_SENSITIVITY = (2000 * Math.PI / 180.0) / 32768.0;

const GRAVITY = new THREE.Vector3(0, -9.81, 0); // Assuming gravity is along the negative Y-axis in the world frame at start.

export class IMUPositionEstimator {
  private position: THREE.Vector3;
  private velocity: THREE.Vector3;
  private orientation: THREE.Quaternion;
  private lastTimestamp: number | null;

  constructor() {
    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.orientation = new THREE.Quaternion();
    this.lastTimestamp = null;
  }

  public reset(): void {
    this.position.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.orientation.set(0, 0, 0, 1);
    this.lastTimestamp = null;
  }
  
  public update(data: IMUData, timestamp: number): void {
    if (this.lastTimestamp === null) {
      this.lastTimestamp = timestamp;
      return;
    }
    
    const dt = (timestamp - this.lastTimestamp) / 1000.0; // Delta time in seconds
    if (dt <= 0) return;

    // 1. Update orientation with gyroscope data
    const gx = data.gx * GYRO_SENSITIVITY;
    const gy = data.gy * GYRO_SENSITIVITY;
    const gz = data.gz * GYRO_SENSITIVITY;
    
    const deltaRotation = new THREE.Quaternion();
    const rotationAxis = new THREE.Vector3(gx, gy, gz);
    const angle = rotationAxis.length() * dt;
    rotationAxis.normalize();
    deltaRotation.setFromAxisAngle(rotationAxis, angle);
    
    this.orientation.multiplyQuaternions(this.orientation, deltaRotation);
    this.orientation.normalize();

    // 2. Get linear acceleration in world frame
    const ax = data.ax * ACCEL_SENSITIVITY;
    const ay = data.ay * ACCEL_SENSITIVITY;
    const az = data.az * ACCEL_SENSITIVITY;
    const localAccel = new THREE.Vector3(ax, ay, az);

    // Estimate gravity in the device's local frame by rotating the world gravity vector
    const gravityInDeviceFrame = GRAVITY.clone().applyQuaternion(this.orientation.clone().invert());
    
    // Subtract gravity to get linear acceleration
    const linearAccelLocal = localAccel.clone().sub(gravityInDeviceFrame);

    // Rotate linear acceleration to world frame
    const linearAccelWorld = linearAccelLocal.clone().applyQuaternion(this.orientation);

    // Simple thresholding to reduce drift from noise when the device is stationary
    if (linearAccelWorld.length() < 0.1) {
        linearAccelWorld.set(0,0,0);
    }
    
    // 3. Integrate acceleration to get velocity
    this.velocity.addScaledVector(linearAccelWorld, dt);

    // 4. Integrate velocity to get position
    this.position.addScaledVector(this.velocity, dt);

    this.lastTimestamp = timestamp;
  }
  
  public getPose(): Pose {
    return {
      position: {
        x: this.position.x,
        y: this.position.y,
        z: this.position.z,
      },
      orientation: {
        x: this.orientation.x,
        y: this.orientation.y,
        z: this.orientation.z,
        w: this.orientation.w,
      }
    };
  }
}
