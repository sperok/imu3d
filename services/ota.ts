// ota.ts
// Strongly-typed OTA (Over-The-Air) update module using WebHID feature reports

// Lightweight localization support for user-facing messages
export interface OTAStrings {
  noDeviceSpecified: string;
  noConnectedDevice: string;
  deviceNotOpened: string;
  dataTooLong: string;
  emptyResponse: string;
  unknownMessageType: string; // {msgType}
  errorOpeningDevice: string; // {error}
  errorSendingInit: string; // {error}
  errorClosingDevice: string; // {error}
  errorReceivingFeatureReport: string; // {error}
  errorSendingFeatureReport: string; // {error}
}

const defaultStrings: OTAStrings = {
  noDeviceSpecified: 'No device specified.',
  noConnectedDevice: 'No connected device',
  deviceNotOpened: 'Device not opened',
  dataTooLong: 'Data too long',
  emptyResponse: 'Empty response',
  unknownMessageType: 'Unknown message type: {msgType}',
  errorOpeningDevice: 'Error opening device: {error}',
  errorSendingInit: 'Error sending init: {error}',
  errorClosingDevice: 'Error closing device: {error}',
  errorReceivingFeatureReport: 'Error receiving feature report: {error}',
  errorSendingFeatureReport: 'Error sending feature report: {error}',
};

let STRINGS: OTAStrings = { ...defaultStrings };

export function configureOtaLocale(overrides: Partial<OTAStrings>): void {
  STRINGS = { ...STRINGS, ...overrides };
}

function fmt(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

const OTA_FR = {
  id: 6,
  write: {
    length: 244,
    headerLength: 5,        // 0:0x00, 1:0xFF, 2:msgType, 3:lenLSB, 4:lenMSB
    msgTypeIndex: 2,
    lenIndex: 3,
    maxData: 244 - 5,
  },
  // Incoming feature reports include a 6-byte header in the returned DataView:
  // [0]=reportId, [1]=0x00, [2]=0xFF, [3]=msgType, [4]=lenLSB, [5]=lenMSB, then payload
  read: {
    headerLength: 6,
    msgTypeIndex: 3,
    lenIndex: 4,
    maxData: 244 - 6,
  },
} as const;

const max = Math.max;
const min = Math.min;

const ota_g: {
  hbTimeout: number;
  device: HIDDevice | null;
} = {
  hbTimeout: 9000,
  device: null,
};

async function sendHB(device: HIDDevice): Promise<void> {
  try {
    const resp = await otaSend(device, 'hb');
    console.log('Heartbeat response: ', resp);
  } catch (err) {
    console.error('Heartbeat error: ' + String(err));
  }
}

const hbTimer = {
  id: null as null | ReturnType<typeof setTimeout>,
  clear: () => {
    if (hbTimer.id) {
      console.log('Clearing heartbeat timer (' + hbTimer.id + ')');
      clearTimeout(hbTimer.id);
      hbTimer.id = null;
    }
  },
  arm: (device: HIDDevice, timeout = Math.round(ota_g.hbTimeout + Math.random() * 1000)) => {
    if (hbTimer.id) {
      console.log('Clearing heartbeat timer (' + hbTimer.id + ')');
      clearTimeout(hbTimer.id);
    }
    if (device && device.opened) {
      hbTimer.id = setTimeout(() => void sendHB(device), timeout);
      console.log('Armed heartbeat timer (' + hbTimer.id + ') for ' + timeout + 'ms');
    }
  },
};

export async function otaOpen(
  device: HIDDevice,
): Promise<unknown> {
  if (!device) throw new Error(STRINGS.noDeviceSpecified);
  if (!device.opened) await device.open().catch((err) => { throw new Error(fmt(STRINGS.errorOpeningDevice, { error: String(err) })); });

  const info = await otaSend(device, 'init').catch((err) => { throw new Error(fmt(STRINGS.errorSendingInit, { error: String(err) })); });
  // attach info to the device for app usage
  (device as HIDDevice & { info?: unknown }).info = info;
  console.log('Device info: ', info);

  ota_g.device = device;
  // Note: WebHID disconnects are reported on navigator.hid.ondisconnect, not per-device
  return info;
}

export async function otaClose(device: HIDDevice): Promise<void> {
  if (!device) throw new Error(STRINGS.noDeviceSpecified);
  //hbTimer.clear();
  ota_g.device = null;
  if (device.opened) {
    await device.close().catch((err) => { throw new Error(fmt(STRINGS.errorClosingDevice, { error: String(err) })); });
  }
}

async function processFR(device: HIDDevice): Promise<unknown> {
  if (!device) throw new Error(STRINGS.noConnectedDevice);
  if (!device.opened) throw new Error(STRINGS.deviceNotOpened);

  const ACK = new Uint8Array([0x00, 0xff, 0x02, 0x00, 0x00]);
  const NACK = new Uint8Array([0x00, 0xff, 0x03, 0x00, 0x00]);
  void ACK; void NACK; // reserved for future use

  let remaining = 1;
  const reportResponse: { error: string | null; data: string } = { error: null, data: '' };
  const decoder = new TextDecoder();

  while (remaining) {
    console.log('Getting feature report response.');
    const dv = await device.receiveFeatureReport(OTA_FR.id).catch((err) => {
      console.log('Error receiving feature report: ' + err);
      throw new Error(fmt(STRINGS.errorReceivingFeatureReport, { error: String(err) }));
    });


    // 5 bytes of header then payload:  0x00, 0xFF, msgType, lenLSB, lenMSB, payload
    const MTYPES = ['FIRST', 'MID', 'ACK_NRSP', 'ACK_RSP', 'NACK', 'EMPTY', 'RESULT'] as const;
    const payloadOffset = OTA_FR.read.headerLength;
    const payloadView = new Uint8Array(
      dv.buffer,
      dv.byteOffset + payloadOffset,
      Math.max(0, dv.byteLength - payloadOffset),
    );
    let data = decoder.decode(payloadView);
    const reportLength = dv.getUint16(OTA_FR.read.lenIndex, true);
    const msgType = dv.getUint8(OTA_FR.read.msgTypeIndex);
    data = data.slice(0, min(reportLength, data.length));
    remaining = 0;

    switch (msgType) {
      case 0: // FIRST
      case 1: // MID
        remaining = max(0, reportLength - data.length);
        reportResponse.data += data;
        break;
      case 2: // ACK_NRSP
        break;
      case 3: // ACK_RSP
        remaining = 1;
        break;
      case 4: // NACK
        reportResponse.error = data;
        break;
      case 5: // EMPTY
        reportResponse.error = STRINGS.emptyResponse;
        break;
      case 6: // RESULT
        reportResponse.data = data;
        break;
      default:
        reportResponse.error = fmt(STRINGS.unknownMessageType, { msgType: String(msgType) });
        break;
    }
    console.log('Msg Type ' + MTYPES[msgType as 0 | 1 | 2 | 3 | 4 | 5 | 6] + ' (' + reportLength + ':' + remaining + ') ' + reportResponse.error);
  }
  console.log('Feature report complete. ');
  if (reportResponse.data.length > 0) {
    reportResponse.data = JSON.parse(reportResponse.data);
  }
  console.log('Report: ', reportResponse);
  if (reportResponse.error) {
    console.log('Error in report response: ', reportResponse.error);
    throw new Error(reportResponse.error);
  }
  //console.log('Report response: ', reportResponse.data);
  return reportResponse.data;
}

export async function otaSend(device: HIDDevice, data: string): Promise<unknown> {
  const err = !device ? STRINGS.noConnectedDevice : !device.opened ? STRINGS.deviceNotOpened : !data ? 'No data' : undefined;
  if (err) {
    console.log(err);
    throw new Error(err);
  }

  const encoder = new TextEncoder();
  const uint8Array = encoder.encode(data);
  console.log("Sending Report '" + data + "' (" + uint8Array.length + ' bytes)');
  //hbTimer.clear();

  // Send in multiple packets if necessary.
  // Each packet payload length <= OTA_FR.write.maxData, with msgType 0 (FIRST) then 1 (MID) for remaining chunks.
  let offset = 0;
  let chunkIndex = 0;
  while (offset < uint8Array.length) {
    const remaining = uint8Array.length - offset;
    const chunkLen = Math.min(OTA_FR.write.maxData, remaining);
    const msgType = chunkIndex === 0 ? 0x00 : 0x01; // FIRST, then MID

    const featureReport = new Uint8Array(OTA_FR.write.length).fill(0);
    // Header: [0x00, 0xFF, msgType, lenLSB, lenMSB]
    featureReport.set([0x00, 0xFF, msgType, remaining & 0xff, (remaining >> 8) & 0xff], 0);
    featureReport.set(uint8Array.slice(offset, offset + chunkLen), OTA_FR.write.headerLength);

    console.log(
      `Sending FR6 chunk #${chunkIndex} msgType=${msgType === 0 ? 'FIRST' : 'MID'} len=${chunkLen}`
    );
    await device.sendFeatureReport(OTA_FR.id, featureReport).catch((e) => {
      throw new Error(fmt(STRINGS.errorSendingFeatureReport, { error: String(e) }));
    });
    offset += chunkLen;
    chunkIndex += 1;
  }
  console.log('All FR6 chunks sent (' + chunkIndex + ')');
  //hbTimer.arm(device);
  const res = await processFR(device);
  console.log('otaSend Returns: ', res);
  return res;
}

const ota = { open: otaOpen, close: otaClose, send: otaSend };
export default ota;
