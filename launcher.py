#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Launcher para Web
Abre automáticamente el navegador
"""
import os
import sys
import time
import webbrowser
import threading
from pathlib import Path

# Asegurar que estamos en el directorio correcto
if getattr(sys, 'frozen', False):
    # Si es ejecutable
    application_path = os.path.dirname(sys.executable)
else:
    # Si es script
    application_path = os.path.dirname(os.path.abspath(__file__))

os.chdir(application_path)

# Crear directorios necesarios
os.makedirs('data', exist_ok=True)
os.makedirs('static/sounds', exist_ok=True)
os.makedirs('static/css', exist_ok=True)
os.makedirs('static/js', exist_ok=True)
os.makedirs('templates', exist_ok=True)

def open_browser():
    """Abre el navegador después de que el servidor esté listo"""
    time.sleep(2)  # Esperar a que el servidor inicie
    webbrowser.open('http://localhost:5000')
    print("\n✅ Navegador abierto en http://localhost:5000")
    print("⚠️  NO CIERRES ESTA VENTANA mientras juegas")
    print("🛑 Para salir: Presiona Ctrl+C aquí o cierra esta ventana\n")

# Iniciar navegador en un hilo separado
threading.Thread(target=open_browser, daemon=True).start()

# Importar y ejecutar la aplicación
from app import app, socketio
import game_logic

print("\n" + "="*60)
print("🎮 PAINANI DEL CONOCIMIENTO - ESCUELA SUPERIOR DE GUERRA")
print("="*60)
print("🚀 Iniciando servidor...")
print("📍 URL: http://localhost:5000")
print("="*60 + "\n")

try:
    socketio.run(app, host='0.0.0.0', port=5000, debug=False)
except KeyboardInterrupt:
    print("\n\n👋 Cerrando Painani. ¡Hasta pronto!")
    sys.exit(0)