// Escapa texto antes de insertarlo como HTML, para que un número de oficio,
// descripcion, nombre de usuario, etc. con < > & " ' no pueda inyectar
// código (XSS) en la página de otros usuarios que lo vean despues.
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
