const { getSupabaseAdmin, requireAdmin, jsonResponse, generateTempPassword } = require("./_shared");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Metodo no permitido" });
  }

  const auth = requireAdmin(event);
  if (auth.error) return jsonResponse(auth.error.statusCode, { error: auth.error.message });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return jsonResponse(400, { error: "Solicitud invalida" });
  }

  const { email, fullName, role } = body;
  if (!email || !fullName || !["ADMIN", "UPLOADER", "READER"].includes(role)) {
    return jsonResponse(400, { error: "Faltan datos o el rol no es valido" });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const tempPassword = generateTempPassword();

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName, must_change_password: true },
  });

  if (createError) {
    return jsonResponse(400, { error: createError.message });
  }

  // El trigger de la base de datos ya crea la fila en profiles con rol READER
  // (o ADMIN si el correo esta en la lista de administradores); aqui se ajusta
  // al rol elegido en el panel y se guarda el nombre completo.
  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .update({ role, full_name: fullName })
    .eq("id", created.user.id);

  if (profileError) {
    return jsonResponse(500, { error: "Usuario creado pero no se pudo asignar el rol: " + profileError.message });
  }

  await supabaseAdmin.from("audit_logs").insert({
    user_id: auth.userId,
    action: "USER_CREATED",
    detail: `Usuario creado: ${email} con rol ${role}`,
  });

  return jsonResponse(201, { id: created.user.id, email, tempPassword });
};
