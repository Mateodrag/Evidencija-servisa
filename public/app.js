(() => {
  'use strict';

  const API = '/api';

  // ---------- Pomoćne funkcije ----------

  function fmtDate(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}.`;
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function fmtKm(n) {
    if (n == null) return '—';
    return Number(n).toLocaleString('hr-HR') + ' km';
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function servisLabel(level) {
    switch (level) {
      case 'overdue': return 'Servis dospio';
      case 'soon': return 'Servis uskoro';
      case 'ok': return 'Servis u redu';
      default: return 'Nepoznato';
    }
  }

  function servisBadgeClass(level) {
    switch (level) {
      case 'overdue': return 'badge-overdue';
      case 'soon': return 'badge-soon';
      case 'ok': return 'badge-ok';
      default: return 'badge-unknown';
    }
  }

  let toastTimer;
  function toast(msg, isError) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  async function api(path, options) {
    const res = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error((data && data.error) || `Greška (${res.status})`);
    }
    return data;
  }

  // ---------- Stanje ----------

  let vehicles = [];
  let bazeList = [];
  let filters = { search: '', baza: '', status: '', servis: '' };

  // ---------- Elementi ----------

  const el = {
    listView: document.getElementById('view-list'),
    detailView: document.getElementById('view-detail'),
    bookingView: document.getElementById('view-booking'),
    bookingContent: document.getElementById('booking-content'),
    tabPopis: document.getElementById('tab-popis'),
    tabBooking: document.getElementById('tab-booking'),
    vehicleList: document.getElementById('vehicle-list'),
    summaryRow: document.getElementById('summary-row'),
    filterSearch: document.getElementById('filter-search'),
    filterBaza: document.getElementById('filter-baza'),
    filterStatus: document.getElementById('filter-status'),
    filterServis: document.getElementById('filter-servis'),
    detailContent: document.getElementById('detail-content'),
    btnBack: document.getElementById('btn-back'),
    btnAddVehicle: document.getElementById('btn-add-vehicle'),
    modalVehicle: document.getElementById('modal-vehicle'),
    formVehicle: document.getElementById('form-vehicle'),
    modalTitle: document.getElementById('modal-vehicle-title'),
    btnCancelVehicle: document.getElementById('btn-cancel-vehicle'),
    btnDeleteVehicle: document.getElementById('btn-delete-vehicle'),
    bazaOptions: document.getElementById('baza-options'),
  };

  function tipLabel(v) {
    if (!v) return '';
    if (v.tip === 'quad') return 'Quad';
    if (v.tip === 'buggy') {
      if (v.podtip === 'dvosjed') return 'Buggy (dvosjed)';
      if (v.podtip === 'cetverosjed') return 'Buggy (četverosjed)';
      return 'Buggy';
    }
    return '';
  }

  // ---------- Učitavanje podataka ----------

  async function loadVehicles() {
    el.vehicleList.innerHTML = '<p class="empty-hint">Učitavanje vozila...</p>';
    try {
      vehicles = await api('/vehicles');
      renderList();
    } catch (e) {
      el.vehicleList.innerHTML = `<p class="empty-hint">Greška pri učitavanju: ${escapeHtml(e.message)}</p>`;
    }
  }

  async function loadBaze() {
    try {
      bazeList = await api('/baze');
      el.filterBaza.innerHTML =
        '<option value="">Sve baze</option>' +
        bazeList.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
      el.bazaOptions.innerHTML = bazeList.map((b) => `<option value="${escapeHtml(b)}"></option>`).join('');
    } catch (e) {
      /* nije kritično */
    }
  }

  // ---------- Renderiranje popisa ----------

  function renderSummary(list) {
    const total = list.length;
    const overdue = list.filter((v) => v.servis_status === 'overdue').length;
    const soon = list.filter((v) => v.servis_status === 'soon').length;
    const neispravno = list.filter((v) => v.status === 'neispravno').length;
    const naslov = filters.baza ? `Ukupno vozila (${escapeHtml(filters.baza)})` : 'Ukupno vozila';

    el.summaryRow.innerHTML = `
      <div class="summary-chip"><strong>${total}</strong>${naslov}</div>
      <div class="summary-chip overdue"><strong>${overdue}</strong>Servis dospio</div>
      <div class="summary-chip soon"><strong>${soon}</strong>Servis uskoro</div>
      <div class="summary-chip overdue"><strong>${neispravno}</strong>Neispravno</div>
    `;
  }

  function applyFilters(list) {
    return list.filter((v) => {
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const hay = `${v.naziv || ''} ${v.registracija || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filters.baza && v.baza !== filters.baza) return false;
      if (filters.status && v.status !== filters.status) return false;
      if (filters.servis && v.servis_status !== filters.servis) return false;
      return true;
    });
  }

  function renderList() {
    const list = applyFilters(vehicles);
    renderSummary(list);

    if (list.length === 0) {
      el.vehicleList.innerHTML = '<p class="empty-hint">Nema vozila koja odgovaraju filteru.</p>';
      return;
    }

    el.vehicleList.innerHTML = list
      .map((v) => {
        const servisInfo =
          v.servis_status === 'unknown'
            ? 'Nema podataka o zadnjem servisu'
            : `Sljedeći: ${fmtDate(v.sljedeci_servis_datum)} / ${fmtKm(v.sljedeci_servis_km)}`;

        return `
        <div class="vehicle-card ${v.ima_nedostatak ? 'has-defect' : ''}" data-id="${v.id}">
          <div class="vehicle-card-top">
            <div>
              <div class="vehicle-name">${escapeHtml(v.naziv)}</div>
              <div class="vehicle-sub">${tipLabel(v) ? tipLabel(v) + ' · ' : ''}${escapeHtml(v.registracija || 'bez registracije')} ${v.baza ? '· ' + escapeHtml(v.baza) : ''}</div>
            </div>
            <div class="badges">
              <span class="badge ${v.status === 'neispravno' ? 'badge-neispravno' : 'badge-ispravno'}">${v.status === 'neispravno' ? 'Neispravno' : 'Ispravno'}</span>
              <span class="badge ${servisBadgeClass(v.servis_status)}">${servisLabel(v.servis_status)}</span>
              ${v.ima_nedostatak ? '<span class="badge badge-nedostatak">⚠️ Nedostatak</span>' : ''}
            </div>
          </div>
          <div class="vehicle-meta-row">
            <span>📍 ${escapeHtml(v.baza || 'baza nije postavljena')}</span>
            <span>🛣️ ${fmtKm(v.trenutna_kilometraza)}</span>
            <span>🔧 ${servisInfo}</span>
          </div>
        </div>`;
      })
      .join('');

    el.vehicleList.querySelectorAll('.vehicle-card').forEach((card) => {
      card.addEventListener('click', () => openDetail(card.dataset.id));
    });
  }

  // ---------- Detalji vozila ----------

  async function openDetail(id) {
    location.hash = `#/vozilo/${id}`;
    el.listView.classList.add('hidden');
    el.detailView.classList.remove('hidden');
    el.detailContent.innerHTML = '<p class="empty-hint">Učitavanje...</p>';

    try {
      const v = await api(`/vehicles/${id}`);
      renderDetail(v);
    } catch (e) {
      el.detailContent.innerHTML = `<p class="empty-hint">Greška: ${escapeHtml(e.message)}</p>`;
    }
  }

  function showListView() {
    location.hash = '';
    el.detailView.classList.add('hidden');
    el.bookingView.classList.add('hidden');
    el.listView.classList.remove('hidden');
    el.tabBooking.classList.remove('active');
    el.tabPopis.classList.add('active');
    loadVehicles();
    loadBaze();
  }

  // ---------- Booking - broj ispravnih quadova/buggyja po bazi ----------

  function renderBooking() {
    const groups = {};
    vehicles.forEach((v) => {
      if (v.status === 'neispravno') return; // booking broji samo ispravna (vozna) vozila
      const baza = v.baza && v.baza.trim() ? v.baza : 'Bez baze';
      if (!groups[baza]) groups[baza] = { quad: 0, dvosjed: 0, cetverosjed: 0, buggyNeoznaceno: 0 };
      if (v.tip === 'quad') {
        groups[baza].quad++;
      } else if (v.tip === 'buggy') {
        if (v.podtip === 'dvosjed') groups[baza].dvosjed++;
        else if (v.podtip === 'cetverosjed') groups[baza].cetverosjed++;
        else groups[baza].buggyNeoznaceno++;
      }
    });

    const bazaNames = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'hr'));

    if (!bazaNames.length) {
      el.bookingContent.innerHTML = '<p class="empty-hint">Nema unesenih vozila.</p>';
      return;
    }

    // Ukupno = zbroj quadova i buggyja (oba podtipa) - dakle sva ispravna, vozna vozila na toj bazi.
    function totalFor(g) {
      return g.quad + g.dvosjed + g.cetverosjed + g.buggyNeoznaceno;
    }

    // Pregled ukupnog broja vozila po lokaciji - za brzu usporedbu jedne baze s drugom.
    const overviewHtml = `
      <div class="summary-row">
        ${bazaNames
          .map((b) => `<div class="summary-chip"><strong>${totalFor(groups[b])}</strong>Ukupno vozila · ${escapeHtml(b)}</div>`)
          .join('')}
      </div>`;

    const cardsHtml = bazaNames
      .map((b) => {
        const g = groups[b];
        const items = [
          { num: g.quad, label: 'Quadova (ispravnih)' },
          { num: g.dvosjed, label: 'Buggy dvosjed (ispravnih)' },
          { num: g.cetverosjed, label: 'Buggy četverosjed (ispravnih)' },
        ];
        if (g.buggyNeoznaceno > 0) {
          items.push({ num: g.buggyNeoznaceno, label: '⚠️ Buggy bez oznake sjedišta' });
        }
        return `
      <div class="panel booking-card">
        <h3>📍 ${escapeHtml(b)} <span class="booking-total-badge">${totalFor(g)} vozila ukupno</span></h3>
        <div class="booking-counts">
          ${items
            .map(
              (it) => `
          <div class="booking-count-item">
            <span class="booking-count-num">${it.num}</span>
            <span>${it.label}</span>
          </div>`
            )
            .join('')}
        </div>
      </div>`;
      })
      .join('');

    el.bookingContent.innerHTML = overviewHtml + cardsHtml;
  }

  function showBookingView() {
    location.hash = '#/booking';
    el.detailView.classList.add('hidden');
    el.listView.classList.add('hidden');
    el.bookingView.classList.remove('hidden');
    el.tabPopis.classList.remove('active');
    el.tabBooking.classList.add('active');

    if (vehicles.length) {
      renderBooking();
    } else {
      el.bookingContent.innerHTML = '<p class="empty-hint">Učitavanje...</p>';
      api('/vehicles')
        .then((list) => {
          vehicles = list;
          renderBooking();
        })
        .catch((e) => {
          el.bookingContent.innerHTML = `<p class="empty-hint">Greška: ${escapeHtml(e.message)}</p>`;
        });
    }
  }

  el.tabPopis.addEventListener('click', showListView);
  el.tabBooking.addEventListener('click', showBookingView);

  function renderDetail(v) {
    const servisInfo =
      v.servis_status === 'unknown'
        ? '<p class="empty-hint" style="padding:0;text-align:left;">Nema još unesenog servisa - unesi prvi servis ispod.</p>'
        : `<div class="info-grid">
            <div><span>Sljedeći servis (datum)</span><strong>${fmtDate(v.sljedeci_servis_datum)}</strong></div>
            <div><span>Sljedeći servis (km)</span><strong>${fmtKm(v.sljedeci_servis_km)}</strong></div>
            <div><span>Zadnji servis (datum)</span><strong>${fmtDate(v.zadnji_servis_datum)}</strong></div>
            <div><span>Zadnji servis (km)</span><strong>${fmtKm(v.zadnji_servis_km)}</strong></div>
          </div>`;

    el.detailContent.innerHTML = `
      <div class="detail-header">
        <div class="detail-header-top">
          <div>
            <h2>${escapeHtml(v.naziv)}</h2>
            <div class="vehicle-sub">${tipLabel(v) ? tipLabel(v) + ' · ' : ''}${escapeHtml(v.registracija || 'bez registracije')} ${v.baza ? '· 📍 ' + escapeHtml(v.baza) : ''}</div>
          </div>
          <div class="badges">
            <span class="badge ${servisBadgeClass(v.servis_status)}" style="font-size:0.85rem;">${servisLabel(v.servis_status)}</span>
            ${v.ima_nedostatak ? '<span class="badge badge-nedostatak" style="font-size:0.85rem;">⚠️ Nedostatak</span>' : ''}
          </div>
        </div>

        <div class="status-toggle" style="margin-top:14px;">
          <button id="btn-status-ispravno" class="${v.status !== 'neispravno' ? 'active-ispravno' : ''}">✅ Ispravno</button>
          <button id="btn-status-neispravno" class="${v.status === 'neispravno' ? 'active-neispravno' : ''}">⛔ Neispravno</button>
        </div>

        ${servisInfo}

        <div class="detail-actions">
          <button id="btn-edit-vehicle" class="btn btn-secondary btn-sm">✏️ Uredi podatke vozila</button>
        </div>
      </div>

      <div class="panel">
        <h3>📋 Kontrola vozila</h3>
        <p class="field-hint" style="margin-top:-6px;">Upiši trenutnu kilometražu i svoje ime svaki put kad preuzmeš/vratiš vozilo. Ako primijetiš kvar ili nedostatak, upiši ga odmah ovdje - automatski će se dodati i u napomene ispod.</p>

        <form id="form-kontrola" class="inline-form">
          <div class="grid-2">
            <label>Trenutna kilometraža *
              <input type="number" id="k-km" min="0" required placeholder="npr. 132500" value="${v.trenutna_kilometraza || ''}" />
            </label>
            <label>Ime i prezime *
              <input type="text" id="k-ime" required placeholder="Tvoje ime" />
            </label>
          </div>
          <label>Uočeni nedostaci (ostavi prazno ako je sve u redu)
            <textarea id="k-nedostaci" rows="2" placeholder="npr. Čudan zvuk pri kočenju"></textarea>
          </label>
          <button type="submit" class="btn btn-primary btn-full">✅ Spremi kontrolu</button>
        </form>

        ${
          v.kontrole && v.kontrole.length
            ? `<div id="kontrole-list" style="margin-top:14px;">
                ${v.kontrole
                  .slice(0, 5)
                  .map(
                    (k) => `
                  <div class="record-item">
                    <div class="record-top"><span>${fmtDate(k.datum)}</span><span>${fmtKm(k.kilometraza)}</span></div>
                    <div class="record-desc">${k.nedostaci ? escapeHtml(k.nedostaci) : 'Nema uočenih nedostataka'}</div>
                    <div class="record-author">Unio/la: ${escapeHtml(k.ime || 'Nepoznato')}</div>
                  </div>`
                  )
                  .join('')}
              </div>`
            : ''
        }
      </div>

      <div class="panel">
        <h3>🔧 Povijest servisa</h3>
        <div id="service-records">
          ${
            v.service_records.length
              ? v.service_records
                  .map(
                    (s) => `
              <div class="record-item">
                <div class="record-top"><span>${s.redni_broj}. servis · ${fmtDate(s.datum)}</span><span>${fmtKm(s.kilometraza)}</span></div>
                ${s.opis ? `<div class="record-desc">${escapeHtml(s.opis)}</div>` : ''}
                ${s.izvrsio ? `<div class="record-author">Unio/la: ${escapeHtml(s.izvrsio)}</div>` : ''}
              </div>`
                  )
                  .join('')
              : '<p class="empty-hint" style="padding:10px 0;">Još nema unesenih servisa.</p>'
          }
        </div>

        <form id="form-service" class="inline-form">
          <p class="field-hint" style="margin-top:0;">Ovaj unos će biti označen kao <strong>${v.service_records.length + 1}. servis</strong>.</p>
          <div class="grid-2">
            <label>Datum servisa
              <input type="date" id="s-datum" required value="${todayISO()}" />
            </label>
            <label>Kilometraža
              <input type="number" id="s-km" min="0" placeholder="npr. 132000" />
            </label>
          </div>
          <label>Opis izvršenih radova
            <textarea id="s-opis" rows="2" placeholder="npr. Zamjena ulja i filtera"></textarea>
          </label>
          <label>Unio/la (ime i prezime)
            <input type="text" id="s-izvrsio" placeholder="Tvoje ime" />
          </label>
          <button type="submit" class="btn btn-primary btn-full">+ Dodaj servis</button>
        </form>
      </div>

      <div class="panel">
        <h3>📝 Napomene / uočeni nedostaci</h3>
        <div id="notes-list">
          ${
            v.notes.length
              ? v.notes
                  .map(
                    (n) => `
              <div class="note-item ${n.rijeseno ? 'note-resolved' : ''}" data-id="${n.id}">
                <div class="note-top">
                  <label style="display:flex;align-items:center;gap:6px;margin:0;font-weight:400;">
                    <input type="checkbox" class="note-resolve-cb" data-id="${n.id}" ${n.rijeseno ? 'checked' : ''} style="width:auto;margin:0;" />
                    ${n.rijeseno ? 'Riješeno' : 'Neriješeno'}
                  </label>
                  <button class="btn btn-link btn-sm note-delete" data-id="${n.id}">Obriši</button>
                </div>
                <div class="note-text">${escapeHtml(n.tekst)}</div>
                <div class="note-meta">${escapeHtml(n.autor || 'Nepoznato')} · ${fmtDate((n.created_at || '').slice(0, 10))}</div>
              </div>`
                  )
                  .join('')
              : '<p class="empty-hint" style="padding:10px 0;">Nema unesenih napomena.</p>'
          }
        </div>

        <form id="form-note" class="inline-form">
          <label>Napomena / uočeni nedostatak
            <textarea id="n-tekst" rows="2" required placeholder="npr. Čudan zvuk pri kočenju"></textarea>
          </label>
          <label>Ime i prezime
            <input type="text" id="n-autor" placeholder="Tvoje ime" />
          </label>
          <button type="submit" class="btn btn-primary btn-full">+ Dodaj napomenu</button>
        </form>
      </div>
    `;

    // --- Event listeneri detalja ---
    document.getElementById('btn-edit-vehicle').addEventListener('click', () => openVehicleModal(v));

    document.getElementById('btn-status-ispravno').addEventListener('click', () => updateStatus(v.id, 'ispravno'));
    document.getElementById('btn-status-neispravno').addEventListener('click', () => updateStatus(v.id, 'neispravno'));

    document.getElementById('form-kontrola').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api(`/vehicles/${v.id}/kontrola`, {
          method: 'POST',
          body: JSON.stringify({
            kilometraza: document.getElementById('k-km').value,
            ime: document.getElementById('k-ime').value,
            nedostaci: document.getElementById('k-nedostaci').value,
          }),
        });
        toast('Kontrola spremljena.');
        openDetail(v.id);
      } catch (err) {
        toast(err.message, true);
      }
    });

    document.getElementById('form-service').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api(`/vehicles/${v.id}/service`, {
          method: 'POST',
          body: JSON.stringify({
            datum: document.getElementById('s-datum').value,
            kilometraza: document.getElementById('s-km').value || null,
            opis: document.getElementById('s-opis').value,
            izvrsio: document.getElementById('s-izvrsio').value,
          }),
        });
        toast('Servis dodan.');
        openDetail(v.id);
      } catch (err) {
        toast(err.message, true);
      }
    });

    document.getElementById('form-note').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api(`/vehicles/${v.id}/notes`, {
          method: 'POST',
          body: JSON.stringify({
            tekst: document.getElementById('n-tekst').value,
            autor: document.getElementById('n-autor').value,
          }),
        });
        toast('Napomena dodana.');
        openDetail(v.id);
      } catch (err) {
        toast(err.message, true);
      }
    });

    el.detailContent.querySelectorAll('.note-resolve-cb').forEach((cb) => {
      cb.addEventListener('change', async () => {
        try {
          await api(`/notes/${cb.dataset.id}`, {
            method: 'PUT',
            body: JSON.stringify({ rijeseno: cb.checked }),
          });
          openDetail(v.id);
        } catch (err) {
          toast(err.message, true);
        }
      });
    });

    el.detailContent.querySelectorAll('.note-delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Obrisati ovu napomenu?')) return;
        try {
          await api(`/notes/${btn.dataset.id}`, { method: 'DELETE' });
          openDetail(v.id);
        } catch (err) {
          toast(err.message, true);
        }
      });
    });
  }

  async function updateStatus(id, status) {
    try {
      await api(`/vehicles/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
      toast('Status ažuriran.');
      openDetail(id);
    } catch (err) {
      toast(err.message, true);
    }
  }

  // ---------- Modal: dodaj / uredi vozilo ----------

  function openVehicleModal(vehicle) {
    el.formVehicle.reset();
    document.getElementById('v-id').value = vehicle ? vehicle.id : '';
    el.modalTitle.textContent = vehicle ? 'Uredi vozilo' : 'Novo vozilo';
    el.btnDeleteVehicle.classList.toggle('hidden', !vehicle);

    document.getElementById('v-naziv').value = vehicle ? vehicle.naziv : '';
    document.getElementById('v-registracija').value = vehicle ? vehicle.registracija || '' : '';
    document.getElementById('v-baza').value = vehicle ? vehicle.baza || '' : '';
    document.getElementById('v-status').value = vehicle ? vehicle.status : 'ispravno';
    document.getElementById('v-tip').value = vehicle ? vehicle.tip || '' : '';
    document.getElementById('v-podtip').value = vehicle ? vehicle.podtip || '' : '';
    togglePodtipField();
    document.getElementById('v-km').value = vehicle ? vehicle.trenutna_kilometraza || '' : '';
    document.getElementById('v-zadnji-datum').value = vehicle ? vehicle.zadnji_servis_datum || '' : '';
    document.getElementById('v-zadnji-km').value = vehicle ? vehicle.zadnji_servis_km || '' : '';
    document.getElementById('v-prvi-servis-km').value = vehicle ? vehicle.prvi_servis_km || 500 : 500;
    document.getElementById('v-interval-mj').value = vehicle ? vehicle.interval_mjeseci || 6 : 6;
    document.getElementById('v-interval-km').value = vehicle ? vehicle.interval_km || 1500 : 1500;

    el.modalVehicle.classList.remove('hidden');
  }

  function closeVehicleModal() {
    el.modalVehicle.classList.add('hidden');
  }

  function togglePodtipField() {
    const isBuggy = document.getElementById('v-tip').value === 'buggy';
    document.getElementById('v-podtip-wrap').classList.toggle('hidden', !isBuggy);
    if (!isBuggy) document.getElementById('v-podtip').value = '';
  }

  document.getElementById('v-tip').addEventListener('change', togglePodtipField);

  el.btnAddVehicle.addEventListener('click', () => openVehicleModal(null));
  el.btnCancelVehicle.addEventListener('click', closeVehicleModal);
  el.modalVehicle.addEventListener('click', (e) => {
    if (e.target === el.modalVehicle) closeVehicleModal();
  });

  el.formVehicle.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('v-id').value;
    const payload = {
      naziv: document.getElementById('v-naziv').value,
      registracija: document.getElementById('v-registracija').value,
      baza: document.getElementById('v-baza').value,
      status: document.getElementById('v-status').value,
      tip: document.getElementById('v-tip').value || null,
      podtip: document.getElementById('v-tip').value === 'buggy' ? (document.getElementById('v-podtip').value || null) : null,
      trenutna_kilometraza: document.getElementById('v-km').value || 0,
      zadnji_servis_datum: document.getElementById('v-zadnji-datum').value || null,
      zadnji_servis_km: document.getElementById('v-zadnji-km').value || null,
      prvi_servis_km: document.getElementById('v-prvi-servis-km').value || 500,
      interval_mjeseci: document.getElementById('v-interval-mj').value || 6,
      interval_km: document.getElementById('v-interval-km').value || 1500,
    };

    try {
      if (id) {
        await api(`/vehicles/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast('Vozilo ažurirano.');
        closeVehicleModal();
        openDetail(id);
      } else {
        const created = await api('/vehicles', { method: 'POST', body: JSON.stringify(payload) });
        toast('Vozilo dodano.');
        closeVehicleModal();
        await loadBaze();
        openDetail(created.id);
      }
    } catch (err) {
      toast(err.message, true);
    }
  });

  el.btnDeleteVehicle.addEventListener('click', async () => {
    const id = document.getElementById('v-id').value;
    if (!id) return;
    if (!confirm('Obrisati ovo vozilo i cijelu njegovu povijest? Ova radnja se ne može poništiti.')) return;
    try {
      await api(`/vehicles/${id}`, { method: 'DELETE' });
      toast('Vozilo obrisano.');
      closeVehicleModal();
      showListView();
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---------- Filteri ----------

  el.filterSearch.addEventListener('input', (e) => {
    filters.search = e.target.value;
    renderList();
  });
  el.filterBaza.addEventListener('change', (e) => {
    filters.baza = e.target.value;
    renderList();
  });
  el.filterStatus.addEventListener('change', (e) => {
    filters.status = e.target.value;
    renderList();
  });
  el.filterServis.addEventListener('change', (e) => {
    filters.servis = e.target.value;
    renderList();
  });

  el.btnBack.addEventListener('click', showListView);

  // ---------- Pokretanje / routing ----------

  function boot() {
    const hash = location.hash;
    const match = hash.match(/^#\/vozilo\/(\d+)/);
    loadBaze();
    if (match) {
      el.listView.classList.add('hidden');
      el.detailView.classList.remove('hidden');
      openDetail(match[1]);
    } else if (hash === '#/booking') {
      el.listView.classList.add('hidden');
      showBookingView();
    } else {
      loadVehicles();
    }
  }

  boot();
})();
