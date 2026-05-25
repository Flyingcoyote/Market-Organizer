// ─────────────────────────────────────────────
//  Config
// ─────────────────────────────────────────────
const FINNHUB_KEY = 'd84ukr9r01qrqbnnlar0d84ukr9r01qrqbnnlarg';
const GEMINI_KEY  = 'AIzaSyB4g9U5ZIQ9-tLjsMiFWqeAVtr0fNyxUqg'; // restrict this key by HTTP referrer in Google Cloud Console

// ─────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────
let state = {
  groups: [],      // { id, name, x, y, w, h, minimized, stocks: [{symbol,name,exchange}] }
  companies: [],   // { id, name, description, x, y, zIndex } — private company nodes
  connections: [], // { id, fromGroupId, toGroupId, status:'pending'|'done'|'error', analysis, shortLabel }
  nextZ: 10
};

let activeWindowId = null;

// ─────────────────────────────────────────────
//  Drag state  (mouse-event based — more reliable than HTML5 drag API)
// ─────────────────────────────────────────────
let dragState = null;
// { symbol, name, exchange, sourceGroupId?, sourceIndex?, active, startX, startY }

let ghost = null;

// ─────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadFromHash();
  initSearch();
  renderAll();
  connectWS();
});

// ─────────────────────────────────────────────
//  Group creation
// ─────────────────────────────────────────────
function createGroup(opts = {}) {
  const canvas = document.getElementById('canvas');
  const id = uid();
  const offset = (state.groups.length % 6) * 24;
  state.groups.push({
    id,
    name: opts.name || 'New Group',
    x: opts.x ?? 40 + offset,
    y: opts.y ?? 40 + offset,
    w: opts.w ?? 260,
    h: opts.h ?? 320,
    minimized: opts.minimized ?? false,
    zIndex: state.nextZ++,
    stocks: opts.stocks || []
  });
  renderGroup(state.groups[state.groups.length - 1]);
  autoSave();
}

function createCompanyNode(opts = {}) {
  const id = uid();
  const offset = (state.companies.length % 6) * 24;
  state.companies.push({
    id,
    name: opts.name || 'Private Company',
    description: opts.description || '',
    x: opts.x ?? 120 + offset,
    y: opts.y ?? 120 + offset,
    zIndex: state.nextZ++
  });
  renderCompanyNode(state.companies[state.companies.length - 1]);
  autoSave();
}

function renderCompanyNode(c) {
  const existing = document.getElementById('win-' + c.id);
  if (existing) existing.remove();

  const win = document.createElement('div');
  win.className = 'group-window company-node';
  win.id = 'win-' + c.id;
  win.style.cssText = `left:${c.x}px;top:${c.y}px;width:220px;z-index:${c.zIndex}`;

  // Connector tab
  const connTab = document.createElement('div');
  connTab.className = 'win-connector-tab';
  connTab.addEventListener('mousedown', (e) => {
    if (e.target === portLeft || e.target === portRight) return;
    startWindowDragCompany(e, c);
  });

  const portLeft = document.createElement('div');
  portLeft.className = 'win-port-left';
  portLeft.title = 'Flow in';

  const portRight = document.createElement('div');
  portRight.className = 'win-port-right';
  portRight.title = 'Flow out — drag to connect';
  portRight.addEventListener('mousedown', (e) => { e.stopPropagation(); startConnectionDraw(e, c.id); });

  connTab.append(portLeft, portRight);
  win.appendChild(connTab);

  // Title bar
  const titlebar = document.createElement('div');
  titlebar.className = 'win-titlebar company-titlebar';

  const dotClose = document.createElement('div');
  dotClose.className = 'win-dot dot-close';
  dotClose.title = 'Remove';
  dotClose.onclick = (e) => { e.stopPropagation(); removeCompanyNode(c.id); };

  const badge = document.createElement('span');
  badge.className = 'company-badge';
  badge.textContent = 'PRIVATE';

  const title = document.createElement('div');
  title.className = 'win-title';
  title.textContent = c.name;
  title.title = 'Double-click to rename';
  title.ondblclick = (e) => { e.stopPropagation(); startRenameCompany(title, c); };

  titlebar.append(dotClose, badge, title);
  titlebar.addEventListener('mousedown', (e) => {
    if (e.target === dotClose) return;
    startWindowDragCompany(e, c);
  });
  win.appendChild(titlebar);

  // Description body
  const body = document.createElement('div');
  body.className = 'company-body';
  body.id = 'body-' + c.id;

  const desc = document.createElement('div');
  desc.className = 'company-desc';
  desc.textContent = c.description || 'Double-click to add description…';
  desc.style.opacity = c.description ? '1' : '0.4';
  desc.ondblclick = (e) => { e.stopPropagation(); startEditDesc(desc, c); };
  body.appendChild(desc);

  win.appendChild(body);
  win.addEventListener('mousedown', () => bringCompanyToFront(c.id));

  document.getElementById('canvas').appendChild(win);
}

function removeCompanyNode(id) {
  state.companies = state.companies.filter(c => c.id !== id);
  state.connections = state.connections.filter(c => c.fromGroupId !== id && c.toGroupId !== id);
  document.getElementById('win-' + id)?.remove();
  renderConnections();
  autoSave();
}

function bringCompanyToFront(id) {
  const c = state.companies.find(c => c.id === id);
  if (!c) return;
  c.zIndex = state.nextZ++;
  const win = document.getElementById('win-' + id);
  if (win) win.style.zIndex = c.zIndex;
  document.querySelectorAll('.group-window').forEach(w => w.classList.remove('active'));
  win?.classList.add('active');
}

function startWindowDragCompany(e, c) {
  e.preventDefault();
  bringCompanyToFront(c.id);
  const win = document.getElementById('win-' + c.id);
  const startX = e.clientX - c.x;
  const startY = e.clientY - c.y;
  const onMove = (ev) => {
    const canvas = document.getElementById('canvas').getBoundingClientRect();
    c.x = Math.max(0, Math.min(ev.clientX - startX, canvas.width - 60));
    c.y = Math.max(0, Math.min(ev.clientY - startY, canvas.height - 36));
    win.style.left = c.x + 'px';
    win.style.top  = c.y + 'px';
    renderConnections();
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    autoSave();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function startRenameCompany(titleEl, c) {
  titleEl.contentEditable = 'true';
  titleEl.focus();
  window.getSelection().selectAllChildren(titleEl);
  const finish = () => {
    titleEl.contentEditable = 'false';
    c.name = titleEl.textContent.trim() || 'Private Company';
    titleEl.textContent = c.name;
    titleEl.removeEventListener('blur', finish);
    titleEl.removeEventListener('keydown', onKey);
    autoSave();
  };
  const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(); } };
  titleEl.addEventListener('blur', finish);
  titleEl.addEventListener('keydown', onKey);
}

function startEditDesc(descEl, c) {
  descEl.contentEditable = 'true';
  descEl.style.opacity = '1';
  if (!c.description) descEl.textContent = '';
  descEl.focus();
  const finish = () => {
    descEl.contentEditable = 'false';
    c.description = descEl.textContent.trim();
    descEl.textContent = c.description || 'Double-click to add description…';
    descEl.style.opacity = c.description ? '1' : '0.4';
    descEl.removeEventListener('blur', finish);
    descEl.removeEventListener('keydown', onKey);
    autoSave();
  };
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(); } };
  descEl.addEventListener('blur', finish);
  descEl.addEventListener('keydown', onKey);
}

function renderAll() {
  // Preserve the SVG overlay, remove only group/company windows
  document.querySelectorAll('.group-window').forEach(el => el.remove());
  state.groups.forEach(g => renderGroup(g));
  state.companies.forEach(c => renderCompanyNode(c));
  renderConnections();
}

// ─────────────────────────────────────────────
//  Render a single group window
// ─────────────────────────────────────────────
function renderGroup(g) {
  const existing = document.getElementById('win-' + g.id);
  if (existing) existing.remove();

  const win = document.createElement('div');
  win.className = 'group-window' + (g.minimized ? ' minimized' : '');
  win.id = 'win-' + g.id;
  win.style.cssText = `left:${g.x}px;top:${g.y}px;width:${g.w}px;${g.minimized ? '' : 'height:' + g.h + 'px;'}z-index:${g.zIndex}`;

  // Connector tab (top strip with left/right port bubbles)
  const connTab = document.createElement('div');
  connTab.className = 'win-connector-tab';
  connTab.addEventListener('mousedown', (e) => {
    if (e.target === portLeft || e.target === portRight) return;
    startWindowDrag(e, g);
  });

  const portLeft = document.createElement('div');
  portLeft.className = 'win-port-left';
  portLeft.title = 'Flow in — drop connections here';

  const portRight = document.createElement('div');
  portRight.className = 'win-port-right';
  portRight.title = 'Flow out — drag to connect to another group';
  portRight.addEventListener('mousedown', (e) => { e.stopPropagation(); startConnectionDraw(e, g.id); });

  connTab.append(portLeft, portRight);
  win.appendChild(connTab);

  // Title bar
  const titlebar = document.createElement('div');
  titlebar.className = 'win-titlebar';

  const dots = document.createElement('div');
  dots.className = 'win-dots';

  const dotClose = document.createElement('div');
  dotClose.className = 'win-dot dot-close';
  dotClose.title = 'Close';
  dotClose.onclick = (e) => { e.stopPropagation(); removeGroup(g.id); };

  const dotMin = document.createElement('div');
  dotMin.className = 'win-dot dot-min';
  dotMin.title = 'Minimize';
  dotMin.onclick = (e) => { e.stopPropagation(); toggleMinimize(g.id); };

  dots.append(dotClose, dotMin);

  const title = document.createElement('div');
  title.className = 'win-title';
  title.textContent = g.name;
  title.title = 'Double-click to rename';
  title.ondblclick = (e) => { e.stopPropagation(); startRename(title, g); };

  titlebar.append(dots, title);
  titlebar.addEventListener('mousedown', (e) => {
    if (e.target === dotClose || e.target === dotMin) return;
    startWindowDrag(e, g);
  });

  win.appendChild(titlebar);

  // Body
  const body = document.createElement('div');
  body.className = 'win-body';
  body.id = 'body-' + g.id;

  if (g.stocks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'win-empty';
    empty.textContent = 'Drag stocks here';
    body.appendChild(empty);
  } else {
    g.stocks.forEach((stock, idx) => {
      body.appendChild(createStockRow(stock, g, idx));
    });
  }

  win.appendChild(body);

  // Resize handle
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'win-resize';
  resizeHandle.addEventListener('mousedown', (e) => { e.stopPropagation(); startResize(e, g); });
  win.appendChild(resizeHandle);

  win.addEventListener('mousedown', () => bringToFront(g.id));

  document.getElementById('canvas').appendChild(win);
}

// ─────────────────────────────────────────────
//  Stock row inside a group
// ─────────────────────────────────────────────
function createStockRow(stock, g, idx) {
  const row = document.createElement('div');
  row.className = 'stock-row';
  row.dataset.symbol = stock.symbol;
  row.dataset.groupId = g.id;
  row.dataset.index = idx;

  const sym = document.createElement('span');
  sym.className = 'stock-symbol';
  sym.textContent = stock.symbol;

  const name = document.createElement('span');
  name.className = 'stock-name';
  name.textContent = stock.name || '';

  const price = document.createElement('span');
  price.className = 'stock-price';
  price.id = `price-${g.id}-${stock.symbol}`;
  price.textContent = '—';

  const change = document.createElement('span');
  change.className = 'stock-change';
  change.id = `change-${g.id}-${stock.symbol}`;
  change.textContent = '';

  const removeBtn = document.createElement('button');
  removeBtn.className = 'stock-remove';
  removeBtn.textContent = '✕';
  removeBtn.title = 'Remove';
  removeBtn.onclick = (e) => { e.stopPropagation(); removeStock(g.id, idx); };

  row.append(sym, name, price, change, removeBtn);

  row.addEventListener('mousedown', (e) => {
    if (e.target === removeBtn) return;
    e.preventDefault();
    startDrag(e, { symbol: stock.symbol, name: stock.name, exchange: stock.exchange, sourceGroupId: g.id, sourceIndex: idx });
  });

  row.addEventListener('mouseenter', () => showChartTooltip(stock.symbol, stock.name, row));
  row.addEventListener('mouseleave', hideChartTooltip);

  return row;
}

// ─────────────────────────────────────────────
//  Mouse-event drag system
// ─────────────────────────────────────────────
function startDrag(e, data) {
  dragState = { ...data, active: false, startX: e.clientX, startY: e.clientY };
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
}

function onDragMove(e) {
  if (!dragState) return;
  if (!dragState.active) {
    if (Math.hypot(e.clientX - dragState.startX, e.clientY - dragState.startY) < 5) return;
    dragState.active = true;
    hideChartTooltip();
    showGhost(dragState.symbol, e);
  }
  moveGhost(e);
  // Highlight the group body under cursor
  document.querySelectorAll('.win-body').forEach(b => b.classList.remove('drag-over'));
  ghost.style.display = 'none';
  const el = document.elementFromPoint(e.clientX, e.clientY);
  ghost.style.display = '';
  el?.closest('.win-body')?.classList.add('drag-over');
}

function onDragEnd(e) {
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
  document.querySelectorAll('.win-body').forEach(b => b.classList.remove('drag-over'));

  if (!dragState?.active) { dragState = null; return; }

  // Temporarily hide ghost so elementFromPoint finds the element underneath
  ghost.style.display = 'none';
  const el = document.elementFromPoint(e.clientX, e.clientY);
  ghost.style.display = '';

  const dropBody = el?.closest('.win-body');
  const dropRow  = el?.closest('.stock-row');

  if (dropBody) {
    const groupId = dropBody.id.replace('body-', '');
    if (dropRow && dropRow.dataset.groupId === groupId) {
      dropOnRow(groupId, parseInt(dropRow.dataset.index));
    } else {
      dropOnGroup(groupId);
    }
  }

  hideGhost();
  dragState = null;
}

function dropOnGroup(targetGroupId) {
  if (!dragState) return;
  const { symbol, name, exchange, sourceGroupId, sourceIndex } = dragState;
  const targetGroup = state.groups.find(g => g.id === targetGroupId);
  if (!targetGroup) return;

  if (sourceGroupId && sourceGroupId !== targetGroupId) {
    const src = state.groups.find(g => g.id === sourceGroupId);
    if (src) src.stocks.splice(sourceIndex, 1);
  } else if (sourceGroupId === targetGroupId) {
    return;
  }

  if (!targetGroup.stocks.some(s => s.symbol === symbol)) {
    targetGroup.stocks.push({ symbol, name, exchange });
  }

  renderAll();
  fetchPricesForGroup(targetGroup);
  wsSubscribe(symbol);
  autoSave();
}

function dropOnRow(targetGroupId, targetIdx) {
  if (!dragState) return;
  const { symbol, name, exchange, sourceGroupId, sourceIndex } = dragState;
  const targetGroup = state.groups.find(g => g.id === targetGroupId);
  if (!targetGroup) return;

  if (sourceGroupId === targetGroupId) {
    const [moved] = targetGroup.stocks.splice(sourceIndex, 1);
    targetGroup.stocks.splice(targetIdx, 0, moved);
  } else {
    if (sourceGroupId) {
      const src = state.groups.find(g => g.id === sourceGroupId);
      if (src) src.stocks.splice(sourceIndex, 1);
    }
    if (!targetGroup.stocks.some(s => s.symbol === symbol)) {
      targetGroup.stocks.splice(targetIdx, 0, { symbol, name, exchange });
    }
  }

  renderAll();
  fetchPricesForGroup(targetGroup);
  wsSubscribe(symbol);
  autoSave();
}

// ─────────────────────────────────────────────
//  Remove
// ─────────────────────────────────────────────
function removeGroup(id) {
  state.groups = state.groups.filter(g => g.id !== id);
  state.connections = state.connections.filter(c => c.fromGroupId !== id && c.toGroupId !== id);
  const el = document.getElementById('win-' + id);
  if (el) el.remove();
  renderConnections();
  autoSave();
}

function removeStock(groupId, idx) {
  const g = state.groups.find(g => g.id === groupId);
  if (!g) return;
  g.stocks.splice(idx, 1);
  renderGroup(g);
  autoSave();
}

// ─────────────────────────────────────────────
//  Minimize / bring to front
// ─────────────────────────────────────────────
function toggleMinimize(id) {
  const g = state.groups.find(g => g.id === id);
  if (!g) return;
  g.minimized = !g.minimized;
  const win = document.getElementById('win-' + id);
  if (!win) return;
  win.classList.toggle('minimized', g.minimized);
  if (!g.minimized) win.style.height = g.h + 'px';
  else win.style.height = '';
  const body = document.getElementById('body-' + id);
  if (body) body.style.display = g.minimized ? 'none' : '';
  autoSave();
}

function bringToFront(id) {
  const g = state.groups.find(g => g.id === id);
  if (!g) return;
  g.zIndex = state.nextZ++;
  const win = document.getElementById('win-' + id);
  if (win) win.style.zIndex = g.zIndex;
  document.querySelectorAll('.group-window').forEach(w => w.classList.remove('active'));
  win && win.classList.add('active');
}

// ─────────────────────────────────────────────
//  Rename
// ─────────────────────────────────────────────
function startRename(titleEl, g) {
  titleEl.contentEditable = 'true';
  titleEl.focus();
  const sel = window.getSelection();
  sel.selectAllChildren(titleEl);

  const finish = () => {
    titleEl.contentEditable = 'false';
    g.name = titleEl.textContent.trim() || 'Group';
    titleEl.textContent = g.name;
    titleEl.removeEventListener('blur', finish);
    titleEl.removeEventListener('keydown', onKey);
    autoSave();
  };
  const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(); } };
  titleEl.addEventListener('blur', finish);
  titleEl.addEventListener('keydown', onKey);
}

// ─────────────────────────────────────────────
//  Window drag (move)
// ─────────────────────────────────────────────
function startWindowDrag(e, g) {
  e.preventDefault();
  bringToFront(g.id);
  const win = document.getElementById('win-' + g.id);
  const startX = e.clientX - g.x;
  const startY = e.clientY - g.y;

  const onMove = (ev) => {
    const canvas = document.getElementById('canvas');
    const rect = canvas.getBoundingClientRect();
    g.x = Math.max(0, Math.min(ev.clientX - startX, rect.width - 60));
    g.y = Math.max(0, Math.min(ev.clientY - startY, rect.height - 36));
    win.style.left = g.x + 'px';
    win.style.top = g.y + 'px';
    renderConnections();
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    autoSave();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ─────────────────────────────────────────────
//  Window resize
// ─────────────────────────────────────────────
function startResize(e, g) {
  bringToFront(g.id);
  const win = document.getElementById('win-' + g.id);
  const startX = e.clientX;
  const startY = e.clientY;
  const startW = g.w;
  const startH = g.h;

  const onMove = (ev) => {
    g.w = Math.max(200, startW + ev.clientX - startX);
    g.h = Math.max(120, startH + ev.clientY - startY);
    win.style.width = g.w + 'px';
    win.style.height = g.h + 'px';
    renderConnections();
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    autoSave();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ─────────────────────────────────────────────
//  Ghost element for drag
// ─────────────────────────────────────────────
function showGhost(symbol, e) {
  hideGhost();
  ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.textContent = symbol;
  ghost.style.pointerEvents = 'none';
  document.body.appendChild(ghost);
  moveGhost(e);
}

function moveGhost(e) {
  if (!ghost) return;
  ghost.style.left = e.clientX + 'px';
  ghost.style.top = e.clientY + 'px';
}

function hideGhost() {
  if (ghost) { ghost.remove(); ghost = null; }
}

// ─────────────────────────────────────────────
//  Search
// ─────────────────────────────────────────────
let searchDebounce = null;

function initSearch() {
  const input = document.getElementById('search-input');
  input.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const q = input.value.trim();
    if (!q) { showSearchMsg('Type a symbol or company name'); return; }
    showSearchMsg('Searching…');
    searchDebounce = setTimeout(() => doSearch(q), 350);
  });
  // Press Enter to create a draggable card from raw symbol (fallback)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const sym = input.value.trim().toUpperCase();
      if (sym) addManualSymbol(sym);
    }
  });
}

function addManualSymbol(symbol) {
  const container = document.getElementById('search-results');
  // If there's already a manual result card, replace it
  const existing = container.querySelector('[data-manual="1"]');
  if (existing) existing.remove();

  const item = document.createElement('div');
  item.className = 'search-result';
  item.dataset.manual = '1';
  item.dataset.symbol = symbol;

  const sym = document.createElement('div');
  sym.className = 'result-symbol';
  sym.textContent = symbol;

  const info = document.createElement('div');
  info.className = 'result-info';
  const nameEl = document.createElement('div');
  nameEl.className = 'result-name';
  nameEl.textContent = 'Manual entry — drag to a group';
  info.append(nameEl);
  item.append(sym, info);

  item.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startDrag(e, { symbol, name: symbol, exchange: '' });
  });

  container.prepend(item);
}

async function doSearch(query) {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${FINNHUB_KEY}`
    );
    if (!res.ok) throw new Error();
    const data = await res.json();
    renderSearchResults(data.result || []);
  } catch {
    showSearchMsg('Search unavailable. Type a symbol and press <b>Enter</b> to add it manually.');
  }
}

function renderSearchResults(results) {
  const container = document.getElementById('search-results');
  container.innerHTML = '';

  // Finnhub result: { symbol, displaySymbol, description, type }
  const filtered = results.filter(r => r.type === 'Common Stock' || r.type === 'ETP' || r.type === 'ADR');
  if (!filtered.length) { showSearchMsg('No results found'); return; }

  filtered.slice(0, 10).forEach(r => {
    const item = document.createElement('div');
    item.className = 'search-result';
    item.dataset.symbol = r.symbol;

    const sym = document.createElement('div');
    sym.className = 'result-symbol';
    sym.textContent = r.displaySymbol || r.symbol;

    const info = document.createElement('div');
    info.className = 'result-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'result-name';
    nameEl.textContent = r.description || '';
    const typeEl = document.createElement('div');
    typeEl.className = 'result-exchange';
    typeEl.textContent = r.type || '';
    info.append(nameEl, typeEl);

    item.append(sym, info);
    container.appendChild(item);

    const dragData = { symbol: r.symbol, name: r.description || r.symbol, exchange: r.type || '' };
    item.addEventListener('mousedown', (e) => { e.preventDefault(); startDrag(e, dragData); });
    item.addEventListener('mouseenter', () => showChartTooltip(r.symbol, r.description || r.symbol, item));
    item.addEventListener('mouseleave', hideChartTooltip);
  });
}

function showSearchMsg(html) {
  const container = document.getElementById('search-results');
  container.innerHTML = `<div class="search-msg">${html}</div>`;
}

// ─────────────────────────────────────────────
//  Price fetching — direct Finnhub REST
// ─────────────────────────────────────────────
async function fetchPricesForGroup(g) {
  await Promise.all(g.stocks.map(s => fetchPrice(s.symbol, g.id)));
}

async function fetchPrice(symbol, groupId) {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`
    );
    if (!res.ok) return;
    const d = await res.json();
    // Finnhub: { c: current price, dp: % change from prev close }
    updatePriceEl(groupId, symbol, d.c, d.dp);
  } catch { /* silent */ }
}

function updatePriceEl(groupId, symbol, price, changePct) {
  const priceEl  = document.getElementById(`price-${groupId}-${symbol}`);
  const changeEl = document.getElementById(`change-${groupId}-${symbol}`);
  if (priceEl)  priceEl.textContent = price ? '$' + price.toFixed(2) : '—';
  if (changeEl && changePct != null) {
    changeEl.textContent = (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%';
    changeEl.className   = 'stock-change ' + (changePct >= 0 ? 'up' : 'down');
  }
}

function fetchAllPrices() {
  state.groups.forEach(g => fetchPricesForGroup(g));
}

// ─────────────────────────────────────────────
//  WebSocket — live price ticks via Finnhub
// ─────────────────────────────────────────────
let ws = null;
let wsRetryTimeout = null;

function allSymbols() {
  const seen = new Set();
  state.groups.forEach(g => g.stocks.forEach(s => seen.add(s.symbol)));
  return [...seen];
}

function connectWS() {
  if (ws) return;
  setFeedStatus('connecting');
  ws = new WebSocket(`wss://ws.finnhub.io?token=${FINNHUB_KEY}`);

  ws.addEventListener('open', () => {
    setFeedStatus('live');
    allSymbols().forEach(wsSubscribe);
  });

  ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type !== 'trade' || !msg.data) return;
      msg.data.forEach(tick => {
        state.groups.forEach(g => {
          if (!g.stocks.some(st => st.symbol === tick.s)) return;
          const priceEl = document.getElementById(`price-${g.id}-${tick.s}`);
          const prev = priceEl?.dataset.prev ? parseFloat(priceEl.dataset.prev) : null;
          const chg  = prev ? ((tick.p - prev) / prev * 100) : null;
          updatePriceEl(g.id, tick.s, tick.p, chg);
          if (priceEl) priceEl.dataset.prev = tick.p;
        });
      });
    } catch { /* malformed frame */ }
  });

  ws.addEventListener('close', () => {
    ws = null;
    setFeedStatus('err');
    wsRetryTimeout = setTimeout(connectWS, 5000);
  });

  ws.addEventListener('error', () => ws?.close());
}

function wsSubscribe(symbol) {
  if (ws?.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ type: 'subscribe', symbol }));
}

function wsUnsubscribe(symbol) {
  if (ws?.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ type: 'unsubscribe', symbol }));
}

function setFeedStatus(s) {
  const el = document.getElementById('feed-status');
  if (!el) return;
  const map = {
    connecting: ['feed-off',  '⬤ Connecting…'],
    live:       ['feed-live', '⬤ Live'],
    err:        ['feed-err',  '⬤ Reconnecting…'],
  };
  const [cls, label] = map[s] || ['feed-off', '⬤ Off'];
  el.className   = `feed-status ${cls}`;
  el.textContent = label;
}

// REST refresh every 30 s as fallback for non-market hours
setInterval(fetchAllPrices, 30000);

// ─────────────────────────────────────────────
//  Save / Load / Share
// ─────────────────────────────────────────────
function encodeState() {
  const payload = {
    groups: state.groups.map(g => ({
      id: g.id, name: g.name,
      x: Math.round(g.x), y: Math.round(g.y),
      w: Math.round(g.w), h: Math.round(g.h),
      minimized: g.minimized, stocks: g.stocks
    })),
    companies: state.companies.map(c => ({
      id: c.id, name: c.name, description: c.description,
      x: Math.round(c.x), y: Math.round(c.y)
    })),
    connections: state.connections.map(c => ({
      id: c.id, fromGroupId: c.fromGroupId, toGroupId: c.toGroupId,
      status: c.status, analysis: c.analysis, shortLabel: c.shortLabel
    }))
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

function decodeState(code) {
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
    // Support old format (array of groups only)
    if (Array.isArray(parsed)) return { groups: parsed, connections: [] };
    return parsed;
  } catch { return null; }
}

// Auto-saves to localStorage after every state change (debounced 800ms)
let autoSaveTimer = null;
function autoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    localStorage.setItem('market_organizer_save', encodeState());
  }, 800);
}

function saveLayout() {
  const code = encodeState();
  localStorage.setItem('market_organizer_save', code);
  showModal('Layout Saved — your code:', code);
}

function shareLayout() {
  const code = encodeState();
  const url = location.origin + location.pathname + '#' + code;
  showModal('Share this link or code:', url);
}

function openLoadModal() {
  document.getElementById('load-overlay').classList.remove('hidden');
  document.getElementById('load-code').value = '';
  setTimeout(() => document.getElementById('load-code').focus(), 50);
}

function loadFromCode() {
  const raw = document.getElementById('load-code').value.trim();
  let code = raw;

  // Accept full URL or just code
  if (raw.includes('#')) code = raw.split('#').pop();

  const groups = decodeState(code);
  if (!groups) { alert('Invalid code. Please check and try again.'); return; }

  applyGroups(groups);
  closeLoadDirect();
}

function applyGroups(payload) {
  state.groups      = payload.groups.map(g => ({ ...g, zIndex: state.nextZ++ }));
  state.companies   = (payload.companies || []).map(c => ({ ...c, zIndex: state.nextZ++ }));
  state.connections = payload.connections || [];
  renderAll();
  renderConnections();
  setTimeout(fetchAllPrices, 200);
}

function loadFromHash() {
  const hash = location.hash.slice(1);
  if (hash) {
    const payload = decodeState(hash);
    if (payload) { applyGroups(payload); return; }
  }
  const saved = localStorage.getItem('market_organizer_save');
  if (saved) {
    const payload = decodeState(saved);
    if (payload) applyGroups(payload);
  }
}

// ─────────────────────────────────────────────
//  Modal helpers
// ─────────────────────────────────────────────
function showModal(title, code) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-code').value = code;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModalDirect();
  if (e.target === document.getElementById('load-overlay')) closeLoadDirect();
}

function closeModalDirect() { document.getElementById('modal-overlay').classList.add('hidden'); }
function closeLoadDirect() { document.getElementById('load-overlay').classList.add('hidden'); }

function copyCode() {
  const code = document.getElementById('modal-code').value;
  navigator.clipboard.writeText(code).then(() => {
    const btn = document.querySelector('#modal-actions button');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = orig, 1500);
  });
}

function closeLoad(e) {
  if (e.target === document.getElementById('load-overlay')) closeLoadDirect();
}

// ─────────────────────────────────────────────
//  Connection drawing (drag port → group)
// ─────────────────────────────────────────────
let connectingFrom     = null;
let connectingFromSide = 'right'; // 'right' for normal draw; 'left' when fixed end is a "to" group
let drawingPath        = null;
let reconnectInfo      = null; // { conn, whichEnd:'from'|'to' } — set during a reconnect drag

function startConnectionDraw(e, fromGroupId) {
  e.preventDefault();
  connectingFrom     = fromGroupId;
  connectingFromSide = 'right';

  const svg = document.getElementById('connections-svg');
  drawingPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  drawingPath.setAttribute('class', 'conn-line drawing');
  svg.appendChild(drawingPath);

  document.getElementById('win-' + fromGroupId)?.classList.add('connect-source');
  document.addEventListener('mousemove', onConnectMove);
  document.addEventListener('mouseup',   onConnectEnd);
}

function onConnectMove(e) {
  if (!connectingFrom || !drawingPath) return;
  const { x1, y1 } = portCenter(connectingFrom, connectingFromSide);
  const canvas = document.getElementById('canvas').getBoundingClientRect();
  const x2 = e.clientX - canvas.left;
  const y2 = e.clientY - canvas.top;
  drawingPath.setAttribute('d', bezier(x1, y1, x2, y2));

  // Highlight valid targets and pulse their left (input) port
  document.querySelectorAll('.group-window').forEach(w => w.classList.remove('connect-target'));
  document.querySelectorAll('.win-port-left').forEach(p => p.classList.remove('port-target-active'));
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const targetWin = el?.closest('.group-window');
  if (targetWin && targetWin.id !== 'win-' + connectingFrom) {
    targetWin.classList.add('connect-target');
    targetWin.querySelector('.win-port-left')?.classList.add('port-target-active');
  }
}

function onConnectEnd(e) {
  document.removeEventListener('mousemove', onConnectMove);
  document.removeEventListener('mouseup',   onConnectEnd);
  document.querySelectorAll('.group-window').forEach(w => {
    w.classList.remove('connect-target');
    w.classList.remove('connect-source');
  });
  document.querySelectorAll('.win-port-left').forEach(p => p.classList.remove('port-target-active'));
  if (drawingPath) { drawingPath.remove(); drawingPath = null; }

  const el = document.elementFromPoint(e.clientX, e.clientY);
  const targetWin = el?.closest('.group-window');
  if (targetWin) {
    const toId = targetWin.id.replace('win-', '');
    if (toId !== connectingFrom) createConnection(connectingFrom, toId);
  }
  connectingFrom     = null;
  connectingFromSide = 'right';
}

// ─────────────────────────────────────────────
//  Reconnect — grab an existing endpoint and drag to a new group
// ─────────────────────────────────────────────
function startReconnect(e, connId, whichEnd) {
  e.preventDefault();
  e.stopPropagation();

  const conn = state.connections.find(c => c.id === connId);
  if (!conn) return;

  // Stash original and remove it from state so it disappears while dragging
  reconnectInfo = { conn: { ...conn }, whichEnd };
  state.connections = state.connections.filter(c => c.id !== connId);
  renderConnections();

  // Fixed end is the opposite of what we're dragging
  if (whichEnd === 'from') {
    connectingFrom     = conn.toGroupId;
    connectingFromSide = 'left';  // fixed end is the "to" group's left (input) port
  } else {
    connectingFrom     = conn.fromGroupId;
    connectingFromSide = 'right'; // fixed end is the "from" group's right (output) port
  }

  const svg = document.getElementById('connections-svg');
  drawingPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  drawingPath.setAttribute('class', 'conn-line drawing');
  svg.appendChild(drawingPath);

  document.getElementById('win-' + connectingFrom)?.classList.add('connect-source');
  document.addEventListener('mousemove', onConnectMove);
  document.addEventListener('mouseup', onReconnectEnd);
}

function onReconnectEnd(e) {
  document.removeEventListener('mousemove', onConnectMove);
  document.removeEventListener('mouseup', onReconnectEnd);
  document.querySelectorAll('.group-window').forEach(w => {
    w.classList.remove('connect-target');
    w.classList.remove('connect-source');
  });
  document.querySelectorAll('.win-port-left').forEach(p => p.classList.remove('port-target-active'));
  if (drawingPath) { drawingPath.remove(); drawingPath = null; }

  const el = document.elementFromPoint(e.clientX, e.clientY);
  const targetWin = el?.closest('.group-window');
  const newGroupId = targetWin?.id.replace('win-', '');

  const { conn: orig, whichEnd } = reconnectInfo;
  reconnectInfo      = null;
  connectingFrom     = null;
  connectingFromSide = 'right';

  // Determine if the drop landed on a genuinely different group
  const fixedId = whichEnd === 'from' ? orig.toGroupId : orig.fromGroupId;
  if (newGroupId && newGroupId !== fixedId) {
    const updated = {
      ...orig,
      fromGroupId: whichEnd === 'from' ? newGroupId : orig.fromGroupId,
      toGroupId:   whichEnd === 'to'   ? newGroupId : orig.toGroupId,
      status: 'pending', analysis: null, shortLabel: null
    };
    state.connections.push(updated);
    renderConnections();
    autoSave();
    analyzeConnection(updated);
  } else {
    // Dropped on empty canvas or same group — restore original
    state.connections.push(orig);
    renderConnections();
  }
}

// Get the SVG-space center of a group's left or right port bubble
function portCenter(groupId, side = 'right') {
  const win = document.getElementById('win-' + groupId);
  if (!win) return { x1: 0, y1: 0 };
  const canvas = document.getElementById('canvas').getBoundingClientRect();
  const port = win.querySelector(side === 'right' ? '.win-port-right' : '.win-port-left');
  if (port) {
    const pr = port.getBoundingClientRect();
    return {
      x1: pr.left + pr.width / 2 - canvas.left,
      y1: pr.top  + pr.height / 2 - canvas.top
    };
  }
  const wr = win.getBoundingClientRect();
  return {
    x1: (side === 'right' ? wr.right : wr.left) - canvas.left,
    y1: wr.top + 10 - canvas.top
  };
}

// Cubic bezier path between two points
function bezier(x1, y1, x2, y2) {
  const cx = (x1 + x2) / 2;
  return `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`;
}

// ─────────────────────────────────────────────
//  Connection state management
// ─────────────────────────────────────────────
function createConnection(fromId, toId) {
  // No duplicates in either direction
  const exists = state.connections.some(c =>
    (c.fromGroupId === fromId && c.toGroupId === toId) ||
    (c.fromGroupId === toId   && c.toGroupId === fromId)
  );
  if (exists) return;

  const conn = { id: uid(), fromGroupId: fromId, toGroupId: toId, status: 'pending', analysis: null, shortLabel: null };
  state.connections.push(conn);
  renderConnections();
  autoSave();
  analyzeConnection(conn);
}

function deleteConnection(id) {
  state.connections = state.connections.filter(c => c.id !== id);
  renderConnections();
  autoSave();
  closeConnModal();
}

// ─────────────────────────────────────────────
//  Render all connection lines on the SVG
// ─────────────────────────────────────────────
function renderConnections() {
  const svg    = document.getElementById('connections-svg');
  const canvas = document.getElementById('canvas').getBoundingClientRect();

  // Remove previous permanent elements (keep defs + drawing path)
  svg.querySelectorAll('.conn-permanent, .conn-fo').forEach(el => el.remove());

  state.connections.forEach(conn => {
    const fromWin = document.getElementById('win-' + conn.fromGroupId);
    const toWin   = document.getElementById('win-' + conn.toGroupId);
    if (!fromWin || !toWin) return;

    const { x1, y1 } = portCenter(conn.fromGroupId, 'right');
    const { x1: x2, y1: y2 } = portCenter(conn.toGroupId, 'left');

    // Path
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', `conn-line conn-permanent ${conn.status}`);
    path.setAttribute('d', bezier(x1, y1, x2, y2));
    path.style.pointerEvents = 'visibleStroke';
    path.style.cursor = 'pointer';
    path.addEventListener('click', () => showConnModal(conn.id));
    svg.appendChild(path);

    // Label at midpoint via foreignObject
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const fw = 170, fh = 36;

    const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    fo.setAttribute('class', 'conn-fo');
    fo.setAttribute('x', midX - fw / 2);
    fo.setAttribute('y', midY - fh / 2);
    fo.setAttribute('width', fw);
    fo.setAttribute('height', fh);
    fo.style.pointerEvents = 'all';
    fo.style.overflow = 'visible';

    const labelDiv = document.createElement('div');
    labelDiv.className = 'conn-label ' + conn.status;

    if (conn.status === 'pending') {
      labelDiv.textContent = '⏳ Analyzing…';
    } else if (conn.status === 'error') {
      labelDiv.textContent = '⚠ Analysis failed';
    } else {
      labelDiv.textContent = conn.shortLabel || conn.analysis || '';
    }

    labelDiv.addEventListener('click', () => showConnModal(conn.id));
    fo.appendChild(labelDiv);
    svg.appendChild(fo);

    // Endpoint handles — drag to reconnect
    addConnHandle(svg, x1, y1, conn.id, 'from');
    addConnHandle(svg, x2, y2, conn.id, 'to');
  });
}

function addConnHandle(svg, cx, cy, connId, whichEnd) {
  // Invisible larger hit area
  const hit = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  hit.setAttribute('class', 'conn-permanent conn-handle-hit');
  hit.setAttribute('cx', cx); hit.setAttribute('cy', cy); hit.setAttribute('r', 12);
  hit.style.fill = 'transparent';
  hit.style.pointerEvents = 'all';
  hit.style.cursor = 'crosshair';

  // Visible dot
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('class', 'conn-permanent conn-handle');
  dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('r', 5);

  hit.addEventListener('mouseenter', () => dot.classList.add('conn-handle-hover'));
  hit.addEventListener('mouseleave', () => dot.classList.remove('conn-handle-hover'));
  hit.addEventListener('mousedown', (e) => startReconnect(e, connId, whichEnd));

  svg.appendChild(dot);
  svg.appendChild(hit);
}

// ─────────────────────────────────────────────
//  Rule-based relationship analysis (Finnhub profile data — no AI key needed)
// ─────────────────────────────────────────────
const profileCache = new Map();

async function fetchProfile(symbol) {
  if (profileCache.has(symbol)) return profileCache.get(symbol);
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`
    );
    const d = await res.json();
    profileCache.set(symbol, d);
    return d;
  } catch { return {}; }
}

// Maps finnhubIndustry strings to broad category keys
const IND_CAT = [
  [/E&P|Exploration.*Production|Crude.*Oil|Coal|Uranium|Natural Gas Prod/i, 'energy_prod'],
  [/Midstream|Pipeline/i,                                                     'energy_mid'],
  [/Refin|Oil.*Gas.*Market/i,                                                 'energy_ref'],
  [/Oil.*Gas.*Equip|Oil.*Gas.*Serv/i,                                         'energy_svc'],
  [/Utilit/i,                                                                  'utilities'],
  [/Airline|Aviation/i,                                                        'airlines'],
  [/Truck|Railroad|Rail |Marine.*Ship|Freight|Logistic/i,                     'transport'],
  [/Auto Manuf/i,                                                              'auto_oem'],
  [/Auto Part|Automotive Component/i,                                          'auto_parts'],
  [/Semiconductor Equip|Fab Equip/i,                                           'semi_equip'],
  [/Semiconductor|Chip Manuf/i,                                                'semis'],
  [/Consumer Electron|Electrical Equip|Electronic Comp/i,                     'tech_hw'],
  [/Software|Information Technology|IT Serv|Cloud Comput|Internet.*Content/i, 'software'],
  [/Gold|Silver|Platinum|Precious Metal/i,                                    'metals_prec'],
  [/Copper|Steel|Aluminum|Iron|Lithium|Battery Tech/i,                        'metals_ind'],
  [/Chemic/i,                                                                  'chemicals'],
  [/Agricultural|Farm Prod|Fertiliz/i,                                         'agriculture'],
  [/Packaged Food|Food Distrib|Grocery|Beverage/i,                            'food'],
  [/Retail|Department Store|E.commerce/i,                                      'retail'],
  [/Bank|Insurance|Asset Manag|Financial Serv|Credit/i,                       'finance'],
  [/Drug Manuf|Pharma|Biotech/i,                                               'pharma'],
  [/Healthcare|Medical Device|Hospital|Health Plan/i,                          'healthcare'],
  [/Defense|Aerospace/i,                                                       'defense'],
  [/Construct|Homebuilder/i,                                                   'construction'],
  [/Real Estate|REIT/i,                                                        'realestate'],
  [/Telecom|Wireless|Communication Serv/i,                                    'telecom'],
  [/Media|Entertainment|Broadcast/i,                                           'media'],
  [/Mining/i,                                                                  'mining'],
];

function categorize(industry) {
  for (const [re, cat] of IND_CAT) {
    if (re.test(industry || '')) return cat;
  }
  return 'other';
}

// Text-based categorizer for private company nodes (runs against name + description)
const TEXT_CAT_EXTRAS = [
  [/nuclear|fission|fast.?reactor|molten.?salt|SMR|small.?modular.?reactor/i, 'nuclear'],
  [/isotope|enrichment|enriched.?uranium|radioisotope|centrifuge.?enrich/i,   'nuclear_fuel'],
  [/wind.?farm|solar.?farm|renewable.?energy|clean.?energy|geotherm|hydro.?power/i, 'utilities'],
  [/battery.?storage|energy.?storage|grid.?storage/i,                         'metals_ind'],
  [/satellite|launch.?vehicle|space.?propuls|rocket.?engine/i,                 'defense'],
  [/therapeutics|biopharm|clinical.?stage|gene.?therapy/i,                    'pharma'],
  [/data.?cent|cloud.?infra/i,                                                'software'],
  [/mine|mining|ore.?extract|mineral.?extract/i,                              'mining'],
  [/land.?leas|mineral.?right|subsurface.?right/i,                           'realestate'],
  [/freight.?forward|third.?party.?logist/i,                                  'transport'],
];

function categorizeFromText(text) {
  for (const [re, cat] of TEXT_CAT_EXTRAS) {
    if (re.test(text || '')) return cat;
  }
  for (const [re, cat] of IND_CAT) {
    if (re.test(text || '')) return cat;
  }
  return 'other';
}

// Each entry: [fromCats, toCats, shortLabel, detailFn(nameA, nameB, indsA, indsB)]
// null for toCats means "matches anything"
const REL_TABLE = [
  [['nuclear'], ['nuclear_fuel','chemicals','energy_prod'],
   'Nuclear fuel sourcing',
   (a,b) => `${a} operates advanced nuclear reactors that require enriched isotopes and specialty nuclear materials produced by ${b}. This is a direct upstream supply relationship — ${b}'s enrichment capacity and material output are critical inputs to ${a}'s reactor fuel cycle.`],

  [['nuclear'], ['utilities','energy_mid'],
   'Power generation link',
   (a,b) => `${a} develops nuclear reactor technology that feeds into the electricity grid operated by ${b}. Nuclear capacity built by ${a} expands the zero-carbon baseload available to ${b}.`],

  [['nuclear','utilities'], ['nuclear_fuel'],
   'Nuclear material buyer',
   (a,b) => `${a} purchases enriched isotopes and specialty nuclear materials from ${b}. Supply agreements, enrichment capacity, and material pricing at ${b} are direct operational dependencies for ${a}'s reactor fleet.`],


  [['energy_prod','energy_mid','energy_ref'], ['utilities','airlines','transport'],
   'Fuel supplier → consumer',
   (a,b) => `${a} produces the fossil fuels that power ${b}'s operations. Rising energy prices compress ${b}'s margins while boosting ${a}'s revenues — an inverse cost relationship that makes them natural hedges.`],

  [['semis'], ['tech_hw','auto_oem'],
   'Chip supplier → OEM',
   (a,b) => `${a} manufactures the semiconductors embedded in ${b}'s products. Wafer capacity constraints, lead times, and chip pricing from ${a} are key supply-side risks for ${b}'s production schedules.`],

  [['semi_equip'], ['semis'],
   'Fab equipment supplier',
   (a,b) => `${a} makes the lithography and process tools that ${b} uses to manufacture chips. Capex expansion cycles at ${b} drive equipment orders for ${a}, creating a lagged demand relationship.`],

  [['metals_ind','mining'], ['auto_oem','auto_parts'],
   'Metal supplier → auto',
   (a,b) => `${a} supplies the steel, aluminum, and lithium that ${b} uses in vehicle manufacturing. Commodity price swings directly impact ${b}'s bill of materials and production margins.`],

  [['metals_ind','metals_prec','mining'], ['construction','defense'],
   'Structural material supplier',
   (a,b) => `${a} produces the metals and alloys that ${b} requires for projects and systems. Infrastructure budgets and defense procurement programs at ${b} are primary demand drivers for ${a}'s output.`],

  [['agriculture'], ['food','chemicals'],
   'Agricultural commodity link',
   (a,b) => `${a} supplies raw crops and agricultural inputs that ${b} processes into consumer products. Harvest conditions, weather shocks, and commodity indices in ${a} translate directly into ${b}'s cost structure.`],

  [['energy_prod','energy_mid'], ['chemicals'],
   'Petrochemical feedstock',
   (a,b) => `${a} provides the petroleum and natural gas that ${b} converts into specialty and bulk chemicals. Energy price volatility is one of the biggest cost drivers for ${b}'s plant operations.`],

  [['finance'], null,
   'Capital provider',
   (a,b) => `${a} provides the loans, credit facilities, and capital markets access that fund ${b}'s operations and expansion. Interest rate changes simultaneously raise ${b}'s borrowing costs and influence ${a}'s net interest margins.`],

  [['auto_parts'], ['auto_oem'],
   'Tier-1 supplier → OEM',
   (a,b) => `${a} supplies components directly to the vehicle manufacturers in ${b}. Production schedules and model-launch timing at ${b} dictate order volumes and revenue visibility for ${a}.`],

  [['telecom'], ['semis','tech_hw'],
   'Network infrastructure buyer',
   (a,b) => `${a} purchases chips and hardware from ${b} for network infrastructure and 5G rollouts. Telecom capex cycles create lumpy but significant demand signals for ${b}.`],

  [['pharma','healthcare'], ['chemicals'],
   'API & excipient sourcing',
   (a,b) => `${a} sources active pharmaceutical ingredients and excipients from ${b}'s specialty chemical operations. Regulatory changes affecting either side can disrupt this supply relationship.`],

  [['construction','realestate'], ['metals_ind','chemicals'],
   'Building material buyer',
   (a,b) => `${a} is a major downstream consumer of the materials produced by ${b}. Housing cycles and infrastructure spending create correlated demand swings across both groups.`],
];

function inferRelationship(nameA, catsA, nameB, catsB, indsA, indsB) {
  // Same-category overlap → competitors
  const overlap = catsA.filter(c => c !== 'other' && catsB.includes(c));
  if (overlap.length) {
    const ind = indsA[0] || 'the same industry';
    return {
      shortLabel: 'Industry competitors',
      analysis: `Both groups operate in ${ind}, making them direct competitors. Regulatory shifts, commodity cycles, and sector-wide sentiment affect both simultaneously, though relative execution determines divergence.`
    };
  }

  const hits = (cats, pattern) => pattern === null || cats.some(c => pattern.includes(c));

  for (const [from, to, label, detail] of REL_TABLE) {
    if (hits(catsA, from) && hits(catsB, to))
      return { shortLabel: label, analysis: detail(nameA, nameB, indsA, indsB) };
    // Check reversed direction
    if (hits(catsB, from) && hits(catsA, to))
      return { shortLabel: label, analysis: detail(nameB, nameA, indsB, indsA) };
  }

  const indStr = inds => inds.slice(0, 2).join(' & ') || null;
  const isUnknown = cats => !cats.length || cats.every(c => c === 'other');
  const hint = (isUnknown(catsA) || isUnknown(catsB))
    ? ` Add a description to any private company node (e.g. "nuclear reactor developer") so the analysis can identify the relationship.`
    : '';
  return {
    shortLabel: 'Cross-sector link',
    analysis: `${nameA}${indStr(indsA) ? ` (${indStr(indsA)})` : ''} and ${nameB}${indStr(indsB) ? ` (${indStr(indsB)})` : ''} share indirect macroeconomic exposure through interest rates, global trade flows, and consumer confidence cycles.${hint}`
  };
}

// ─────────────────────────────────────────────
//  Gemini AI analysis
// ─────────────────────────────────────────────
async function analyzeWithGemini(nameA, nameB, ctxA, ctxB) {
  const prompt = `You are a financial supply-chain analyst. Identify the economic or supply-chain relationship between these two entities.

Entity A — "${nameA}": ${ctxA}
Entity B — "${nameB}": ${ctxB}

Reply with EXACTLY two parts separated by a pipe "|":
1. A SHORT label (max 6 words) for the connection arrow
2. A full explanation (2-3 sentences) of the supply-chain or economic relationship. Where known, reference specific agreements, contracts, or dependencies between these particular entities.

Example: "Nuclear fuel sourcing | TerraPower's advanced reactors require enriched isotopes supplied by ASP Isotopes under a commercial agreement. This upstream dependency makes isotope enrichment capacity at ASP a critical input for TerraPower's fuel cycle."`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 280, temperature: 0.3 }
      })
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gemini ${res.status}: ${err.error?.message || 'unknown error'}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('empty Gemini response');
  return text;
}

// Resolves a node id to either a group or a company node
function findNode(id) {
  return state.groups.find(g => g.id === id) || state.companies.find(c => c.id === id) || null;
}

async function analyzeConnection(conn) {
  const fromG = findNode(conn.fromGroupId);
  const toG   = findNode(conn.toGroupId);
  if (!fromG || !toG) return;

  try {
    // Build { inds, cats, context } for any node type
    const nodeData = async (node) => {
      const stocks = node.stocks || [];
      if (stocks.length) {
        const profiles = await Promise.all(stocks.map(s => fetchProfile(s.symbol)));
        const uniq = arr => [...new Set(arr.filter(Boolean))];
        const inds = uniq(profiles.map(p => p.finnhubIndustry));
        const names = uniq(profiles.map(p => p.name).filter(Boolean));
        return {
          inds,
          cats: uniq(inds.map(categorize)),
          context: `Public stocks: ${stocks.map(s => s.symbol).join(', ')}${names.length ? ` (${names.slice(0,3).join(', ')})` : ''}. Finnhub industries: ${inds.join(', ') || 'unknown'}.`
        };
      }
      // Private company — categorize from name + description
      const text = `${node.name} ${node.description || ''}`;
      const cat  = categorizeFromText(text);
      return {
        inds: node.description ? [node.description] : [],
        cats: [cat],
        context: node.description
          ? `Private company. Description: ${node.description}.`
          : `Private company — no description set.`
      };
    };

    const [dataA, dataB] = await Promise.all([nodeData(fromG), nodeData(toG)]);

    let shortLabel, analysis;

    // Try Gemini first — it knows about specific companies and agreements
    if (GEMINI_KEY) {
      try {
        const raw    = await analyzeWithGemini(fromG.name, toG.name, dataA.context, dataB.context);
        const parts  = raw.split('|');
        shortLabel   = parts[0]?.trim() || raw.slice(0, 40);
        analysis     = parts[1]?.trim() || raw;
      } catch (geminiErr) {
        console.warn('Gemini analysis failed, using rule-based fallback:', geminiErr.message);
      }
    }

    // Rule-based fallback if Gemini unavailable or errored
    if (!shortLabel) {
      ({ shortLabel, analysis } = inferRelationship(
        fromG.name, dataA.cats, toG.name, dataB.cats, dataA.inds, dataB.inds
      ));
    }

    conn.shortLabel = shortLabel;
    conn.analysis   = analysis;
    conn.status     = 'done';
  } catch {
    conn.status     = 'error';
    conn.analysis   = 'Could not analyze this connection.';
    conn.shortLabel = 'Error';
  }

  renderConnections();
  autoSave();
  const overlay = document.getElementById('conn-overlay');
  if (!overlay.classList.contains('hidden') && overlay.dataset.connId === conn.id) {
    showConnModal(conn.id);
  }
}

// ─────────────────────────────────────────────
//  Connection detail modal
// ─────────────────────────────────────────────
function showConnModal(connId) {
  const conn  = state.connections.find(c => c.id === connId);
  if (!conn) return;
  const fromG = findNode(conn.fromGroupId);
  const toG   = findNode(conn.toGroupId);

  const overlay = document.getElementById('conn-overlay');
  overlay.dataset.connId = connId;

  const fillCard = (elId, node) => {
    const el = document.getElementById(elId);
    const detail = node?.stocks?.length
      ? node.stocks.map(s => s.symbol).join(' · ')
      : (node?.description || '(private company)');
    el.innerHTML = `<div class="cgc-name">${node?.name || 'Unknown'}</div>
      <div class="cgc-stocks">${detail}</div>`;
  };
  fillCard('conn-from-card', fromG);
  fillCard('conn-to-card',   toG);

  const textEl = document.getElementById('conn-analysis-text');
  if (conn.status === 'pending') {
    textEl.className = 'thinking';
    textEl.textContent = 'AI is analyzing the relationship…';
  } else {
    textEl.className = '';
    textEl.textContent = conn.analysis || '—';
  }

  document.getElementById('conn-reanalyze-btn').onclick = () => {
    conn.status = 'pending'; conn.analysis = null; conn.shortLabel = null;
    renderConnections();
    showConnModal(connId);
    analyzeConnection(conn);
  };
  document.getElementById('conn-delete-btn').onclick = () => deleteConnection(connId);

  overlay.classList.remove('hidden');
}

function closeConnModal(e) {
  if (e && e.target !== document.getElementById('conn-overlay')) return;
  document.getElementById('conn-overlay').classList.add('hidden');
}

// ─────────────────────────────────────────────
//  Mini chart tooltip
// ─────────────────────────────────────────────
const chartCache = new Map();
let chartTooltipEl = null;
let chartHoverTimer = null;

function showChartTooltip(symbol, name, anchor) {
  clearTimeout(chartHoverTimer);
  hideChartTooltip();

  // Show stub immediately — no delay, no flicker
  const tip = document.createElement('div');
  tip.className = 'chart-tooltip';
  tip.innerHTML = `
    <div class="ct-header">
      <span class="ct-symbol">${symbol}</span>
      <span class="ct-name">${name}</span>
    </div>
    <div class="ct-loading">Loading 1-year chart…</div>`;

  // Render off-screen first so we can measure height
  tip.style.visibility = 'hidden';
  tip.style.left = '-9999px';
  document.body.appendChild(tip);
  chartTooltipEl = tip;
  placeTooltip(tip, anchor);
  tip.style.visibility = '';

  // Fetch data and fill in chart
  fetchCandleData(symbol).then(data => {
    if (chartTooltipEl !== tip) return; // user moved away
    if (!data) {
      tip.querySelector('.ct-loading').textContent = 'No chart data available';
      return;
    }
    const closes = data.c;
    const latest = closes[closes.length - 1];
    const first  = closes[0];
    const chgPct = ((latest - first) / first * 100);
    const up     = chgPct >= 0;
    const startLbl = fmtMonth(data.t[0]);
    const endLbl   = fmtMonth(data.t[data.t.length - 1]);

    tip.innerHTML = `
      <div class="ct-header">
        <span class="ct-symbol">${symbol}</span>
        <span class="ct-name">${name}</span>
      </div>
      <div class="ct-price">
        <span>$${latest.toFixed(2)}</span>
        <span class="ct-chg ${up ? 'up' : 'down'}">${up ? '+' : ''}${chgPct.toFixed(2)}% (1Y)</span>
      </div>
      <div class="ct-spark">${sparklineSVG(closes, data.h, data.l, 260, 80)}</div>
      <div class="ct-footer">
        <span>${startLbl}</span>
        <span>H $${Math.max(...data.h).toFixed(2)} · L $${Math.min(...data.l).toFixed(2)}</span>
        <span>${endLbl}</span>
      </div>`;

    placeTooltip(tip, anchor);
  });
}

function hideChartTooltip() {
  clearTimeout(chartHoverTimer);
  if (chartTooltipEl) { chartTooltipEl.remove(); chartTooltipEl = null; }
}

function placeTooltip(tip, anchor) {
  const ar  = anchor.getBoundingClientRect();
  const tw  = tip.offsetWidth  || 286;
  const th  = tip.offsetHeight || 180;
  let left  = ar.left - tw - 12;
  let top   = ar.top + ar.height / 2 - th / 2;
  if (left < 8) left = ar.right + 12;
  if (left + tw > window.innerWidth - 8) left = 8;
  top = Math.max(8, Math.min(top, window.innerHeight - th - 8));
  tip.style.left = left + 'px';
  tip.style.top  = top + 'px';
}

function fmtMonth(unixSec) {
  return new Date(unixSec * 1000).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

async function fetchCandleData(symbol) {
  if (chartCache.has(symbol)) return chartCache.get(symbol);
  const to   = Math.floor(Date.now() / 1000);
  const from = to - 365 * 24 * 60 * 60; // 1 year
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${to}&token=${FINNHUB_KEY}`
    );
    const d = await res.json();
    if (d.s !== 'ok' || !d.c?.length) return null;
    chartCache.set(symbol, d);
    return d;
  } catch { return null; }
}

function sparklineSVG(closes, highs, lows, w, h) {
  if (closes.length < 2) return '';
  const min   = Math.min(...lows);
  const max   = Math.max(...highs);
  const range = max - min || 1;
  const padT  = 6, padB = 6;
  const up    = closes[closes.length - 1] >= closes[0];
  const color = up ? '#3fb950' : '#f85149';
  const fillC = up ? 'rgba(63,185,80,0.12)' : 'rgba(248,81,73,0.12)';
  const id    = 'grad-' + Math.random().toString(36).slice(2, 7);

  const pts = closes.map((p, i) => {
    const x = (i / (closes.length - 1)) * w;
    const y = padT + (1 - (p - min) / range) * (h - padT - padB);
    return [+x.toFixed(1), +y.toFixed(1)];
  });

  const lineStr = pts.map(([x, y]) => `${x},${y}`).join(' ');
  // Closed area path: line forward, then back along bottom
  const areaStr = `M${pts[0][0]},${h} ` +
    pts.map(([x, y]) => `L${x},${y}`).join(' ') +
    ` L${pts[pts.length-1][0]},${h} Z`;

  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${areaStr}" fill="url(#${id})"/>
    <polyline points="${lineStr}" fill="none" stroke="${color}" stroke-width="1.8"
      stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

// ─────────────────────────────────────────────
//  Utilities
// ─────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// Keyboard: Escape closes modals
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeModalDirect(); closeLoadDirect(); }
});

// Show hint on fresh page
window.addEventListener('load', () => {
  if (state.groups.length === 0) {
    showSearchMsg('Type a symbol or company name');
  }
  fetchAllPrices();
});

function showBanner(msg) {
  const b = document.createElement('div');
  b.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#2d2f31;border:1px solid #e3b341;color:#e3b341;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9998;max-width:520px;text-align:center;';
  b.textContent = msg;
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 8000);
}
