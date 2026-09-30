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

  const { userId } = body;
  if (!userId) return jsonResponse(400, { error: "Falta el usuario a reiniciar" });

  const supabaseAdmin = getSupabaseAdmin();

  const { data: existing, error: getError } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (getError || !existing?.user) {
    return jsonResponse(404, { error: "Usuario no encontrado" });
  }

  const tempPassword = generateTempPassword();
  const mergedMetadata = { ...(existing.user.user_metadata || {}), must_change_password: true };

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: tempPassword,
    user_metadata: mergedMetadata,
  });

  if (updateError) {
    return jsonResponse(400, { error: updateError.message });
  }

  await supabaseAdmin.from("audit_logs").insert({
    user_id: auth.userId,
    action: "PASSWORD_RESET_BY_ADMIN",
    detail: `Contrasena reiniciada manualmente para el usuario ${existing.user.email}`,
  });

  return jsonResponse(200, { tempPassword });
};
