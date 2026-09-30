const pdfParse = require("pdf-parse");
const { getSupabaseAdmin } = require("./_shared");

// Corre solo cada 15 minutos (ver netlify.toml), sin que nadie tenga el
// navegador abierto. Solo funciona para documentos con texto digital real
// (no escaneados): usa pdf-parse, que es JS puro y no necesita convertir
// paginas a imagen. Los documentos escaneados (que necesitan OCR) se dejan
// tal como estan -- esos se siguen indexando desde el navegador, porque
// intentar reconocer texto de una imagen dentro de un servidor sin sistema
// operativo completo no es confiable en este momento.
const MAX_DOCS_PER_RUN = 5;
const MIN_CHARS_PER_PAGE = 25;

function normalizeForSearch(text) {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

exports.handler = async () => {
  const supabaseAdmin = getSupabaseAdmin();

  const { data: pending, error } = await supabaseAdmin
    .from("documents")
    .select("id, storage_path")
    .eq("is_deleted", false)
    .is("contenido_texto", null)
    .order("fecha_subida", { ascending: true })
    .limit(MAX_DOCS_PER_RUN);

  if (error) {
    console.error("Error consultando documentos pendientes:", error.message);
    return { statusCode: 200 };
  }

  for (const doc of pending || []) {
    try {
      const { data: fileBlob, error: downloadError } = await supabaseAdmin.storage
        .from("documents-originals")
        .download(doc.storage_path);
      if (downloadError) throw downloadError;

      const buffer = Buffer.from(await fileBlob.arrayBuffer());
      const parsed = await pdfParse(buffer);
      const totalChars = (parsed.text || "").replace(/\s/g, "").length;

      // Si el texto extraido es muy poco comparado con la cantidad de
      // paginas, es probablemente un documento escaneado -- se deja
      // pendiente para que el navegador lo indexe con OCR.
      if (totalChars < MIN_CHARS_PER_PAGE * Math.max(parsed.numpages || 1, 1)) {
        continue;
      }

      const texto = normalizeForSearch(parsed.text).slice(0, 300000);
      await supabaseAdmin.from("documents").update({ contenido_texto: texto }).eq("id", doc.id);
    } catch (err) {
      console.error("Error indexando documento", doc.id, err.message);
    }
  }

  return { statusCode: 200 };
};
