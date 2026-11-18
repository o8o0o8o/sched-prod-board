import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000; // R4
const board = document.querySelector('[data-testid="board"]');
const list = board.querySelector('[data-testid="incident-list"]');
const loader = board.querySelector('[data-testid="loader"]');
const empty = board.querySelector('[data-testid="empty"]');
const errorBox = board.querySelector('[data-role="error"]');
const updated = document.querySelector('[data-role="updated"]');
const panel = document.querySelector('[data-testid="incident-panel"]');
const panelId = panel.querySelector('[data-role="panel-id"]');
const panelFacts = panel.querySelector('[data-role="panel-facts"]');
const panelState = panel.querySelector('[data-role="panel-state"]');
const panelAck = panel.querySelector('[data-testid="panel-ack"]');

const byId = new Map(); // id -> incident (latest data)
const acked = new Map(); // id -> ackedAt; survives refreshes
const pending = new Set();
let selected = null; // the incident the panel is open on, by id (never by position)

// R5: viewer's local zone and locale order (en-GB/de/fr… give dd/mm, en-US gives mm/dd).
const fmt = new Intl.DateTimeFormat(navigator.languages?.[0] || navigator.language, {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
});
const localTime = (iso) => fmt.format(new Date(iso));

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function rowHtml(i) {
  return `<span class="id">${esc(i.id)}</span>
    <span class="sev">${esc(i.severity)}</span>
    <span class="what">${esc(i.service)} · ${esc(i.region)} · ${esc(i.summary)}</span>
    <time datetime="${esc(i.openedAt)}" title="${esc(i.openedAt)}">${esc(localTime(i.openedAt))}</time>
    <span class="act"></span>`;
}

// Rows carry no Ack (product, step 2): only the acked mark.
function renderRowState(li) {
  const id = li.dataset.id;
  const slot = li.querySelector('.act');
  if (acked.has(id) && !slot.querySelector('[data-testid="acked"]')) {
    slot.innerHTML = `<span data-testid="acked" class="acked">✓ acked</span>`;
    li.classList.add('is-acked');
  }
  li.classList.toggle('is-selected', id === selected);
  li.setAttribute('aria-selected', String(id === selected));
}

function renderPanel() {
  if (!selected) { panel.hidden = true; return; }
  const i = byId.get(selected);
  panel.hidden = false;
  panelId.textContent = selected;
  panelFacts.innerHTML = i
    ? `<dt>severity</dt><dd>${esc(i.severity)}</dd>
       <dt>service</dt><dd>${esc(i.service)} · ${esc(i.region)}</dd>
       <dt>summary</dt><dd>${esc(i.summary)}</dd>
       <dt>opened</dt><dd><time datetime="${esc(i.openedAt)}">${esc(localTime(i.openedAt))}</time></dd>`
    : '';
  if (acked.has(selected)) {
    panelState.textContent = `Acked at ${localTime(acked.get(selected))}`;
    panelAck.hidden = true;
  } else {
    panelState.textContent = '';
    panelAck.hidden = false;
    panelAck.textContent = `Ack ${selected}`;
    panelAck.disabled = pending.has(selected);
  }
}

// R1: keyed render, newest first. Existing rows are kept (never removed and rebuilt), new ones go in at the top.
function render(incidents) {
  const sorted = [...incidents].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  const existing = new Map([...list.children].map((li) => [li.dataset.id, li]));
  let prev = null;
  for (const i of sorted) {
    byId.set(i.id, i);
    let li = existing.get(i.id);
    if (!li) {
      li = document.createElement('li');
      li.setAttribute('data-testid', 'incident-row');
      li.dataset.id = i.id;
      li.className = `row ${i.severity}`;
      li.tabIndex = 0;
      li.innerHTML = rowHtml(i);
      if (existing.size) li.classList.add('is-new');
    }
    existing.delete(i.id);
    renderRowState(li);
    const want = prev ? prev.nextSibling : list.firstChild;
    if (want !== li) list.insertBefore(li, want);
    prev = li;
  }
  for (const gone of existing.values()) gone.remove();
  const none = sorted.length === 0;
  empty.hidden = !none;
  list.hidden = none;
  renderPanel();
}

function select(id) {
  selected = id;
  for (const li of list.children) renderRowState(li);
  renderPanel();
}

// A row opens its incident panel. The panel names the incident; Ack lives there.
list.addEventListener('click', (e) => {
  const li = e.target.closest('[data-testid="incident-row"]');
  if (li) select(li.dataset.id);
});
list.addEventListener('keydown', (e) => {
  const li = e.target.closest('[data-testid="incident-row"]');
  if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(li.dataset.id); }
});
panel.querySelector('[data-role="panel-close"]').addEventListener('click', () => select(null));

panelAck.addEventListener('click', async () => {
  const id = selected; // the id the panel names, not a row position
  if (!id || pending.has(id) || acked.has(id)) return;
  pending.add(id);
  renderPanel();
  try {
    const reply = await ack(id);
    acked.set(reply.id, reply.ackedAt);
    errorBox.hidden = true;
  } catch (err) {
    errorBox.textContent = `Ack ${id} failed: ${err.message}`;
    errorBox.hidden = false;
  } finally {
    pending.delete(id);
    const li = list.querySelector(`[data-testid="incident-row"][data-id="${CSS.escape(id)}"]`);
    if (li) renderRowState(li);
    renderPanel();
  }
});

let loaded = false;
async function tick() {
  try {
    const page = await fetchIncidents();
    render(page.incidents);
    updated.textContent = `updated ${new Date(page.updatedAt).toLocaleTimeString()}`;
    errorBox.hidden = true;
    if (!loaded) {
      loaded = true;
      loader.remove(); // R3: gone once incidents load
    }
  } catch (err) {
    errorBox.textContent = `Could not load incidents: ${err.message}`;
    errorBox.hidden = false;
  } finally {
    setTimeout(tick, REFRESH_MS); // R4: no overlapping requests
  }
}
tick();
