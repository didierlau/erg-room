/**
 * The connect/disconnect chips in the top bar, one per Bluetooth device.
 */
import { showDialog, toast } from './dom.js';

/**
 * @param {HTMLButtonElement} chip  element with a <small> status line
 * @param {import('../ble/ble-device.js').BleDevice} device
 * @param {{onUnsupported: () => void}} hooks
 */
export function bindDeviceChip(chip, device, { onUnsupported }) {
  const status = chip.querySelector('small');

  device.addEventListener('state', ({ detail }) => {
    chip.dataset.state = detail.state;
    status.textContent = detail.text;
  });
  device.addEventListener('connected', () => toast(`${device.label} connected`));
  device.addEventListener('lost', () => toast(`${device.label} disconnected`));

  chip.addEventListener('click', async () => {
    if (!navigator.bluetooth) {
      onUnsupported();
      return;
    }
    if (device.connected) {
      showDialog({
        title: `Disconnect ${device.label.toLowerCase()}?`,
        actions: [{ label: 'Cancel', style: 'ghost' }, { label: 'Disconnect', style: 'danger', onClick: () => device.disconnect() }],
      });
      return;
    }
    try {
      await device.connect();
    } catch (error) {
      console.warn(error);
      toast(`${device.label}: ${error.message}`);
    }
  });
}
