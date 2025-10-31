// Panel de Administración - Selección de número de equipos

const adminState = {
  playerCount: null,
  hasQuestion: false,
  currentBuzzer: null,
  board: null,
  currentQuestionKey: null,
  hideAnswers: false,
  scores: [],
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
  els.board = $('admin-board');
  els.btnCorrect = $('btn-correct');
  els.btnIncorrect = $('btn-incorrect');
  els.btnCancel = $('btn-cancel');
  els.actionStatus = $('admin-action-status');
  els.correctBox = $('admin-correct-box');
  els.correctLetter = $('admin-correct-letter');
  els.correctText = $('admin-correct-text');
  els.hideToggle = $('admin-hide-answers');
  els.hideStatus = $('hide-answers-status');
  els.scores = $('admin-scores');
  els.resetBtn = $('btn-reset-exercise');
  els.resetStatus = $('reset-status');
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
  // Habilitar/deshabilitar controles de pregunta
  const enabled = !!adminState.hasQuestion;
  [els.btnCorrect, els.btnIncorrect, els.btnCancel].forEach(b => { if (b) b.disabled = !enabled; });
  document.querySelectorAll('[data-answer]')?.forEach(btn => { btn.disabled = !enabled; });
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

  // Acciones de pregunta
  if (els.btnCorrect) els.btnCorrect.addEventListener('click', moderatorCorrectAdmin);
  if (els.btnIncorrect) els.btnIncorrect.addEventListener('click', moderatorIncorrectAdmin);
  if (els.btnCancel) els.btnCancel.addEventListener('click', cancelQuestionAdmin);
  document.querySelectorAll('[data-answer]')?.forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-answer'), 10);
      adminSubmitAnswer(idx);
    });
  });

  // Toggle de ocultar respuestas
  if (els.hideToggle) {
    els.hideToggle.addEventListener('change', () => {
      const hide = !!els.hideToggle.checked;
      const s = window.__adminSocketInstance || io();
      s.emit('toggle_hide_answers', { hide });
      renderHideAnswersStatus(hide);
    });
  }

  // Reinicio de ejercicio
  if (els.resetBtn) {
    els.resetBtn.addEventListener('click', resetExerciseAdmin);
  }
}

window.addEventListener('load', () => {
  initElements();
  setConn('Conectando…');

  const socket = io();
  // Guardar referencia global para otros handlers
  window.__adminSocketInstance = socket;
  window._lastSocket = socket;
  // Registrar este socket como admin para recibir respuesta correcta
  socket.emit('register_admin');
  attachHandlers(socket);

  // Estado inicial
  fetch('/api/game-state')
    .then(r => r.json())
    .then(gs => {
      adminState.playerCount = gs.player_count ?? (Array.isArray(gs.scores) ? gs.scores.length : 5);
      adminState.hasQuestion = !!gs.has_question;
      adminState.currentBuzzer = (typeof gs.current_buzzer === 'number') ? gs.current_buzzer : null;
      adminState.hideAnswers = !!gs.hide_answers;
      adminState.scores = Array.isArray(gs.scores) ? gs.scores.slice() : [];
      populateSelect(adminState.playerCount);
      updateStatus();
      // Cargar tablero inicial
      fetchBoard();
      // Sincronizar UI de ocultar respuestas
      if (els.hideToggle) els.hideToggle.checked = !!adminState.hideAnswers;
      renderHideAnswersStatus(!!adminState.hideAnswers);
      renderScores(adminState.scores);
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
  socket.on('close_question', () => { adminState.hasQuestion = false; adminState.currentBuzzer = null; updateStatus(); renderCorrectInfo(null); });
  socket.on('buzzer_activated', (d) => { adminState.currentBuzzer = d?.player ?? null; updateStatus(); });
  socket.on('stop_timer', () => { /* keep */ });
  socket.on('hide_answers_toggled', (d) => { adminState.hideAnswers = !!(d && d.hide); });
  socket.on('hide_answers_toggled', (d) => {
    const hide = !!(d && d.hide);
    adminState.hideAnswers = hide;
    if (els.hideToggle) els.hideToggle.checked = hide;
    renderHideAnswersStatus(hide);
  });
  socket.on('scores_update', (data) => {
    const scores = Array.isArray(data?.scores) ? data.scores : [];
    adminState.scores = scores.slice();
    renderScores(scores);
  });

  socket.on('question_opened_admin', (q) => {
    renderCorrectInfo(q);
  });

  socket.on('game_reset', (data) => {
    // Refrescar conteo de equipos y estado tras cargar
    if (Array.isArray(data?.scores)) {
      adminState.playerCount = data.scores.length;
      populateSelect(adminState.playerCount);
    }
    adminState.hasQuestion = false;
    adminState.currentBuzzer = null;
    updateStatus();
    setLoadStatus('Datos cargados (nueva ronda).', 'ok');
    fetchBoard();
    renderCorrectInfo(null);
    // Refrescar panel de puntajes con posibles cambios de tamaño
    const scores = Array.isArray(data?.scores) ? data.scores : adminState.scores;
    adminState.scores = scores.slice();
    renderScores(scores);
    setResetStatus('Ejercicio reiniciado.');
  });

  socket.on('question_opened', (q) => {
    if (q && typeof q.cat_idx === 'number' && typeof q.clue_idx === 'number') {
      adminState.currentQuestionKey = `${q.cat_idx}-${q.clue_idx}`;
      highlightCurrentQuestion();
    }
  });

  socket.on('answer_result', (r) => {
    // Si se cierra la pregunta, refrescar tablero para reflejar usada/correcta
    if (r && r.close_question) {
      adminState.currentQuestionKey = null;
      fetchBoard();
    }
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

// =============
// Tablero admin
// =============

function fetchBoard() {
  return fetch('/api/board')
    .then(r => r.json())
    .then(data => {
      adminState.board = data;
      renderAdminBoard(data);
    })
    .catch(() => {});
}

function renderAdminBoard(data) {
  if (!els.board) return;

  const categories = Array.isArray(data?.categories) ? data.categories : [];
  const used = new Set((data?.used || []).map(([c, r]) => `${c}-${r}`));
  const tileStatus = data?.tile_status || {};

  const cols = categories.length || 1;
  let maxClues = 0;
  categories.forEach(cat => { maxClues = Math.max(maxClues, (cat?.clues?.length || 0)); });

  els.board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  els.board.innerHTML = '';

  // Headers
  categories.forEach(cat => {
    const h = document.createElement('div');
    h.textContent = cat?.name || 'Categoría';
    h.style.background = 'rgba(255,255,255,0.06)';
    h.style.border = '1px solid rgba(255,255,255,0.12)';
    h.style.borderRadius = '8px';
    h.style.display = 'flex';
    h.style.alignItems = 'center';
    h.style.justifyContent = 'center';
    h.style.fontWeight = '700';
    els.board.appendChild(h);
  });

  for (let row = 0; row < maxClues; row += 1) {
    categories.forEach((cat, catIdx) => {
      const clue = cat?.clues?.[row];
      const cell = document.createElement('button');
      cell.style.borderRadius = '10px';
      cell.style.border = '1px solid rgba(255,255,255,0.12)';
      cell.style.background = 'linear-gradient(180deg, rgba(20,33,66,0.8) 0%, rgba(10,15,26,0.8) 100%)';
      cell.style.color = '#fff';
      cell.style.fontWeight = '700';
      cell.style.fontSize = '16px';
      cell.style.cursor = 'pointer';
      cell.style.display = 'flex';
      cell.style.alignItems = 'center';
      cell.style.justifyContent = 'center';

      if (!clue) {
        cell.textContent = '-';
        cell.disabled = true;
        cell.style.opacity = '0.4';
        els.board.appendChild(cell);
        return;
      }

      const key = `${catIdx}-${row}`;
      const status = tileStatus[`${catIdx},${row}`];
      const value = (typeof clue.value === 'number') ? clue.value : ((row + 1) * 100);
      cell.textContent = value;

      const unavailable = clue.unavailable === true;
      const alreadyUsed = used.has(`${catIdx}-${row}`) || status === 'used' || status === 'correct';
      const disabled = unavailable || alreadyUsed;

      if (disabled) {
        cell.disabled = true;
        cell.style.opacity = '0.5';
        if (status === 'correct') {
          cell.style.borderColor = 'rgba(76,175,80,0.7)';
        }
      } else {
        cell.addEventListener('click', () => openQuestionAdmin(catIdx, row));
        cell.addEventListener('mouseover', () => { cell.style.transform = 'scale(1.03)'; cell.style.transition = 'transform 0.1s ease'; });
        cell.addEventListener('mouseout', () => { cell.style.transform = 'scale(1)'; });
      }

      cell.dataset.key = key;
      els.board.appendChild(cell);
    });
  }

  highlightCurrentQuestion();
}

function highlightCurrentQuestion() {
  if (!els.board) return;
  els.board.querySelectorAll('button').forEach(btn => {
    btn.style.boxShadow = 'none';
  });
  if (!adminState.currentQuestionKey) return;
  const active = els.board.querySelector(`button[data-key="${adminState.currentQuestionKey}"]`);
  if (active) {
    active.style.boxShadow = '0 0 0 3px rgba(255,215,0,0.6)';
  }
}

function openQuestionAdmin(catIdx, clueIdx) {
  // Usar el socket global actual si existe en el namespace por defecto
  // Nota: si hubiera múltiples conexiones, se podría guardar la instancia.
  const s = (window.__adminSocketInstance) || window._lastSocket || null;
  try {
    // Intento de usar el socket creado en load (mantenido por cierres)
    // Si no, emito con una nueva conexión (ligero overhead pero funcional).
    const emitter = s || io();
    emitter.emit('open_question', { cat_idx: catIdx, clue_idx: clueIdx });
  } catch (e) {
    try { io().emit('open_question', { cat_idx, clue_idx }); } catch (_) {}
  }
}

function renderCorrectInfo(q) {
  if (!els.correctBox) return;
  let letter = '-';
  let text = '-';
  if (q) {
    const ans = typeof q.answer === 'number' ? q.answer : parseInt(q.answer, 10);
    const choices = Array.isArray(q.choices) ? q.choices : [];
    if (!Number.isNaN(ans) && ans >= 0 && ans < 26) {
      letter = String.fromCharCode(97 + ans);
    }
    // Preferir texto directo si existe para preguntas abiertas
    if (q.answer_text && String(q.answer_text).trim() !== '') {
      text = String(q.answer_text).trim();
    } else if (Array.isArray(choices) && ans >= 0 && ans < choices.length) {
      text = String(choices[ans] ?? '').trim();
    } else if (typeof q.answer_choice_text === 'string') {
      text = q.answer_choice_text.trim();
    }
  }
  els.correctLetter.textContent = letter;
  els.correctText.textContent = text || '-';
  els.correctBox.style.display = (text && text !== '-') ? 'block' : 'none';
}

function renderHideAnswersStatus(hide) {
  if (!els.hideStatus) return;
  els.hideStatus.textContent = hide ? 'Activado' : 'Desactivado';
}

// =================
// Puntajes (admin)
// =================

function renderScores(scores) {
  if (!els.scores) return;
  const count = scores.length || adminState.playerCount || 0;
  els.scores.innerHTML = '';
  for (let i = 0; i < count; i += 1) {
    const row = document.createElement('div');
    row.className = 'score-row';

    const name = document.createElement('div');
    name.className = 'score-name';
    name.textContent = `Equipo ${i + 1}`;

    const value = document.createElement('div');
    value.className = 'score-value';
    value.textContent = String(typeof scores[i] !== 'undefined' ? scores[i] : 0);
    value.id = `admin-score-${i}`;

    const controls = document.createElement('div');
    controls.className = 'score-controls';

    const minus = document.createElement('button');
    minus.className = 'btn-adjust minus btn-small';
    minus.textContent = '-100';
    minus.title = 'Restar 100';
    minus.addEventListener('click', () => adjustScoreAdmin(i, -100));

    const plus = document.createElement('button');
    plus.className = 'btn-adjust plus btn-small';
    plus.textContent = '+100';
    plus.title = 'Sumar 100';
    plus.addEventListener('click', () => adjustScoreAdmin(i, 100));

    const edit = document.createElement('button');
    edit.className = 'btn-primary btn-small';
    edit.textContent = 'Editar…';
    edit.addEventListener('click', () => editScoreAdmin(i));

    const reset = document.createElement('button');
    reset.className = 'btn-secondary btn-small';
    reset.textContent = 'Reiniciar';
    reset.addEventListener('click', () => resetScoreAdmin(i));

    controls.appendChild(minus);
    controls.appendChild(plus);
    controls.appendChild(edit);
    controls.appendChild(reset);

    row.appendChild(name);
    row.appendChild(value);
    row.appendChild(controls);
    els.scores.appendChild(row);
  }
}

function adjustScoreAdmin(playerIdx, delta) {
  const s = window.__adminSocketInstance || io();
  s.emit('adjust_score', { player: playerIdx, delta });
}

function editScoreAdmin(playerIdx) {
  const currentEl = document.getElementById(`admin-score-${playerIdx}`);
  const current = currentEl ? parseInt(currentEl.textContent, 10) || 0 : 0;
  const newStr = prompt(`Nuevo puntaje para Equipo ${playerIdx + 1}:`, String(current));
  if (newStr === null) return;
  const newScore = parseInt(newStr, 10);
  if (Number.isNaN(newScore)) return;
  setScoreAdmin(playerIdx, newScore);
}

function resetScoreAdmin(playerIdx) {
  if (!confirm(`¿Reiniciar puntaje del Equipo ${playerIdx + 1} a 0?`)) return;
  setScoreAdmin(playerIdx, 0);
}

function setScoreAdmin(playerIdx, score) {
  const s = window.__adminSocketInstance || io();
  s.emit('set_score', { player: playerIdx, score });
}

// ================
// Reinicio completo
// ================

function resetExerciseAdmin() {
  if (!confirm('¿Deseas reiniciar el ejercicio? Se perderán todos los puntajes y el tablero.')) {
    return;
  }
  setResetStatus('Reiniciando…');
  fetch('/api/reset', { method: 'POST' })
    .then(r => r.json())
    .then((data) => {
      if (data && data.success) {
        setResetStatus('Reinicio solicitado.');
      } else {
        throw new Error(data && data.error ? data.error : 'Error al reiniciar');
      }
    })
    .catch((err) => {
      setResetStatus(err.message || 'Error al reiniciar', 'error');
    });
}

function setResetStatus(text, variant) {
  if (!els.resetStatus) return;
  els.resetStatus.textContent = text;
  if (variant === 'error') {
    els.resetStatus.style.color = '#FF7F7F';
  } else {
    els.resetStatus.style.color = '#fff';
  }
}

function moderatorCorrectAdmin() {
  if (!adminState.hasQuestion) return setActionStatus('No hay pregunta activa.', 'warn');
  if (adminState.currentBuzzer == null) return setActionStatus('Ningún equipo tiene el turno.', 'warn');
  const s = window.__adminSocketInstance || io();
  s.emit('moderator_correct', { player: adminState.currentBuzzer });
}

function moderatorIncorrectAdmin() {
  if (!adminState.hasQuestion) return setActionStatus('No hay pregunta activa.', 'warn');
  if (adminState.currentBuzzer == null) return setActionStatus('Ningún equipo tiene el turno.', 'warn');
  const s = window.__adminSocketInstance || io();
  s.emit('moderator_incorrect', { player: adminState.currentBuzzer });
}

function cancelQuestionAdmin() {
  if (!adminState.hasQuestion) return setActionStatus('No hay pregunta activa.', 'warn');
  const s = window.__adminSocketInstance || io();
  s.emit('cancel_question');
}

function adminSubmitAnswer(index) {
  if (!adminState.hasQuestion) return setActionStatus('No hay pregunta activa.', 'warn');
  if (adminState.currentBuzzer == null) return setActionStatus('Ningún equipo tiene el turno.', 'warn');
  if (typeof index !== 'number' || index < 0 || index > 3) return;
  const s = window.__adminSocketInstance || io();
  s.emit('submit_answer', { player: adminState.currentBuzzer, answer: index });
}

function setActionStatus(text, variant) {
  if (!els.actionStatus) return;
  els.actionStatus.textContent = text;
  if (variant === 'warn') {
    els.actionStatus.style.color = '#FFD54F';
  } else if (variant === 'error') {
    els.actionStatus.style.color = '#FF7F7F';
  } else if (variant === 'ok') {
    els.actionStatus.style.color = '#90EE90';
  } else {
    els.actionStatus.style.color = '#fff';
  }
}

// Atajos de teclado: a,b,c,d para responder; Escape para cancelar
document.addEventListener('keydown', (e) => {
  if (!adminState.hasQuestion) return;
  const key = e.key.toLowerCase();
  if ('abcd'.includes(key)) {
    const idx = 'abcd'.indexOf(key);
    adminSubmitAnswer(idx);
  } else if (e.key === 'Escape') {
    cancelQuestionAdmin();
  }
});
