/**
 * The connect/disconnect chips in the top bar, one per Bluetooth device.
 */
import { showDialog, toast } from './dom.js';
import { TIMEOUT_ERROR } from '../core/timeout.js';
import { describeBattery } from '../core/device-status.js';

/**
 * Wire a chip to a device. While connected, the chip can show a live reading
 * (for example heart rate) and the battery level instead of the device name.
 * @param {HTMLButtonElement} chip  element with a <small> status line
 * @param {import('../ble/ble-device.js').BleDevice} device
 * @param {{onUnsupported: () => void}} hooks
 * @returns {{setReading: (reading:{value:string, unit?:string}|null) => void}}
 */
export function bindDeviceChip(chip, device, { onUnsupported }) {
  const status = chip.querySelector('small');
  const reading = Object.assign(document.createElement('span'), { className: 'chip-reading', hidden: true });
  const battery = Object.assign(document.createElement('span'), { className: 'chip-battery', hidden: true });
  chip.append(reading, battery);

  const refresh = () => {
    const connected = chip.dataset.state === 'on';
    reading.hidden = !connected || !reading.textContent;
    battery.hidden = !connected || !battery.textContent;
    chip.classList.toggle('has-live', !reading.hidden || !battery.hidden);
  };
  const setBattery = (percent) => {
    const level = describeBattery(percent);
    battery.textContent = level?.text ?? '';
    battery.classList.toggle('low', Boolean(level?.low));
    battery.title = level ? `Battery ${level.text}` : '';
    refresh();
  };

  device.addEventListener('state', ({ detail }) => {
    chip.dataset.state = detail.state;
    status.textContent = detail.text;
    if (detail.state !== 'on') reading.replaceChildren();
    refresh();
  });
  device.addEventListener('battery', ({ detail }) => setBattery(detail.percent));
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
    connect();
  });

  return {
    setReading(value) {
      if (!value) reading.replaceChildren();
      else {
        const unit = Object.assign(document.createElement('span'), { className: 'chip-unit', textContent: value.unit ? ` ${value.unit}` : '' });
        reading.replaceChildren(value.value, unit);
      }
      refresh();
    },
  };

  async function connect() {
    try {
      await device.connect();
    } catch (error) {
      console.warn(error);
      if (error.name === TIMEOUT_ERROR) {
        showDialog({
          title: `Couldn't connect to ${device.label.toLowerCase()}`,
          text: error.message,
          actions: [{ label: 'Close', style: 'ghost' }, { label: 'Try again', style: 'primary', onClick: connect }],
        });
      } else toast(`${device.label}: ${error.message}`);
    }
  }
}
