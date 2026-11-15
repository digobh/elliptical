# Elliptical Circuits (proof of concept)

A web app that plays circuit workouts on a ProForm elliptical. It connects over Bluetooth and
**changes the machine's resistance automatically** as the circuit moves from one segment to the next.

- 6 built-in circuits: Quick Sync Test, Rolling Hills, HIIT 30/30, Pyramid, Tabata, Endurance Climb
- Live metrics: strides/min (with target), watts, speed, heart rate, distance, kcal
- Manual −/+ override for the current segment, plus a global difficulty slider (60–140 %)
- Audio cues (3-2-1 countdown + segment change), screen kept awake while riding
- **Simulator mode**, so you can develop and demo without the machine

**Live app:** https://digobh.github.io/elliptical/ (open in Chrome on Android, or **Bluefy** on iPhone/iPad)

## Run it locally

```bash
npm start          # → http://localhost:8080 (no dependencies to install)
npm test           # protocol + workout-engine unit tests
```

Web Bluetooth needs a **secure context**. `http://localhost` counts as one. To use a phone or tablet on
the machine, host the folder over HTTPS (for example with GitHub Pages) and open it in:

| Device | Browser |
|---|---|
| Android | Chrome |
| Windows / macOS / ChromeOS | Chrome or Edge |
| iPhone / iPad | **Bluefy** (Safari has no Web Bluetooth) |

## How the machine is controlled

The app uses the standard Bluetooth **FTMS** (Fitness Machine Service, `0x1826`) profile:

1. Reads *Supported Resistance Level Range* (`0x2AD6`), so circuits adapt to machines with levels 1–22, 1–24, 1–26 and so on.
2. Subscribes to *Cross Trainer Data* (`0x2ACE`), or *Indoor Bike Data* (`0x2AD2`) as a fallback, for live metrics.
3. On the *Control Point* (`0x2AD9`): **Request Control** → **Start**, then **Set Target Resistance Level** (`0x04`)
   at every segment change. Each write waits for the machine's acknowledgement, and the result is shown in the connection log.

Circuits store intensity as **% of the machine's range** (see `src/workout/circuits.js`). The engine converts it
to a real level.

### ProForm Endurance 420E and other iFit "I_EL" ellipticals

These consoles use iFit's own Bluetooth protocol (service `00001533-1412-efde-1523-785feabcd123`),
not FTMS. The app includes an **iFit driver** (`src/ble/ifit-*.js`) ported from the open-source
[QZ / qdomyos-zwift](https://github.com/cagnulein/qdomyos-zwift) project (GPL-3.0). It is QZ's default
`I_EL` variant: a 28-step console start-up, a 200 ms keep-alive poll, and resistance levels 1–20.

- Tap **Connect via Bluetooth** and pick **I_EL**. The driver is chosen automatically from the services the device exposes.
- Start-up takes about 12 seconds. Then resistance changes reach the console within about 1 second of each segment change.
- Live data from the console: cadence, speed and the console's own resistance level. Watts and heart rate aren't decoded yet.
- Troubleshooting: tick *Advanced → Log raw Bluetooth data*, reproduce the problem, then use *Copy log*.

### If your ProForm does not show up / ignores resistance

ProForm/iFit models differ:

- **Newer iFit models** often expose FTMS directly. They appear in the Bluetooth picker. Run *Quick Sync Test* first.
- **Older iFit models** use a proprietary Bluetooth protocol and don't advertise FTMS. The practical route is the
  open-source **QZ (qdomyos-zwift)** app. It speaks the ProForm protocol and re-broadcasts the machine as a standard FTMS
  device, which this app can then connect to.
- If it connects but resistance doesn't change, open *Advanced* and try the `uint8` / `sint16` command format.
- Only one app can control the machine at a time. Close iFit (or QZ's own control) on other devices.

## License

GPL-3.0 (see `LICENSE`). The iFit protocol code is derived from QZ (GPL-3.0).

## Code map

```
src/
  ble/ftms-parse.js     pure FTMS encode/decode (unit-tested)
  ble/connect.js        device picker, chooses the FTMS or iFit driver
  ble/ftms-device.js    FTMS over Web Bluetooth, command queue, ack handling
  ble/ifit-protocol.js  iFit I_EL packets + parsing (unit-tested against QZ)
  ble/ifit-device.js    iFit driver: init sequence, keep-alive poll, resistance
  ble/inspector.js      lists any device's services (diagnostics)
  ble/simulator.js      fake elliptical with the same interface
  workout/circuits.js   circuit definitions + %→level mapping
  workout/engine.js     clock, segments, pause/skip/nudge, pushes resistance
  ui/profile-chart.js   SVG circuit profile with playhead
  main.js               UI wiring + telemetry bus for the 3D phase
```

The machine interface is small (`connect`, `setResistance`, `range`, `data` events). Another backend, such as a
direct ProForm-protocol driver, can be added later without touching the rest of the app.

See [docs/ROADMAP.md](docs/ROADMAP.md) for the 3D virtual-world phase.
