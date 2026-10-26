# Erg Room: notes for Claude

Erg Room is a browser app that replaces Zwift for structured training only: no map, no social features, no scenery. It plays ERG workouts on a Zwift Hub, takes +/− from a Zwift Click, records every ride and exports `.FIT`.

- Live: https://didierlau.github.io/erg-room/ (GitHub Pages, deployed by `.github/workflows/pages.yml`)
- Owner rides on **Android Chrome** (primary) and Windows Chrome/Edge. Garmin Connect matters most; TrainingPeaks and Strava get rides through Garmin.
- Hardware: Zwift Hub with Zwift Cog (single cog, no physical gears) and Zwift Click v1. Optional Bluetooth heart-rate strap.

## Commands

```sh
npm install     # dev tools only
npm start       # http://localhost:8080 (Web Bluetooth works on localhost)
npm test        # node:test unit tests in tests/*.test.js
npm run lint    # ESLint (flat config)
npm run build   # copies index.html, styles.css, src/ into _site/
```

Run `npm run lint && npm test` before every commit. CI runs both; Pages deploys only when they pass.

## Architecture rules

- No build step and no runtime dependencies: plain ES modules loaded by the browser. Don't add a bundler or framework.
- Logic lives in `src/workout`, `src/ride`, `src/fit`, `src/ftp`, `src/data` and the parser functions in `src/ble`. These never touch the DOM, take time (`now`, `wall`) as arguments, and have unit tests.
- `src/ui/*` only render and report user actions through callbacks. `src/main.js` is the composition root and the only place that wires devices, storage and views together. The ride frame loop lives in `src/app/ride-controller.js`; `src/app/exports.js` holds the download and Garmin hand-off.
- Ride screens are plug-ins under `src/ui/ride/<id>/screen.js`, registered in `src/ui/ride/screens.js` and chosen by the `rideScreen` setting. Each screen owns its markup (built in JS) and its stylesheet (loaded with `loadStylesheet`), implements the `RideScreen` contract in `src/ui/ride/screen.js`, and uses `src/ride/describe.js` for shared wording. Shared full-screen rules live in `styles.css` under `.ride-screen`; a screen scopes its own rules under `.ride-<id>`.
- Keyboard shortcuts (`src/ui/ride-keys.js`) and the Click are input sources: they only call the ride actions, never a screen directly. Each screen declares `click: 'nudge' | 'shift'`; the controller's `press()` dispatches accordingly.
- Virtual gears and terrain are ride logic (`src/ride/gears.js`, `src/ride/terrain.js`), used by `RideSession` in `resistance: 'gears'` mode, which sends FTMS simulation commands (terrain gradient + gear offset) instead of ERG targets. The tuning constants (`GEAR_GRADE_STEP`, `GRADE_PER_FTP`, `TERRAIN_GRADE_RANGE`) have not been validated on a real Hub yet.
- Persisted data goes through `src/data/repository.js` (localStorage, key prefix `ergroom.`). If a stored shape changes, bump `SCHEMA_VERSION` and add a migration step.
- Powers are fractions of FTP in workouts; durations are whole seconds. Segments can carry `tag` (`ramp-step`, `effort`, `stage`) for FTP tests.
- Put named constants at the top of a module instead of magic numbers, and add a JSDoc comment to each exported function.
- When fixing a bug, add a test that would have caught it.

## Protocol facts

- Trainer: Bluetooth FTMS (0x1826). Indoor Bike Data 0x2AD2, Control Point 0x2AD9: request control 0x00, start 0x07, target power 0x05, simulation 0x11. GATT writes are queued one at a time.
- Zwift Click: unofficial protocol (as used by BikeControl/SwiftControl). Service `00000001-19ca-4651-86e5-fa29dcdd09d1`, write `RideOn` to `…0003`, notifications on `…0002`. Message 0x37 is the Click keypad (field 1 plus, field 2 minus, 0 = pressed); 0x23 is the Ride keypad bitmap.
- Garmin Connect and TrainingPeaks have no upload API for personal apps (partner programs plus a server). Uploading means saving the `.FIT` and opening `https://connect.garmin.com/modern/import-data`. Don't build anything that asks for the user's Garmin password.

## Testing limits

The cloud sandbox has no Bluetooth hardware. Verify UI changes in headless Chromium (`/opt/pw-browsers/chromium`) against `npm start`, using demo mode and `page.clock` to fast-forward rides. Tell the user clearly which behaviour still needs a real ride to confirm.

## Commits

Commit as `didierlau <didier.lauwerys@outlook.com>` on `main`. After pushing, check the Actions run and the live page.
