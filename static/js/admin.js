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
};

function $(id) { return document.getElementById(id); }

function initElements() {
  els.select = $('team-count-select');
  els.current = $('team-count-current');
  els.hasQuestion = $('has-question');
  els.currentBuzzer = $('current-buzzer');
  els.conn = $('admin-conn');
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
});

