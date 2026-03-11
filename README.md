# Logitech Mouse Manager

A web-based configuration tool for Logitech mice using the WebHID API and HID++ 2.0 protocol. No software installation required — runs entirely in your browser.

## Features

- **Battery Monitoring** — Real-time battery percentage and charging status with auto-refresh
- **DPI Control** — Read and set mouse DPI with preset buttons (400, 800, 1600, 3200)
- **Polling Rate Management** — Switch between 125Hz, 250Hz, 500Hz, and 1000Hz
- **Communication Log** — Debug HID++ protocol messages (toggle with `` ` `` or `~`)
- **Auto-Connect** — Automatically reconnects to a previously paired receiver without the device picker
- **Per-Device Feature Detection** — Unsupported features show a "Work in Progress" indicator

## Supported Mice

Any Logitech mouse using HID++ 2.0 over a USB receiver. Tested models:

| Mouse | DPI | Polling Rate | Battery |
|-------|-----|-------------|---------|
| G Pro X Superlight | ✅ | ✅ | ✅ |
| G Pro X Superlight 2 | ✅ | ✅ | ✅ |
| G Pro Wireless | ✅ | ✅ | ✅ |
| G502 X Lightspeed | ✅ | ✅ | ✅ |
| G502 Lightspeed | ✅ | ✅ | ✅ |
| G703 Lightspeed | ✅ | ✅ | ✅ |
| G305 / G304 | ✅ | ✅ | ✅ |
| G603 | ✅ | ✅ | ✅ |
| G903 Lightspeed | ✅ | ✅ | ✅ |
| G403 Wireless | ✅ | ✅ | ✅ |
| MX Master 3 / 3S | ✅ | — | ✅ |
| MX Anywhere 3 / 3S | ✅ | — | ✅ |
| Superstrike X2 | — | — | ✅ |

Other HID++ 2.0 mice may also work. Features vary by model.

## Usage

1. Open `index.html` in Chrome, Edge, or Opera (WebHID required)
2. Click **Connect Mouse** — if a receiver was previously paired, it connects automatically; otherwise, select your Logitech USB receiver from the picker
3. Configure DPI, polling rate, and monitor battery
4. Press `` ` `` or `~` to toggle the communication log for debugging

## Browser Requirements

Requires a browser with [WebHID API](https://developer.mozilla.org/en-US/docs/Web/API/WebHID_API) support:
- Google Chrome 89+
- Microsoft Edge 89+
- Opera 75+

## Tech Stack

- Vanilla JavaScript (ES6+)
- WebHID API
- HID++ 2.0 protocol
- No dependencies, no build step
