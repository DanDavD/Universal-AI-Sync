# Universal AI Sync — Arquitectura y Flujo Completo del Software

---

## 1. ¿Qué es este software?

Universal AI Sync es una extensión de Chrome (Manifest V3) que actúa como un puente inteligente entre tres clientes web de inteligencia artificial: **ChatGPT** (chatgpt.com / chat.openai.com), **Claude** (claude.ai) y **Gemini** (gemini.google.com).

Tiene dos funciones principales:

- **Export Conv:** Exporta el texto completo de una conversación de una IA a otra, formateado como contexto para que la IA de destino pueda continuar desde donde quedó.
- **Export Memory:** Extrae solo los mensajes que el usuario escribió (los hechos, datos, instrucciones que dio) y los transfiere a otra IA como una memoria directa, haciendo que la IA destino los internalice como si el usuario le hubiera hablado directamente.

---

## 2. Diagrama de Arquitectura General

```
┌─────────────────────────────────────────────────────────────────┐
│                        CHROME BROWSER                           │
│                                                                 │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐    │
│  │  ChatGPT Tab │   │  Claude Tab  │   │   Gemini Tab     │    │
│  │              │   │              │   │                  │    │
│  │ ┌──────────┐ │   │ ┌──────────┐ │   │ ┌──────────────┐ │    │
│  │ │Content   │ │   │ │Content   │ │   │ │Content       │ │    │
│  │ │Script    │ │   │ │Script    │ │   │ │Script        │ │    │
│  │ │(chatgpt) │ │   │ │(claude)  │ │   │ │(gemini)      │ │    │
│  │ └────┬─────┘ │   │ └────┬─────┘ │   │ └──────┬───────┘ │    │
│  │      │Overlay│   │      │Overlay│   │        │Overlay  │    │
│  └──────┼───────┘   └──────┼───────┘   └────────┼─────────┘    │
│         │                  │                    │               │
│         └──────────────────┼────────────────────┘               │
│                            │  chrome.runtime.sendMessage        │
│                            ▼                                    │
│              ┌─────────────────────────┐                        │
│              │  Background Service     │                        │
│              │  Worker (SW)            │                        │
│              │                         │                        │
│              │  - Tab Registry         │                        │
│              │  - Transfer Pipeline    │                        │
│              │  - Progress Tracking    │                        │
│              └─────────────────────────┘                        │
│                            ▲                                    │
│                            │  chrome.runtime.sendMessage        │
│              ┌─────────────────────────┐                        │
│              │  Popup UI               │                        │
│              │  (Control Panel)        │                        │
│              └─────────────────────────┘                        │
│                                                                 │
│  ┌──────────────────────────┐                                   │
│  │  Options Page            │  (chrome.storage.local)           │
│  │  (Selector Config)       │◄──────────────────────────────┐  │
│  └──────────────────────────┘                               │  │
│                                                             │  │
│  ┌──────────────────────────────────────────────────────────┘  │
│  │  chrome.storage.session  (estado de sesión: tab registry,   │
│  │  mirror pairs, transfer status, progreso)                   │
│  └─────────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Estructura de Archivos y Responsabilidad de Cada Uno

```
ai-sync-extension/
│
├── build.mjs                        ← Orchestrador del build
├── package.json                     ← Scripts npm
├── vite.config.js                   ← Config base de Vite (referencia)
│
├── public/                          ← Archivos copiados tal cual a dist/
│   ├── manifest.json                ← Declaración MV3 de la extensión
│   ├── popup/
│   │   └── popup.html               ← HTML del panel de control
│   └── options/
│       └── options.html             ← HTML del editor de selectores
│
├── src/
│   ├── background/
│   │   └── service-worker.js        ← Router central + pipeline de transferencia
│   │
│   ├── content/
│   │   ├── shared/                  ← Código compartido entre las 3 plataformas
│   │   │   ├── parser.js            ← Convierte DOM en ConvMsg[], genera prompts
│   │   │   ├── observer.js          ← MutationObserver, waitForElement, debounce
│   │   │   ├── eventSimulator.js    ← Inyección de texto compatible con React
│   │   │   ├── selectorConfig.js    ← Selectores CSS + sistema de overrides
│   │   │   └── overlay.js           ← Panel flotante con Shadow DOM
│   │   │
│   │   ├── chatgpt/
│   │   │   ├── index.js             ← Entry point del content script de ChatGPT
│   │   │   ├── scraper.js           ← Extrae mensajes del DOM de ChatGPT
│   │   │   └── injector.js          ← Inyecta texto en el input de ChatGPT
│   │   │
│   │   ├── claude/
│   │   │   ├── index.js             ← Entry point del content script de Claude
│   │   │   ├── scraper.js           ← Extrae mensajes del DOM de Claude
│   │   │   └── injector.js          ← Inyecta texto en el editor ProseMirror
│   │   │
│   │   └── gemini/
│   │       ├── index.js             ← Entry point del content script de Gemini
│   │       ├── scraper.js           ← Extrae mensajes del DOM de Gemini
│   │       └── injector.js          ← Inyecta texto en el editor Quill
│   │
│   ├── popup/
│   │   └── popup.js                 ← Lógica del panel de control
│   │
│   └── options/
│       └── options.js               ← Lógica del editor de selectores
│
└── dist/                            ← Output del build (cargar esto en Chrome)
    ├── manifest.json
    ├── background/service-worker.js
    ├── content/chatgpt.js
    ├── content/claude.js
    ├── content/gemini.js
    ├── popup/popup.html + popup.js
    └── options/options.html + options.js
```

---

## 4. El Sistema de Build

### ¿Por qué build.mjs y no solo Vite?

Vite 8 usa internamente **Rolldown** (un reemplazo de Rollup escrito en Rust) que tiene una limitación: no permite múltiples entry points cuando el formato de salida es `IIFE`.

Los content scripts de Chrome necesitan ser formato `IIFE` (Immediately Invoked Function Expression) porque cada uno se inyecta como un archivo independiente y auto-contenido. No pueden usar ES modules nativos en la página.

**La solución:** `build.mjs` llama a `vite.build()` una vez por cada archivo, con un único entry point cada vez. Eso evita el conflicto de Rolldown.

```
node build.mjs
│
├── 1. Limpia dist/ y copia public/ → dist/  (manifest.json, HTMLs, etc.)
├── 2. Construye background/service-worker.js como IIFE
├── 3. Construye content/chatgpt.js como IIFE
├── 4. Construye content/claude.js como IIFE
├── 5. Construye content/gemini.js como IIFE
├── 6. Construye popup/popup.js como IIFE
└── 7. Construye options/options.js como IIFE
```

Cada bundle IIFE es completamente auto-contenido: el código de `shared/` (parser, observer, eventSimulator, etc.) se **inlinea** dentro de cada bundle. Esto significa que cada content script es un archivo independiente que no depende de nada externo.

### ¿Qué es publicDir: false?

Sin este flag, Vite copia la carpeta `public/` dentro de CADA directorio de output (`dist/background/`, `dist/content/`, etc.), contaminando la estructura. Con `publicDir: false` en cada llamada individual a `build()`, la copia de `public/` solo ocurre una vez, al inicio del script.

---

## 5. Manifest V3 — La Declaración de la Extensión

El archivo `public/manifest.json` es el documento de identidad de la extensión. Chrome lo lee para saber qué permisos necesita, qué scripts inyectar y dónde.

### Permisos críticos:

```json
"permissions": ["storage", "tabs", "scripting", "activeTab"]
```

- **storage:** Permite usar `chrome.storage.session` (RAM de sesión) y `chrome.storage.local` (persistente). Sin esto no hay estado.
- **tabs:** Permite consultar qué tabs están abiertas, sus URLs y títulos. El popup lo usa para listar las tabs de IA. También permite enviar mensajes a tabs específicas.
- **scripting:** Permite ejecutar scripts en tabs específicas (usado por el background para comunicarse con los content scripts).
- **activeTab:** Acceso temporal a la tab activa cuando el usuario interactúa con el popup.

### Host Permissions:

```json
"host_permissions": [
  "https://chat.openai.com/*",
  "https://chatgpt.com/*",
  "https://claude.ai/*",
  "https://gemini.google.com/*"
]
```

Sin estas entradas, Chrome bloquea cualquier comunicación o inyección en esos dominios. **Nota importante:** ChatGPT migró de `chat.openai.com` a `chatgpt.com` en 2024, por eso aparecen los dos.

### Content Scripts:

```json
"content_scripts": [
  {
    "matches": ["https://chatgpt.com/*", "https://chat.openai.com/*"],
    "js": ["content/chatgpt.js"],
    "run_at": "document_idle"
  }
]
```

`run_at: "document_idle"` significa que el script se inyecta después de que el HTML esté parseado pero antes de que todas las imágenes y recursos carguen. Es el momento ideal para una SPA (Single Page Application) como ChatGPT.

---

## 6. El Background Service Worker — El Cerebro

### ¿Qué es un Service Worker en MV3?

Es un script que corre en segundo plano, sin acceso al DOM de ninguna página. En Manifest V3, reemplaza las "background pages" de MV2. La diferencia crítica: **es efímero**. Chrome lo puede matar después de 30 segundos de inactividad y reiniciarlo cuando llega un nuevo mensaje. Cada vez que se reinicia, **pierde toda su memoria RAM**.

### Cómo manejamos el estado efímero

Todo el estado importante se guarda en `chrome.storage.session`:

```
chrome.storage.session
├── tabRegistry: { "1234": "chatgpt", "5678": "claude", ... }
├── mirrorPairs: { "1234": 5678, "5678": 1234 }        (bidireccional)
└── transferStatus: { phase: "injecting", message: "...", pct: 75 }
```

**Cada función del SW empieza con `await loadState()`** que reconstruye los Maps en memoria desde storage. Esto asegura consistencia sin importar cuántas veces se haya reiniciado el SW.

### El Tab Registry

Cuando un content script se carga en una tab de ChatGPT, Claude o Gemini, lo primero que hace es registrarse:

```
Content Script → SW: { type: "REGISTER_TAB", platform: "claude" }
SW → Content Script: { ok: true, tabId: 5678 }
```

El SW guarda `tabRegistry.set(5678, "claude")` y lo persiste. El popup consulta este registry para saber qué tabs son "AI tabs" y mostrarlas en la lista.

### El Router de Mensajes

Todos los mensajes pasan por `dispatch()`:

```
REGISTER_TAB       → registerTab()
UNREGISTER_TAB     → unregisterTab()
SET_MIRROR_PAIR    → setMirrorPair()
REMOVE_MIRROR_PAIR → removeMirrorPair()
EXPORT_CONVERSATION→ exportConversation()
TRANSFER_MEMORY    → transferMemory()   ← el más importante
GET_STATE          → getState()
```

### El Pipeline de Transferencia de Memoria (transferMemory)

Esta función es el corazón del software. Se ejecuta **completamente en el SW**, no en el popup, por eso sobrevive si el usuario cierra el popup o cambia de tab.

```
Paso 1: setProgress("scraping", "Reading source tab...", 15%)
        ↓
Paso 2: chrome.tabs.sendMessage(sourceTabId, { type: "SCRAPE_CONVERSATION" })
        ← Content script del tab origen raspa el DOM y devuelve ConvMsg[]
        ↓
Paso 3: Filtra solo mensajes con role === "user" (los que el humano escribió)
        Verifica que haya al menos 1
        ↓
Paso 4: setProgress("building", "Building prompt from N memories...", 45%)
        Espera 250ms para que el usuario vea el label antes de continuar
        ↓
Paso 5: setProgress("injecting", "Injecting N memories into target...", 75%)
        chrome.tabs.sendMessage(destTabId, { type: "INJECT_MEMORY", conversation })
        ← Content script del tab destino inyecta el prompt y lo envía
        ↓
Paso 6: setProgress("done", "N memories transferred — AI is processing", 100%)
```

En cada paso, `setProgress()` hace dos cosas:
1. Escribe en `chrome.storage.session` (para que el popup pueda leerlo al abrirse)
2. Intenta enviar `TRANSFER_PROGRESS` al popup si está abierto (best-effort, falla silenciosamente si está cerrado)

---

## 7. Los Content Scripts — Los Ojos y Manos

Cada content script tiene tres responsabilidades: **ver** (scraper), **actuar** (injector) y **mostrarse** (overlay).

### Ciclo de vida de un Content Script

```
Chrome carga la tab de ChatGPT
        ↓
Chrome inyecta content/chatgpt.js automáticamente (declarado en manifest.json)
        ↓
init() se ejecuta:
  1. Carga selectores CSS desde storage.local (o usa defaults)
  2. Registra la tab con el SW → obtiene tabId
  3. Crea el overlay (el panel flotante)
  4. Registra el listener para mensajes del SW
        ↓
El content script queda "escuchando" mensajes del SW
        ↓
Cuando el usuario cambia de página dentro de la SPA:
  → beforeunload dispara UNREGISTER_TAB al SW
```

### 7.1. El Scraper

El scraper busca los elementos del DOM que representan mensajes y extrae su texto.

**Estrategia de extracción de texto: `innerText`**

No usamos `textContent` ni selectores específicos de hijos. Usamos `node.innerText` directamente en el contenedor de cada mensaje.

¿Por qué? Porque `innerText`:
- Respeta la visibilidad CSS (ignora elementos ocultos)
- Captura TODO el texto visible: párrafos, listas, **bloques de código** (los "copy boxes")
- No requiere conocer los selectores internos del mensaje, que cambian frecuentemente

**Estrategia de detección de rol (usuario vs asistente):**

NO miramos atributos del nodo para determinar si es un mensaje de usuario o asistente. En cambio, usamos dos queries separadas:
- `queryAll(sel.userMessages)` → estos son de `role: "user"` por definición
- `queryAll(sel.assistantMessages)` → estos son de `role: "assistant"` por definición

Luego los mezclamos y ordenamos por posición en el DOM para reconstruir el orden cronológico.

```javascript
// Todos los nodos pre-etiquetados con su rol
const tagged = [
  ...userNodes.map(n => ({ node: n, role: "user" })),
  ...assistantNodes.map(n => ({ node: n, role: "assistant" })),
].sort((a, b) => /* orden DOM */ )
```

Esto es más robusto que leer atributos como `data-testid="human-turn"` porque esos atributos cambian con cada deploy de la plataforma.

### 7.2. El Injector — El Desafío de React

Inyectar texto en un input de React parece simple pero no lo es. El problema:

**React mantiene un registro interno del valor de cada input.** Cuando haces `input.value = "texto"`, React no se entera porque su sistema de eventos sintéticos no detecta ese cambio. En el próximo render, React sobreescribe el valor con el que tenía registrado internamente.

**La solución para `<input>` y `<textarea>`:**

```javascript
// Obtenemos el setter NATIVO de la propiedad value, antes de que React lo pueda envolver
const nativeInputSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype, 'value'
).set

// Lo usamos para escribir directamente en el elemento
nativeInputSetter.call(inputElement, "el texto a inyectar")

// Luego disparamos un evento nativo que React SÍ detecta porque escucha en el documento
inputElement.dispatchEvent(new Event('input', { bubbles: true }))
inputElement.dispatchEvent(new Event('change', { bubbles: true }))
```

**La solución para `contenteditable` (ProseMirror, Quill):**

ChatGPT, Claude y Gemini usan editores ricos basados en `div[contenteditable="true"]`, no `<textarea>`. ProseMirror (Claude, ChatGPT) y Quill (Gemini) tienen su propio modelo interno de documento.

La técnica correcta es `document.execCommand('insertText')`:

```javascript
element.focus()

// Seleccionar todo el contenido existente
const range = document.createRange()
range.selectNodeContents(element)
window.getSelection().removeAllRanges()
window.getSelection().addRange(range)

// insertText dispara un InputEvent "trusted" que ProseMirror y Quill
// interceptan para actualizar su estado interno
document.execCommand('insertText', false, "el texto a inyectar")
```

`execCommand('insertText')` genera un `InputEvent` con `inputType: "insertText"` que es indistinguible de lo que genera el usuario tecleando. Es la única forma de que ProseMirror actualice su árbol de documentos interno.

Si `execCommand` falla (en algunos contextos de sandbox), hay un fallback que setea `textContent` directamente y dispara un `InputEvent` sintético.

### 7.3. El Overlay — Shadow DOM

Cada content script inyecta un panel flotante en la esquina inferior derecha de la página con dos botones: "Export conv" y "Export memory".

**¿Por qué Shadow DOM?**

Las páginas de ChatGPT, Claude y Gemini tienen sus propios estilos CSS que podrían afectar nuestro panel (o viceversa). El Shadow DOM crea un sub-árbol del DOM completamente aislado:
- Los estilos de la página no penetran el Shadow DOM
- Los estilos del Shadow DOM no afectan la página
- JavaScript de la página no puede acceder al Shadow DOM (usamos `mode: 'closed'`)

```javascript
const host = document.createElement('div')
host.id = 'ai-sync-host'
const shadow = host.attachShadow({ mode: 'closed' })  // aislado completamente
// Todo el HTML y CSS del panel va dentro de shadow, no del documento principal
```

---

## 8. El Sistema de Selectores CSS

### ¿Por qué los selectores pueden fallar?

ChatGPT, Claude y Gemini son SPAs (Single Page Applications) actualizadas constantemente. Sus equipos de ingeniería cambian nombres de clases, atributos y estructura del DOM en cada deploy. Lo que funciona hoy puede no funcionar mañana.

### La solución: Cadenas de selectores con fallbacks

Cada selector soporta múltiples alternativas separadas por coma, probadas en orden:

```javascript
claude: {
  userMessages: '[data-testid="human-turn"], [data-testid="user-message"], ' +
                '.human-turn, [class*="humanTurn"], [class*="HumanTurn"]',
  // Si el primero no encuentra nada, prueba el segundo, y así...
}
```

### La función queryAll

```javascript
export function queryAll(selectors, root = document) {
  const seen = new Set()
  const results = []
  for (const sel of selectors.split(',').map(s => s.trim())) {
    try {
      for (const el of root.querySelectorAll(sel)) {
        if (!seen.has(el)) { seen.add(el); results.push(el) }
      }
    } catch { /* selector inválido (escrito por el usuario en Options) — ignorar */ }
  }
  return results
}
```

El `Set` evita duplicados cuando múltiples selectores en la cadena matchean el mismo elemento.

### Overrides del usuario (Options Page)

Los selectores se guardan en `chrome.storage.local` bajo la clave `selectorConfig`. Los content scripts los cargan en `init()` y los mergean sobre los defaults:

```javascript
// En loadSelectors():
const config = data.selectorConfig ?? {}
const overrides = config[platform] ?? {}
return { ...DEFAULT_SELECTORS[platform], ...overrides }
// Los overrides del usuario siempre ganan sobre los defaults del código
```

Si los selectores del código dejan de funcionar (porque la plataforma actualizó su DOM), el usuario puede ir a Options, inspeccionar el DOM con DevTools, encontrar el selector correcto y pegarlo ahí. **No requiere rebuild de la extensión.**

---

## 9. Flujo Completo: Export Memory (el más importante)

Vamos paso a paso con todos los actores involucrados:

```
USUARIO
  │
  │  1. Abre el popup (clic en el ícono de la extensión)
  ▼
POPUP (popup.js)
  │
  │  2. Al cargar, envía GET_STATE al SW
  │     Recibe: { tabRegistry: {...}, mirrorPairs: {...} }
  │
  │  3. Consulta chrome.tabs.query() para tabs de IA
  │     Filtra solo las que están en el tabRegistry
  │
  │  4. Renderiza la lista de tabs
  │     Gemini (verde si destino, azul si origen)
  │     Claude  (azul si origen, verde si destino)
  │
  │  5. Usuario hace clic en tab origen → selectedSource = tabId_gemini
  │     Usuario hace clic en tab destino → selectedDest = tabId_claude
  │     Los botones "Export Conv" y "Export Memory" se habilitan
  │
  │  6. Usuario hace clic en "🧠 Export Memory"
  │
  │  7. popup.js envía al SW:
  │     { type: "TRANSFER_MEMORY", sourceTabId: X, destTabId: Y }
  │
  │  8. Popup muestra barra de progreso (5%)
  │
  │  EL POPUP PUEDE CERRARSE AQUÍ. EL SW CONTINÚA INDEPENDIENTEMENTE.
  │
  ▼
BACKGROUND SERVICE WORKER (service-worker.js → transferMemory())
  │
  │  9. setProgress("scraping", "Reading source tab...", 15%)
  │     → Escribe en storage.session
  │     → Intenta push al popup (puede que ya esté cerrado, no importa)
  │
  │  10. Envía a la tab de Gemini:
  │      chrome.tabs.sendMessage(sourceTabId, { type: "SCRAPE_CONVERSATION" })
  │
  ▼
CONTENT SCRIPT DE GEMINI (gemini/index.js)
  │
  │  11. Recibe el mensaje SCRAPE_CONVERSATION
  │  12. Llama a scrapeConversation(sel)
  │
  ▼
GEMINI SCRAPER (gemini/scraper.js)
  │
  │  13. queryAll(sel.userMessages) → busca "user-query, .user-query-bubble-container"
  │      Encuentra: [div_msg1_usuario, div_msg2_usuario, ...]
  │
  │  14. queryAll(sel.assistantMessages) → busca "model-response, message-content"
  │      Encuentra: [div_resp1_gemini, div_resp2_gemini, ...]
  │
  │  15. Pre-etiqueta cada nodo con su rol y ordena por posición DOM:
  │      [
  │        { node: div_msg1, role: "user" },
  │        { node: div_resp1, role: "assistant" },
  │        { node: div_msg2, role: "user" },
  │        ...
  │      ]
  │
  │  16. Para cada nodo: node.innerText → texto completo visible
  │      Construye ConvMsg[]:
  │      [
  │        { role: "user", text: "recuerda estos 3 numeros: 1, 8, 10", id: "a3f2" },
  │        { role: "assistant", text: "oki", id: "b7d1" },
  │        ...
  │      ]
  │
  │  17. Devuelve: { ok: true, conversation: ConvMsg[] }
  │
  ▼
BACKGROUND SERVICE WORKER (continúa en transferMemory())
  │
  │  18. Recibe la conversación
  │  19. Filtra: userMsgs = conversation.filter(m => m.role === "user")
  │      userCount = 3  (solo los mensajes que el humano escribió)
  │
  │  20. setProgress("building", "Building prompt from 3 memories...", 45%)
  │      Espera 250ms
  │
  │  21. setProgress("injecting", "Injecting 3 memories into target...", 75%)
  │
  │  22. Envía a la tab de Claude:
  │      chrome.tabs.sendMessage(destTabId, {
  │        type: "INJECT_MEMORY",
  │        conversation: ConvMsg[]  // la conversación completa, el injector filtra
  │      })
  │
  ▼
CONTENT SCRIPT DE CLAUDE (claude/index.js)
  │
  │  23. Recibe INJECT_MEMORY
  │  24. Llama a injectMemory(msg.conversation, sel)
  │
  ▼
CLAUDE INJECTOR (claude/injector.js → injectMemory())
  │
  │  25. Llama a buildMemoryPrompt(conversation) desde parser.js
  │
  ▼
PARSER (shared/parser.js → buildMemoryPrompt())
  │
  │  26. Filtra solo mensajes de role === "user":
  │      ["recuerda estos 3 numeros: 1, 8, 10", ...]
  │
  │  27. Construye el prompt de memoria:
  │      "I need you to remember the following information.
  │       I previously shared this with another AI assistant
  │       and I want you to have the same knowledge. Treat
  │       each item below as if I had told it to you directly:
  │
  │       --- MEMORY TRANSFER START ---
  │       1. recuerda estos 3 numeros: 1, 8, 10
  │       2. [siguiente mensaje del usuario]
  │       --- MEMORY TRANSFER END ---
  │
  │       Please confirm you have read and memorized this
  │       information by briefly listing the key facts."
  │
  │  28. Devuelve el string del prompt
  │
  ▼
CLAUDE INJECTOR (continúa → injectText())
  │
  │  29. queryFirst(sel.input) → busca ".ProseMirror[contenteditable='true']"
  │      Obtiene el div del editor de Claude
  │
  │  30. queryFirst(sel.submitBtn) → busca el botón de enviar
  │
  │  31. Llama a injectAndSubmit(inputEl, submitEl, prompt, { autoSubmit: true })
  │
  ▼
EVENT SIMULATOR (shared/eventSimulator.js → injectAndSubmit())
  │
  │  32. inputEl.scrollIntoView()
  │  33. inputEl.focus()
  │  34. Espera 60ms
  │
  │  35. Como inputEl.isContentEditable === true → llama setContentEditable()
  │      a. Selecciona todo el contenido del editor
  │      b. document.execCommand('insertText', false, promptText)
  │         → ProseMirror detecta el InputEvent y actualiza su estado interno
  │         → El texto aparece en el editor de Claude
  │
  │  36. Espera 120ms
  │
  │  37. autoSubmit === true → clickElement(submitBtn)
  │      a. dispatchEvent(mousedown)
  │      b. dispatchEvent(mouseup)
  │      c. btn.click()
  │      → Claude recibe el prompt y empieza a procesarlo
  │
  ▼
CLAUDE (la IA)
  │
  │  38. Lee el prompt de memoria
  │  39. Responde confirmando qué información memorizó:
  │      "He leído y memorizado la siguiente información:
  │       - Los números 1, 8 y 10
  │       [...]"
  │
  ▼
BACKGROUND SERVICE WORKER (recibe respuesta del injector)
  │
  │  40. setProgress("done", "3 memories transferred — AI is processing", 100%)
  │
  ▼
POPUP (si está abierto) o STORAGE (si está cerrado)
  │
  │  41. La barra de progreso llega al 100% y se pone verde
  │  42. Después de 4 segundos, la barra desaparece
  │  43. El overlay en la tab de Claude muestra: "Memory transferred — AI is processing"
```

---

## 10. Flujo Completo: Export Conv

Más simple que Export Memory porque solo transfiere el contexto de la conversación sin auto-submit:

```
1. Usuario selecciona tab origen y tab destino en el popup
2. Clic en "↗ Export Conv"
3. popup.js envía SCRAPE_CONVERSATION a la tab origen
4. El content script scraper extrae ConvMsg[] con TODOS los mensajes (user + assistant)
5. popup.js envía EXPORT_CONVERSATION al SW con la conversación y destTabId
6. SW verifica que destTabId esté en el registry
7. SW envía INJECT_CONVERSATION a la tab destino
8. El injector de destino llama a buildContextPrompt(conversation):
   "[Conversation context — please continue from where this left off]
   ---
   Human: [mensaje 1]
   Assistant: [respuesta 1]
   Human: [mensaje 2]
   ...
   ---
   Assistant:"
9. El texto se inyecta en el input de la IA destino (SIN auto-submit)
10. El usuario puede revisar/editar el prompt antes de enviarlo manualmente
```

La diferencia clave con Export Memory:
- Export Conv incluye los mensajes del asistente (toda la conversación)
- Export Memory solo incluye los del usuario (los hechos que el humano compartió)
- Export Conv NO hace auto-submit (el usuario lo revisa y envía)
- Export Memory SÍ hace auto-submit (para que la IA confirme la memoria inmediatamente)

---

## 11. El Popup — Panel de Control

El popup es una página HTML pequeña que vive dentro de la extensión. Se abre cuando el usuario hace clic en el ícono de la extensión en la barra de Chrome.

**Ciclo de vida del popup:**
- Se destruye cada vez que pierde foco (el usuario cambia de tab o hace clic fuera)
- Se recrea desde cero cada vez que el usuario lo abre
- Por eso, al abrirse, primero lee el estado de `chrome.storage.session` (tabRegistry, transferStatus)

**Lógica de selección de tabs:**
```
Primer clic en una tab  → se marca como SOURCE (azul) — de aquí se extrae
Segundo clic en otra tab → se marca como DEST (verde) — aquí se inyecta
Clic en cualquier otra tab → resetea, esa es la nueva SOURCE
```

**La barra de progreso:**
- Se muestra solo durante una transferencia activa
- Se alimenta de mensajes `TRANSFER_PROGRESS` del SW (si el popup está abierto)
- Al abrirse, restaura el estado actual desde `chrome.storage.session.transferStatus`
- Cambia de color: morado (en proceso) → verde (éxito) → rojo (error)
- Auto-desaparece a los 4 segundos de terminar

---

## 12. La Options Page — Editor de Selectores

Accesible desde el link "⚙ Options" en el popup.

Permite al usuario actualizar los selectores CSS para cada plataforma sin necesidad de rebuild. Es la válvula de escape cuando una plataforma actualiza su DOM y los selectores del código dejan de funcionar.

**Flujo de guardado:**
1. Usuario cambia el selector en el campo de texto
2. Clic en "Save"
3. `options.js` lee todos los campos del formulario como un objeto
4. Llama a `saveSelectors(platform, partial)` que hace merge con los valores actuales en storage
5. El próximo `SCRAPE_CONVERSATION` que ejecute ese content script cargará los nuevos selectores

**Flujo de reset:**
1. Clic en "Reset to defaults"
2. `options.js` escribe `DEFAULT_SELECTORS[platform]` en storage
3. Los campos del formulario se actualizan visualmente

---

## 13. Comunicación entre Componentes — Mapa de Mensajes

```
Dirección               Mensaje                    Propósito
─────────────────────────────────────────────────────────────────
Content → SW            REGISTER_TAB               Registrar tab al cargar
Content → SW            UNREGISTER_TAB             Limpiar al cerrar tab
Popup → SW              GET_STATE                  Obtener tabRegistry y mirrorPairs
Popup → SW              TRANSFER_MEMORY            Iniciar transferencia de memoria
Popup → SW              EXPORT_CONVERSATION        Inyectar conversación completa
SW → Content            SCRAPE_CONVERSATION        Pedir al content script que raspe el DOM
SW → Content            INJECT_MEMORY              Inyectar prompt de memoria + submit
SW → Content            INJECT_CONVERSATION        Inyectar contexto de conversación
SW → Popup              TRANSFER_PROGRESS          Actualizar barra de progreso en tiempo real
```

Todos los mensajes son asíncronos y usan el patrón:
```javascript
// Emisor
const response = await chrome.runtime.sendMessage({ type: "...", ...data })

// Receptor (siempre retorna true para mantener el canal abierto)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  ;(async () => {
    const result = await handleMessage(msg)
    sendResponse(result)
  })()
  return true  // ← CRÍTICO: sin esto el canal se cierra antes de la respuesta async
})
```

---

## 14. Puntos Críticos que Pueden Fallar

### 14.1. Los selectores CSS quedan obsoletos
**Síntoma:** "Nothing scraped from source tab" o "No user messages found"
**Causa:** La plataforma actualizó su DOM
**Fix:** Usar DevTools → Inspect en un mensaje → copiar el selector → pegarlo en Options Page

### 14.2. El content script no se inyecta
**Síntoma:** La tab no aparece en el popup
**Causa posible 1:** La tab estaba abierta antes de instalar/recargar la extensión
**Fix:** Hard-refresh de la tab (`Ctrl+Shift+R`)
**Causa posible 2:** La URL no coincide con las declaradas en manifest.json
**Fix:** Verificar que sea `chatgpt.com` y no `chat.openai.com` u otra URL

### 14.3. La inyección no dispara el estado de React
**Síntoma:** El texto aparece en el input pero el botón de enviar está deshabilitado
**Causa:** El editor no detectó el cambio y React no actualizó el estado de "hay texto"
**Fix:** El EventSimulator ya maneja esto con el native setter + InputEvent, pero si falla, puede ser que la plataforma haya actualizado su versión de React con cambios en el reconciler

### 14.4. El Service Worker se cae a mitad de una transferencia
**Síntoma:** La transferencia no completa
**Causa:** Chrome mató el SW por inactividad (30s timeout)
**Mitigación:** El pipeline de `transferMemory` es rápido (< 10 segundos), por lo que en condiciones normales termina antes del timeout

### 14.5. El popup se cierra antes de ver el resultado
**No es un bug**, es el comportamiento esperado. El SW almacena el estado en `chrome.storage.session.transferStatus`. Al reabrir el popup, el estado se restaura automáticamente y la barra de progreso muestra el último estado.

---

## 15. Cómo Agregar una Nueva Plataforma

Si se quisiera agregar soporte para, por ejemplo, **Perplexity** (perplexity.ai):

1. **manifest.json:** Agregar `"https://www.perplexity.ai/*"` a `host_permissions` y un nuevo entry en `content_scripts`

2. **selectorConfig.js:** Agregar un entry `perplexity: { ... }` en `DEFAULT_SELECTORS` con los selectores correctos

3. **Crear src/content/perplexity/:**
   - `scraper.js` (copia de claude/scraper.js, ajustar selectores)
   - `injector.js` (verificar qué editor usa: ProseMirror, Quill, textarea nativa)
   - `index.js` (copia de claude/index.js, cambiar `PLATFORM = 'perplexity'`)

4. **build.mjs:** Agregar la entrada:
   ```javascript
   ['content', 'perplexity.js', 'src/content/perplexity/index.js'],
   ```

5. **popup.js:** Agregar `'https://www.perplexity.ai/*'` al array `patterns` en `getAiTabs()`

6. **options.html:** Agregar el formulario de selectores para Perplexity

7. `npm run build` → recargar extensión

---

## 16. Stack Tecnológico Resumido

| Componente | Tecnología | Por qué |
|---|---|---|
| Bundler | Vite 8 + Rolldown | Build rápido, soporte ES2022 |
| Build orchestrator | Node.js ESM script (build.mjs) | Rolldown no soporta multi-entry IIFE |
| Output format | IIFE | Requerido para content scripts MV3 |
| Lenguaje | JavaScript + JSDoc | Tipos sin compilador TypeScript separado |
| Estado de sesión | chrome.storage.session | Persiste entre SW restarts, se limpia al cerrar el browser |
| Estado permanente | chrome.storage.local | Solo para overrides de selectores del usuario |
| UI del overlay | Shadow DOM (closed mode) | Aislamiento total de estilos de la plataforma host |
| Inyección en React | Native prototype setter + execCommand | Lo único que activa el reconciler de React confiablemente |
| Comunicación | chrome.runtime.sendMessage | Canal nativo de la extensión |
