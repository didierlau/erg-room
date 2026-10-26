# Erg Room

Structured ERG workouts for a **Zwift Hub** and **Zwift Click**, in the browser. No account, no world, no social features. It controls the trainer's power, lets the Click nudge the intensity, and saves every ride as a `.FIT` file.

**Open the app:** https://didierlau.github.io/erg-room/

## Features

- **ERG workouts.** The trainer holds each target wattage; ramps change smoothly. You see power against target, the interval countdown, what's next, cadence, heart rate and the workout profile with your actual power and heart rate traced over it. The heart-rate line is coloured by zone (from your threshold heart rate, or 90% of max HR) using the same colours as the power zones.
- **Zwift Click.** On the Dashboard screen `+` / `−` change the whole workout's intensity by 5%. In free-ride steps, ERG turns off and the Click changes the simulated gradient. On a laptop the arrow keys do the same; space pauses.
- **Two ride screens** (Settings → Ride screen). *Dashboard*: big numbers and the workout profile. *Avatar*: a rider on a road that climbs with the target power; the Click shifts 13 virtual gears. A toggle on that screen picks what the trainer does: **ERG holds target** (gears only change the virtual speed) or **Gears set resistance** (the trainer runs in simulation mode; the road's gradient plus your gear sets the resistance and you pace yourself to the target, like riding outside). Since the Zwift Cog has no real gears and FTMS has no shift command, a gear is emulated as ±0.5% of gradient per step.
- **Workouts.** Import Zwift `.zwo` files (several at once) or build your own with steady, ramp, interval and free-ride steps, in % of FTP or watts, with estimated duration, TSS and IF. Any workout exports back to `.zwo`.
- **Recording.** One sample per second, one lap per workout step. Download the `.FIT` (indoor cycling) and upload it to Strava, Garmin Connect, intervals.icu or TrainingPeaks.
- **Safety nets.** The workout clock pauses when you stop pedalling, the screen stays awake, devices reconnect after a dropout, and an unfinished ride is saved every 10 seconds.
- **Heart rate** from any Bluetooth strap (optional) and a **demo mode** to try it without a trainer.
- **FTP tests** with automatic analysis and a one-tap “Set FTP”. Details below.
- **Garmin upload helper.** Saves the `.FIT` and opens Garmin Connect’s import page.

## FTP tests

| Test | What you ride | How FTP is calculated |
| --- | --- | --- |
| **Ramp test** | 1-minute steps from 50% of FTP, +6% each minute, until your cadence collapses (detected automatically) | 75% of your best 1-minute power. Also records max heart rate. |
| **20-minute test** | Warm-up with three openers, then 20 minutes as hard as you can sustain | 95% of 20-minute power (Allen & Coggan). Threshold heart rate = 95% of the effort’s average heart rate (Friel). Flags uneven pacing and heart-rate drift. |
| **Critical Power 3/12** | A 3-minute and a 12-minute all-out effort, 30 minutes easy between | Two-parameter Critical Power model (work = CP·t + W′); FTP = 95% of CP. Also reports W′, your anaerobic capacity, and flags implausible values. |
| **Heart-rate check** | Four 4-minute steady stages at 55–85% of FTP, nothing maximal | Fits heart rate against power over the settled end of each stage and finds the power at your threshold heart rate (or 90% of max HR). Least precise; meant for checking between real tests. |
| **From your rides** | Nothing: uses rides from the last 90 days | Fits the Critical Power model to your best 3, 5, 8, 12 and 20-minute powers. Only valid if those rides contain hard efforts. |

During test efforts the trainer stays in ERG and **+ / − change the target by 5 W**, so you pace the effort yourself. This also works with a single-cog setup like the Zwift Cog.

## Garmin Connect, TrainingPeaks and Strava

Garmin and TrainingPeaks only accept uploads from approved partner apps with a server, so Erg Room can’t upload in the background. The quickest route:

1. Tap **Upload to Garmin** after a ride. The `.FIT` is saved and Garmin Connect’s *Import Data* page opens; choose the file there.
2. Connect TrainingPeaks (Settings → Apps & Devices → Garmin) and Strava to your Garmin account once. Every ride you upload to Garmin then appears in both automatically.

## Requirements

| Device | Browser |
| --- | --- |
| Android | Chrome |
| Windows | Chrome or Edge |
| iPhone / iPad | [Bluefy](https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055) (Safari has no Web Bluetooth) |

Web Bluetooth only works on `https://` pages, which is why the app is hosted on GitHub Pages. For local development use `npm start` (see below); opening `index.html` straight from disk does not work because the app is built from ES modules.

## How to ride

1. Open the app and tap **Trainer**, then pick your Zwift Hub. Tap **Click** and pick the Zwift Click (press a button on it first so it wakes up). **Heart rate** is optional.
2. Set your **FTP** under Settings.
3. Press **Ride** on a workout. Start pedalling and the clock starts.
4. Tap **Finish → Finish & save**, then **Download .FIT**.

On Android, use Chrome's menu → **Add to Home screen** to launch it like an app. The home page is split into Workouts, FTP test, Rides and Settings tabs so each fits a phone screen; the ride screens work in portrait and landscape.

## Notes

- Trainer control uses the standard Bluetooth FTMS protocol, which the Zwift Hub supports for third-party apps.
- The Zwift Click protocol is not officially published. Erg Room follows what open-source projects such as BikeControl use. If the Click connects but presses don't register, check **Settings → Click test**.
- Workouts, settings and rides live in your browser's local storage on each device. Download the `.FIT` files you want to keep.

## Development

No build step and no runtime dependencies: the browser loads the ES modules in `src/` directly. Node.js 20+ is only needed for the tests, the linter and the local server.

```sh
npm install      # dev tools only (ESLint, an XML parser for tests)
npm start        # http://localhost:8080 — Web Bluetooth works on localhost too
npm test         # unit tests (node:test)
npm run lint     # ESLint
```

Every push to `main` runs the lint and tests in GitHub Actions; the site is deployed to GitHub Pages only when they pass. Pull requests get the same checks without deploying.

### Project structure

```
index.html              markup for all screens
styles.css              all styling; colours are CSS variables with a light and a dark theme
src/
  main.js               composition root: creates devices, storage and views and wires them together
  app/
    ride-controller.js  frame loop: sensor data → ride engine → trainer and ride screen
  core/                 helpers with no browser dependencies (formatting, storage wrapper)
  data/repository.js    everything that is persisted, with a schema version for migrations
  ftp/
    protocols.js        FTP test workouts (tagged segments the analysis looks for)
    analysis.js         FTP, CP/W′, LTHR and heart-rate estimates, with quality warnings
    ramp-failure.js     detects the end of a ramp test
  workout/
    model.js            workout blocks, flattening into segments, zones, TSS/IF estimates
    zwo.js              Zwift .zwo import and export
  ride/
    engine.js           RideSession: workout clock, ERG targets, Click nudges, 1 Hz recording
    live-data.js        latest sensor readings, staleness, display smoothing
    stats.js            ride summary (Normalized Power, TSS, …)
    demo-rider.js       simulated rider for demo mode
  fit/
    fit-writer.js       generic FIT binary writer with CRCs
    activity-file.js    FIT activity file (records, one lap per workout step, session)
  ble/
    ble-device.js       Web Bluetooth base class with automatic reconnect
    ftms-trainer.js     trainer control (FTMS): ERG, simulation, Indoor Bike Data parsing
    zwift-click.js      Zwift Click button protocol
    heart-rate-monitor.js
  ui/                   one module per screen, plus the profile chart and small DOM helpers
tests/                  unit tests for everything outside src/ui and the Bluetooth plumbing
scripts/                local server and the Pages build
```

The rule of thumb: logic lives in `workout/`, `ride/`, `fit/` and the parsers in `ble/`, which never touch the DOM and are covered by tests. `ui/` modules only render state and report user actions through callbacks, and `main.js` is the only place that connects the two.
