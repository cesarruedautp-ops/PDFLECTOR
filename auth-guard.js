function decodeJwtAppMetadata(accessToken) {
  try {
    const payload = JSON.parse(atob(accessToken.split(".")[1]));
    return payload.app_metadata || {};
  } catch (e) {
    return {};
  }
}

async function requireAuth(allowedRoles = null) {
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (!session) {
    window.location.href = "login.html";
    return null;
  }

  const mustChangePassword = session.user.user_metadata?.must_change_password === true;

  if (mustChangePassword && !window.location.pathname.includes("change-password.html")) {
    window.location.href = "change-password.html";
    return null;
  }

  const appMetadata = decodeJwtAppMetadata(session.access_token);
  const role = appMetadata.role ?? "READER";

  if (allowedRoles && !allowedRoles.includes(role)) {
    alert("No tiene permisos para acceder a esta sección");
    window.location.href = "index.html";
    return null;
  }

  return { user: session.user, role };
}

function applyRoleVisibilityToNav(role) {
  const navUpload = document.getElementById("navUpload");
  const navLogs = document.getElementById("navLogs");
  const navUsers = document.getElementById("navUsers");
  if (navUpload) navUpload.classList.toggle("hidden", role === "READER");
  if (navLogs) navLogs.classList.toggle("hidden", role !== "ADMIN");
  if (navUsers) navUsers.classList.toggle("hidden", role !== "ADMIN");
}

function setupLogout() {
  const btn = document.getElementById("logoutBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    broadcastTabClosing();
    await supabaseClient.auth.signOut();
    window.location.href = "login.html";
  });
}

async function logAction(action, documentId, detail) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;
  await supabaseClient.from("audit_logs").insert({
    user_id: session.user.id,
    action,
    document_id: documentId,
    detail,
  });
}
