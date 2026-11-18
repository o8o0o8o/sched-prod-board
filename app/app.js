import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000; // R4
const board = document.querySelector('[data-testid="board"]');
const list = board.querySelector('[data-testid="incident-list"]');
const loader = board.querySelector('[data-testid="loader"]');
const empty = board.querySelector('[data-testid="empty"]');
const errorBox = board.querySelector('[data-role="error"]');
const updated = document.querySelector('[data-role="updated"]');

const acked = new Map(); // id -> ackedAt; survives refreshes
const pending = new Set();

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

function renderAction(li) {
  const id = li.dataset.id;
  const slot = li.querySelector('.act');
  if (acked.has(id)) {
    if (!slot.querySelector('[data-testid="acked"]')) {
      slot.innerHTML = `<span data-testid="acked" class="acked">✓ acked</span>`;
    }
    li.classList.add('is-acked');
  } else if (!slot.querySelector('[data-testid="ack"]')) {
    slot.innerHTML = `<button type="button" data-testid="ack">Ack</button>`;
  }
  const btn = slot.querySelector('[data-testid="ack"]');
  if (btn) btn.disabled = pending.has(id);
}

// R1: keyed render, newest first. Existing rows are kept (not rebuilt), new ones go in at the top.
function render(incidents) {
  const sorted = [...incidents].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  const existing = new Map([...list.children].map((li) => [li.dataset.id, li]));
  let prev = null;
  for (const i of sorted) {
    let li = existing.get(i.id);
    if (!li) {
      li = document.createElement('li');
      li.setAttribute('data-testid', 'incident-row');
      li.dataset.id = i.id;
      li.className = `row ${i.severity}`;
      li.innerHTML = rowHtml(i);
      if (existing.size) li.classList.add('is-new');
    }
    existing.delete(i.id);
    renderAction(li);
    const want = prev ? prev.nextSibling : list.firstChild;
    if (want !== li) list.insertBefore(li, want);
    prev = li;
  }
  for (const gone of existing.values()) gone.remove();
  const none = sorted.length === 0;
  empty.hidden = !none;
  list.hidden = none;
}

// R2: Ack the row that was clicked, by its id.
list.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-testid="ack"]');
  if (!btn) return;
  const li = btn.closest('[data-testid="incident-row"]');
  const id = li.dataset.id;
  if (pending.has(id) || acked.has(id)) return;
  pending.add(id);
  renderAction(li);
  try {
    const reply = await ack(id);
    acked.set(id, reply.ackedAt);
    errorBox.hidden = true;
  } catch (err) {
    errorBox.textContent = `Ack ${id} failed: ${err.message}`;
    errorBox.hidden = false;
  } finally {
    pending.delete(id);
    renderAction(li);
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
