#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Servidor Flask 
WebSockets para comunicación en tiempo real
Con soporte para imágenes en preguntas
"""
from flask import Flask, render_template, jsonify, request, send_from_directory
from flask_socketio import SocketIO, emit
import game_logic
import os
import tempfile
from pathlib import Path

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret_2025'
socketio = SocketIO(app, cors_allowed_origins="*")

# Instancia global del juego
game = game_logic.GameState()

# =====================
# RUTAS HTTP
# =====================

@app.route('/')
def index():
    """Página principal del juego"""
    return render_template('index.html')

@app.route('/api/board')
def get_board():
    """Obtiene el estado del tablero"""
    return jsonify(game.get_board_state())

@app.route('/api/game-state')
def get_game_state():
    """Obtiene el estado completo del juego"""
    return jsonify(game.get_game_state())

@app.route('/api/load-data', methods=['POST'])
def load_data():
    """Carga datos desde JSON o CSV"""
    uploaded_path = None
    original_name = None

    try:
        if request.files:
            uploaded_file = request.files.get('file')
            if not uploaded_file or uploaded_file.filename == '':
                return jsonify({"error": "No se recibió archivo"}), 400

            original_name = uploaded_file.filename
            _, ext = os.path.splitext(original_name)
            ext = ext.lower()

            if ext not in ('.json', '.csv'):
                return jsonify({"error": "Formato no soportado"}), 400

            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
            uploaded_file.save(temp_file.name)
            temp_file.close()

            uploaded_path = temp_file.name
            file_type = 'csv' if ext == '.csv' else 'json'
            file_path = uploaded_path
        else:
            data = request.get_json(silent=True) or {}
            file_type = data.get('type', 'json')
            file_path = data.get('path', '')
            original_name = os.path.basename(file_path) if file_path else None

            if not file_path:
                return jsonify({"error": "No se especificó archivo"}), 400

        if file_type == 'csv':
            game.data = game_logic.load_from_csv_sampled(
                file_path,
                used_csv_path="data/usadas.csv"
            )
            
            # Establecer carpeta de imágenes basada en el NOMBRE ORIGINAL del archivo
            # La carpeta debe tener el mismo nombre que el archivo sin extensión
            if original_name:
                csv_basename = Path(original_name).stem
            else:
                csv_basename = Path(file_path).stem
            
            images_folder = f"data/{csv_basename}"
            
            # Verificar si la carpeta existe
            if os.path.exists(images_folder) and os.path.isdir(images_folder):
                game.images_folder = csv_basename
                print(f"📁 Carpeta de imágenes configurada: {images_folder}")
            else:
                game.images_folder = None
                print(f"⚠️ No se encontró carpeta de imágenes: {images_folder}")
                print(f"   Asegúrate de crear la carpeta: {images_folder}")
        else:
            game.data = game_logic.load_data(file_path)
            game.images_folder = None

        game.reset_game()

        # Notificar a todos los clientes
        socketio.emit('game_reset', game.get_board_state())

        display_name = original_name or os.path.basename(file_path)
        message = f"Datos cargados correctamente desde {display_name}"
        if game.images_folder:
            message += f" (con imágenes de data/{game.images_folder}/)"
        return jsonify({"success": True, "message": message})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        if uploaded_path and os.path.exists(uploaded_path):
            try:
                os.remove(uploaded_path)
            except OSError:
                pass

@app.route('/api/reset', methods=['POST'])
def reset_game():
    """Reinicia el juego"""
    game.reset_game()
    socketio.emit('game_reset', game.get_board_state())
    return jsonify({"success": True})

@app.route('/api/images-folder')
def get_images_folder():
    """Obtiene la carpeta de imágenes actual"""
    return jsonify({"images_folder": game.images_folder})

@app.route('/manual')
def manual():
    """Página del manual de usuario"""
    return render_template('manual.html')

# =====================
# WEBSOCKET EVENTS
# =====================

@socketio.on('connect')
def handle_connect():
    """Cliente se conecta"""
    print("Cliente conectado")
    emit('connected', {
        'board': game.get_board_state(),
        'game_state': game.get_game_state()
    })

@socketio.on('open_question')
def handle_open_question(data):
    """Abre una pregunta del tablero"""
    cat_idx = data.get('cat_idx')
    clue_idx = data.get('clue_idx')
    
    result = game.open_question(cat_idx, clue_idx)
    
    if 'error' in result:
        emit('error', result, broadcast=False)
    else:
        # Enviar pregunta (con o sin respuestas según modo)
        question_data = result.copy()
        if game.hide_answers:
            question_data.pop('answer', None)
            question_data.pop('choices', None)
        
        emit('question_opened', question_data, broadcast=True)

@socketio.on('buzzer_press')
def handle_buzzer(data):
    """Un jugador presiona su buzzer"""
    player_idx = data.get('player')
    
    result = game.buzzer_press(player_idx)
    
    if 'error' in result:
        emit('error', result, broadcast=False)
    else:
        emit('buzzer_activated', result, broadcast=True)
        # Iniciar temporizador del lado del cliente
        emit('start_timer', {'seconds': game_logic.TIME_LIMIT_SECONDS}, broadcast=True)

@socketio.on('submit_answer')
def handle_submit_answer(data):
    """Jugador envía su respuesta"""
    player_idx = data.get('player')
    answer_idx = data.get('answer')
    
    result = game.submit_answer(player_idx, answer_idx)
    
    if 'error' in result:
        emit('error', result, broadcast=False)
    else:
        emit('answer_result', result, broadcast=True)
        emit('stop_timer', {}, broadcast=True)
        
        # Actualizar scores
        emit('scores_update', {'scores': game.player_scores}, broadcast=True)
        
        if result.get('close_question'):
            emit('close_question', {}, broadcast=True)

@socketio.on('moderator_correct')
def handle_moderator_correct(data):
    """Moderador marca como correcta (modo ocultar respuestas)"""
    player_idx = data.get('player')
    
    result = game.moderator_correct(player_idx)
    
    if 'error' in result:
        emit('error', result, broadcast=False)
    else:
        emit('answer_result', result, broadcast=True)
        emit('stop_timer', {}, broadcast=True)
        emit('scores_update', {'scores': game.player_scores}, broadcast=True)
        emit('close_question', {}, broadcast=True)

@socketio.on('moderator_incorrect')
def handle_moderator_incorrect(data):
    """Moderador marca como incorrecta (modo ocultar respuestas)"""
    player_idx = data.get('player')
    
    result = game.moderator_incorrect(player_idx)
    
    if 'error' in result:
        emit('error', result, broadcast=False)
    else:
        emit('answer_result', result, broadcast=True)
        emit('stop_timer', {}, broadcast=True)
        emit('scores_update', {'scores': game.player_scores}, broadcast=True)
        
        if result.get('close_question'):
            emit('close_question', {}, broadcast=True)

@socketio.on('cancel_question')
def handle_cancel():
    """Cancela la pregunta actual"""
    result = game.cancel_question()
    
    if 'error' in result:
        emit('error', result, broadcast=False)
    else:
        emit('stop_timer', {}, broadcast=True)
        emit('close_question', {}, broadcast=True)

@socketio.on('timeout')
def handle_timeout():
    """Tiempo agotado"""
    result = game.timeout()
    
    emit('answer_result', result, broadcast=True)
    emit('scores_update', {'scores': game.player_scores}, broadcast=True)
    
    if result.get('close_question'):
        emit('close_question', {}, broadcast=True)

@socketio.on('toggle_hide_answers')
def handle_toggle_hide(data):
    """Cambia el modo de ocultar/mostrar respuestas"""
    game.hide_answers = data.get('hide', False)
    emit('hide_answers_toggled', {'hide': game.hide_answers}, broadcast=True)

@socketio.on('adjust_score')
def handle_adjust_score(data):
    """Ajusta el puntaje de un jugador"""
    player_idx = data.get('player')
    delta = data.get('delta', 0)
    
    result = game.adjust_score(player_idx, delta)
    
    if 'error' in result:
        emit('error', result, broadcast=False)
    else:
        emit('scores_update', {'scores': game.player_scores}, broadcast=True)

@socketio.on('set_score')
def handle_set_score(data):
    """Establece el puntaje de un jugador directamente"""
    player_idx = data.get('player')
    score = data.get('score', 0)

    result = game.set_score(player_idx, score)

    if 'error' in result:
        emit('error', result, broadcast=False)
    else:
        emit('scores_update', {'scores': game.player_scores}, broadcast=True)

@socketio.on('set_team_count')
def handle_set_team_count(data):
    """Configura la cantidad de equipos disponibles"""
    count = data.get('count')

    result = game.set_player_count(count)

    if 'error' in result:
        emit('error', result, broadcast=False)
    else:
        emit('team_count_updated', {
            'player_count': result['player_count'],
            'scores': game.player_scores,
            'current_buzzer': result.get('current_buzzer'),
            'tried_players': result.get('tried_players', []),
            'timer_active': result.get('timer_active', False)
        }, broadcast=True)
        emit('scores_update', {'scores': game.player_scores}, broadcast=True)

@socketio.on('disconnect')
def handle_disconnect():
    """Cliente se desconecta"""
    print("Cliente desconectado")

# =====================
# MANEJO DE ARCHIVOS ESTÁTICOS
# =====================

@app.route('/sounds/<path:filename>')
def serve_sound(filename):
    """Sirve archivos de sonido"""
    return send_from_directory('static/sounds', filename)

@app.route('/images/<folder>/<filename>')
def serve_image(folder, filename):
    """Sirve imágenes de preguntas desde data/<folder>/<filename>"""
    try:
        image_path = os.path.join('data', folder)
        return send_from_directory(image_path, filename)
    except Exception as e:
        print(f"Error sirviendo imagen {folder}/{filename}: {e}")
        return "Imagen no encontrada", 404


# =====================
# INICIAR SERVIDOR
# =====================

if __name__ == '__main__':
    # Crear directorios si no existen
    os.makedirs('data', exist_ok=True)
    os.makedirs('static/sounds', exist_ok=True)
    os.makedirs('static/css', exist_ok=True)
    os.makedirs('static/js', exist_ok=True)
    os.makedirs('templates', exist_ok=True)
    
    
    print("\n" + "="*50)
    print("🎮 Painani del Conocimiento - Servidor Iniciado")
    print("="*50)
    print("📍 URL: http://localhost:5000")
    print("📍 Red local: http://[tu-ip]:5000")
    print("\n🎯 Controles:")
    print("   - Teclado 1-9: Buzzers de equipos 1 al 9")
    print("   - Tecla 0: Buzzer del equipo 10")
    print("   - Teclado A-D: Seleccionar respuestas")
    print("   - Enter: Confirmar respuesta")
    print("   - Escape: Cancelar")
    print("\n📸 Soporte de imágenes:")
    print("   - Las imágenes deben estar en data/<nombre_csv>/")
    print("   - Ejemplo: data/preguntas/imagen1.jpg")
    print("\n⚡ WebSockets activos para tiempo real")
    print("="*50 + "\n")
    
    # Iniciar servidor con eventlet para mejor rendimiento
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)