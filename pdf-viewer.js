let currentDocument = null;
let currentPdfDoc = null;
let currentPage = 1;
let currentZoom = 1.4;
let currentBlobUrl = null;

async function selectOficio(documentId, btnEl) {
  document.querySelectorAll(".tree-node-oficio").forEach((b) => b.classList.remove("selected"));
  if (btnEl) btnEl.classList.add("selected");

  currentDocument = await fetchDocumentById(documentId);
  renderMetadata(currentDocument);

  const blob = await downloadDocumentBlob(currentDocument.storage_path);
  if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
  currentBlobUrl = URL.createObjectURL(blob);

  const arrayBuffer = await blob.arrayBuffer();
  currentPdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  currentPage = 1;

  const firstPage = await currentPdfDoc.getPage(1);
  const baseWidth = firstPage.getViewport({ scale: 1 }).width;
  const available = document.getElementById("pdfCanvasWrap").clientWidth - 64;
  currentZoom = Math.min(4, Math.max(0.6, available / baseWidth));
  renderCurrentPage();
}

async function renderCurrentPage() {
  const page = await currentPdfDoc.getPage(currentPage);
  const viewport = page.getViewport({ scale: currentZoom });

  // Resolución real de la pantalla: evita que el texto se vea borroso.
  // Se limita el total de pixeles para no agotar la memoria con zoom alto.
  const MAX_PIXELS = 16000000;
  let outputScale = window.devicePixelRatio || 1;
  outputScale = Math.max(outputScale, 2);
  const pixels = viewport.width * viewport.height * outputScale * outputScale;
  if (pixels > MAX_PIXELS) outputScale = Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height));

  const canvas = document.createElement("canvas");
  canvas.id = "pdfCanvas";
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = Math.floor(viewport.width) + "px";
  canvas.style.height = Math.floor(viewport.height) + "px";

  const wrap = document.getElementById("pdfCanvasWrap");
  wrap.innerHTML = "";
  wrap.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  await page.render({
    canvasContext: ctx,
    viewport,
    transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null,
  }).promise;

  renderToolbar();
}

function renderToolbar() {
  const total = currentPdfDoc.numPages;
  document.getElementById("viewerToolbar").innerHTML = `
    <button class="pdf-toolbar-btn" onclick="changeZoom(-0.2)">\u2212</button>
    <span class="mono" style="font-size:12px;color:var(--ink-soft);min-width:44px;text-align:center;">${Math.round(currentZoom * 100)}%</span>
    <button class="pdf-toolbar-btn" onclick="changeZoom(0.2)">+</button>
    <div class="page-indicator">
      <button ${currentPage === 1 ? "disabled" : ""} onclick="changePage(-1)">\u2190</button>
      Página ${currentPage} de ${total}
      <button ${currentPage === total ? "disabled" : ""} onclick="changePage(1)">\u2192</button>
    </div>
    <button class="btn-close-doc" onclick="closeDocument()" title="Cerrar documento">\u2715 Cerrar</button>
  `;
}

function closeDocument() {
  if (currentPdfDoc) { currentPdfDoc.destroy(); currentPdfDoc = null; }
  if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null; }
  currentDocument = null;
  document.querySelectorAll(".tree-node-oficio").forEach((b) => b.classList.remove("selected"));
  showEmptyViewer();
}

function changeZoom(delta) {
  currentZoom = Math.min(4, Math.max(0.6, currentZoom + delta));
  renderCurrentPage();
}

function changePage(delta) {
  currentPage = Math.min(currentPdfDoc.numPages, Math.max(1, currentPage + delta));
  renderCurrentPage();
}

function renderMetadata(doc) {
  const canDelete = window.currentUserRole === "ADMIN";
  const tipo = doc.tipo_documento || "OFICIO";

  const BADGE = {
    OFICIO: "EXPEDIENTE",
    MEMORANDUM: "MEMORANDUM",
    ASIGNACION_VIATICOS: "VIÁTICOS - ASIGNACIÓN",
    LIQUIDACION_VIATICOS: "VIÁTICOS - LIQUIDACIÓN",
  };

  let title;
  if (tipo === "OFICIO") {
    // Si el usuario ya escribio "Oficio" al capturar el número (ej. "OFICIO 033"),
    // no se antepone la palabra de nuevo para evitar el titulo duplicado.
    const rawOficio = doc.numero_oficio || "";
    title = escapeHtml(/oficio/i.test(rawOficio) ? rawOficio : `Oficio N\u00b0 ${rawOficio}`);
  } else if (tipo === "MEMORANDUM") {
    title = escapeHtml(doc.numero_oficio || "Memorandum sin número");
  } else {
    title = escapeHtml(doc.empleado || "Sin empleado identificado");
  }

  let gridItems = `<div class="meta-item"><div class="k">A\u00f1o</div><div class="v mono">${escapeHtml(doc.anio)}</div></div>`;
  if (tipo === "OFICIO") {
    gridItems += `<div class="meta-item"><div class="k">Tomo</div><div class="v mono">${escapeHtml(doc.tomo)}</div></div>`;
  }
  gridItems += `<div class="meta-item"><div class="k">Mes</div><div class="v mono">${escapeHtml(doc.mes)}</div></div>`;

  let extraSection = "";
  if (tipo === "MEMORANDUM") {
    extraSection = `
      <div class="meta-item" style="margin-bottom:1.1rem;"><div class="k">De</div><div class="v">${escapeHtml(doc.remitente || "-")}</div></div>
      <div class="meta-item" style="margin-bottom:1.1rem;"><div class="k">Para</div><div class="v">${escapeHtml(doc.destinatario || "-")}</div></div>
    `;
  } else if (tipo === "ASIGNACION_VIATICOS" || tipo === "LIQUIDACION_VIATICOS") {
    const periodo = (doc.fecha_viaje_inicio || doc.fecha_viaje_fin)
      ? `${doc.fecha_viaje_inicio || "?"} al ${doc.fecha_viaje_fin || "?"}`
      : "-";
    extraSection = `
      <div class="meta-item" style="margin-bottom:1.1rem;"><div class="k">Empleado</div><div class="v">${escapeHtml(doc.empleado || "-")}</div></div>
      <div class="meta-item" style="margin-bottom:1.1rem;"><div class="k">Periodo del viaje</div><div class="v mono">${escapeHtml(periodo)}</div></div>
    `;
  }

  const descLabel = (tipo === "ASIGNACION_VIATICOS" || tipo === "LIQUIDACION_VIATICOS")
    ? "Propósito del viaje"
    : (tipo === "MEMORANDUM" ? "Asunto" : "Descripción");

  document.getElementById("metadataPanel").innerHTML = `
    <div class="meta-oficio-badge">${BADGE[tipo] || "EXPEDIENTE"}</div>
    <h2>${title}</h2>
    <div class="meta-grid">
      ${gridItems}
    </div>
    ${extraSection}
    <div class="meta-item" style="margin-bottom:1.1rem;">
      <div class="k">Fecha de subida</div>
      <div class="v mono">${new Date(doc.fecha_subida).toLocaleString()}</div>
    </div>
    <div class="meta-item" style="margin-bottom:1.1rem;">
      <div class="k">Subido por</div>
      <div class="v">${escapeHtml(doc.uploadedBy?.full_name ?? "-")}</div>
    </div>
    <div class="meta-desc">
      <div class="k">${descLabel}</div>
      <p>${escapeHtml(doc.descripcion)}</p>
    </div>
    <div class="meta-actions">
      <button class="btn" onclick="downloadOriginal()">Descargar PDF original</button>
      ${canDelete ? `<button class="btn btn-danger" onclick="openDeleteModal()">Eliminar documento</button>` : ""}
    </div>
  `;
}

function downloadOriginal() {
  const a = document.createElement("a");
  a.href = currentBlobUrl;
  a.download = `documento-${currentDocument.numero_oficio || currentDocument.empleado || currentDocument.id}.pdf`;
  a.click();
}

function showEmptyViewer() {
  document.getElementById("viewerToolbar").innerHTML = "";
  document.getElementById("pdfCanvasWrap").innerHTML =
    '<div class="empty-viewer"><h3>Ningun documento seleccionado</h3><p>Elige un a\u00f1o, tomo y oficio en el panel izquierdo para visualizarlo aqui.</p></div>';
  document.getElementById("metadataPanel").innerHTML = "";
}

let deleteCaptchaWidgetId = null;

function openDeleteModal() {
  document.getElementById("modalRoot").innerHTML = `
    <div class="modal-overlay">
      <div class="modal">
        <h3>Confirmar eliminación</h3>
        <p>Esta a punto de eliminar el documento <strong>${escapeHtml(currentDocument.numero_oficio || currentDocument.empleado || "seleccionado")}</strong>. Ingrese su contraseña para confirmar. Esta acción queda registrada en auditoría.</p>
        <div class="field">
          <label for="deletePass">Contraseña</label>
          <input type="password" id="deletePass">
        </div>
        <div id="deleteCaptchaContainer" style="margin-bottom:1rem;"></div>
        <div class="modal-error" id="deleteError"></div>
        <div class="modal-actions">
          <button class="btn" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-danger" onclick="confirmDelete()">Eliminar definitivamente</button>
        </div>
      </div>
    </div>
  `;

  // El widget insertado por innerHTML no se dibuja solo -- hCaptcha solo
  // detecta automaticamente los que ya estaban en la pagina al cargarla.
  // Se dibuja a mano y se guarda su id para leer/reiniciar ESTE widget
  // en particular (por si hay otro en la misma pagina).
  deleteCaptchaWidgetId = null;
  if (typeof hcaptcha !== "undefined") {
    deleteCaptchaWidgetId = hcaptcha.render("deleteCaptchaContainer", {
      sitekey: "904881b0-b654-48c2-8e52-42823d420c50",
    });
  }
}

function closeModal() {
  document.getElementById("modalRoot").innerHTML = "";
}

async function confirmDelete() {
  const pass = document.getElementById("deletePass").value;
  const errorEl = document.getElementById("deleteError");
  if (!pass) {
    errorEl.textContent = "Ingrese su contraseña para continuar.";
    return;
  }

  const captchaToken = (typeof hcaptcha !== "undefined" && deleteCaptchaWidgetId !== null)
    ? hcaptcha.getResponse(deleteCaptchaWidgetId)
    : "";
  if (!captchaToken) {
    errorEl.textContent = "Complete la verificación (no soy un robot) antes de continuar.";
    return;
  }

  const { data: { session } } = await supabaseClient.auth.getSession();

  try {
    await deleteDocumentWithPassword({
      documentId: currentDocument.id,
      numeroOficio: currentDocument.numero_oficio || currentDocument.empleado || currentDocument.id,
      email: session.user.email,
      password: pass,
      captchaToken,
    });
    closeModal();
    showToast("Documento eliminado. Registrado en auditoría.");
    showEmptyViewer();
    currentDocument = null;
    renderSidebarTree();
  } catch (err) {
    errorEl.textContent = err.message;
    if (typeof hcaptcha !== "undefined" && deleteCaptchaWidgetId !== null) hcaptcha.reset(deleteCaptchaWidgetId);
  }
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3200);
}
