// =============================
// Panel de Administración (IIFE)
// =============================
// Objetivo: centralizar lógica, reducir duplicación y documentar el flujo.
// NOTA: No se cambia la funcionalidad; solo organización y comentarios.

(function AdminPanel() {
  'use strict';

  // -----------------------------
  // Estado global del panel admin
  // -----------------------------
  const state = {
    playerCount: null,
    hasQuestion: false,
    currentBuzzer: null,
    board: null,
    currentQuestionKey: null,
    hideAnswers: false,
    scores: [],
  };

  // -----------------------------
  // Referencias al DOM (se cachean)
  // -----------------------------
  const els = {};
  function $(id) { return document.getElementById(id); }
  function cacheElements() {
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
    els.scoresRoot = $('admin-scores');
    els.resetBtn = $('btn-reset-exercise');
    els.resetStatus = $('reset-status');
  }

  // -----------------------------
  // Sistema de Pestañas
  // -----------------------------
  function initTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        const targetTab = button.getAttribute('data-tab');

        // Remover clase active de todos los botones y contenidos
        tabButtons.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));

        // Añadir clase active al botón y contenido seleccionados
        button.classList.add('active');
        const targetContent = document.getElementById(targetTab);
        if (targetContent) {
          targetContent.classList.add('active');
        }
      });
    });
  }

  // -----------------------------
  // Socket.IO (única instancia)
  // -----------------------------
  function getSocket() {
    if (window.__adminSocketInstance) return window.__adminSocketInstance;
    const socket = io();
    window.__adminSocketInstance = socket;
    window._lastSocket = socket; // compat histórico
    // Registrar este cliente como admin para recibir datos completos
    socket.emit('register_admin');
    wireSocketEvents(socket);
    return socket;
  }

  // -----------------------------
  // Eventos Socket.IO
  // -----------------------------
  function wireSocketEvents(socket) {
    socket.on('connected', (data) => {
      // Sincronizar por si llega antes que el fetch inicial
      const gs = data?.game_state || {};
      if (typeof gs.player_count === 'number') state.playerCount = gs.player_count;
      if (Array.isArray(gs.scores)) state.scores = gs.scores.slice();
      renderTeamCountSelect(state.playerCount || (state.scores.length || 5));
      updateStatus();
    });

    socket.on('team_count_updated', (data) => {
      const scores = Array.isArray(data?.scores) ? data.scores : [];
      const pc = typeof data?.player_count === 'number' ? data.player_count : scores.length;
      if (pc) state.playerCount = pc;
      state.currentBuzzer = (typeof data?.current_buzzer === 'number') ? data.current_buzzer : null;
      state.hasQuestion = !!data?.has_question; // por si llega, aunque no siempre viene
      renderTeamCountSelect(state.playerCount);
      renderScores(scores);
      updateStatus();
    });

    socket.on('question_opened', (q) => {
      state.hasQuestion = true;
      if (q && typeof q.cat_idx === 'number' && typeof q.clue_idx === 'number') {
        state.currentQuestionKey = `${q.cat_idx}-${q.clue_idx}`;
        highlightCurrentQuestion();
      }
      updateStatus();
    });

    socket.on('question_opened_admin', (q) => {
      // Contiene siempre la información completa, incluso en modo oculto
      renderCorrectInfo(q);
    });

    socket.on('answer_result', (r) => {
      // Si se cierra la pregunta, refrescar tablero y limpiar resaltado
      if (r && r.close_question) {
        state.currentQuestionKey = null;
        fetchBoard();
      }
    });

    socket.on('close_question', () => {
      state.hasQuestion = false;
      state.currentBuzzer = null;
      updateStatus();
      renderCorrectInfo(null);
    });

    socket.on('buzzer_activated', (d) => {
      state.currentBuzzer = d?.player ?? null;
      updateStatus();
    });

    socket.on('stop_timer', () => { /* noop: admin no muestra timer */ });

    socket.on('time_up', () => {
      // Informar al moderador que debe decidir manualmente
      setActionStatus('Tiempo agotado: el moderador debe decidir.', 'warn');
    });

    socket.on('hide_answers_toggled', (d) => {
      const hide = !!(d && d.hide);
      state.hideAnswers = hide;
      if (els.hideToggle) els.hideToggle.checked = hide;
      renderHideAnswersStatus(hide);
    });

    socket.on('scores_update', (data) => {
      const scores = Array.isArray(data?.scores) ? data.scores : [];
      state.scores = scores.slice();
      renderScores(scores);
    });

    socket.on('game_reset', (data) => {
      // Nueva ronda o reinicio completo
      if (Array.isArray(data?.scores)) {
        state.playerCount = data.scores.length;
        state.scores = data.scores.slice();
      }
      state.hasQuestion = false;
      state.currentBuzzer = null;
      updateStatus();
      setLoadStatus('Datos cargados (nueva ronda).', 'ok');
      fetchBoard();
      renderCorrectInfo(null);
      renderScores(state.scores);
      setResetStatus('Ejercicio reiniciado.');
    });
  }

  // -----------------------------
  // Inicialización
  // -----------------------------
  function init() {
    cacheElements();
    initTabs(); // Inicializar sistema de pestañas
    renderQuestionBanks(); // Cargar bancos de preguntas guardados
    setConn('Conectando…');

    // Inicializar socket y eventos
    const socket = getSocket();

    // DOM events
    wireDomEvents(socket);

    // Cargar estado inicial del servidor
    fetch('/api/game-state')
      .then(r => r.json())
      .then(gs => {
        state.playerCount = gs.player_count ?? (Array.isArray(gs.scores) ? gs.scores.length : 5);
        state.hasQuestion = !!gs.has_question;
        state.currentBuzzer = (typeof gs.current_buzzer === 'number') ? gs.current_buzzer : null;
        state.hideAnswers = !!gs.hide_answers;
        state.scores = Array.isArray(gs.scores) ? gs.scores.slice() : [];

        renderTeamCountSelect(state.playerCount);
        updateStatus();
        fetchBoard();

        if (els.hideToggle) els.hideToggle.checked = !!state.hideAnswers;
        renderHideAnswersStatus(!!state.hideAnswers);
        renderScores(state.scores);
      })
      .catch(() => {})
      .finally(() => setConn('Conectado'));

    // Atajos: a/b/c/d para responder, Esc para cancelar
    document.addEventListener('keydown', (e) => {
      if (!state.hasQuestion) return;
      const key = e.key.toLowerCase();
      if ('abcd'.includes(key)) {
        const idx = 'abcd'.indexOf(key);
        adminSubmitAnswer(idx);
      } else if (e.key === 'Escape') {
        cancelQuestionAdmin();
      }
    });
  }

  // -----------------------------
  // DOM: wiring de handlers
  // -----------------------------
  let suppressTeamCountChange = false;

  function wireDomEvents(socket) {
    // Selector de equipos
    if (els.select) {
      els.select.addEventListener('change', (e) => {
        if (suppressTeamCountChange) return;
        const next = parseInt(e.target.value, 10);
        if (!Number.isNaN(next) && next !== state.playerCount) {
          socket.emit('set_team_count', { count: next });
        }
      });
    }

    // Carga de archivo
    if (els.pickBtn && els.fileInput) {
      els.pickBtn.addEventListener('click', () => els.fileInput.click());
      els.fileInput.addEventListener('change', handleFileSelection);
    }

    // Controles de pregunta
    if (els.btnCorrect) els.btnCorrect.addEventListener('click', moderatorCorrectAdmin);
    if (els.btnIncorrect) els.btnIncorrect.addEventListener('click', moderatorIncorrectAdmin);
    if (els.btnCancel) els.btnCancel.addEventListener('click', cancelQuestionAdmin);
    document.querySelectorAll('[data-answer]')?.forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-answer'), 10);
        adminSubmitAnswer(idx);
      });
    });

    // Toggle ocultar respuestas
    if (els.hideToggle) {
      els.hideToggle.addEventListener('change', () => {
        const hide = !!els.hideToggle.checked;
        const s = getSocket();
        s.emit('toggle_hide_answers', { hide });
        renderHideAnswersStatus(hide);
      });
    }

    // Reinicio del ejercicio
    if (els.resetBtn) {
      els.resetBtn.addEventListener('click', resetExerciseAdmin);
    }
  }

  // -----------------------------
  // Equipo / selector de cantidad
  // -----------------------------
  function renderTeamCountSelect(count) {
    if (!els.select) return;
    // Poblar opciones 2..10 si aún no existen o hay mismatch
    if (!els.select.options.length) {
      for (let i = 2; i <= 10; i += 1) {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = `${i} equipos`;
        els.select.appendChild(opt);
      }
    }
    // Evitar bucle de eventos
    suppressTeamCountChange = true;
    els.select.value = String(count);
    suppressTeamCountChange = false;
    if (els.current) els.current.textContent = String(count);
  }

  // -----------------------------
  // Tablero: cargar y renderizar
  // -----------------------------
  function fetchBoard() {
    return fetch('/api/board')
      .then(r => r.json())
      .then(data => {
        state.board = data;
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

    // Encabezados de categorías
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

    // Celdas por fila/columna
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
    els.board.querySelectorAll('button').forEach(btn => { btn.style.boxShadow = 'none'; });
    if (!state.currentQuestionKey) return;
    const active = els.board.querySelector(`button[data-key="${state.currentQuestionKey}"]`);
    if (active) {
      active.style.boxShadow = '0 0 0 3px rgba(255,215,0,0.6)';
    }
  }

  // -----------------------------
  // Acciones de juego (admin)
  // -----------------------------
  function openQuestionAdmin(catIdx, clueIdx) {
    const s = getSocket();
    s.emit('open_question', { cat_idx: catIdx, clue_idx: clueIdx });
  }

  function moderatorCorrectAdmin() {
    if (!state.hasQuestion) return setActionStatus('No hay pregunta activa.', 'warn');
    if (state.currentBuzzer == null) return setActionStatus('Ningún equipo tiene el turno.', 'warn');
    const s = getSocket();
    s.emit('moderator_correct', { player: state.currentBuzzer });
  }

  function moderatorIncorrectAdmin() {
    if (!state.hasQuestion) return setActionStatus('No hay pregunta activa.', 'warn');
    if (state.currentBuzzer == null) return setActionStatus('Ningún equipo tiene el turno.', 'warn');
    const s = getSocket();
    s.emit('moderator_incorrect', { player: state.currentBuzzer });
  }

  function cancelQuestionAdmin() {
    if (!state.hasQuestion) return setActionStatus('No hay pregunta activa.', 'warn');
    const s = getSocket();
    s.emit('cancel_question');
  }

  function adminSubmitAnswer(index) {
    if (!state.hasQuestion) return setActionStatus('No hay pregunta activa.', 'warn');
    if (state.currentBuzzer == null) return setActionStatus('Ningún equipo tiene el turno.', 'warn');
    if (typeof index !== 'number' || index < 0 || index > 3) return;
    const s = getSocket();
    s.emit('submit_answer', { player: state.currentBuzzer, answer: index });
  }

  // -----------------------------
  // Carga de archivo (CSV/JSON)
  // -----------------------------
  function handleFileSelection(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    if (!file) return;

    if (els.selectedFile) els.selectedFile.textContent = file.name;
    setLoadStatus(`Guardando ${file.name} en la lista...`, 'info');

    // Validar la extensión del archivo
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.json') && !fileName.endsWith('.csv')) {
      setLoadStatus('Error: Solo se permiten archivos .json o .csv', 'error');
      input.value = '';
      return;
    }

    // Leer el archivo para guardarlo en localStorage (sin cargarlo al servidor aún)
    const reader = new FileReader();
    reader.onload = (e) => {
      const fileContent = e.target.result;

      // Validar que el contenido no esté vacío
      if (!fileContent || fileContent.trim().length === 0) {
        setLoadStatus('Error: El archivo está vacío', 'error');
        input.value = '';
        return;
      }

      console.log('Archivo leído correctamente:', file.name, 'Tamaño:', fileContent.length);

      // Solo guardar en localStorage, y autocargar (comportamiento anterior)
      saveBankFromFile(file.name, fileContent);
      try {
        const banks = loadQuestionBanks();
        const idx = Math.max(0, banks.length - 1);
        setLoadStatus(`"${file.name}" agregado. Cargando banco...`, 'info');
        loadBankData(idx);
      } catch (err) {
        console.error('Autocarga falló:', err);
        setLoadStatus(`"${file.name}" agregado a la lista. Usa el botón "Cargar" para aplicarlo.`, 'ok');
      }
      input.value = '';
    };

    reader.onerror = (e) => {
      console.error('Error al leer archivo:', e);
      setLoadStatus('Error al leer el archivo', 'error');
      input.value = '';
    };

    // Usar readAsText con codificación UTF-8
    reader.readAsText(file, 'UTF-8');
  }

  // -----------------------------
  // Puntajes (render y acciones)
  // -----------------------------
  function renderScores(scores) {
    if (!els.scoresRoot) return;
    const list = Array.isArray(scores) ? scores : state.scores;
    const count = list.length || state.playerCount || 0;
    els.scoresRoot.innerHTML = '';
    for (let i = 0; i < count; i += 1) {
      const row = document.createElement('div');
      row.className = 'score-row';

      const name = document.createElement('div');
      name.className = 'score-name';
      name.textContent = `Equipo ${i + 1}`;

      const value = document.createElement('div');
      value.className = 'score-value';
      const scoreValue = typeof list[i] !== 'undefined' ? list[i] : 0;
      value.textContent = String(scoreValue);
      value.id = `admin-score-${i}`;

      // Pintar en rojo si el puntaje es negativo
      if (scoreValue < 0) {
        value.style.color = '#FF3333';
      }

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
      els.scoresRoot.appendChild(row);
    }
  }

  function adjustScoreAdmin(playerIdx, delta) {
    const s = getSocket();
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
    const s = getSocket();
    s.emit('set_score', { player: playerIdx, score });
  }

  // -----------------------------
  // UI helpers (status/textos)
  // -----------------------------
  function setConn(text) { if (els.conn) els.conn.textContent = text; }

  function updateStatus() {
    if (els.current) els.current.textContent = String(state.playerCount ?? '-');
    if (els.hasQuestion) els.hasQuestion.textContent = state.hasQuestion ? 'Sí' : 'No';
    if (els.currentBuzzer) {
      els.currentBuzzer.textContent = (state.currentBuzzer == null) ? '-' : `Equipo ${state.currentBuzzer + 1}`;
    }
    // Habilitar/deshabilitar controles de pregunta
    const enabled = !!state.hasQuestion;
    [els.btnCorrect, els.btnIncorrect, els.btnCancel].forEach(b => { if (b) b.disabled = !enabled; });
    document.querySelectorAll('[data-answer]')?.forEach(btn => { btn.disabled = !enabled; });
  }

  function renderCorrectInfo(q) {
    if (!els.correctBox) return;
    const placeholder = document.getElementById('admin-correct-placeholder');
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
    if (text && text !== '-') {
      els.correctBox.classList.remove('hidden');
      if (placeholder) placeholder.classList.add('hidden');
    } else {
      els.correctBox.classList.add('hidden');
      if (placeholder) placeholder.classList.remove('hidden');
    }
  }

  function renderHideAnswersStatus(hide) {
    if (!els.hideStatus) return;
    els.hideStatus.textContent = hide ? 'Activado' : 'Desactivado';
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

  function setResetStatus(text, variant) {
    if (!els.resetStatus) return;
    els.resetStatus.textContent = text;
    if (variant === 'error') {
      els.resetStatus.style.color = '#FF7F7F';
    } else {
      els.resetStatus.style.color = '#fff';
    }
  }

  // -----------------------------
  // Gestión de bancos de preguntas
  // -----------------------------
  function loadQuestionBanks() {
    const banksJson = localStorage.getItem('question_banks');
    return banksJson ? JSON.parse(banksJson) : [];
  }

  function saveQuestionBanks(banks) {
    localStorage.setItem('question_banks', JSON.stringify(banks));
  }

  function renderQuestionBanks() {
    const listEl = document.getElementById('question-banks-list');
    if (!listEl) return;

    const banks = loadQuestionBanks();

    if (banks.length === 0) {
      listEl.innerHTML = '<div class="banks-placeholder">No hay bancos de preguntas guardados</div>';
      return;
    }

    listEl.innerHTML = '';
    banks.forEach((bank, index) => {
      const item = document.createElement('div');
      item.className = 'bank-item';

      const info = document.createElement('div');
      info.className = 'bank-item-info';

      const name = document.createElement('div');
      name.className = 'bank-item-name';
      name.textContent = bank.name;

      const meta = document.createElement('div');
      meta.className = 'bank-item-meta';
      meta.textContent = `Guardado: ${new Date(bank.timestamp).toLocaleString('es-ES')}`;

      info.appendChild(name);
      info.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'bank-item-actions';

      const loadBtn = document.createElement('button');
      loadBtn.className = 'btn-bank btn-bank-load';
      loadBtn.textContent = 'Cargar';
      loadBtn.addEventListener('click', () => loadBankData(index));

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-bank btn-bank-delete';
      deleteBtn.textContent = 'Eliminar';
      deleteBtn.addEventListener('click', () => deleteBank(index));

      actions.appendChild(loadBtn);
      actions.appendChild(deleteBtn);

      item.appendChild(info);
      item.appendChild(actions);
      listEl.appendChild(item);
    });
  }

  function saveBankFromFile(fileName, fileData) {
    const banks = loadQuestionBanks();
    console.log('Guardando banco:', fileName, 'Tamaño:', fileData.length, 'caracteres');
    banks.push({
      name: fileName,
      data: fileData,
      timestamp: Date.now()
    });
    saveQuestionBanks(banks);
    console.log('Total de bancos guardados:', banks.length);
    renderQuestionBanks();
  }

  function loadBankData(index) {
    const banks = loadQuestionBanks();
    if (index < 0 || index >= banks.length) {
      console.error('Índice de banco inválido:', index);
      setLoadStatus('Error: Índice de banco inválido', 'error');
      return;
    }

    const bank = banks[index];
    console.log('Cargando banco:', bank.name);
    console.log('Datos del banco:', {
      name: bank.name,
      dataLength: bank.data ? bank.data.length : 0,
      timestamp: bank.timestamp,
      dataPreview: bank.data ? bank.data.substring(0, 100) + '...' : 'sin datos'
    });

    setLoadStatus(`Cargando banco "${bank.name}"...`, 'info');

    // Validar que existan los datos
    if (!bank.data || bank.data.trim().length === 0) {
      console.error('El banco no tiene datos');
      setLoadStatus('Error: El banco no tiene datos', 'error');
      return;
    }

    // Determinar el tipo MIME basado en la extensión del archivo
    let mimeType = 'text/plain';
    const fileName = bank.name.toLowerCase();
    if (fileName.endsWith('.json')) {
      mimeType = 'application/json';
    } else if (fileName.endsWith('.csv')) {
      mimeType = 'text/csv';
    }

    console.log('Tipo MIME detectado:', mimeType);
    console.log('Tamaño de datos:', bank.data.length, 'caracteres');

    // Enviar como Blob con nombre de archivo explícito (mejor compatibilidad)
    try {
      const blob = new Blob([bank.data], { type: mimeType });
      const formData = new FormData();
      formData.append('file', blob, bank.name);

      console.log('Enviando petición a /api/load-data...');
      console.log('FormData creado con archivo:', bank.name, 'tipo:', mimeType, 'tamaño(chars):', bank.data.length);

      fetch('/api/load-data', { method: 'POST', body: formData })
        .then(async (response) => {
          console.log('Respuesta recibida:', response.status, response.statusText);

          // Intentar parsear directamente como JSON; si falla, degradar a texto
          let data;
          try {
            data = await response.json();
          } catch (_) {
            const responseText = await response.text();
            console.log('Respuesta (texto):', responseText);
            try {
              data = JSON.parse(responseText);
            } catch (e) {
              console.error('Error parseando JSON de respuesta:', e);
              data = { success: false, error: 'Respuesta del servidor no es JSON válido' };
            }
          }

          console.log('Datos de respuesta parseados:', data);

          if (response.ok && data.success) {
            setLoadStatus(data.message || 'Banco cargado correctamente', 'ok');
            console.log('Banco cargado exitosamente, refrescando tablero...');
            // Refrescar el tablero después de cargar
            fetchBoard();
          } else {
            const msg = data.error || `Error al cargar banco (${response.status}: ${response.statusText})`;
            console.error('Error en la carga:', msg);
            throw new Error(msg);
          }
        })
        .catch((err) => {
          console.error('Error en fetch (FormData):', err);
          setLoadStatus('Reintentando con método alternativo...', 'info');
          // Fallback: enviar nombre + contenido en JSON a un endpoint alterno
          fetch('/api/load-data-inline', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: bank.name, content: bank.data })
          })
            .then(async (response) => {
              let data; try { data = await response.json(); } catch (_) { data = null; }
              if (response.ok && data && data.success) {
                setLoadStatus(data.message || 'Banco cargado correctamente', 'ok');
                fetchBoard();
              } else {
                const msg = (data && data.error) || `Error en fallback inline (${response.status}: ${response.statusText})`;
                throw new Error(msg);
              }
            })
            .catch((e2) => {
              console.error('Ambos métodos de carga fallaron:', e2);
              setLoadStatus(e2?.message || 'Error al cargar banco', 'error');
            });
        });
    } catch (e) {
      console.error('Error creando archivo:', e);
      setLoadStatus('Error al preparar el archivo para carga', 'error');
    }
  }

  function deleteBank(index) {
    const banks = loadQuestionBanks();
    if (index < 0 || index >= banks.length) return;

    const bank = banks[index];
    if (!confirm(`¿Eliminar el banco "${bank.name}"?`)) return;

    banks.splice(index, 1);
    saveQuestionBanks(banks);
    renderQuestionBanks();
    setLoadStatus(`Banco "${bank.name}" eliminado.`, 'ok');
  }

  // -----------------------------
  // Reinicio del ejercicio (puntajes y tablero)
  // -----------------------------
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

  // -----------------------------
  // Entrada principal
  // -----------------------------
  window.addEventListener('load', init);
})();
