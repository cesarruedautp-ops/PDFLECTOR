let usersCache = [];
let currentUserId = null;

async function loadUsers() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  currentUserId = session.user.id;

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    showAlert("No se pudo cargar la lista: " + error.message, "error");
    return;
  }

  usersCache = data;
  renderUsersTable();
}

function renderUsersTable() {
  const tbody = document.getElementById("usersTableBody");

  if (usersCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--ink-soft);padding:2rem;">No hay usuarios registrados.</td></tr>`;
    return;
  }

  tbody.innerHTML = usersCache.map((u) => {
    const isSelf = u.id === currentUserId;
    return `
    <tr style="${isSelf ? "background:var(--paper-dark);" : ""}">
      <td>${escapeHtml(u.full_name)}${isSelf ? '<span class="mono" style="font-size:10.5px;color:var(--bronze);margin-left:6px;">(usted)</span>' : ""}</td>
      <td class="mono" style="font-size:12px;">${escapeHtml(u.email)}</td>
      <td>
        <select onchange="changeRole('${u.id}', this.value)" ${isSelf ? "disabled" : ""}
                style="font-size:12.5px;padding:4px 6px;border:1px solid var(--hairline);border-radius:2px;">
          <option value="ADMIN" ${u.role === "ADMIN" ? "selected" : ""}>ADMIN</option>
          <option value="UPLOADER" ${u.role === "UPLOADER" ? "selected" : ""}>USUARIO SUBIDA</option>
          <option value="READER" ${u.role === "READER" ? "selected" : ""}>USUARIO LECTOR</option>
        </select>
      </td>
      <td><span class="badge ${u.is_active ? "badge-upload" : "badge-delete"}">${u.is_active ? "ACTIVO" : "INACTIVO"}</span></td>
      <td style="white-space:nowrap;">
        <button class="btn" style="padding:5px 10px;font-size:12px;" onclick="handleResetPassword('${u.id}', '${u.email}')">Reiniciar contraseña</button>
        <button class="btn" style="padding:5px 10px;font-size:12px;" onclick="toggleActive('${u.id}', ${u.is_active})" ${isSelf && u.is_active ? "disabled title='No puede desactivar su propia cuenta'" : ""}>
          ${u.is_active ? "Desactivar" : "Activar"}
        </button>
      </td>
    </tr>`;
  }).join("");
}

// Llama a las Netlify Functions (mismo dominio, sin problema de CORS),
// mandando el token de sesión para que la función verifique que quien
// llama es realmente un administrador antes de hacer nada.
async function callFunction(name, body) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const res = await fetch(`/.netlify/functions/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Error en la solicitud");
  return data;
}

function openCreateUserModal() {
  document.getElementById("modalRoot").innerHTML = `
    <div class="modal-overlay">
      <div class="modal" style="width:400px;">
        <h3 style="color:var(--navy);">Nuevo usuario</h3>
        <p>Se creará con una contraseña temporal y deberá cambiarla al iniciar sesión por primera vez.</p>
        <div class="field"><label>Nombre completo</label><input type="text" id="newFullName"></div>
        <div class="field"><label>Correo institucional</label><input type="email" id="newEmail"></div>
        <div class="field">
          <label>Rol</label>
          <select id="newRole">
            <option value="READER">Usuario Lector</option>
            <option value="UPLOADER">Usuario Subida</option>
            <option value="ADMIN">Administrador</option>
          </select>
        </div>
        <div class="modal-error" id="createUserError"></div>
        <div class="modal-actions">
          <button class="btn" onclick="document.getElementById('modalRoot').innerHTML=''">Cancelar</button>
          <button class="btn btn-primary" style="width:auto;padding:9px 16px;" id="submitCreateBtn" onclick="submitCreateUser()">Crear usuario</button>
        </div>
      </div>
    </div>
  `;
}

async function submitCreateUser() {
  const fullName = document.getElementById("newFullName").value.trim();
  const email = document.getElementById("newEmail").value.trim();
  const role = document.getElementById("newRole").value;
  const errorEl = document.getElementById("createUserError");
  const submitBtn = document.getElementById("submitCreateBtn");

  if (!fullName || !email) {
    errorEl.textContent = "Complete todos los campos.";
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Creando...";

  try {
    const result = await callFunction("create-user", { email, fullName, role });
    document.getElementById("modalRoot").innerHTML = "";
    showAlert(`Usuario creado. Contraseña temporal para ${email}: ${result.tempPassword} (comuníquela por un canal seguro).`, "success");
    loadUsers();
  } catch (err) {
    errorEl.textContent = err.message || "No se pudo crear el usuario.";
    submitBtn.disabled = false;
    submitBtn.textContent = "Crear usuario";
  }
}

async function handleResetPassword(userId, email) {
  if (!confirm(`¿Reiniciar la contraseña de ${email}? Deberá cambiarla en su próximo inicio de sesión.`)) return;

  try {
    const result = await callFunction("reset-password", { userId });
    showAlert(`Contraseña reiniciada para ${email}. Temporal: ${result.tempPassword} (comuníquela por un canal seguro).`, "success");
  } catch (err) {
    showAlert("No se pudo reiniciar la contraseña: " + err.message, "error");
  }
}

async function changeRole(userId, newRole) {
  if (userId === currentUserId) {
    showAlert("No puede cambiar su propio rol. Pida a otro administrador que lo haga.", "error");
    loadUsers();
    return;
  }

  const target = usersCache.find((u) => u.id === userId);
  if (target.role === "ADMIN" && newRole !== "ADMIN") {
    const adminCount = usersCache.filter((u) => u.role === "ADMIN").length;
    if (adminCount <= 1) {
      showAlert("No puede quitar el rol ADMIN al único administrador restante.", "error");
      loadUsers();
      return;
    }
  }

  const { error } = await supabaseClient.from("profiles").update({ role: newRole }).eq("id", userId);
  if (error) {
    showAlert(error.message, "error");
    loadUsers();
    return;
  }

  const { data: { session } } = await supabaseClient.auth.getSession();
  await supabaseClient.from("audit_logs").insert({
    user_id: session.user.id,
    action: "ROLE_CHANGED",
    detail: `Rol de ${target.email} cambiado a ${newRole}`,
  });

  showAlert("Rol actualizado correctamente.", "success");
  loadUsers();
}

async function toggleActive(userId, currentlyActive) {
  if (userId === currentUserId && currentlyActive) {
    showAlert("No puede desactivar su propia cuenta.", "error");
    return;
  }

  const target = usersCache.find((u) => u.id === userId);
  if (currentlyActive && target.role === "ADMIN") {
    const activeAdmins = usersCache.filter((u) => u.role === "ADMIN" && u.is_active).length;
    if (activeAdmins <= 1) {
      showAlert("No puede desactivar al único administrador activo del sistema.", "error");
      return;
    }
  }

  const action = currentlyActive ? "desactivar" : "activar";
  if (!confirm(`\u00bfSeguro que desea ${action} a ${target.full_name}?`)) return;

  const { error } = await supabaseClient.from("profiles").update({ is_active: !currentlyActive }).eq("id", userId);
  if (error) {
    showAlert(error.message, "error");
    return;
  }

  const { data: { session } } = await supabaseClient.auth.getSession();
  await supabaseClient.from("audit_logs").insert({
    user_id: session.user.id,
    action: "STATUS_CHANGED",
    detail: `Usuario ${target.email} ${currentlyActive ? "desactivado" : "reactivado"}`,
  });

  showAlert(`Usuario ${currentlyActive ? "desactivado" : "activado"} correctamente.`, "success");
  loadUsers();
}

function showAlert(message, type) {
  const box = document.getElementById("alertBox");
  box.textContent = message;
  box.style.background = type === "error" ? "#F4E4E0" : "#DCEBDD";
  box.style.color = type === "error" ? "#8B2E2E" : "#2C6B34";
  box.classList.remove("hidden");
  setTimeout(() => box.classList.add("hidden"), 7000);
}
