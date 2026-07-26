# docs/assets — Visual Assets

This directory contains images and diagrams embedded in the README and documentation.

## Architecture Diagram

`architecture.svg` — full system architecture diagram generated from the README ASCII art.
To regenerate or update it, edit the SVG directly or import it into [draw.io](https://app.diagrams.net) / [Excalidraw](https://excalidraw.com).

## Demo GIF

`demo.gif` — screen recording showing the full subscription flow:

1. Connect Freighter wallet
2. Fill the subscription form (merchant address, token, amount, interval)
3. Freighter signing popup appears
4. Success card with transaction hash

### Recording the demo GIF

**Requirements:**
- Frontend running locally (`npm run dev`)
- Freighter installed and set to **Testnet**
- A funded testnet account

**Recommended tools:**

| OS | Tool | Notes |
|----|------|-------|
| Linux | [Peek](https://github.com/phw/peek) | GIF + WebM; free |
| Linux | [Byzanz](https://github.com/GNOME/byzanz) | CLI-based GIF recorder |
| macOS | [LICEcap](https://www.cockos.com/licecap/) | Simple, free |
| macOS | QuickTime + [gifski](https://gif.ski) | High quality |
| Windows | [ScreenToGif](https://www.screentogif.com) | Free; excellent compression |

**Target specs:**
- **Resolution:** 1280×800 (or crop to the app area)
- **Frame rate:** 10–15 fps
- **Duration:** 30–60 seconds
- **File size:** < 5 MB (compress with [gifsicle](https://www.lcdf.org/gifsicle/): `gifsicle -O3 --lossy=80 demo.gif -o demo.gif`)

### Placeholder

Until the GIF is recorded, the README embeds a placeholder notice.
Replace it by placing the recorded file at `docs/assets/demo.gif` and updating the README embed.

## YouTube Walkthrough

**Planned:** a 5–10 minute video walkthrough covering:

1. Installing prerequisites (Rust, Stellar CLI, Node.js, Freighter)
2. Deploying the contract to testnet
3. Configuring `frontend/.env.local`
4. Creating the first subscription end-to-end
5. Verifying the on-chain payment via Stellar Expert

Add the YouTube URL to the README once recorded.
