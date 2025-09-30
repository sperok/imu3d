import React, { useState, useRef, useCallback, useEffect } from 'react';
// FIX: Import HIDDevice and HIDInputReportEvent to resolve type errors.
import type { Pose, IMUData, HIDDevice, HIDInputReportEvent } from './types';
import { ThreeScene } from './components/ThreeScene';
import { IMUPositionEstimator } from './services/IMUPositionEstimator';

const VENDOR_ID = 0x1a86; // Example Vendor ID, change if needed
const PRODUCT_ID = 0xe025; // Example Product ID, change if needed


const App: React.FC = () => {
  const [device, setDevice] = useState<HIDDevice | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isHidSupported, setIsHidSupported] = useState(true);
  
  const [imuData, setImuData] = useState<IMUData | null>(null);
  const [pose, setPose] = useState<Pose>({
    position: { x: 0, y: 0, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  });

  const positionEstimator = useRef<IMUPositionEstimator | null>(null);

  useEffect(() => {
    positionEstimator.current = new IMUPositionEstimator();
    if (!('hid' in navigator)) {
      setIsHidSupported(false);
      setError("WebHID is not supported in this browser. Please use Chrome or Edge.");
    }
  }, []);

  const handleInputReport = useCallback((event: HIDInputReportEvent) => {
    if (!positionEstimator.current) return;

    const { data, device: hidDevice, reportId } = event;
    
    // This is a simplified parsing logic. A real-world application should use
    // device.collections to dynamically find the correct report ID and the byte offsets
    // for each sensor axis based on HID usages (e.g., Accelerometer X, Gyroscope Z).
    // For this example, we assume a fixed structure:
    // - 6 axes of data (ax, ay, az, gx, gy, gz)
    // - Each axis is a 16-bit signed integer (little-endian)
    // - The data starts at byte 0 of the report.
    if (data.byteLength < 12) {
      console.warn("Received data packet is too small.", data.byteLength);
      return;
    }

    const rawData: IMUData = {
      ax: data.getInt16(0, true),
      ay: data.getInt16(2, true),
      az: data.getInt16(4, true),
      gx: data.getInt16(6, true),
      gy: data.getInt16(8, true),
      gz: data.getInt16(10, true),
    };
    
    setImuData(rawData);

    positionEstimator.current.update(rawData, event.timeStamp);
    const newPose = positionEstimator.current.getPose();
    setPose(newPose);

  }, []);

  const connectDevice = useCallback(async () => {
    if (!isHidSupported) {
      return;
    }
    
    setIsConnecting(true);
    setError(null);
    
    try {
      const devices = await navigator.hid.requestDevice({
        filters: [
            // Use a specific vendor/product ID for a known device
            // { vendorId: VENDOR_ID, productId: PRODUCT_ID },
            // Or use a more generic filter by HID usage page for sensors
            { vendorId:  0x1915 } // Vendor-defined usage page is a common fallback
        ],
      });

      if (!devices.length) {
        setIsConnecting(false);
        return;
      }

      const selectedDevice = devices[0];
      await selectedDevice.open();
      
      setDevice(selectedDevice);
      selectedDevice.addEventListener('inputreport', handleInputReport);

      selectedDevice.addEventListener('disconnect', () => {
        setDevice(null);
      });

    } catch (e) {
      const err = e as Error;
      let errorMessage = `Failed to connect device: ${err.message}`;
      if (err.name === 'SecurityError' || err.message.toLowerCase().includes('permissions policy')) {
        errorMessage = "WebHID Permission Error: The app is likely running in an iframe that blocks WebHID. Please try opening the app in a new, top-level tab.";
      }
      setError(errorMessage);
    } finally {
      setIsConnecting(false);
    }
  }, [handleInputReport, isHidSupported]);

  const disconnectDevice = useCallback(async () => {
    if (device) {
      device.removeEventListener('inputreport', handleInputReport);
      await device.close();
      setDevice(null);
      setImuData(null);
    }
  }, [device, handleInputReport]);

  const resetPosition = () => {
    if (positionEstimator.current) {
      positionEstimator.current.reset();
      setPose(positionEstimator.current.getPose());
    }
  };

  const status = device ? 'Connected' : 'Disconnected';
  const statusColor = device ? 'text-green-400' : 'text-red-400';

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 font-sans p-4 lg:p-6 flex flex-col">
      <header className="mb-4">
        <h1 className="text-3xl font-bold text-cyan-400">IMU 3D Visualizer</h1>
        <p className="text-gray-400">Visualizing 3D position and orientation from IMU data via WebHID.</p>
      </header>
      
      <div className="flex-grow grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-gray-800 rounded-lg shadow-2xl p-4 flex flex-col">
          <div className="flex-grow relative min-h-[300px] lg:min-h-0">
             <ThreeScene pose={pose} />
          </div>
        </div>
        
        <div className="bg-gray-800 rounded-lg shadow-2xl p-6 flex flex-col space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-cyan-300 mb-3">Controls</h2>
            <div className="space-y-3">
              {!device ? (
                <button 
                  onClick={connectDevice} 
                  disabled={isConnecting || !isHidSupported}
                  className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-4 rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isConnecting ? 'Connecting...' : 'Connect IMU Device'}
                </button>
              ) : (
                <button 
                  onClick={disconnectDevice} 
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-lg transition-colors duration-200"
                >
                  Disconnect Device
                </button>
              )}
              <button 
                onClick={resetPosition}
                disabled={!device}
                className="w-full bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-3 px-4 rounded-lg transition-colors duration-200 disabled:opacity-50"
              >
                Reset Position & Orientation
              </button>
            </div>
            {error && <p className="text-red-400 mt-3">{error}</p>}
          </div>

          <div className="flex-grow space-y-6">
            <InfoPanel title="Device Status">
              <p className="text-lg">Status: <span className={`font-semibold ${statusColor}`}>{status}</span></p>
              {device && <p className="text-sm text-gray-400">{device.productName}</p>}
            </InfoPanel>

            <InfoPanel title="Live Sensor Data (Raw)">
                {imuData ? (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                        <span>AX: <span className="font-mono text-cyan-400">{imuData.ax.toFixed(0)}</span></span>
                        <span>GX: <span className="font-mono text-purple-400">{imuData.gx.toFixed(0)}</span></span>
                        <span>AY: <span className="font-mono text-cyan-400">{imuData.ay.toFixed(0)}</span></span>
                        <span>GY: <span className="font-mono text-purple-400">{imuData.gy.toFixed(0)}</span></span>
                        <span>AZ: <span className="font-mono text-cyan-400">{imuData.az.toFixed(0)}</span></span>
                        <span>GZ: <span className="font-mono text-purple-400">{imuData.gz.toFixed(0)}</span></span>
                    </div>
                ) : <p className="text-gray-500">Waiting for data...</p>}
            </InfoPanel>

            <InfoPanel title="Calculated Position">
                <div className="space-y-1">
                    <p>X: <span className="font-mono text-green-400">{pose.position.x.toFixed(3)}</span> m</p>
                    <p>Y: <span className="font-mono text-green-400">{pose.position.y.toFixed(3)}</span> m</p>
                    <p>Z: <span className="font-mono text-green-400">{pose.position.z.toFixed(3)}</span> m</p>
                </div>
            </InfoPanel>
          </div>
        </div>
      </div>
    </div>
  );
};

interface InfoPanelProps {
  title: string;
  children: React.ReactNode;
}

const InfoPanel: React.FC<InfoPanelProps> = ({ title, children }) => (
  <div className="bg-gray-700/50 p-4 rounded-lg">
    <h3 className="text-md font-semibold text-gray-300 border-b border-gray-600 pb-2 mb-3">{title}</h3>
    {children}
  </div>
);


export default App;