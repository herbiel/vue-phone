# Vue JSSip Phone

A modern, compact SIP phone widget built with Vue 3 and JsSIP. It can be used as a standalone Vue application or bundled as a JS SDK for integration into any website.

## Features

- **Modern UI**: Compact, dark-themed, and responsive design.
- **Core Functionality**:
  - Voice Calls (make and receive)
  - Mute / Unmute
  - Hold / Resume
  - DTMF Keypad (in-call)
- **Advanced Features**:
  - **Call Transfer**: Blind transfer support.
  - **Call History**: Local storage persisted history (last 100 calls) with status indicators.
  - **Dialer**: Built-in keypad for dialing numbers.
  - **Agent Status**: Switch between Online, Busy (auto-reject), and Offline.
  - **ICE Configuration**: Custom STUN/TURN server support via UI or SDK config.
- **Resilient**: Auto-reconnection logic and credential persistence.

## Project Setup

### Prerequisites

- Node.js (v16+)
- A SIP account (WSS URL, Domain, Extension, Password)

### Installation

```bash
npm install
```

### Development

Run the standalone Vue app locally:

```bash
npm run dev
```

### Build

Build the project (App + SDK):

```bash
npm run build
```

Artifacts will be generated in `dist/`:
- `dist/phone-sdk.umd.js`: The SDK library.
- `dist/vue-phone.css`: The required styles.

## SDK Usage

You can use the built artifacts to embed the phone widget into any HTML page.

### 1. Include Files

```html
<link rel="stylesheet" href="./dist/vue-phone.css">
<script src="./dist/phone-sdk.umd.js"></script>
```

### 2. Initialize

Initialize the phone globally. You can also provide credentials for auto-login.

```javascript
window.PhoneSDK.init({
    id: 'phone-container', // DOM element ID to mount the widget
    // Optional: Auto-login
    user: '1001',
    password: 'your_password',
    domain: 'sip.example.com',
    socketUrl: 'wss://sip.example.com',
    // Optional: ICE Servers
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
});
```

### 3. API Methods

```javascript
// Make an outgoing call
window.PhoneSDK.makeCall('1002');
```

## Tech Stack

- **Vue 3**: Reactive UI framework.
- **JsSIP**: SIP WebSocket client.
- **TailwindCSS**: Utility-first styling.
- **Vite**: Fast build tool.
- **Lucide Vue**: Icons.

## License

MIT
