// ===========================
// PAINANI WEB - CLIENTE
// ===========================

// Estado global
const gameState = {
    currentQuestion: null,
    currentBuzzer: null,
    hideAnswers: false,
    selectedAnswer: -1,
    answerPending: false,
    triedPlayers: new Set(),
    timerInterval: null,
    contextMenuPlayer: null,
    playerCount: 5,
    scores: []
};

// Ocultar splash screen después de 10 segundos
window.addEventListener('load', () => {
    setTimeout(() => {
        const splash = document.getElementById('splash-screen');
        if (splash) {
            splash.remove();
        }
    }, 10000); // 10 segundos
});

// Conexión WebSocket
const socket = io();

// Elementos del DOM
const elements = {
    board: document.getElementById('board'),
    questionPanel: document.getElementById('question-panel'),
    boardContainer: document.getElementById('board-container'),
    statusBar: document.getElementById('status-bar'),
    timer: document.getElementById('timer'),
    boardControls: document.getElementById('board-controls'),
    panelControls: document.getElementById('panel-controls'),
    moderatorControls: document.getElementById('moderator-controls'),
    hideAnswersCheckbox: document.getElementById('hide-answers'),
    fileInput: document.getElementById('file-input'),
    playersBar: document.getElementById('players-bar'),
    quickAdjustPanel: document.getElementById('quick-adjust-panel'),
    quickAdjustPlayers: document.getElementById('quick-adjust-players'),
    teamCountSelect: document.getElementById('team-count-select')
};



let suppressTeamCountChange = false;



const mosaic = (() => {
    const state = {
        enabled: false,
        imageUrl: null,
        totalPieces: 0,
        revealedPieces: 0,
        grid: { rows: 0, cols: 0 },
        revealedPiecesSet: new Set(),
        layout: {
            rowOrder: [],
            displayIndexByOriginal: {},
            cols: 0
        }
    };

    function resetState() {
        state.enabled = false;
        state.imageUrl = null;
        state.totalPieces = 0;
        state.revealedPieces = 0;
        state.revealedPiecesSet = new Set();
        state.layout = { rowOrder: [], displayIndexByOriginal: {}, cols: 0 };
    }

    function getDisplayRowIndex(originalRow, layoutOverride) {
        const layoutRef = layoutOverride || state.layout;
        if (!layoutRef || !layoutRef.displayIndexByOriginal) return null;
        const mapped = layoutRef.displayIndexByOriginal[originalRow];
        return typeof mapped === 'number' ? mapped : null;
    }

    function recalculateProgress(layoutOverride) {
        const layoutRef = layoutOverride || state.layout;
        if (!state.revealedPiecesSet || !layoutRef) {
            state.revealedPieces = 0;
            return;
        }

        let count = 0;
        state.revealedPiecesSet.forEach(key => {
            const [catIdxStr, clueIdxStr] = key.split('-');
            const clueIdx = parseInt(clueIdxStr, 10);

            if (getDisplayRowIndex(clueIdx, layoutRef) !== null) {
                count += 1;
                return;
            }

            const catIdx = parseInt(catIdxStr, 10);
            const fallbackCell = document.querySelector(
                `.board-cell.clue[data-cat-idx="${catIdx}"][data-clue-idx="${clueIdx}"]`
            );

            if (fallbackCell) {
                const fallbackRow = parseInt(fallbackCell.dataset.displayRow, 10);
                if (!Number.isNaN(fallbackRow)) {
                    count += 1;
                }
            }
        });

        state.revealedPieces = count;
    }

    function clearCell(cell) {
        if (!cell) return;

        cell.classList.remove('mosaic-visible');
        cell.style.background = '';
        cell.style.backgroundImage = '';
        cell.style.backgroundPosition = '';
        cell.style.backgroundSize = '';
        cell.style.backgroundRepeat = '';
        cell.style.color = '';

        if (cell.dataset.value && cell.textContent.trim() === '') {
            cell.textContent = cell.dataset.value;
        }
    }

    function applyToCellElement(cell, catIdx, clueIdx, displayRow) {
        if (!cell || !state.imageUrl) return;

        const cols = Math.max(state.grid.cols, 1);
        const rows = Math.max(state.grid.rows, 1);

        const normalizedRow = Number.isNaN(displayRow)
            ? getDisplayRowIndex(clueIdx)
            : displayRow;

        if (normalizedRow === null) {
            clearCell(cell);
            return;
        }

        const posX = cols > 1 ? (catIdx / (cols - 1)) * 100 : 50;
        const posY = rows > 1 ? (normalizedRow / (rows - 1)) * 100 : 50;
        const sizeW = cols * 100;
        const sizeH = rows * 100;

        cell.classList.add('mosaic-visible');
        cell.style.background = 'none';
        cell.style.backgroundImage = `url('${state.imageUrl}')`;
        cell.style.backgroundPosition = `${posX}% ${posY}%`;
        cell.style.backgroundSize = `${sizeW}% ${sizeH}%`;
        cell.style.backgroundRepeat = 'no-repeat';
        cell.style.color = 'transparent';

        if (!cell.dataset.value && cell.textContent) {
            cell.dataset.value = cell.textContent.trim();
        }

        if (cell.textContent.trim() !== '') {
            cell.dataset.value = cell.textContent.trim();
        }

        cell.textContent = '';
    }

    function applyToBoard() {
        const cells = document.querySelectorAll('.board-cell.clue');

        if (!state.enabled || !state.imageUrl) {
            cells.forEach(clearCell);
            return;
        }

        cells.forEach(cell => {
            const catIdx = parseInt(cell.dataset.catIdx, 10);
            const clueIdx = parseInt(cell.dataset.clueIdx, 10);
            const displayRow = parseInt(cell.dataset.displayRow, 10);

            if (Number.isNaN(catIdx) || Number.isNaN(clueIdx)) {
                clearCell(cell);
                return;
            }

            const key = `${catIdx}-${clueIdx}`;
            let isRevealed = state.revealedPiecesSet?.has(key);
            const cellConsumed = cell.classList.contains('used') || cell.classList.contains('correct');

            if (cellConsumed) {
                const newlyRevealed = markPieceRevealed(catIdx, clueIdx);
                if (newlyRevealed) {
                    isRevealed = true;
                }
            }

            if (isRevealed) {
                applyToCellElement(cell, catIdx, clueIdx, displayRow);
            } else {
                clearCell(cell);
            }
        });
    }

    function markPieceRevealed(catIdx, clueIdx) {
        if (!state.enabled) return false;

        if (!state.revealedPiecesSet) {
            state.revealedPiecesSet = new Set();
        }

        const key = `${catIdx}-${clueIdx}`;
        if (state.revealedPiecesSet.has(key)) {
            return false;
        }

        if (getDisplayRowIndex(clueIdx) === null) {
            const fallbackCell = document.querySelector(
                `.board-cell.clue[data-cat-idx="${catIdx}"][data-clue-idx="${clueIdx}"]`
            );

            if (!fallbackCell || Number.isNaN(parseInt(fallbackCell.dataset.displayRow, 10))) {
                return false;
            }
        }

        state.revealedPiecesSet.add(key);
        recalculateProgress();
        return true;
    }

    function revealPiece(catIdx, clueIdx) {
        if (!state.enabled) return;

        const newlyRevealed = markPieceRevealed(catIdx, clueIdx);

        if (newlyRevealed) {
            console.log(`🎨 Pieza revelada: ${state.revealedPieces}/${state.totalPieces}`);
        }

        applyToBoard();

        if (
            newlyRevealed &&
            state.totalPieces > 0 &&
            state.revealedPieces >= state.totalPieces
        ) {
            setStatus('¡Mosaico completado!', 'correct');
            createConfetti();
        }
    }

    function updateLayout(layout, options = {}) {
        state.grid = {
            rows: layout.rowOrder.length,
            cols: layout.cols
        };
        state.layout = {
            rowOrder: [...layout.rowOrder],
            displayIndexByOriginal: { ...layout.displayIndexByOriginal },
            cols: layout.cols
        };

        if (options.resetRevealed) {
            state.revealedPiecesSet = new Set();
        } else if (state.revealedPiecesSet) {
            const filtered = new Set();
            state.revealedPiecesSet.forEach(key => {
                const [catIdxStr, clueIdxStr] = key.split('-');
                const catIdx = parseInt(catIdxStr, 10);
                const clueIdx = parseInt(clueIdxStr, 10);
                if (Number.isNaN(catIdx) || Number.isNaN(clueIdx)) return;
                if (catIdx >= layout.cols) return;
                if (getDisplayRowIndex(clueIdx, layout) === null) return;
                filtered.add(key);
            });
            state.revealedPiecesSet = filtered;
        }

        state.totalPieces = state.grid.rows * state.grid.cols;
        recalculateProgress(layout);
    }

    function setup() {
        return fetch('/api/board')
            .then(r => r.json())
            .then(data => {
                const categories = data.categories || [];
                const layout = computeBoardLayout(categories);

                updateLayout(layout, { resetRevealed: true });

                console.log('🎨 Mosaico listo para integrarse al tablero:', state.grid);
                applyToBoard();
            })
            .catch(err => {
                console.error('No se pudo preparar el mosaico:', err);
            });
    }

    function initialize(imagesFolder) {
        if (!imagesFolder) {
            resetState();
            applyToBoard();
            return;
        }

        const mosaicUrl = `/images/${imagesFolder}/MOSAICO.jpg`;

        const testImg = new Image();
        testImg.onload = function() {
            console.log('🎨 Mosaico encontrado:', mosaicUrl);
            state.enabled = true;
            state.imageUrl = mosaicUrl;
            setup();
        };
        testImg.onerror = function() {
            const mosaicUrlPng = `/images/${imagesFolder}/MOSAICO.png`;
            const testImg2 = new Image();
            testImg2.onload = function() {
                console.log('🎨 Mosaico encontrado:', mosaicUrlPng);
                state.enabled = true;
                state.imageUrl = mosaicUrlPng;
                setup();
            };
            testImg2.onerror = function() {
                console.log('⚠️ No se encontró imagen MOSAICO');
                resetState();
                applyToBoard();
            };
            testImg2.src = mosaicUrlPng;
        };
        testImg.src = mosaicUrl;
    }

    return {
        state,
        initialize,
        revealPiece,
        applyToBoard,
        updateLayout,
        getDisplayRowIndex,
        recalculateProgress
    };
})();

// Algunos templates antiguos incluían múltiples instancias del menú contextual de
// puntajes. Si detectamos copias extra, las eliminamos para evitar que se
// muestre un segundo menú.
const scoreMenus = document.querySelectorAll('#score-menu');
scoreMenus.forEach((menuEl, idx) => {
    if (idx > 0) {
        menuEl.remove();
    }
});

// Sonidos
const sounds = {
    buzz: new Audio('/sounds/boton_presionado2.wav'),
    correct: new Audio('/sounds/aplausos.wav'),
    incorrect: new Audio('/sounds/incorrecto.wav'),
    countdown: new Audio('/sounds/contestando.wav'),
    timeup: new Audio('/sounds/fin.mp3')
};

// ===========================
// INICIALIZACIÓN
// ===========================

socket.on('connected', (data) => {
    console.log('📊 Estado inicial recibido');
    if (data.game_state && typeof data.game_state.player_count === 'number') {
        gameState.playerCount = data.game_state.player_count;
    }

    renderBoard(data.board);
    updateScores(data.board.scores);
    setStatus('Selecciona una casilla para abrir una pregunta', 'info');

    // Inicializar mosaico
    fetch('/api/images-folder')
        .then(r => r.json())
        .then(result => {
            if (result.images_folder) {
                mosaic.initialize(result.images_folder);
            }
        })
        .catch(err => console.log('No hay carpeta de imágenes'));
});

// ===========================
// EVENTOS DEL SERVIDOR
// ===========================

socket.on('question_opened', (data) => {
    console.log('❓ Pregunta abierta:', data);
    gameState.currentQuestion = data;
    gameState.selectedAnswer = -1;
    gameState.answerPending = false;
    gameState.triedPlayers = new Set();
    clearChoiceSelection();
    
    // Ocultar panel de ajuste si está visible
    document.getElementById('quick-adjust-panel').style.display = 'none';
    
    showQuestionPanel(data);
    enableBuzzers(true);
    setStatus('Pregunta abierta. ¡Toca tu timbre para responder!', 'info');
});

socket.on('buzzer_activated', (data) => {
    console.log('🔔 Buzzer presionado:', data);
    gameState.currentBuzzer = data.player;

    playSound('buzz');
    refreshBuzzerState();
    setStatus(`Equipo ${data.player + 1} tiene el turno. ¡Responde!`, 'info');

    // Habilitar opciones si están visibles
    if (!gameState.hideAnswers) {
        console.log('✅ Habilitando opciones para el jugador');
        enableChoices(true);
    } else {
        console.log('🔒 Opciones ocultas (modo moderador)');
    }
});

socket.on('start_timer', (data) => {
    console.log('⏱️ Temporizador iniciado');
    startTimer(data.seconds);
});

socket.on('stop_timer', () => {
    console.log('⏹️ Temporizador detenido');
    stopTimer();
});


// Tiempo agotado sin calificación automática (opción A)
socket.on('time_up', (data) => {
    console.log('?? Tiempo agotado (esperando decisión del moderador)');
    stopTimer();
    enableChoices(false);
    setStatus('Tiempo agotado. Esperando decisión del moderador.', 'info');
    playSound('timeup');
});

socket.on('answer_result', (data) => {
    console.log('📝 Resultado:', data);
    gameState.answerPending = false;

    if (data.result === 'correct') {
        playSound('correct');
        flashStatus('correct', 'CORRECTO', '¡Correcto! Elige otra casilla.');

        // Revelar pieza del mosaico
        if (gameState.currentQuestion) {
            mosaic.revealPiece(
                gameState.currentQuestion.cat_idx,
                gameState.currentQuestion.clue_idx
            );
        }
        refreshBuzzerState();
    } else {
        playSound('incorrect');

        if (data.rebote) {
            flashStatus('incorrect', 'INCORRECTO', 'Rebote: otro equipo puede contestar.');
            gameState.triedPlayers.add(data.player);
            gameState.currentBuzzer = null;
            refreshBuzzerState();
            enableChoices(false);
            gameState.selectedAnswer = -1;
            gameState.answerPending = false;
            clearChoiceSelection();
        } else {
            flashStatus('incorrect', 'INCORRECTO', 'Sin intentos restantes. Elige otra casilla.');
            gameState.selectedAnswer = -1;
            clearChoiceSelection();
            refreshBuzzerState();
        }
    }
});

socket.on('scores_update', (data) => {
    console.log('💯 Puntajes actualizados');
    updateScores(data.scores);
});

socket.on('team_count_updated', (data) => {
    console.log('👥 Cantidad de equipos actualizada:', data);
    const scores = Array.isArray(data.scores) ? data.scores : [];
    const playerCount = typeof data.player_count === 'number' ? data.player_count : scores.length;

    if (playerCount && playerCount !== gameState.playerCount) {
        gameState.playerCount = playerCount;
    }

    gameState.triedPlayers = new Set(data.tried_players || []);
    gameState.currentBuzzer = (typeof data.current_buzzer === 'number') ? data.current_buzzer : null;

    renderPlayers(scores);
    updateScores(scores);

    refreshBuzzerState();

    if (!data.timer_active) {
        stopTimer();
    }
});

socket.on('close_question', () => {
    console.log('❌ Pregunta cerrada');
    closeQuestionPanel();
    gameState.currentQuestion = null;
    gameState.currentBuzzer = null;
    enableBuzzers(false);
    gameState.triedPlayers.clear();
    gameState.selectedAnswer = -1;
    gameState.answerPending = false;
    clearChoiceSelection();

    // Asegurar que los controles vuelvan al modo tablero
    updateControlsMode();
    
    // Recargar tablero
    fetch('/api/board')
        .then(r => r.json())
        .then(data => renderBoard(data));
});

socket.on('game_reset', (data) => {
    console.log('🔄 Juego reiniciado');
    renderBoard(data);
    updateScores(data.scores);
    closeQuestionPanel();
    gameState.currentQuestion = null;
    gameState.currentBuzzer = null;
    gameState.selectedAnswer = -1;
    gameState.triedPlayers.clear();
    gameState.answerPending = false;
    updateControlsMode();
    if (data && data.scores_preserved) { setStatus('Nueva ronda cargada. Selecciona una casilla.', 'info'); } else { setStatus('Juego reiniciado. Selecciona una casilla.', 'info'); }
    clearChoiceSelection();
    
    // Reinicializar mosaico
    fetch('/api/images-folder')
        .then(r => r.json())
        .then(result => {
            if (result.images_folder) {
                mosaic.initialize(result.images_folder);
            }
        })
        .catch(err => console.log('No hay carpeta de imágenes'));
});

socket.on('hide_answers_toggled', (data) => { gameState.hideAnswers = data.hide; updateControlsMode(); if (gameState.currentQuestion) { showQuestionPanel(gameState.currentQuestion); } });

socket.on('error', (data) => {
    console.error('❌ Error:', data);
    setStatus(data.error || 'Error desconocido', 'incorrect');
});

// ===========================
// RENDERIZADO DEL TABLERO
// ===========================

function renderBoard(data) {
    const categories = data.categories || [];
    const used = new Set(data.used.map(([c, r]) => `${c}-${r}`));
    const tileStatus = data.tile_status || {};

    if (categories.length === 0) {
        elements.board.innerHTML = '<div style="text-align:center">No hay categorías</div>';
        return;
    }

    const layout = computeBoardLayout(categories);

    // Configurar grid
    elements.board.style.gridTemplateColumns = `repeat(${layout.cols}, 1fr)`;
    elements.board.style.gridTemplateRows = `auto repeat(${layout.rowOrder.length}, 1fr)`;

    elements.board.innerHTML = '';

    // Encabezados
    categories.forEach(cat => {
        const header = document.createElement('div');
        header.className = 'board-cell header';
        header.textContent = cat.name || 'Categoría';
        elements.board.appendChild(header);
    });

    // Celdas
    layout.rowOrder.forEach((row, displayRowIdx) => {
        categories.forEach((cat, catIdx) => {
            const clue = cat.clues?.[row];
            const cell = document.createElement('div');
            cell.className = 'board-cell clue';

            // Animación escalonada
            cell.style.animation = `slideInScale 0.5s ease backwards`;
            cell.style.animationDelay = `${(catIdx * 0.1) + (displayRowIdx * 0.05)}s`;

            if (clue) {
                const key = `${catIdx},${row}`;
                const status = tileStatus[key];
                const value = clue.value || ((row + 1) * 100);

                cell.textContent = value;
                cell.dataset.catIdx = catIdx;
                cell.dataset.clueIdx = row;
                cell.dataset.displayRow = displayRowIdx;
                cell.dataset.value = value;

                if (status === 'correct') {
                    cell.classList.add('correct');
                } else if (status === 'used' || used.has(`${catIdx}-${row}`) || clue.unavailable) {
                    cell.classList.add('used');
                } else {
                    cell.onclick = () => openQuestion(catIdx, row);
                }
            } else {
                cell.textContent = '—';
                cell.dataset.catIdx = catIdx;
                cell.dataset.clueIdx = row;
                cell.dataset.displayRow = displayRowIdx;
                cell.classList.add('used');
            }

            elements.board.appendChild(cell);
        });
    });
    
    // Agregar keyframe para animación de entrada
    if (!document.getElementById('board-animation-keyframe')) {
        const style = document.createElement('style');
        style.id = 'board-animation-keyframe';
        style.textContent = `
            @keyframes slideInScale {
                from {
                    opacity: 0;
                    transform: scale(0.5) translateY(20px);
                }
                to {
                    opacity: 1;
                    transform: scale(1) translateY(0);
                }
            }
        `;
        document.head.appendChild(style);
    }

    // Asegurar que estamos en modo tablero
    gameState.currentQuestion = null;
    updateControlsMode();

    mosaic.updateLayout(layout);

    if (mosaic.state.enabled) {
        requestAnimationFrame(() => mosaic.applyToBoard());
    } else {
        mosaic.applyToBoard();
    }
}

function computeBoardLayout(categories) {
    const cols = categories.length;
    const maxClues = Math.max(...categories.map(c => c.clues?.length || 0), 0);
    const rowOrder = [];
    const displayIndexByOriginal = {};

    for (let row = 0; row < maxClues; row++) {
        const hasAvailableQuestion = categories.some(cat => {
            const clue = cat.clues?.[row];
            if (!clue) return false;
            if (clue.unavailable) return false;
            const text = typeof clue.question === 'string' ? clue.question.trim() : '';
            return text !== '' && !text.startsWith('(Sin pregunta disponible');
        });

        if (hasAvailableQuestion) {
            displayIndexByOriginal[row] = rowOrder.length;
            rowOrder.push(row);
        }
    }

    // Si no se encontró ninguna fila disponible, usar todas las filas existentes
    if (rowOrder.length === 0) {
        for (let row = 0; row < maxClues; row++) {
            displayIndexByOriginal[row] = rowOrder.length;
            rowOrder.push(row);
        }
    }

    return { cols, rowOrder, displayIndexByOriginal };
}

// ===========================
// PANEL DE PREGUNTA
// ===========================

function clearChoiceSelection() {
    document.querySelectorAll('.choice-option').forEach(option => {
        option.classList.remove('selected');

        const radio = option.querySelector('input');
        if (radio) {
            radio.checked = false;
        }
    });
}

function showQuestionPanel(question) {
    elements.boardContainer.style.display = 'none';
    elements.questionPanel.style.display = 'block';

    clearChoiceSelection();
    
    document.getElementById('question-category').textContent = question.category;
    document.getElementById('question-value').textContent = `Valor: ${question.value}`;
    document.getElementById('question-text').textContent = question.question;
    // document.getElementById('question-status').textContent = 'Esperando timbre...';
    document.getElementById('question-status').textContent = '';
    
    // Determinar si hay imagen
    const hasImage = question.image && question.image_folder;
    
    // Crear o limpiar el contenedor de contenido
    let contentWrapper = document.getElementById('question-content-wrapper');
    if (!contentWrapper) {
        contentWrapper = document.createElement('div');
        contentWrapper.id = 'question-content-wrapper';
        
        // Insertar después del texto de la pregunta
        const questionText = document.getElementById('question-text');
        questionText.parentNode.insertBefore(contentWrapper, questionText.nextSibling);
    }
    
    contentWrapper.innerHTML = '';
    contentWrapper.className = '';
    
    // Crear contenedor de opciones PRIMERO
    const choicesWrapper = document.createElement('div');
    choicesWrapper.id = 'choices-wrapper';
    
    const choicesContainer = document.createElement('div');
    choicesContainer.id = 'choices-container';
    choicesWrapper.appendChild(choicesContainer);
    
    contentWrapper.appendChild(choicesWrapper);
    
    // Manejar imagen si existe (se agrega DESPUÉS para que aparezca a la derecha)
    if (hasImage) {
        const imageContainer = document.createElement('div');
        imageContainer.id = 'question-image-container';
        
        const img = document.createElement('img');
        img.id = 'question-image';
        img.src = `/images/${question.image_folder}/${question.image}`;
        img.alt = 'Imagen de la pregunta';
        
        img.onerror = function() {
            console.error('Error cargando imagen:', question.image);
            imageContainer.innerHTML = '<div style="padding: 20px; background: rgba(255,0,0,0.1); border-radius: 8px; color: #fff;">⚠️ Imagen no disponible</div>';
        };
        
        imageContainer.appendChild(img);
        contentWrapper.appendChild(imageContainer);
    }
    
    // Configurar layout según el contexto
    if (hasImage && !gameState.hideAnswers) {
        // Imagen + Respuestas visibles: Layout lado a lado
        contentWrapper.classList.add('with-image-and-choices');
        const imageContainer = contentWrapper.querySelector('#question-image-container');
        if (imageContainer) {
            imageContainer.classList.remove('centered');
        }
        const img = contentWrapper.querySelector('#question-image');
        if (img) {
            img.classList.remove('centered');
        }
    } else if (hasImage && gameState.hideAnswers) {
        // Imagen + Respuestas ocultas: Imagen centrada
        const imageContainer = contentWrapper.querySelector('#question-image-container');
        if (imageContainer) {
            imageContainer.classList.add('centered');
        }
        const img = contentWrapper.querySelector('#question-image');
        if (img) {
            img.classList.add('centered');
        }
    }
    
    // Renderizar opciones
    if (question.choices && !gameState.hideAnswers) {
        question.choices.forEach((choice, idx) => {
            const option = document.createElement('div');
            option.className = 'choice-option disabled';
            option.dataset.index = idx;
            
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'answer';
            radio.value = idx;
            radio.disabled = true;
            radio.id = `choice-${idx}`;
            
            // Event listener para el radio button
            radio.addEventListener('change', () => {
                if (!radio.disabled) {
                    selectChoice(idx);
                }
            });
            
            const label = document.createElement('label');
            label.htmlFor = `choice-${idx}`;
            label.textContent = `${String.fromCharCode(97 + idx)}) ${choice}`;
            label.style.cursor = 'pointer';
            label.style.flex = '1';
            
            option.appendChild(radio);
            option.appendChild(label);
            
            // Event listener para el div completo
            option.addEventListener('click', (e) => {
                if (!option.classList.contains('disabled')) {
                    selectChoice(idx);
                }
            });
            
            choicesContainer.appendChild(option);
        });
    } else if (gameState.hideAnswers) {
        if (!hasImage) {
            // choicesContainer.innerHTML = '<p style="text-align:center;color:#FFD700;font-size:18px;padding:20px;">🔒 Modo moderador: respuestas ocultas</p>';
            choicesContainer.innerHTML = '';
        }
        // Si hay imagen y respuestas ocultas, no mostrar nada en el contenedor de opciones
    }
    
    updateControlsMode();
}

function closeQuestionPanel() {
    console.log('🔙 Cerrando panel de pregunta, volviendo al tablero');

    elements.questionPanel.style.display = 'none';
    elements.boardContainer.style.display = 'block';

    // Limpiar estado
    gameState.currentQuestion = null;
    gameState.selectedAnswer = -1;
    gameState.answerPending = false;

    clearChoiceSelection();

    // Restaurar controles del tablero
    updateControlsMode();
}

function selectChoice(index) {
    if (gameState.currentBuzzer === null) {
        console.warn('⚠️ No hay jugador con turno activo');
        return;
    }
    
    console.log(`🎯 Seleccionando opción: ${index} (${String.fromCharCode(97 + index)})`);
    gameState.selectedAnswer = parseInt(index);
    
    // Actualizar UI
    document.querySelectorAll('.choice-option').forEach((option, idx) => {
        const isSelected = (idx === parseInt(index));
        option.classList.toggle('selected', isSelected);
        
        const radio = option.querySelector('input');
        if (radio) {
            radio.checked = isSelected;
        }
        
        if (isSelected) {
            console.log(`✓ Opción ${String.fromCharCode(97 + idx)} seleccionada`);
        }
    });
    
    // Mostrar en status
    setStatus(`Opción ${String.fromCharCode(97 + index)} seleccionada. Se enviará automáticamente si el tiempo se agota.`, 'info');
}

function enableChoices(enable) {
    console.log(`🎛️ ${enable ? 'Habilitando' : 'Deshabilitando'} opciones de respuesta`);
    
    document.querySelectorAll('.choice-option').forEach(option => {
        const radio = option.querySelector('input');
        
        if (enable) {
            option.classList.remove('disabled');
            option.style.pointerEvents = 'auto';
            option.style.cursor = 'pointer';
            if (radio) {
                radio.disabled = false;
            }
        } else {
            option.classList.add('disabled');
            option.style.pointerEvents = 'none';
            option.style.cursor = 'not-allowed';
            if (radio) {
                radio.disabled = true;
            }
        }
    });
}

// ===========================
// ACCIONES DEL JUEGO
// ===========================

function openQuestion(catIdx, clueIdx) {
    console.log('🎯 Abriendo pregunta:', catIdx, clueIdx);
    socket.emit('open_question', { cat_idx: catIdx, clue_idx: clueIdx });
}

function pressBuzzer(playerIdx) {
    if (playerIdx < 0 || playerIdx >= gameState.playerCount) {
        return;
    }

    if (gameState.triedPlayers.has(playerIdx)) {
        console.log('⚠️ Jugador ya intentó');
        return;
    }

    console.log('🔔 Presionando buzzer:', playerIdx);
    socket.emit('buzzer_press', { player: playerIdx });
}

function submitAnswer() {
    console.log('🚀 Intentando enviar respuesta...');
    console.log('   - Buzzer actual:', gameState.currentBuzzer);
    console.log('   - Respuesta seleccionada:', gameState.selectedAnswer);

    if (gameState.currentBuzzer === null) {
        setStatus('Primero un jugador debe presionar su timbre', 'incorrect');
        console.error('❌ No hay jugador con turno activo');
        return;
    }

    if (gameState.selectedAnswer < 0) {
        setStatus('Selecciona una opción antes de responder', 'incorrect');
        console.error('❌ No hay respuesta seleccionada (valor:', gameState.selectedAnswer, ')');
        return;
    }

    console.log('📤 Enviando respuesta:');
    console.log('  - Jugador:', gameState.currentBuzzer);
    console.log('  - Respuesta seleccionada:', gameState.selectedAnswer);
    console.log('  - Pregunta actual:', gameState.currentQuestion);
    console.log('  - Respuesta correcta esperada:', gameState.currentQuestion?.answer);

    gameState.answerPending = true;

    socket.emit('submit_answer', {
        player: gameState.currentBuzzer,
        answer: gameState.selectedAnswer
    });
}

function moderatorCorrect() {
    if (gameState.currentBuzzer === null) {
        setStatus('Primero un jugador debe presionar su timbre', 'incorrect');
        return;
    }
    
    console.log('✅ Moderador: Correcto');
    socket.emit('moderator_correct', { player: gameState.currentBuzzer });
}

function moderatorIncorrect() {
    if (gameState.currentBuzzer === null) {
        setStatus('Primero un jugador debe presionar su timbre', 'incorrect');
        return;
    }
    
    console.log('❌ Moderador: Incorrecto');
    socket.emit('moderator_incorrect', { player: gameState.currentBuzzer });
}

function cancelQuestion() {
    console.log('🚫 Cancelando pregunta');
    socket.emit('cancel_question');
    stopAllSounds();
}











// ===========================
// TEMPORIZADOR
// ===========================

function startTimer(seconds) {
    stopTimer(); // Detener temporizador previo

    let remaining = seconds;
    elements.timer.textContent = remaining;
    elements.timer.style.color = '#FF3333';
    elements.timer.style.fontSize = '56px';
    elements.timer.style.animation = '';

    gameState.timerInterval = setInterval(() => {
        remaining--;
        elements.timer.textContent = remaining;

        // Cambiar color según tiempo restante
        if (remaining <= 3) {
            elements.timer.style.color = '#FF0000';
            elements.timer.style.fontSize = '64px';
            elements.timer.style.animation = 'timerUrgent 0.5s infinite';
        } else if (remaining <= 6) {
            elements.timer.style.color = '#FF6B00';
            elements.timer.style.fontSize = '52px';
            elements.timer.style.animation = '';
        } else {
            elements.timer.style.color = '#FF3333';
            elements.timer.style.fontSize = '56px';
            elements.timer.style.animation = '';
        }

        // Sonido a los 6 segundos
        if (remaining === 6) {
            playSound('countdown');
        }
        
        if (remaining <= 0) {
            stopTimer();

            if (!gameState.answerPending) {
                if (gameState.currentBuzzer !== null && gameState.selectedAnswer >= 0) {
                    console.log('⏰ Tiempo agotado: enviando respuesta seleccionada automáticamente');
                    setStatus('Tiempo agotado. Respuesta enviada automáticamente.', 'info');
                    submitAnswer();
                } else {
                    console.log('⏰ Tiempo agotado sin respuesta seleccionada. Notificando timeout.');
                    socket.emit('time_up');
                }
            }
        }
    }, 1000);
    
    // Agregar animación de urgencia
    if (!document.getElementById('timer-urgent-keyframe')) {
        const style = document.createElement('style');
        style.id = 'timer-urgent-keyframe';
        style.textContent = `
            @keyframes timerUrgent {
                0%, 100% { 
                    transform: scale(1); 
                    box-shadow: 0 0 20px rgba(255, 0, 0, 0.5);
                }
                50% { 
                    transform: scale(1.1); 
                    box-shadow: 0 0 40px rgba(255, 0, 0, 0.9);
                }
            }
        `;
        document.head.appendChild(style);
    }
}

function stopTimer() {
    if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
        gameState.timerInterval = null;
    }
    elements.timer.textContent = '—';
    elements.timer.style.color = '#FF3333';
    elements.timer.style.fontSize = '56px';
    elements.timer.style.animation = '';
    stopSound('countdown');
}







function renderPlayers(scores = []) {
    if (!elements.playersBar || !elements.quickAdjustPlayers) return;

    const desiredCount = scores.length || gameState.playerCount || 5;
    const count = Math.min(10, Math.max(2, desiredCount));
    gameState.playerCount = count;

    elements.playersBar.innerHTML = '';
    elements.quickAdjustPlayers.innerHTML = '';

    for (let i = 0; i < count; i += 1) {
        const scoreValue = typeof scores[i] !== 'undefined' ? scores[i] : 0;

        const playerDiv = document.createElement('div');
        playerDiv.className = 'player';
        playerDiv.dataset.player = String(i);
        playerDiv.style.animationDelay = `${(i + 1) * 0.1}s`;

        const button = document.createElement('button');
        button.className = 'buzzer-btn';
        button.disabled = true;
        button.innerHTML = `<span>🏆</span> Equipo ${i + 1}`;
        button.addEventListener('click', () => pressBuzzer(i));

        const scoreEl = document.createElement('div');
        scoreEl.className = 'score';
        scoreEl.textContent = scoreValue;

        // Pintar en rojo si el puntaje es negativo
        if (scoreValue < 0) {
            scoreEl.style.color = '#FF3333';
        }

        playerDiv.appendChild(button);
        playerDiv.appendChild(scoreEl);

        playerDiv.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showScoreMenu(e, i);
        });

        elements.playersBar.appendChild(playerDiv);

        const adjustDiv = document.createElement('div');
        adjustDiv.className = 'player-adjust';
        adjustDiv.dataset.player = String(i);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'player-name';
        nameSpan.textContent = `Equipo ${i + 1}`;

        const buttonsWrap = document.createElement('div');
        buttonsWrap.className = 'adjust-buttons';

        const minusBtn = document.createElement('button');
        minusBtn.className = 'btn-adjust minus';
        minusBtn.textContent = '-100';
        minusBtn.title = 'Restar 100';
        minusBtn.addEventListener('click', () => quickAdjust(i, -100));

        const quickScore = document.createElement('span');
        quickScore.className = 'player-quick-score';
        quickScore.textContent = scoreValue;

        // Pintar en rojo si el puntaje es negativo
        if (scoreValue < 0) {
            quickScore.style.color = '#FF3333';
        }

        const plusBtn = document.createElement('button');
        plusBtn.className = 'btn-adjust plus';
        plusBtn.textContent = '+100';
        plusBtn.title = 'Sumar 100';
        plusBtn.addEventListener('click', () => quickAdjust(i, 100));

        buttonsWrap.appendChild(minusBtn);
        buttonsWrap.appendChild(quickScore);
        buttonsWrap.appendChild(plusBtn);

        adjustDiv.appendChild(nameSpan);
        adjustDiv.appendChild(buttonsWrap);

        elements.quickAdjustPlayers.appendChild(adjustDiv);
    }

    refreshBuzzerState();
    updateQuickAdjustScores();
}

function refreshBuzzerState() {
    const buttons = document.querySelectorAll('.buzzer-btn');
    if (!buttons.length) return;

    if (!gameState.currentQuestion) {
        buttons.forEach((btn) => {
            btn.disabled = true;
        });
        updateBuzzerButtons();
        return;
    }

    if (gameState.currentBuzzer === null) {
        buttons.forEach((btn, idx) => {
            btn.disabled = gameState.triedPlayers.has(idx);
        });
    } else {
        buttons.forEach((btn, idx) => {
            btn.disabled = idx !== gameState.currentBuzzer;
        });
    }

    updateBuzzerButtons();
}

// ===========================
// BUZZER BUTTONS
// ===========================

function enableBuzzers(enable) {
    if (enable) {
        refreshBuzzerState();
        return;
    }

    document.querySelectorAll('.buzzer-btn').forEach((btn) => {
        btn.disabled = true;
    });

    updateBuzzerButtons();
}

function updateBuzzerButtons() {
    document.querySelectorAll('.buzzer-btn').forEach((btn, idx) => {
        if (gameState.currentBuzzer === idx) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// ===========================
// PUNTAJES
// ===========================

function updateScores(scores) {
    if (!Array.isArray(scores)) return;

    gameState.scores = scores.slice();
    gameState.playerCount = scores.length || gameState.playerCount;

    const players = document.querySelectorAll('.player');
    if (players.length !== scores.length) {
        renderPlayers(scores);
        return;
    }

    players.forEach((player, idx) => {
        const scoreEl = player.querySelector('.score');
        if (scoreEl) {
            const scoreValue = typeof scores[idx] !== 'undefined' ? scores[idx] : 0;
            scoreEl.textContent = scoreValue;

            // Pintar en rojo si el puntaje es negativo
            if (scoreValue < 0) {
                scoreEl.style.color = '#FF3333';
            } else {
                scoreEl.style.color = ''; // Resetear al color por defecto
            }
        }
    });

    updateQuickAdjustScores();
}

// Menú contextual para ajustar puntajes
// Nota: los botones de timbre suelen estar deshabilitados, por lo que no
// reciben eventos de contexto. Asociamos el menú al contenedor completo del
// jugador para garantizar que el clic derecho funcione siempre.
// Prevenir menú contextual del navegador en el área de juego
document.getElementById('app').addEventListener('contextmenu', (e) => {
    // Solo prevenir si es sobre un botón de buzzer
    if (e.target.classList.contains('buzzer-btn') || e.target.closest('.buzzer-btn')) {
        e.preventDefault();
    }
});

function showScoreMenu(event, playerIdx) {
    if (playerIdx === null || playerIdx < 0 || playerIdx >= gameState.playerCount) {
        return;
    }
    const menu = document.getElementById('score-menu');
    gameState.contextMenuPlayer = playerIdx;

    // Si el menú está dentro de un contenedor con z-index menor (como el header),
    // lo movemos al <body> la primera vez para que pueda quedar por encima del
    // overlay semitransparente. De lo contrario el overlay bloquea la interacción.
    if (menu.parentElement !== document.body) {
        // Guardar el contenedor original para referencia futura si es necesario.
        if (!menu.dataset.originalParent) {
            menu.dataset.originalParent = menu.parentElement.id || '';
        }
        document.body.appendChild(menu);
    }

    // Crear overlay si no existe
    let overlay = document.getElementById('menu-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'menu-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 99998;
            animation: fadeIn 0.15s ease;
        `;
        document.body.appendChild(overlay);
        
        // Cerrar menú al hacer clic en el overlay
        overlay.addEventListener('click', () => {
            closeScoreMenu();
        });
    }
    
    menu.style.display = 'block';
    
    // Posicionar el menú
    let left = event.pageX;
    let top = event.pageY;
    
    // Forzar renderizado para obtener dimensiones correctas
    menu.style.visibility = 'hidden';
    menu.style.display = 'block';
    const menuRect = menu.getBoundingClientRect();
    menu.style.visibility = 'visible';
    
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Si se sale por la derecha
    if (left + menuRect.width > viewportWidth - 10) {
        left = viewportWidth - menuRect.width - 10;
    }
    
    // Si se sale por abajo
    if (top + menuRect.height > viewportHeight - 10) {
        top = viewportHeight - menuRect.height - 10;
    }
    
    // Asegurar que no esté fuera por arriba o izquierda
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    
    console.log('📋 Menú contextual abierto para Equipo', playerIdx + 1);
}

// Cerrar menú con tecla Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const menu = document.getElementById('score-menu');
        if (menu.style.display === 'block') {
            closeScoreMenu();
        }
    }
});

function handleGlobalMenuClose(event) {
    const menu = document.getElementById('score-menu');

    if (!menu || menu.style.display !== 'block') {
        return;
    }

    // Mantener el menú abierto si el punto de interacción está dentro de él.
    if (menu.contains(event.target)) {
        return;
    }

    closeScoreMenu();
}

// Detectar interacciones con mouse, táctil o stylus fuera del menú.
document.addEventListener('pointerdown', handleGlobalMenuClose, true);
document.addEventListener('click', handleGlobalMenuClose);

function closeScoreMenu() {
    const menu = document.getElementById('score-menu');
    const overlay = document.getElementById('menu-overlay');

    menu.style.display = 'none';
    if (overlay) overlay.remove();
    gameState.contextMenuPlayer = null;

    console.log('📋 Menú contextual cerrado');
}

function adjustScore(player, delta) {
    const playerIdx = gameState.contextMenuPlayer;
    if (playerIdx === null || playerIdx < 0 || playerIdx >= gameState.playerCount) return;
    
    console.log(`💰 Ajustando puntaje: Jugador ${playerIdx + 1}, Delta: ${delta}`);
    socket.emit('adjust_score', { player: playerIdx, delta });
    
    // Feedback visual
    showScoreAdjustFeedback(playerIdx, delta);
    
    // Cerrar menú
    closeScoreMenu();
}

function adjustScoreByQuestionValue(player, multiplier) {
    const playerIdx = gameState.contextMenuPlayer;
    if (playerIdx === null || playerIdx < 0 || playerIdx >= gameState.playerCount) return;
    
    // Obtener el valor de la última pregunta o usar 100 por defecto
    let value = 100;
    if (gameState.currentQuestion && gameState.currentQuestion.value) {
        value = gameState.currentQuestion.value;
    }
    
    const delta = value * multiplier;
    console.log(`💰 Ajustando por valor de pregunta: ${value} x ${multiplier} = ${delta}`);
    
    socket.emit('adjust_score', { player: playerIdx, delta });
    showScoreAdjustFeedback(playerIdx, delta);
    
    // Cerrar menú
    closeScoreMenu();
}

function editScore() {
    const playerIdx = gameState.contextMenuPlayer;
    if (playerIdx === null || playerIdx < 0 || playerIdx >= gameState.playerCount) return;
    
    // Cerrar menú primero
    closeScoreMenu();
    
    const currentScore = parseInt(document.querySelectorAll('.score')[playerIdx].textContent) || 0;
    const newScore = prompt(`Nuevo puntaje para Equipo ${playerIdx + 1}:`, currentScore);
    
    if (newScore !== null && !isNaN(newScore)) {
        socket.emit('set_score', { player: playerIdx, score: parseInt(newScore) });
        showScoreAdjustFeedback(playerIdx, parseInt(newScore) - currentScore);
    }
}

function resetPlayerScore() {
    const playerIdx = gameState.contextMenuPlayer;
    if (playerIdx === null || playerIdx < 0 || playerIdx >= gameState.playerCount) return;
    
    // Cerrar menú primero
    closeScoreMenu();
    
    if (confirm(`¿Reiniciar puntaje del Equipo ${playerIdx + 1} a 0?`)) {
        const currentScore = parseInt(document.querySelectorAll('.score')[playerIdx].textContent) || 0;
        socket.emit('set_score', { player: playerIdx, score: 0 });
        showScoreAdjustFeedback(playerIdx, -currentScore);
    }
}

function quickAdjust(playerIdx, delta) {
    if (playerIdx < 0 || playerIdx >= gameState.playerCount) return;
    
    console.log(`⚡ Ajuste rápido: Jugador ${playerIdx + 1}, Delta: ${delta}`);
    socket.emit('adjust_score', { player: playerIdx, delta });
    showScoreAdjustFeedback(playerIdx, delta);
}

function showScoreAdjustFeedback(playerIdx, delta) {
    const scoreEl = document.querySelectorAll('.score')[playerIdx];
    if (!scoreEl) return;
    
    // Crear elemento de feedback flotante
    const feedback = document.createElement('div');
    feedback.style.position = 'fixed';
    feedback.style.zIndex = '10000';
    feedback.style.fontSize = '24px';
    feedback.style.fontWeight = 'bold';
    feedback.style.pointerEvents = 'none';
    feedback.style.animation = 'floatUp 1s ease-out forwards';
    
    if (delta > 0) {
        feedback.textContent = `+${delta}`;
        feedback.style.color = '#4CAF50';
    } else {
        feedback.textContent = delta;
        feedback.style.color = '#F44336';
    }
    
    // Posicionar cerca del puntaje
    const rect = scoreEl.getBoundingClientRect();
    feedback.style.left = (rect.left + rect.width / 2) + 'px';
    feedback.style.top = rect.top + 'px';
    
    document.body.appendChild(feedback);
    
    // Remover después de la animación
    setTimeout(() => feedback.remove(), 1000);
    
    // Agregar keyframe si no existe
    if (!document.getElementById('floatUp-keyframe')) {
        const style = document.createElement('style');
        style.id = 'floatUp-keyframe';
        style.textContent = `
            @keyframes floatUp {
                0% {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
                100% {
                    opacity: 0;
                    transform: translateY(-50px) scale(1.2);
                }
            }
        `;
        document.head.appendChild(style);
    }
}

function toggleQuickAdjust() {
    const panel = elements.quickAdjustPanel;
    if (!panel) return;
    const isVisible = panel.style.display !== 'none';

    if (isVisible) {
        panel.style.display = 'none';
    } else {
        panel.style.display = 'block';
        updateQuickAdjustScores();
    }
}

function updateQuickAdjustScores() {
    if (!elements.quickAdjustPlayers) return;

    const scores = document.querySelectorAll('.score');
    const quickScores = elements.quickAdjustPlayers.querySelectorAll('.player-quick-score');

    scores.forEach((scoreEl, idx) => {
        if (quickScores[idx]) {
            const scoreValue = parseInt(scoreEl.textContent, 10) || 0;
            quickScores[idx].textContent = scoreEl.textContent;

            // Pintar en rojo si el puntaje es negativo
            if (scoreValue < 0) {
                quickScores[idx].style.color = '#FF3333';
            } else {
                quickScores[idx].style.color = ''; // Resetear al color por defecto
            }
        }
    });
}

// ===========================
// UI HELPERS
// ===========================

function setStatus(text, variant) {
    // Agregar emojis según el tipo
    let emoji = '';
    if (variant === 'correct') emoji = '✅ ';
    if (variant === 'incorrect') emoji = '❌ ';
    if (variant === 'info') emoji = '💡 ';
    
    elements.statusBar.textContent = emoji + text;
    elements.statusBar.className = variant;
}

function flashStatus(variant, immediateText, afterText) {
    let flashCount = 0;
    const maxFlashes = 6;
    const interval = 150;
    
    elements.statusBar.textContent = immediateText;
    elements.statusBar.className = variant;
    
    const flashInterval = setInterval(() => {
        if (flashCount >= maxFlashes) {
            clearInterval(flashInterval);
            setStatus(afterText, 'info');
            return;
        }
        
        // Toggle entre el color y blanco
        if (flashCount % 2 === 0) {
            elements.statusBar.style.color = 'white';
        } else {
            elements.statusBar.style.color = variant === 'correct' ? 'var(--success)' : 'var(--red)';
        }
        
        flashCount++;
    }, interval);
}

function updateControlsMode() {
    console.log('🎛️ Actualizando controles. Pregunta activa:', gameState.currentQuestion !== null);
    
    // Ocultar todos primero (con chequeos)\r\n    if (elements.boardControls) elements.boardControls.style.display = 'none';\r\n    if (elements.panelControls) elements.panelControls.style.display = 'none';\r\n    if (elements.moderatorControls) elements.moderatorControls.style.display = 'none';
    
    if (gameState.currentQuestion) {
        // Hay pregunta activa
        if (gameState.hideAnswers) {
            console.log('   → Modo: Moderador (respuestas ocultas)');
            if (elements.moderatorControls) elements.moderatorControls.style.display = 'flex';
        } else {
            console.log('   → Modo: Panel (respuestas visibles)');
            if (elements.panelControls) elements.panelControls.style.display = 'flex';
        }
    } else {
        // Tablero visible
        console.log('   → Modo: Tablero');
        if (elements.boardControls) elements.boardControls.style.display = 'flex';
    }
}

// ===========================
// SONIDOS
// ===========================

function playSound(key) {
    if (sounds[key]) {
        sounds[key].currentTime = 0;
        sounds[key].play().catch(err => console.log('Error reproduciendo sonido:', err));
        
        // Feedback visual según el sonido
        if (key === 'correct') {
            createConfetti();
        } else if (key === 'incorrect') {
            shakeScreen();
        }
    }
}

function createConfetti() {
    // Crear efecto de confetti simple
    for (let i = 0; i < 30; i++) {
        const confetti = document.createElement('div');
        confetti.style.position = 'fixed';
        confetti.style.width = '10px';
        confetti.style.height = '10px';
        confetti.style.backgroundColor = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1'][Math.floor(Math.random() * 4)];
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.top = '-10px';
        confetti.style.borderRadius = '50%';
        confetti.style.pointerEvents = 'none';
        confetti.style.zIndex = '9999';
        confetti.style.transition = 'all 2s ease-out';
        
        document.body.appendChild(confetti);
        
        setTimeout(() => {
            confetti.style.top = '100vh';
            confetti.style.opacity = '0';
            confetti.style.transform = `rotate(${Math.random() * 360}deg)`;
        }, 10);
        
        setTimeout(() => confetti.remove(), 2000);
    }
}

function shakeScreen() {
    const app = document.getElementById('app');
    app.style.animation = 'shake 0.5s';
    setTimeout(() => {
        app.style.animation = '';
    }, 500);
    
    // Agregar keyframe si no existe
    if (!document.getElementById('shake-keyframe')) {
        const style = document.createElement('style');
        style.id = 'shake-keyframe';
        style.textContent = `
            @keyframes shake {
                0%, 100% { transform: translateX(0); }
                10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
                20%, 40%, 60%, 80% { transform: translateX(5px); }
            }
        `;
        document.head.appendChild(style);
    }
}

function stopSound(key) {
    if (sounds[key]) {
        sounds[key].pause();
        sounds[key].currentTime = 0;
    }
}

function stopAllSounds() {
    Object.values(sounds).forEach(sound => {
        sound.pause();
        sound.currentTime = 0;
    });
}

// ===========================
// ATAJOS DE TECLADO
// ===========================

document.addEventListener('keydown', (e) => {
    // Números 1-9 y 0 para buzzers
    if (e.key >= '1' && e.key <= '9') {
        const playerIdx = parseInt(e.key, 10) - 1;
        triggerBuzzerShortcut(playerIdx);
        return;
    }

    if (e.key === '0') {
        triggerBuzzerShortcut(9);
        return;
    }
    
    // Escape para cancelar
    if (e.key === 'Escape') {
        if (gameState.currentQuestion) {
            cancelQuestion();
        }
        return;
    }

    // Solo si hay pregunta activa y respuestas visibles
    if (!gameState.currentQuestion || gameState.hideAnswers) return;

    // Letras a-d para seleccionar respuestas
    const key = e.key.toLowerCase();
    if ('abcd'.includes(key)) {
        const index = 'abcd'.indexOf(key);
        selectChoice(index);
        return;
    }

    // Enter para enviar respuesta
    if (e.key === 'Enter') {
        submitAnswer();
        return;
    }
});

function triggerBuzzerShortcut(playerIdx) {
    if (playerIdx < 0 || playerIdx >= gameState.playerCount) return;
    const btn = document.querySelectorAll('.buzzer-btn')[playerIdx];
    if (btn && !btn.disabled) {
        pressBuzzer(playerIdx);
    }
}

// ===========================
// INICIALIZACIÓN AL CARGAR
// ===========================

window.addEventListener('load', () => {
    console.log('🎮 Painani Web iniciado');
    
    // Cargar tablero inicial
    fetch('/api/board')
        .then(r => r.json())
        .then(data => {
            if (typeof data.player_count === 'number') {
                gameState.playerCount = data.player_count;
            }
            renderBoard(data);
            updateScores(data.scores);
        })
        .catch(err => console.error('Error cargando tablero:', err));
});

// Prevenir cierre accidental
window.addEventListener('beforeunload', (e) => {
    if (gameState.currentQuestion) {
        e.preventDefault();
        e.returnValue = '';
    }
});
