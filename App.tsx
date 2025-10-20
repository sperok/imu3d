import React, { useState, useRef, useCallback, useEffect } from "react";
// FIX: Import HIDDevice and HIDInputReportEvent to resolve type errors.
import type {
  Pose,
  IMUData,
  HIDDevice,
  HIDInputReportEvent,
  SensorSample,
} from "./types";
import { ThreeScene } from "./components/ThreeScene";
import { IMUPositionEstimator } from "./services/IMUPositionEstimator";
import ota from "./services/ota";

const VENDOR_ID = 0x1915; // Cato
const PRODUCT_ID = 0x52dd;

const App: React.FC = () => {
  const [device, setDevice] = useState<HIDDevice | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isHidSupported, setIsHidSupported] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isCollecting, setIsCollecting] = useState(false);
  const isCollectingRef = useRef(isCollecting);
  isCollectingRef.current = isCollecting;
  const [collectedSamples, setCollectedSamples] = useState<SensorSample[]>([]);
  const collectedSamplesRef = useRef<SensorSample[]>([]);

  const [imuData, setImuData] = useState<SensorSample | null>(null);
  const [pose, setPose] = useState<Pose>({
    position: { x: 0, y: 0, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  });

  const positionEstimator = useRef<IMUPositionEstimator | null>(null);
  const firstTimestampRef = useRef<number>(0);

  useEffect(() => {
    positionEstimator.current = new IMUPositionEstimator();
    if (!("hid" in navigator)) {
      setIsHidSupported(false);
      setError(
        "WebHID is not supported in this browser. Please use Chrome or Edge."
      );
    }
  }, []);

  const handleInputReport = useCallback((event: HIDInputReportEvent) => {
    if (!positionEstimator.current) return;

    const { data, device: hidDevice, reportId } = event;

    if (reportId !== 7) {
      return;
    }

    // This is a simplified parsing logic. A real-world application should use
    // device.collections to dynamically find the correct report ID and the byte offsets
    // for each sensor axis based on HID usages (e.g., Accelerometer X, Gyroscope Z).
    // For this example, we assume a fixed structure:
    // - 6 axes of data (ax, ay, az, gx, gy, gz)
    // - Each axis is a 32-bit float (little-endian)
    // - The data starts at byte 0 of the report.
    if (data.byteLength < 28) {
      console.warn("Received data packet is too small.", data.byteLength);
      return;
    }

    let dt = 0;
    let ct = 0;
    if (collectedSamplesRef.current.length > 0) {
      ct = data.getUint32(0, true) - firstTimestampRef.current;
      dt =
        ct -
        collectedSamplesRef.current[collectedSamplesRef.current.length - 1].ts;
    } else {
      firstTimestampRef.current = data.getUint32(0, true);
    }

    const rawData: SensorSample = {
      ts: ct,
      dt: dt,
      acc: {
        x: data.getFloat32(4, true),
        y: data.getFloat32(8, true),
        z: data.getFloat32(12, true),
      },
      gyro: {
        x: data.getFloat32(16, true),
        y: data.getFloat32(20, true),
        z: data.getFloat32(24, true),
      },
    };

    if (isCollectingRef.current) {
      collectedSamplesRef.current.push(rawData);
    }
    /*
      positionEstimator.current.update(rawData, event.timeStamp);
      const newPose = positionEstimator.current.getPose();
      setPose(newPose);
      */
  }, []);

  const connectDevice = useCallback(async () => {
    if (!isHidSupported) {
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      let devices: HIDDevice[];
      devices = await navigator.hid.getDevices();
      if (devices.length == 0) {
        devices = await navigator.hid.requestDevice({
          filters: [{ vendorId: VENDOR_ID, productId: PRODUCT_ID }],
        });
      }

      if (!devices.length) {
        setIsConnecting(false);
        return;
      }

      const selectedDevice = devices[0];
      await selectedDevice.open();

      setDevice(selectedDevice);
      await ota.open(selectedDevice);
      selectedDevice.addEventListener("inputreport", handleInputReport);

      selectedDevice.addEventListener("disconnect", () => {
        setDevice(null);
      });
    } catch (e) {
      const err = e as Error;
      let errorMessage = `Failed to connect device: ${err.message}`;
      if (
        err.name === "SecurityError" ||
        err.message.toLowerCase().includes("permissions policy")
      ) {
        errorMessage =
          "WebHID Permission Error: The app is likely running in an iframe that blocks WebHID. Please try opening the app in a new, top-level tab.";
      }
      setError(errorMessage);
    } finally {
      setIsConnecting(false);
    }
  }, [handleInputReport, isHidSupported]);

  const disconnectDevice = useCallback(async () => {
    if (device) {
      device.removeEventListener("inputreport", handleInputReport);
      await ota.close(device);
      await device.close();
      setDevice(null);
      setImuData(null);
      setIsStreaming(false);
      setCountdown(null);
      setCollectedSamples([]);
    }
  }, [device, handleInputReport]);

  const startTwoSecondSample = useCallback(async () => {
    if (!device) return;

    // Start countdown
    setCountdown(3);
    const countdownInterval = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(countdownInterval);
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    // Wait for countdown to finish
    await new Promise((resolve) => setTimeout(resolve, 3000));

    try {
      // Start streaming and collection
      await ota.send(device, "sensor_stream on");
      setIsStreaming(true);
      setIsCollecting(true);
      collectedSamplesRef.current = [];
      setError(null);

      // Set a timer to stop collection after 2 seconds
      setTimeout(async () => {
        await ota.send(device, "sensor_stream off");
        setIsStreaming(false);
        setIsCollecting(false);
        setCollectedSamples(collectedSamplesRef.current);

        // Here you can process the collectedSamples
        console.log("Collected samples:", collectedSamplesRef.current);
        const totalDt = collectedSamplesRef.current.reduce(
          (a, b) => a + b.dt,
          0
        );
        console.log(
          "Total, avg delta time:",
          totalDt,
          totalDt / collectedSamplesRef.current.length
        );

        setCountdown(null);
      }, 2000);
    } catch (e) {
      const err = e as Error;
      setError(`Failed to start stream: ${err.message}`);
      setIsCollecting(false);
      setIsStreaming(false);
    }
  }, [device]);

  const resetPosition = () => {
    if (positionEstimator.current) {
      positionEstimator.current.reset();
      setPose(positionEstimator.current.getPose());
      setCollectedSamples([]);
    }
  };

  const status = device ? "Connected" : "Disconnected";
  const statusColor = device ? "text-green-400" : "text-red-400";

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 font-sans p-4 lg:p-6 flex flex-col">
      <div className="flex-grow grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-gray-800 rounded-lg shadow-2xl p-4 flex flex-col">
          <div className="flex-grow relative min-h-[300px] lg:min-h-0">
            <ThreeScene pose={pose} />
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg shadow-2xl p-6 flex flex-col space-y-6">
          <div>
            <div className="space-y-3">
              {!device ? (
                <button
                  onClick={connectDevice}
                  disabled={isConnecting || !isHidSupported}
                  className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-4 rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isConnecting ? "Connecting..." : "Connect Cato"}
                </button>
              ) : (
                <>
                  <button
                    onClick={disconnectDevice}
                    className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-lg transition-colors duration-200"
                  >
                    Disconnect {device.productName}
                  </button>

                  <button
                    onClick={startTwoSecondSample}
                    disabled={!device || isCollecting || countdown !== null}
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg transition-colors duration-200 disabled:opacity-50"
                  >
                    {countdown !== null
                      ? `Starting in ${countdown}...`
                      : isCollecting
                      ? "Collecting..."
                      : "Start 2s Sample"}
                  </button>
                  <button
                    onClick={resetPosition}
                    disabled={!device}
                    className="w-full bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-3 px-4 rounded-lg transition-colors duration-200 disabled:opacity-50"
                  >
                    Reset Position & Orientation
                  </button>
                </>
              )}
            </div>
            {error && <p className="text-red-400 mt-3">{error}</p>}
          </div>

          {collectedSamples.length > 0 && (
            <InfoPanel
              title={"Sensor Data: " + collectedSamples.length + " samples"}
            >
              <table className="w-full table-auto border-collapse mb-2">
                <thead>
                  <tr className="bg-gray-700">
                    <th className="px-1 py-1 text-right text-sm font-semibold">
                      ts
                    </th>
                    <th className="px-1 py-1 text-right text-sm font-semibold">
                      ∆t
                    </th>
                    <th className="px-1 py-1 text-right text-sm font-semibold">
                      AX
                    </th>
                    <th className="px-1 py-1 text-right text-sm font-semibold">
                      AY
                    </th>
                    <th className="px-1 py-1 text-right text-sm font-semibold">
                      AZ
                    </th>
                    <th className="px-1 py-1 text-right text-sm font-semibold">
                      GX
                    </th>
                    <th className="px-1 py-1 text-right text-sm font-semibold">
                      GY
                    </th>
                    <th className="px-1 py-1 text-right text-sm font-semibold">
                      GZ
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {collectedSamples.map((sample, index) => (
                    <tr key={index} className="border-b border-gray-700">
                      <td className="px-1 py-0 text-right font-mono text-xs">
                        {(sample.ts / 1000).toFixed(3)}
                      </td>
                      <td className="px-1 py-0 text-right font-mono text-xs">
                        {sample.dt}
                      </td>
                      <td className="px-1 py-0 text-right font-mono text-xs">
                        {sample.acc.x.toFixed(2)}
                      </td>
                      <td className="px-1 py-0 text-right font-mono text-xs">
                        {sample.acc.y.toFixed(2)}
                      </td>
                      <td className="px-1 py-0 text-right font-mono text-xs">
                        {sample.acc.z.toFixed(2)}
                      </td>
                      <td className="px-1 py-0 text-right font-mono text-xs">
                        {sample.gyro.x.toFixed(2)}
                      </td>
                      <td className="px-1 py-0 text-right font-mono text-xs">
                        {sample.gyro.y.toFixed(2)}
                      </td>
                      <td className="px-1 py-0 text-right font-mono text-xs">
                        {sample.gyro.z.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </InfoPanel>
          )}
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
    <h3 className="text-md font-semibold text-gray-300 border-b border-gray-600 pb-2 mb-3">
      {title}
    </h3>
    <div className="max-h-48 overflow-y-auto">{children}</div>
  </div>
);

export default App;
