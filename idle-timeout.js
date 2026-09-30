const IDLE_LIMIT_MS = 10 * 60 * 1000;
let idleTimer = null;

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(handleIdleTimeout, IDLE_LIMIT_MS);
  broadcastActivity();
}

// Cuando otra pestana reporta actividad, esta pestana tambien reinicia su
// propio contador -- el limite de 10 minutos aplica a la sesión como
// conjunto, no a cada pestana por separado.
function resetIdleTimerFromBroadcast() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(handleIdleTimeout, IDLE_LIMIT_MS);
}

async function handleIdleTimeout() {
  broadcastTabClosing();
  await supabaseClient.auth.signOut();
  window.location.href = "login.html?timeout=1";
}

function startIdleWatcher() {
  ["mousemove", "keydown", "click", "scroll", "touchstart"].forEach((evt) => {
    document.addEventListener(evt, resetIdleTimer, { passive: true });
  });
  resetIdleTimer();
}
