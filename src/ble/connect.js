// One "Connect" button for every supported machine: ask the user to pick a
// device, then choose the driver from the services it actually exposes.

import { FtmsMachine } from './ftms-device.js?v=17';
import { IfitMachine } from './ifit-device.js?v=17';
import { IFIT } from './ifit-protocol.js?v=17';

const FTMS = '00001826-0000-1000-8000-00805f9b34fb';

// Bluefy (iOS) rejects some request options but exposes all services anyway,
// so it gets the plain "any device" request that is known to work there.
const isBluefy = () => /Bluefy/i.test(navigator.userAgent);

export async function pickAndConnect({ encoding, rawLog, onLog }) {
  const device = await navigator.bluetooth.requestDevice(
    isBluefy()
      ? { acceptAllDevices: true }
      : { acceptAllDevices: true, optionalServices: [FTMS, IFIT.SERVICE] },
  );
  onLog?.(`Selected ${device.name || '(no name)'}`);
  const server = await device.gatt.connect();
  const uuids = (await server.getPrimaryServices()).map((s) => s.uuid.toLowerCase());

  let machine;
  if (uuids.includes(IFIT.SERVICE)) machine = new IfitMachine({ rawLog });
  else if (uuids.includes(FTMS)) machine = new FtmsMachine({ encoding });
  else {
    server.disconnect();
    throw new Error(`${device.name || 'This device'} is not a supported fitness machine (no FTMS or iFit service).`);
  }
  if (onLog) machine.addEventListener('log', (e) => onLog(e.detail));
  await machine.connect(device);
  return machine;
}
