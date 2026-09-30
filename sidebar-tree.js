const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const activeFilters = { oficio: "", keyword: "", mes: "", tipo: "" };
let keywordTimer = null;
let renderToken = 0;

async function renderSidebarTree() {
  const token = ++renderToken;
  const container = document.getElementById("sidebarTree");

  let tree;
  try {
    tree = await fetchDocumentTree({ keyword: activeFilters.keyword, mes: activeFilters.mes, tipo: activeFilters.tipo });
  } catch (err) {
    if (token !== renderToken) return;
    container.innerHTML = '<div class="sidebar-empty">No se pudo cargar el archivo.</div>';
    return;
  }
  if (token !== renderToken) return;

  const filtering = !!(activeFilters.oficio || activeFilters.keyword || activeFilters.mes || activeFilters.tipo);
  container.innerHTML = "";

  let shown = 0;
  Object.keys(tree).sort((a, b) => b - a).forEach((anio) => {
    const node = buildYearNode(anio, tree[anio], activeFilters.oficio, filtering);
    if (node) { container.appendChild(node); shown++; }
  });

  if (shown === 0) {
    container.innerHTML = `<div class="sidebar-empty">${filtering ? "Sin resultados para estos filtros." : "Aun no hay documentos."}</div>`;
  }

  const clearBtn = document.getElementById("clearFiltersBtn");
  if (clearBtn) clearBtn.classList.toggle("hidden", !filtering);
}

function matchesOficio(oficio, filter) {
  if (!filter) return true;
  return oficio.numeroOficio.toLowerCase().includes(filter.toLowerCase());
}

function highlight(text, filter) {
  const t = String(text ?? "");
  if (!filter) return escapeHtml(t);
  const idx = t.toLowerCase().indexOf(filter.toLowerCase());
  if (idx === -1) return escapeHtml(t);
  const before = escapeHtml(t.slice(0, idx));
  const match = escapeHtml(t.slice(idx, idx + filter.length));
  const after = escapeHtml(t.slice(idx + filter.length));
  return before + '<span class="tree-highlight">' + match + '</span>' + after;
}

function buildYearNode(anio, tomos, oficioFilter, expandAll) {
  const wrap = document.createElement("div");
  const header = document.createElement("button");
  header.className = "tree-node-year";
  header.innerHTML = '<span class="chevron">\u25B8</span> A\u00f1o ' + anio;

  const childWrap = document.createElement("div");
  childWrap.className = "tree-children";

  let anyMatch = false;
  Object.keys(tomos).forEach((tomo) => {
    const node = buildTomoNode(tomo, tomos[tomo], oficioFilter, expandAll);
    if (node) { childWrap.appendChild(node); anyMatch = true; }
  });

  if (!anyMatch) return null;

  childWrap.style.display = expandAll ? "block" : "none";
  header.querySelector(".chevron").classList.toggle("open", expandAll);

  header.addEventListener("click", () => {
    const isOpen = childWrap.style.display === "block";
    childWrap.style.display = isOpen ? "none" : "block";
    header.querySelector(".chevron").classList.toggle("open", !isOpen);
  });

  wrap.appendChild(header);
  wrap.appendChild(childWrap);
  return wrap;
}

function buildTomoNode(tomo, meses, oficioFilter, expandAll) {
  const wrap = document.createElement("div");
  const header = document.createElement("button");
  header.className = "tree-node-tomo";
  header.innerHTML = '<span class="chevron">\u25B8</span> ' + tomo;

  const childWrap = document.createElement("div");
  childWrap.className = "tree-children";
  childWrap.style.display = expandAll ? "block" : "none";
  header.querySelector(".chevron").classList.toggle("open", expandAll);

  let anyMatch = false;
  Object.keys(meses).sort((a, b) => a - b).forEach((mes) => {
    const matching = meses[mes].filter((o) => matchesOficio(o, oficioFilter));
    if (matching.length === 0) return;
    anyMatch = true;

    const mesLabel = document.createElement("div");
    mesLabel.className = "tree-mes-label";
    mesLabel.textContent = "Mes " + mes + " - " + (MESES[mes - 1] || "");
    childWrap.appendChild(mesLabel);

    matching.forEach((oficio) => {
      const btn = document.createElement("button");
      btn.className = "tree-node-oficio";
      btn.innerHTML = highlight(oficio.numeroOficio, oficioFilter);
      btn.addEventListener("click", () => selectOficio(oficio.id, btn));
      childWrap.appendChild(btn);
    });
  });

  if (!anyMatch) return null;

  header.addEventListener("click", () => {
    const isOpen = childWrap.style.display === "block";
    childWrap.style.display = isOpen ? "none" : "block";
    header.querySelector(".chevron").classList.toggle("open", !isOpen);
  });

  wrap.appendChild(header);
  wrap.appendChild(childWrap);
  return wrap;
}

// Buscador de la barra superior: número de oficio
function handleSearch(value) {
  activeFilters.oficio = value.trim();
  renderSidebarTree();
}

// Filtro por palabra clave dentro del contenido del PDF
function handleKeywordInput(value) {
  clearTimeout(keywordTimer);
  keywordTimer = setTimeout(() => {
    activeFilters.keyword = value.trim();
    renderSidebarTree();
  }, 400);
}

// Filtro por mes
function handleMonthChange(value) {
  activeFilters.mes = value;
  renderSidebarTree();
}

// Filtro por tipo de documento (Oficio, Memorandum, Viáticos)
function handleTypeChange(value) {
  activeFilters.tipo = value;
  renderSidebarTree();
}

function clearFilters() {
  activeFilters.oficio = "";
  activeFilters.keyword = "";
  activeFilters.mes = "";
  activeFilters.tipo = "";
  const ids = { searchInput: "", keywordInput: "", monthFilter: "", typeFilter: "" };
  Object.entries(ids).forEach(([id, v]) => {
    const el = document.getElementById(id);
    if (el) el.value = v;
  });
  renderSidebarTree();
}
