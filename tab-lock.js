const TAB_LOCK_CHANNEL_NAME = "sgd-tab-lock";
const tabId = crypto.randomUUID();
let tabLockChannel = null;
let isBlocked = false;
let recheckInterval = null;
let onFirstUnblock = null;

// onReady se ejecuta UNA sola vez, cuando se confirma que esta es la unica
// pestana activa (de inmediato si nadie mas responde, o mas tarde si al
// principio habia otra pestana y esta se cierra). El resto de la pagina
// (menu, contenido) debe esperar a este callback en vez de dibujarse antes
// de saber si hay otra pestana abierta -- eso era lo que dejaba una ventana
// de tiempo donde una segunda pestana quedaba usable antes de bloquearse.
function initTabLock(onReady) {
  onFirstUnblock = onReady;
  tabLockChannel = new BroadcastChannel(TAB_LOCK_CHANNEL_NAME);
  injectBlockOverlay();

  tabLockChannel.onmessage = (event) => {
    const msg = event.data;
    if (!msg || msg.tabId === tabId) return;

    if (msg.type === "ping" && !isBlocked) {
      tabLockChannel.postMessage({ type: "pong", tabId });
    }

    if (msg.type === "closing" && isBlocked) {
      checkForOtherTabs();
    }

    if (msg.type === "activity") {
      resetIdleTimerFromBroadcast();
    }
  };

  window.addEventListener("beforeunload", () => {
    tabLockChannel.postMessage({ type: "closing", tabId });
  });

  checkForOtherTabs();

  recheckInterval = setInterval(() => {
    if (isBlocked) checkForOtherTabs();
  }, 3000);
}

function checkForOtherTabs() {
  let gotResponse = false;

  const handler = (event) => {
    if (event.data?.type === "pong" && event.data.tabId !== tabId) {
      gotResponse = true;
    }
  };

  tabLockChannel.addEventListener("message", handler);
  tabLockChannel.postMessage({ type: "ping", tabId });

  setTimeout(() => {
    tabLockChannel.removeEventListener("message", handler);
    setBlocked(gotResponse);

    if (!gotResponse && onFirstUnblock) {
      const cb = onFirstUnblock;
      onFirstUnblock = null;
      cb();
    }
  }, 900);
}

function setBlocked(blocked) {
  isBlocked = blocked;
  const overlay = document.getElementById("tabLockOverlay");
  if (overlay) overlay.classList.toggle("hidden", !blocked);
}

function broadcastTabClosing() {
  if (tabLockChannel) tabLockChannel.postMessage({ type: "closing", tabId });
}

function broadcastActivity() {
  if (tabLockChannel) tabLockChannel.postMessage({ type: "activity", tabId });
}

function injectBlockOverlay() {
  const overlay = document.createElement("div");
  overlay.id = "tabLockOverlay";
  overlay.className = "hidden";
  overlay.innerHTML = `
    <div class="tab-lock-card">
      <h3>Ya hay una sesión abierta</h3>
      <p>Este sistema solo permite una pestaña activa a la vez. Cierre la otra pestaña para continuar aqui.</p>
      <p class="mono" style="font-size:11px;color:var(--ink-soft);">Verificando automaticamente...</p>
    </div>
  `;
  document.body.appendChild(overlay);
}
