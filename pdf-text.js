// Extrae el texto de un PDF en el navegador para poder buscar por palabra clave.
// - Si la página tiene texto digital, lo lee directo (rapido).
// - Si la página es una imagen escaneada, usa OCR (Tesseract.js) en español.
const MIN_CHARS_TEXT_LAYER = 25;
const MAX_TEXT_LENGTH = 300000;
const OCR_RENDER_SCALE = 3;

// Minusculas, sin acentos y con espacios normalizados: la busqueda no distingue
// entre "Presupuesto" y "presupuesto", ni entre "gestión" y "gestion".
function normalizeForSearch(text) {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function extractPdfText(arrayBuffer, onProgress) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const total = pdf.numPages;
  const parts = [];
  let length = 0;
  let worker = null;

  try {
    for (let i = 1; i <= total; i++) {
      if (onProgress) onProgress(i, total, "texto");

      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let pageText = content.items.map((item) => item.str).join(" ");

      const needsOcr = pageText.replace(/\s/g, "").length < MIN_CHARS_TEXT_LAYER;
      if (needsOcr && typeof Tesseract !== "undefined") {
        if (onProgress) onProgress(i, total, "ocr");
        if (!worker) worker = await Tesseract.createWorker("spa");

        const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

        const result = await worker.recognize(canvas);
        pageText = result.data.text;
      }

      parts.push(pageText);
      length += pageText.length;
      if (length > MAX_TEXT_LENGTH) break;
    }
  } finally {
    if (worker) await worker.terminate();
  }

  return normalizeForSearch(parts.join(" ")).slice(0, MAX_TEXT_LENGTH);
}
