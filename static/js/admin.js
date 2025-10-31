// Panel de Administración - Selección de número de equipos

const adminState = {
  playerCount: null,
  hasQuestion: false,
  currentBuzzer: null,
};

const els = {
  select: null,
  current: null,
  hasQuestion: null,
  currentBuzzer: null,
  conn: null,
  pickBtn: null,
  fileInput: null,
  selectedFile: null,
  loadStatus: null,
};

function $(id) { return document.getElementById(id); }

function initElements() {
  els.select = $('team-count-select');
  els.current = $('team-count-current');
  els.hasQuestion = $('has-question');
  els.currentBuzzer = $('current-buzzer');
  els.conn = $('admin-conn');
  els.pickBtn = $('btn-pick-file');
  els.fileInput = $('file-input');
  els.selectedFile = $('selected-file');
  els.loadStatus = $('load-status');
}

function populateSelect(currentCount) {
  if (!els.select) return;
  els.select.innerHTML = '';
  for (let i = 2; i <= 10; i += 1) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `${i} equipos`;
    if (i === currentCount) opt.selected = true;
    els.select.appendChild(opt);
  }
}

function setConn(text) {
  if (els.conn) els.conn.textContent = text;
}

function updateStatus()
{
  if (els.current) els.current.textContent = String(adminState.playerCount ?? '-');
  if (els.hasQuestion) els.hasQuestion.textContent = adminState.hasQuestion ? 'Sí' : 'No';
  if (els.currentBuzzer) {
    els.currentBuzzer.textContent = (adminState.currentBuzzer == null) ? '-' : `Equipo ${adminState.currentBuzzer + 1}`;
  }
}

function attachHandlers(socket) {
  if (!els.select) return;
  els.select.addEventListener('change', (e) => {
    const next = parseInt(e.target.value, 10);
    if (!Number.isNaN(next) && next !== adminState.playerCount) {
      socket.emit('set_team_count', { count: next });
    }
  });

  if (els.pickBtn && els.fileInput) {
    els.pickBtn.addEventListener('click', () => {
      els.fileInput.click();
    });
    els.fileInput.addEventListener('change', handleFileSelection);
  }
}

window.addEventListener('load', () => {
  initElements();
  setConn('Conectando…');

  const socket = io();
  attachHandlers(socket);

  // Estado inicial
  fetch('/api/game-state')
    .then(r => r.json())
    .then(gs => {
      adminState.playerCount = gs.player_count ?? (Array.isArray(gs.scores) ? gs.scores.length : 5);
      adminState.hasQuestion = !!gs.has_question;
      adminState.currentBuzzer = (typeof gs.current_buzzer === 'number') ? gs.current_buzzer : null;
      populateSelect(adminState.playerCount);
      updateStatus();
    })
    .catch(() => {})
    .finally(() => setConn('Conectado'));

  // Eventos en tiempo real
  socket.on('connected', (data) => {
    const pc = data?.game_state?.player_count;
    if (typeof pc === 'number') {
      adminState.playerCount = pc;
      populateSelect(pc);
      updateStatus();
    }
  });

  socket.on('team_count_updated', (data) => {
    const scores = Array.isArray(data.scores) ? data.scores : [];
    const pc = typeof data.player_count === 'number' ? data.player_count : scores.length;
    if (pc) adminState.playerCount = pc;
    populateSelect(adminState.playerCount);
    updateStatus();
  });

  socket.on('question_opened', () => { adminState.hasQuestion = true; updateStatus(); });
  socket.on('close_question', () => { adminState.hasQuestion = false; adminState.currentBuzzer = null; updateStatus(); });
  socket.on('buzzer_activated', (d) => { adminState.currentBuzzer = d?.player ?? null; updateStatus(); });
  socket.on('stop_timer', () => { /* keep */ });

  socket.on('game_reset', (data) => {
    // Refrescar conteo de equipos y estado tras cargar
    if (Array.isArray(data?.scores)) {
      adminState.playerCount = data.scores.length;
      populateSelect(adminState.playerCount);
    }
    adminState.hasQuestion = false;
    adminState.currentBuzzer = null;
    updateStatus();
    setLoadStatus('Datos cargados y juego reiniciado', 'ok');
  });
});

function handleFileSelection(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  if (!file) return;

  if (els.selectedFile) els.selectedFile.textContent = file.name;
  setLoadStatus(`Cargando ${file.name}…`, 'info');

  const formData = new FormData();
  formData.append('file', file);

  fetch('/api/load-data', { method: 'POST', body: formData })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        setLoadStatus(data.message || 'Datos cargados correctamente', 'ok');
      } else {
        const msg = data.error || 'Error al cargar archivo';
        throw new Error(msg);
      }
    })
    .catch((err) => {
      setLoadStatus(err.message || 'Error al cargar archivo', 'error');
    })
    .finally(() => {
      input.value = '';
    });
}

function setLoadStatus(text, variant) {
  if (!els.loadStatus) return;
  els.loadStatus.textContent = text;
  if (variant === 'ok') {
    els.loadStatus.style.borderColor = 'rgba(76,175,80,0.6)';
    els.loadStatus.style.color = '#90EE90';
  } else if (variant === 'error') {
    els.loadStatus.style.borderColor = 'rgba(244,67,54,0.7)';
    els.loadStatus.style.color = '#FF7F7F';
  } else {
    els.loadStatus.style.borderColor = 'rgba(255,255,255,0.15)';
    els.loadStatus.style.color = '#fff';
  }
}
