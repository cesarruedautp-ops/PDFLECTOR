// Para Oficio se agrupa por el Tomo real. Los otros 3 tipos no usan tomo,
// asi que se agrupan por su propio nombre de tipo en ese mismo nivel del
// arbol -- reutiliza el arbol Año -> (Tomo o Tipo) -> Mes sin reescribirlo.
const TIPO_LABEL = {
  OFICIO: "Oficio",
  MEMORANDUM: "Memorandums",
  ASIGNACION_VIATICOS: "Viáticos - Asignación",
  LIQUIDACION_VIATICOS: "Viáticos - Liquidación",
};

function groupKeyFor(doc) {
  return doc.tipo_documento === "OFICIO" ? (doc.tomo || "(sin tomo)") : TIPO_LABEL[doc.tipo_documento];
}

function displayLabelFor(doc) {
  return doc.numero_oficio || doc.empleado || "Documento sin identificar";
}

async function fetchDocumentTree({ keyword = "", mes = "", tipo = "" } = {}) {
  let query = supabaseClient
    .from("documents")
    .select("id, numero_oficio, empleado, anio, tomo, mes, tipo_documento")
    .eq("is_deleted", false);

  if (mes) query = query.eq("mes", Number(mes));
  if (tipo) query = query.eq("tipo_documento", tipo);

  // Cada palabra debe aparecer en el contenido del PDF (busqueda sin acentos ni mayusculas)
  const words = normalizeForSearch(keyword).split(" ").filter(Boolean).slice(0, 6);
  words.forEach((w) => {
    query = query.ilike("contenido_texto", `%${escapeLike(w)}%`);
  });

  const { data, error } = await query
    .order("anio", { ascending: false })
    .order("mes", { ascending: true });

  if (error) throw error;

  const tree = {};
  for (const doc of data) {
    const groupKey = groupKeyFor(doc);
    tree[doc.anio] ??= {};
    tree[doc.anio][groupKey] ??= {};
    tree[doc.anio][groupKey][doc.mes] ??= [];
    tree[doc.anio][groupKey][doc.mes].push({
      id: doc.id,
      numeroOficio: displayLabelFor(doc),
      tipo: doc.tipo_documento,
    });
  }
  return tree;
}

async function fetchDocumentById(id) {
  const { data, error } = await supabaseClient
    .from("documents")
    .select("id, numero_oficio, descripcion, anio, tomo, mes, tipo_documento, empleado, fecha_viaje_inicio, fecha_viaje_fin, remitente, destinatario, fecha_subida, storage_path, file_size_bytes, uploaded_by, uploadedBy:uploaded_by(full_name, email)")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

async function downloadDocumentBlob(storagePath) {
  const { data, error } = await supabaseClient.storage
    .from("documents-originals")
    .download(storagePath);

  if (error) throw error;
  return data;
}

async function uploadDocument({
  file, tipoDocumento = "OFICIO", numeroOficio = null, descripcion, anio, tomo = null, mes,
  empleado = null, fechaViajeInicio = null, fechaViajeFin = null, remitente = null, destinatario = null,
  userId, contenidoTexto = null,
}) {
  const documentId = crypto.randomUUID();
  const storagePath = `${documentId}.pdf`;

  const { error: uploadError } = await supabaseClient.storage
    .from("documents-originals")
    .upload(storagePath, file, { contentType: "application/pdf" });

  if (uploadError) throw uploadError;

  const { data, error: insertError } = await supabaseClient
    .from("documents")
    .insert({
      id: documentId,
      tipo_documento: tipoDocumento,
      numero_oficio: numeroOficio || null,
      descripcion,
      anio: Number(anio),
      tomo: tomo || null,
      mes: Number(mes),
      empleado: empleado || null,
      fecha_viaje_inicio: fechaViajeInicio || null,
      fecha_viaje_fin: fechaViajeFin || null,
      remitente: remitente || null,
      destinatario: destinatario || null,
      storage_path: storagePath,
      file_size_bytes: file.size,
      uploaded_by: userId,
      contenido_texto: contenidoTexto,
    })
    .select()
    .single();

  if (insertError) {
    await supabaseClient.storage.from("documents-originals").remove([storagePath]);
    throw insertError;
  }

  const label = numeroOficio || empleado || "documento";
  await logAction("UPLOAD", documentId, `${TIPO_LABEL[tipoDocumento]} "${label}" subido`);
  return data;
}

async function deleteDocumentWithPassword({ documentId, numeroOficio, email, password, captchaToken }) {
  const { error: authError } = await supabaseClient.auth.signInWithPassword({
    email, password, options: { captchaToken },
  });

  if (authError) {
    await logAction("DELETE", documentId, "Intento fallido: contraseña incorrecta");
    throw new Error("Contraseña incorrecta. Eliminación cancelada.");
  }

  const { error } = await supabaseClient
    .from("documents")
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .eq("id", documentId);

  if (error) throw error;

  await logAction("DELETE", documentId, `Documento "${numeroOficio}" eliminado`);
}

async function searchDocumentsByText(query) {
  const { data, error } = await supabaseClient
    .from("documents")
    .select("id, numero_oficio, anio, tomo, mes, descripcion")
    .eq("is_deleted", false)
    .or(`numero_oficio.ilike.%${query}%,descripcion.ilike.%${query}%`)
    .order("fecha_subida", { ascending: false });

  if (error) throw error;
  return data;
}

// Solo ADMIN: lee el texto de los documentos subidos antes de existir la busqueda por palabra clave.
async function indexExistingDocuments(onStatus) {
  const { data: pending, error } = await supabaseClient
    .from("documents")
    .select("id, numero_oficio, storage_path")
    .eq("is_deleted", false)
    .is("contenido_texto", null);

  if (error) throw error;

  let processed = 0;
  for (const doc of pending) {
    const prefix = `Documento ${processed + 1} de ${pending.length} (${doc.numero_oficio})`;
    try {
      onStatus(prefix + "...");
      const blob = await downloadDocumentBlob(doc.storage_path);
      const text = await extractPdfText(await blob.arrayBuffer(), (i, total, modo) => {
        onStatus(`${prefix}: ${modo === "ocr" ? "reconociendo" : "leyendo"} página ${i} de ${total}`);
      });
      const { error: updError } = await supabaseClient
        .from("documents")
        .update({ contenido_texto: text })
        .eq("id", doc.id);
      if (updError) throw updError;
      processed++;
    } catch (err) {
      console.warn("No se pudo indexar", doc.numero_oficio, err);
    }
  }
  return { total: pending.length, processed };
}
