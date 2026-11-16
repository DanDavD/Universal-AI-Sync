# Universal AI Sync — Cross-Platform AI Context Transfer Extension

A published Google Chrome extension (Manifest V3) that seamlessly transfers conversational context across AI chatbots—including ChatGPT, Claude, Gemini, and Microsoft Copilot—allowing developers to switch assistants without manually re-explaining their prompts.

- **Chrome Web Store:** [Install Universal AI Sync](https://chromewebstore.google.com/detail/universal-ai-sync/hnfdhhaignnapkpkkhjocckiklgedaln)
- **Live Demo Video:** [YouTube Showcase](https://youtu.be/k5hTZCVGwbI)
- **Official Website:** [universalaisync.com](https://www.universalaisync.com)
- **Author:** Daniel David ([@DanDavD](https://github.com/DanDavD))
- **Stack:** JavaScript (ES6+), Manifest V3, Vite, Node.js 20, Express, Supabase (PostgreSQL), PayPal API

---

## Why I Built This

As an engineer frequently working across multiple AI assistants at the same time—using Claude for architecture and code refactoring, ChatGPT for quick queries, Gemini for research, and Copilot for IDE completions—I constantly hit the same frustrating bottleneck:

Every time one model reached a rate limit, needed a second opinion, or excelled at a specific task, I had to manually copy, paste, format, and re-explain 10 to 20 messages of conversational background. 

I built Universal AI Sync to completely eliminate this copy-paste chore from my daily workflow:
1. Detects open AI tabs automatically.
2. Selects source and destination assistants in one click.
3. Automatically serializes conversation threads and injects them seamlessly into the target chat.

After validating the time saved in my own software and game development routines, I polished the extension, passed Google's Web Store review, and published it publicly for other developers experiencing the exact same daily friction.

---

## Technical Architecture & Core Capabilities

Universal AI Sync operates via a decoupled architecture separating client-side browser automation from an optional subscription management backend:

```text
+-------------------------------------------------------------+
|               User Presentation Layer (Popup UI)            |
|   Tab Detection · Source & Destination Picker · Sync Modes  |
+------------------------------+------------------------------+
                               | Message Passing (Runtime API)
+------------------------------v------------------------------+
|               Background Service Worker (Manifest V3)       |
|   chrome.storage.session · State Machine · Survives Closes  |
+------------------------------+------------------------------+
                               | Dispatches Content Scripts
+------------------------------v------------------------------+
|               Content Scripts (DOM Scraping & Injection)    |
|   ChatGPT  ·  Claude  ·  Gemini  ·  Microsoft Copilot       |
|   DOM Sanitization · Event Simulation · Chunked Input Flow  |
+-------------------------------------------------------------+
```

### 1. Dual Synchronization Modes
- **Text-Based Sync:** Scrapes the active conversation DOM, strips noise, formats clean prompt structures, and simulates synthetic user keystrokes into the destination input element. Long conversations are dynamically chunked to conform to each platform's input constraints.
- **File-Based Sync:** Automatically exports the complete conversational history into a structured Markdown document (`.md`) and attaches it directly into the destination chat interface.

### 2. Multi-Platform Adapters
Maintains dedicated scrapers and injectors for all four major web LLM interfaces:
- OpenAI ChatGPT
- Anthropic Claude
- Google Gemini
- Microsoft Copilot

Each adapter couples robust DOM discovery logic with simulated input-event dispatches, handling dynamic single-page application (SPA) mutations gracefully.

### 3. Background Persistence in Manifest V3
Unlike legacy extensions that abort when a popup window loses focus, Universal AI Sync delegates transfer execution to an asynchronous Manifest V3 service worker backed by `chrome.storage.session`. Users can freely close the popup or switch browser windows while multi-part context transfers execute in the background.

### 4. Modular Licensing Backend (Node.js & Supabase)
Features an optional freemium billing service:
- **API:** Node.js 20 and Express REST server.
- **Database:** Supabase (PostgreSQL) with Row-Level Security (RLS) policies.
- **Billing & Delivery:** PayPal Subscriptions API with automated webhooks and transactional license key distribution via Resend.

---

## Codebase Structure

```text
Universal-AI-Sync/
├── ai-sync-extension/         # Chrome extension client source
│   ├── src/
│   │   ├── background/        # Manifest V3 service worker and session orchestrator
│   │   ├── content/           # Per-platform scrapers, injectors, and DOM discovery
│   │   └── popup/             # Extension popup user interface and tab detector
│   ├── manifest.json          # Chrome extension Manifest V3 definition
│   └── build.mjs              # Custom Vite/Rollup build pipeline bundling IIFE entries
├── backend/                   # Express REST API for licensing and device authentication
│   ├── controllers/           # License validation and PayPal webhook listeners
│   └── routes/                # API endpoints and middleware guardrails
└── supabase/                  # PostgreSQL schema migrations and RLS security rules
```

---

## Local Development & Setup

### Running the Chrome Extension
1. Clone the repository and install dependencies:
   ```bash
   cd ai-sync-extension
   npm ci
   npm run build
   ```
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (top right toggle).
4. Click **Load unpacked** and select the generated `ai-sync-extension/dist` directory.

### Running the Backend (Optional)
```bash
cd backend
cp .env.example .env
npm ci
npm run dev
# Server running at http://localhost:3000
```

---

## Author & License

- **Developer:** Daniel David ([@DanDavD](https://github.com/DanDavD))
- **Extension Status:** Live on [Chrome Web Store](https://chromewebstore.google.com/detail/universal-ai-sync/hnfdhhaignnapkpkkhjocckiklgedaln) (v1.0.1)
- **License:** Open source under the [MIT License](LICENSE)
