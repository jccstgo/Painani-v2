# -*- mode: python ; coding: utf-8 -*-
import sys
import os
from PyInstaller.utils.hooks import collect_all, collect_submodules

block_cipher = None

# Recolectar todos los módulos de Flask y dependencias
flask_datas, flask_binaries, flask_hiddenimports = collect_all('flask')
socketio_datas, socketio_binaries, socketio_hiddenimports = collect_all('flask_socketio')
engineio_datas, engineio_binaries, engineio_hiddenimports = collect_all('engineio')
psocketio_datas, psocketio_binaries, psocketio_hiddenimports = collect_all('socketio')
eventlet_datas, eventlet_binaries, eventlet_hiddenimports = collect_all('eventlet')
werkzeug_datas, werkzeug_binaries, werkzeug_hiddenimports = collect_all('werkzeug')
jinja2_datas, jinja2_binaries, jinja2_hiddenimports = collect_all('jinja2')

# Combinar todos los datas
all_datas = flask_datas + socketio_datas + engineio_datas + psocketio_datas + eventlet_datas + werkzeug_datas + jinja2_datas
all_datas += [
    ('static', 'static'),
    ('templates', 'templates'),
    ('data', 'data'),
]

# Combinar todos los binaries
all_binaries = flask_binaries + socketio_binaries + engineio_binaries + psocketio_binaries + eventlet_binaries + werkzeug_binaries + jinja2_binaries

# Combinar todos los hiddenimports
all_hiddenimports = list(set(
    flask_hiddenimports + 
    socketio_hiddenimports + 
    engineio_hiddenimports + 
    psocketio_hiddenimports + 
    eventlet_hiddenimports + 
    werkzeug_hiddenimports + 
    jinja2_hiddenimports
))

# Agregar imports adicionales necesarios
all_hiddenimports += [
    'flask',
    'flask.app',
    'flask.blueprints',
    'flask.cli',
    'flask.config',
    'flask.ctx',
    'flask.globals',
    'flask.helpers',
    'flask.json',
    'flask.json.tag',
    'flask.logging',
    'flask.sessions',
    'flask.signals',
    'flask.templating',
    'flask.testing',
    'flask.views',
    'flask.wrappers',
    'flask_socketio',
    'socketio',
    'engineio',
    'engineio.async_drivers.threading',
    'eventlet',
    'eventlet.green',
    'eventlet.green.threading',
    'eventlet.green.socket',
    'eventlet.greenpool',
    'eventlet.hubs',
    'eventlet.wsgi',
    'werkzeug',
    'werkzeug.security',
    'werkzeug.serving',
    'werkzeug.urls',
    'werkzeug.utils',
    'jinja2',
    'jinja2.ext',
    'click',
    'itsdangerous',
    'markupsafe',
    'game_logic',
    'app',
    'dns',
    'dns.resolver',
]

a = Analysis(
    ['launcher.py'],
    pathex=[],
    binaries=all_binaries,
    datas=all_datas,
    hiddenimports=all_hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Painani',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='icon.ico' if os.path.exists('icon.ico') else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='Painani',
)