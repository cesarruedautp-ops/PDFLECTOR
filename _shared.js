const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");

// Cliente con la clave secreta (service_role) -- SOLO se usa aqui, en el
// servidor. Nunca debe llegar al navegador.
function getSupabaseAdmin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Verifica el token que manda el navegador (el mismo access_token de su
// sesion) y confirma que pertenece a un ADMIN, sin tener que consultar la
// base de datos -- el rol ya viene dentro del token gracias al hook.
function requireAdmin(event) {
  const header = event.headers.authorization || event.headers.Authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return { error: { statusCode: 401, message: "No autenticado" } };
  }

  const token = header.slice(7);
  let payload;
  try {
    payload = jwt.verify(token, process.env.SUPABASE_JWT_SECRET);
  } catch (e) {
    return { error: { statusCode: 401, message: "Sesion invalida o expirada" } };
  }

  const role = payload.app_metadata && payload.app_metadata.role;
  if (role !== "ADMIN") {
    return { error: { statusCode: 403, message: "Solo un administrador puede hacer esto" } };
  }

  return { userId: payload.sub, email: payload.email };
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function generateTempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let pass = "";
  for (let i = 0; i < 10; i++) pass += chars[Math.floor(Math.random() * chars.length)];
  return pass;
}

module.exports = { getSupabaseAdmin, requireAdmin, jsonResponse, generateTempPassword };
