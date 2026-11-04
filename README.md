# Universal AI Sync

A Chrome extension (Manifest V3) that copies the context of a conversation from one AI chat to another — ChatGPT, Claude, Gemini and Microsoft Copilot — so you can continue in a different assistant without re-explaining everything.

**Watch the demo:** [YouTube showcase](https://youtu.be/VIDEO_ID) <!-- TODO: replace VIDEO_ID -->
**Install it:** [Chrome Web Store](https://chromewebstore.google.com/detail/universal-ai-sync/hnfdhhaignnapkpkkhjocckiklgedaln) · [Landing page](https://www.universalaisync.com)

You don't need an account. Open two AI chats in different tabs, open the extension, choose a source and a destination, and click **Sync**.

<!-- TODO: replace with frames from the demo video -->
| Choosing source → destination | Context arriving in the destination AI |
|---|---|
| ![Popup](docs/screenshots/popup-sync-flow.png) | ![Result](docs/screenshots/destination-result.png) |

## Features

- **Text-based sync:** reads the source conversation from the page DOM, builds a clean prompt and types it into the destination chat. Long chats are split into parts sized for each platform.
- **File-based sync:** exports the whole conversation as a Markdown file and uploads it to the destination chat as an attachment.
- **Four platforms:** a scraper and an injector for each one (ChatGPT, Claude, Gemini, Copilot), plus shared DOM discovery and input-event simulation layers.
- **Survives popup close:** the MV3 service worker runs the sync and stores its progress in `chrome.storage.session`, so the popup can be closed or reopened during a sync.
- **Licensing backend (implemented, not live):** an Express + Supabase API for a freemium model. It handles PayPal subscriptions with webhooks, emails license keys through Resend, binds each key to one device and enforces a 5-hour cooldown on file sync for free users. See *Project status* below.

## Tech stack

| Layer | Tech |
|---|---|
| Extension | Vanilla JavaScript, Chrome Extension Manifest V3, Vite 8 (custom `build.mjs` that bundles each entry as an IIFE) |
| Backend | Node.js 20+, Express 4 |
| Database | Supabase (PostgreSQL) with Row Level Security; the backend uses the service-role key |
| Payments / email | PayPal Subscriptions API + webhooks, Resend |
| Hosting | Landing page on Vercel (separate repo). Backend previously on Railway (`backend/railway.json`) |

```
ai-sync-extension/   Chrome extension (popup, service worker, per-platform content scripts)
backend/             Express API: license validation, free-plan cooldown, PayPal, admin dashboard
supabase/            SQL migrations + demo seed (fake data)
```

## Project status

- **Extension: live.** It is published on the Chrome Web Store (v1.0.1). Text and file sync run entirely in the browser and do not need the backend.
- **Backend: offline.** It was deployed on Railway during development. It went offline when the Railway trial ended, and I have not redeployed it.
- **Pro plan: not connected in the published build.** The backend URL is injected at build time (`VITE_BACKEND_URL`). The v1.0.1 release was built without it, so it points to `http://localhost:3000`. As a result, the **Upgrade** button in the published extension does not work. When the backend can't be reached, the extension falls back to the free plan, so the core features are unaffected.

## Context

A personal project that I built and published on my own. It is not a class project or client work.

**Team:** solo. I designed and built the extension (UI, scraping and injection for each platform, service worker), the Express backend, the Supabase schema, and the PayPal and email integrations.

## Run locally

Requirements: Node.js 20+ and Chrome.

### Extension

```bash
cd ai-sync-extension
npm ci
npm run build        # outputs to ai-sync-extension/dist
# or: npm run dev    # rebuilds on change, with sourcemaps
```

In Chrome, go to `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and select `ai-sync-extension/dist`.

To point the popup at a deployed backend instead of `http://localhost:3000`:

```bash
VITE_BACKEND_URL=https://your-backend.example.com npm run build
```

The backend origin must also be listed in `public/manifest.json` (`host_permissions` and `externally_connectable`).

### Backend (optional, needed for licensing only)

1. Create a **separate** Supabase project for development.
2. In its SQL editor, run `supabase/migrations/001_schema.sql`, then `002_device_binding_and_cooldowns.sql`, then (optionally) `supabase/seed/demo_seed.sql`.
3. Configure and start the server:

```bash
cd backend
cp .env.example .env   # fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_SECRET
npm ci
npm run dev            # http://localhost:3000/api/health → {"ok":true}
```

The seed creates a fake Pro license, `UAIS-DEMO0000-DEMO0001` (email `demo@demo.com`). To activate it, open the popup, click **Upgrade**, then **Already have a key?**. PayPal and Resend credentials are only needed to test checkout and email delivery.

## Known limitations and next steps

- **Reconnect licensing:** redeploy the backend on a free host such as Render, build with `VITE_BACKEND_URL`, and publish v1.0.2. Until then, hide the Upgrade button.
- **Scraping depends on each site's DOM.** When ChatGPT, Claude, Gemini or Copilot change their markup, the selectors (`src/content/shared/selectorConfig.js`) have to be updated.
- **No automated tests yet.**
- **Hardcoded PayPal values:** the client ID and plan ID are hardcoded in `backend/public/checkout.html` instead of being read from configuration.
- **Weak free-plan limit:** the cooldown is keyed by a device ID that the client generates, so it is a soft limit.
- **Unfinished mirror mode:** the service worker has handlers for live "mirror" pairing, but the popup does not expose them yet.
- **Leftover template files:** `index.html`, `src/main.js`, `src/counter.js` and `vite.config.js` come from the Vite template and are not used by the build.
