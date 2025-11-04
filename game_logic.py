#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Lógica del juego - Con soporte para imágenes
"""
import json
import csv
import random
import hashlib
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
from typing import Dict, List, Set, Tuple, Optional, Any, Iterable
import os

TIME_LIMIT_SECONDS = 10

# Dataset de respaldo
SAMPLE_DATA = {
    "categories": [
        {
            "name": "Ciencia",
            "clues": [
                {"value": 100, "question": "¿Cuál es el planeta más cercano al Sol?", "choices": ["Venus", "Mercurio", "Marte", "Tierra"], "answer": 1},
                {"value": 200, "question": "¿Qué molécula transporta oxígeno en la sangre?", "choices": ["Insulina", "Hemoglobina", "Glucosa", "Colágeno"], "answer": 1},
                {"value": 300, "question": "¿Qué partícula tiene carga negativa?", "choices": ["Protón", "Neutrón", "Electrón", "Positrón"], "answer": 2},
                {"value": 400, "question": "¿Qué gas es esencial para la respiración humana?", "choices": ["Oxígeno", "Dióxido de carbono", "Nitrógeno", "Hidrógeno"], "answer": 0},
            ],
        },
        {
            "name": "Historia",
            "clues": [
                {"value": 100, "question": "¿En qué año llegó Cristóbal Colón a América?", "choices": ["1492", "1519", "1776", "1453"], "answer": 0},
                {"value": 200, "question": "¿Qué civilización construyó Machu Picchu?", "choices": ["Azteca", "Maya", "Inca", "Olmeca"], "answer": 2},
                {"value": 300, "question": "¿Quién fue conocido como el Libertador de América?", "choices": ["Simón Bolívar", "José de San Martín", "Miguel Hidalgo", "Bernardo O'Higgins"], "answer": 0},
                {"value": 400, "question": "¿En qué año comenzó la Segunda Guerra Mundial?", "choices": ["1935", "1939", "1941", "1945"], "answer": 1},
            ],
        },
        {
            "name": "Tecnología",
            "clues": [
                {"value": 100, "question": "¿Qué significa 'CPU'?", "choices": ["Central Processing Unit", "Computer Personal Unit", "Core Processing Utility", "Central Peripheral Unit"], "answer": 0},
                {"value": 200, "question": "¿Qué protocolo se usa típicamente para la web?", "choices": ["FTP", "SMTP", "HTTP", "SSH"], "answer": 2},
                {"value": 300, "question": "¿Cuál de estos es un lenguaje de programación?", "choices": ["HTML", "CSS", "Python", "JSON"], "answer": 2},
                {"value": 400, "question": "¿Qué protocolo nos permite navegar seguros en la web?", "choices": ["HTTP", "HTTPS", "FTP", "TELNET"], "answer": 1},
            ],
        },
        {
            "name": "Geografía",
            "clues": [
                {"value": 100, "question": "¿Cuál es el río más largo del mundo?", "choices": ["Amazonas", "Nilo", "Yangtsé", "Misisipi"], "answer": 0},
                {"value": 200, "question": "¿En qué continente está Egipto?", "choices": ["Asia", "África", "Europa", "Oceanía"], "answer": 1},
                {"value": 300, "question": "¿Cuál es la capital de Japón?", "choices": ["Pekín", "Seúl", "Tokio", "Osaka"], "answer": 2},
                {"value": 400, "question": "¿Qué país tiene forma de bota?", "choices": ["Grecia", "Italia", "España", "Portugal"], "answer": 1},
            ],
        }
    ]
}


class GameState:
    """Gestiona el estado completo del juego"""
    
    def __init__(self):
        self.data = SAMPLE_DATA
        self.player_count = 5
        self.player_scores = [0] * self.player_count
        self.used_questions: Set[Tuple[int, int]] = set()
        self.tile_status: Dict[Tuple[int, int], str] = {}  # 'correct' | 'used'
        self.current_buzzer: Optional[int] = None
        self.tried_players: Set[int] = set()
        self.current_question: Optional[Dict] = None
        self.timer_active = False
        self.hide_answers = False
        self.images_folder = None  # Carpeta donde buscar imágenes
        
    def reset_game(self):
        """Reinicia el juego completo"""
        self.player_scores = [0] * self.player_count
        self.used_questions.clear()
        self.tile_status.clear()
        self.current_buzzer = None
        self.tried_players.clear()
        self.current_question = None
        self.timer_active = False

    def reset_round(self):
        """Reinicia solo el tablero/pregunta, preservando puntajes"""
        self.used_questions.clear()
        self.tile_status.clear()
        self.current_buzzer = None
        self.tried_players.clear()
        self.current_question = None
        self.timer_active = False
        
    def open_question(self, cat_idx: int, clue_idx: int) -> Dict:
        """Abre una pregunta del tablero"""
        if (cat_idx, clue_idx) in self.used_questions:
            return {"error": "Pregunta ya usada"}
            
        cat = self.data["categories"][cat_idx]
        clue = cat["clues"][clue_idx]
        
        self.current_question = {
            "cat_idx": cat_idx,
            "clue_idx": clue_idx,
            "category": cat["name"],
            "value": clue["value"],
            "question": clue["question"],
            "choices": clue["choices"],
            "answer": clue["answer"]
        }

        # Incluir texto de respuesta si existe para soporte de preguntas sin opciones
        if "answer_text" in clue and clue["answer_text"]:
            self.current_question["answer_text"] = clue["answer_text"]
        
        # Agregar información de imagen si existe
        if "image" in clue and clue["image"]:
            image_name = clue["image"]
            # Construir ruta relativa para el cliente
            if self.images_folder:
                self.current_question["image"] = image_name
                self.current_question["image_folder"] = self.images_folder
        
        self.tried_players.clear()
        
        return self.current_question
        
    def buzzer_press(self, player_idx: int) -> Dict:
        """Un jugador presiona su buzzer"""
        if self.current_question is None:
            return {"error": "No hay pregunta activa"}

        if not isinstance(player_idx, int) or not (0 <= player_idx < self.player_count):
            return {"error": "Índice de jugador inválido"}

        if self.current_buzzer is not None:
            return {"error": "Ya hay un jugador respondiendo"}
            
        if player_idx in self.tried_players:
            return {"error": "Este jugador ya intentó"}
            
        self.current_buzzer = player_idx
        self.timer_active = True
        
        return {
            "success": True,
            "player": player_idx,
            "message": f"Equipo {player_idx + 1} tiene el turno"
        }
        
    def submit_answer(self, player_idx: int, answer_idx: int) -> Dict:
        """Procesa una respuesta del jugador"""
        if self.current_question is None:
            return {"error": "No hay pregunta activa"}

        if not isinstance(player_idx, int) or not (0 <= player_idx < self.player_count):
            return {"error": "Índice de jugador inválido"}

        if self.current_buzzer != player_idx:
            return {"error": "No es tu turno"}
        
        # Asegurar que ambos sean enteros para comparación
        try:
            answer_idx = int(answer_idx)
        except (ValueError, TypeError):
            answer_idx = -1
            
        cat_idx = self.current_question["cat_idx"]
        clue_idx = self.current_question["clue_idx"]
        value = self.current_question["value"]
        correct_answer = int(self.current_question["answer"])
        
        print(f"🔍 Comparando respuestas:")
        print(f"   Recibida: {answer_idx} (tipo: {type(answer_idx).__name__})")
        print(f"   Correcta: {correct_answer} (tipo: {type(correct_answer).__name__})")
        
        is_correct = (answer_idx == correct_answer)
        print(f"   ¿Es correcta? {is_correct}")
        
        if is_correct:
            # Respuesta correcta
            self.player_scores[player_idx] += value
            self.used_questions.add((cat_idx, clue_idx))
            self.tile_status[(cat_idx, clue_idx)] = 'correct'
            self.current_question = None
            self.current_buzzer = None
            self.tried_players.clear()
            self.timer_active = False
            
            return {
                "result": "correct",
                "player": player_idx,
                "new_score": self.player_scores[player_idx],
                "close_question": True
            }
        else:
            # Respuesta incorrecta
            self.player_scores[player_idx] -= value
            self.tried_players.add(player_idx)
            self.current_buzzer = None
            self.timer_active = False
            
            # ¿Quedan jugadores?
            remaining = [i for i in range(self.player_count) if i not in self.tried_players]
            
            if remaining:
                # Rebote
                return {
                    "result": "incorrect",
                    "player": player_idx,
                    "new_score": self.player_scores[player_idx],
                    "close_question": False,
                    "rebote": True,
                    "remaining_players": remaining
                }
            else:
                # Sin intentos restantes
                self.used_questions.add((cat_idx, clue_idx))
                self.tile_status[(cat_idx, clue_idx)] = 'used'
                self.current_question = None
                self.tried_players.clear()
                
                return {
                    "result": "incorrect",
                    "player": player_idx,
                    "new_score": self.player_scores[player_idx],
                    "close_question": True,
                    "rebote": False
                }
                
    def moderator_correct(self, player_idx: int) -> Dict:
        """Moderador marca como correcta (modo respuestas ocultas)"""
        if self.current_question is None:
            return {"error": "No hay pregunta activa"}

        if not isinstance(player_idx, int) or not (0 <= player_idx < self.player_count):
            return {"error": "Índice de jugador inválido"}

        if self.current_buzzer != player_idx:
            return {"error": "No es el turno de este jugador"}
            
        cat_idx = self.current_question["cat_idx"]
        clue_idx = self.current_question["clue_idx"]
        value = self.current_question["value"]
        
        self.player_scores[player_idx] += value
        self.used_questions.add((cat_idx, clue_idx))
        self.tile_status[(cat_idx, clue_idx)] = 'correct'
        self.current_question = None
        self.current_buzzer = None
        self.tried_players.clear()
        self.timer_active = False
        
        return {
            "result": "correct",
            "player": player_idx,
            "new_score": self.player_scores[player_idx],
            "close_question": True
        }
        
    def moderator_incorrect(self, player_idx: int) -> Dict:
        """Moderador marca como incorrecta (modo respuestas ocultas)"""
        if self.current_question is None:
            return {"error": "No hay pregunta activa"}

        if not isinstance(player_idx, int) or not (0 <= player_idx < self.player_count):
            return {"error": "Índice de jugador inválido"}

        if self.current_buzzer != player_idx:
            return {"error": "No es el turno de este jugador"}
            
        cat_idx = self.current_question["cat_idx"]
        clue_idx = self.current_question["clue_idx"]
        value = self.current_question["value"]
        
        self.player_scores[player_idx] -= value
        self.tried_players.add(player_idx)
        self.current_buzzer = None
        self.timer_active = False
        
        remaining = [i for i in range(self.player_count) if i not in self.tried_players]
        
        if remaining:
            return {
                "result": "incorrect",
                "player": player_idx,
                "new_score": self.player_scores[player_idx],
                "close_question": False,
                "rebote": True,
                "remaining_players": remaining
            }
        else:
            self.used_questions.add((cat_idx, clue_idx))
            self.tile_status[(cat_idx, clue_idx)] = 'used'
            self.current_question = None
            self.tried_players.clear()
            
            return {
                "result": "incorrect",
                "player": player_idx,
                "new_score": self.player_scores[player_idx],
                "close_question": True,
                "rebote": False
            }
    
    def cancel_question(self) -> Dict:
        """Cancela la pregunta actual sin afectar puntajes"""
        if self.current_question is None:
            return {"error": "No hay pregunta activa"}
            
        self.current_question = None
        self.current_buzzer = None
        self.tried_players.clear()
        self.timer_active = False
        
        return {"success": True, "message": "Pregunta cancelada"}
        
    def timeout(self) -> Dict:
        """Procesa un timeout (tiempo agotado)"""
        if self.current_buzzer is not None:
            return self.submit_answer(self.current_buzzer, -1)  # Respuesta inválida
        return {"error": "No hay jugador activo"}

    def time_up(self) -> Dict:
        """Tiempo agotado sin calificar automáticamente.
        No modifica puntajes ni estado de la pregunta; solo detiene el temporizador
        para que el moderador decida (correcto/incorrecto/cancelar).
        """
        if self.current_question is None:
            return {"error": "No hay pregunta activa"}
        self.timer_active = False
        return {
            "success": True,
            "time_up": True,
            "current_buzzer": self.current_buzzer,
            "tried_players": list(self.tried_players),
        }
        
    def adjust_score(self, player_idx: int, delta: int):
        """Ajusta el puntaje de un jugador manualmente"""
        if 0 <= player_idx < self.player_count:
            self.player_scores[player_idx] += delta
            return {"success": True, "new_score": self.player_scores[player_idx]}
        return {"error": "Índice de jugador inválido"}

    def set_score(self, player_idx: int, score: int):
        """Establece el puntaje de un jugador directamente"""
        if 0 <= player_idx < self.player_count:
            self.player_scores[player_idx] = score
            return {"success": True, "new_score": self.player_scores[player_idx]}
        return {"error": "Índice de jugador inválido"}
        
    def get_board_state(self) -> Dict:
        """Obtiene el estado actual del tablero"""
        return {
            "categories": self.data["categories"],
            "used": list(self.used_questions),
            "tile_status": {f"{k[0]},{k[1]}": v for k, v in self.tile_status.items()},
            "scores": self.player_scores,
            "player_count": self.player_count
        }

    def get_game_state(self) -> Dict:
        """Obtiene el estado completo del juego"""
        return {
            "scores": self.player_scores,
            "current_buzzer": self.current_buzzer,
            "tried_players": list(self.tried_players),
            "timer_active": self.timer_active,
            "hide_answers": self.hide_answers,
            "has_question": self.current_question is not None,
            "player_count": self.player_count
        }

    def set_player_count(self, count: int) -> Dict:
        """Configura la cantidad de equipos permitidos"""
        try:
            count = int(count)
        except (TypeError, ValueError):
            return {"error": "Cantidad de equipos inválida"}

        count = max(2, min(10, count))

        if count == self.player_count:
            return {
                "success": True,
                "player_count": self.player_count,
                "scores": self.player_scores,
                "current_buzzer": self.current_buzzer,
                "tried_players": list(self.tried_players),
                "timer_active": self.timer_active
            }

        # Ajustar puntajes existentes
        if count > self.player_count:
            self.player_scores.extend([0] * (count - self.player_count))
        else:
            self.player_scores = self.player_scores[:count]

        self.player_count = count

        # Limpiar estados que referencian jugadores eliminados
        self.tried_players = {i for i in self.tried_players if i < count}
        if self.current_buzzer is not None and self.current_buzzer >= count:
            self.current_buzzer = None
            self.timer_active = False

        return {
            "success": True,
            "player_count": self.player_count,
            "scores": self.player_scores,
            "current_buzzer": self.current_buzzer,
            "tried_players": list(self.tried_players),
            "timer_active": self.timer_active
        }


# Funciones de carga de datos (reutilizadas del código original)

def load_data(path: str = "data/questions.json") -> Dict[str, Any]:
    """Carga datos desde JSON"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict) or "categories" not in data:
            return SAMPLE_DATA
        return data
    except Exception:
        return SAMPLE_DATA


def _read_used_ids(used_csv_path: str) -> Set[int]:
    """Lee usadas.csv y devuelve conjunto de IDs ya utilizados"""
    used = set()
    p = Path(used_csv_path)
    if not p.exists():
        return used
    try:
        with p.open("r", encoding="utf-8", newline="") as f:
            r = csv.DictReader(f)
            for row in r:
                raw = (row.get("idpregunta") or row.get("id") or "").strip()
                if raw:
                    try:
                        used.add(int(raw))
                    except ValueError:
                        pass
    except Exception:
        pass
    return used


def _append_used_rows(used_csv_path: str, rows: List[dict]):
    """Anexa filas a usadas.csv"""
    p = Path(used_csv_path)
    exists = p.exists()
    try:
        with p.open("a", encoding="utf-8", newline="") as f:
            fieldnames = ["idpregunta", "category", "value", "question", "choice_a", "choice_b", "choice_c", "choice_d", "answer", "image"]
            w = csv.DictWriter(f, fieldnames=fieldnames)
            if not exists:
                w.writeheader()
            for row in rows:
                w.writerow({
                    "idpregunta": row.get("idpregunta"),
                    "category": row.get("category", ""),
                    "value": row.get("value", 0),
                    "question": row.get("question", ""),
                    "choice_a": (row.get("choices", ["", "", "", ""])[0] if "choices" in row else row.get("choice_a", "")),
                    "choice_b": (row.get("choices", ["", "", "", ""])[1] if "choices" in row else row.get("choice_b", "")),
                    "choice_c": (row.get("choices", ["", "", "", ""])[2] if "choices" in row else row.get("choice_c", "")),
                    "choice_d": (row.get("choices", ["", "", "", ""])[3] if "choices" in row else row.get("choice_d", "")),
                    "answer": row.get("answer", 0),
                    "image": row.get("image", ""),
                })
    except Exception as e:
        # Usar repr() para evitar problemas de encoding en la consola de Windows
        try:
            print(f"Error guardando en usadas.csv: {repr(e)}")
        except:
            print("Error guardando en usadas.csv (error no imprimible)")


def load_from_csv_sampled(
    path: str,
    used_csv_path: str = "data/usadas.csv",
    values_per_category=(100, 200, 300, 400, 500),
    rng_seed: Optional[int] = None
) -> dict:
    """Carga CSV con muestreo aleatorio excluyendo usadas y soporte para imágenes"""
    if rng_seed is not None:
        random.seed(rng_seed)

    used_ids = _read_used_ids(used_csv_path)

    try:
        rows = list(_read_question_rows(path))
    except UnicodeDecodeError as e:
        print(f"Error leyendo CSV: {e}")
        return SAMPLE_DATA
    except FileNotFoundError:
        raise
    except Exception as e:
        print(f"Error leyendo CSV: {e}")
        return SAMPLE_DATA

    bucket: Dict[Tuple[str, int], List[dict]] = {}

    for raw_row in rows:
        try:
            qid = int(str(raw_row.get("idpregunta", "")).strip())
        except ValueError:
            continue

        cat = (raw_row.get("category") or "General").strip()
        try:
            val = int(float(str(raw_row.get("value", "0")).strip() or "0"))
        except ValueError:
            continue

        question = (raw_row.get("question") or "").strip()
        choices = [
            (raw_row.get("choice_a") or "").strip(),
            (raw_row.get("choice_b") or "").strip(),
            (raw_row.get("choice_c") or "").strip(),
            (raw_row.get("choice_d") or "").strip(),
        ]

        original_ans = str(raw_row.get("answer", "")).strip()
        ans_raw = original_ans.lower()
        answer_text = ""
        if ans_raw in ("a", "b", "c", "d"):
            answer = "abcd".index(ans_raw)
        else:
            try:
                answer = int(ans_raw)
            except Exception:
                # Si no es indice ni letra, guardamos el texto como respuesta libre
                answer = 0
                if original_ans:
                    answer_text = original_ans

        # Leer información de imagen
        image = (raw_row.get("image") or "").strip()
        nombre_imagen = (raw_row.get("nombre_imagen") or "").strip()

        bucket.setdefault((cat, val), []).append({
            "idpregunta": qid,
            "category": cat,
            "value": val,
            "question": question,
            "choices": choices,
            "answer": answer,
            "answer_text": answer_text,
            "image": nombre_imagen if image.lower() == "si" else "",
        })

    categories = {}
    cats_in_csv = sorted({cat for (cat, _) in bucket.keys()})
    used_rows_to_append = []

    if not cats_in_csv:
        raise ValueError("El archivo no contiene preguntas válidas")

    for cat in cats_in_csv:
        clues = []
        for val in values_per_category:
            pool = bucket.get((cat, val), [])
            fresh = [r for r in pool if r["idpregunta"] not in used_ids]
            
            if fresh:
                pick = random.choice(fresh)
            elif pool:
                pick = random.choice(pool)
                pick = {**pick, "reused": True}
            else:
                pick = {
                    "idpregunta": None,
                    "category": cat,
                    "value": val,
                    "question": f"(Sin pregunta disponible para {cat} {val})",
                    "choices": ["", "", "", ""],
                    "answer": 0,
                    "image": "",
                    "unavailable": True
                }
                
            clue_payload = {
                "value": pick["value"],
                "question": pick["question"],
                "choices": pick["choices"],
                "answer": pick["answer"],
            }

            # Agregar imagen si existe
            if pick.get("image"):
                clue_payload["image"] = pick["image"]

            if pick.get("unavailable"):
                clue_payload["unavailable"] = True
            if pick.get("reused"):
                clue_payload["reused"] = True

            # Propagar texto de respuesta libre si existe
            if pick.get("answer_text"):
                clue_payload["answer_text"] = pick.get("answer_text")

            clues.append(clue_payload)

            already_used = pick.get("idpregunta") in used_ids

            if (
                not pick.get("unavailable")
                and not already_used
                and any(pick["choices"])
                and pick.get("idpregunta") is not None
            ):
                used_rows_to_append.append({
                    "idpregunta": pick["idpregunta"],
                    "category": pick["category"],
                    "value": pick["value"],
                    "question": pick["question"],
                    "choices": pick["choices"],
                    "answer": pick["answer"],
                    "image": pick.get("image", ""),
                })
                used_ids.add(pick["idpregunta"])
                
        categories[cat] = {"name": cat, "clues": clues}

    if used_rows_to_append:
        _append_used_rows(used_csv_path, used_rows_to_append)

    return {"categories": [categories[c] for c in sorted(categories.keys())]}


def _read_question_rows(path: str) -> Iterable[Dict[str, str]]:
    """Lee el archivo de preguntas ya sea CSV o XLSX y normaliza claves."""
    raw_rows: List[Dict[str, str]]
    if zipfile.is_zipfile(path):
        raw_rows = _read_xlsx_rows(path)
    else:
        raw_rows = _read_csv_rows(path)

    for row in raw_rows:
        normalized: Dict[str, str] = {}
        for key, value in row.items():
            if key is None:
                continue
            key_norm = str(key).strip().lower()
            if not key_norm:
                continue
            value_norm = value.strip() if isinstance(value, str) else value
            target_key = COLUMN_ALIASES.get(key_norm, key_norm)
            normalized[target_key] = value_norm
        if normalized:
            yield normalized


COLUMN_ALIASES = {
    "id": "idpregunta",
    "id_pregunta": "idpregunta",
    "idpregunta": "idpregunta",
    "categoria": "category",
    "categoría": "category",
    "category": "category",
    "valor": "value",
    "value": "value",
    "pregunta": "question",
    "question": "question",
    "opcion_a": "choice_a",
    "opción_a": "choice_a",
    "choice_a": "choice_a",
    "opcion_b": "choice_b",
    "opción_b": "choice_b",
    "choice_b": "choice_b",
    "opcion_c": "choice_c",
    "opción_c": "choice_c",
    "choice_c": "choice_c",
    "opcion_d": "choice_d",
    "opción_d": "choice_d",
    "choice_d": "choice_d",
    "respuesta": "answer",
    "answer": "answer",
    "imagen": "image",
    "image": "image",
    "nombre_imagen": "nombre_imagen",
    "nombre imagen": "nombre_imagen",
}


def _read_csv_rows(path: str) -> List[Dict[str, str]]:
    encodings_to_try = ["utf-8", "utf-8-sig", "latin-1", "cp1252"]
    last_error: Optional[UnicodeDecodeError] = None

    for enc in encodings_to_try:
        try:
            with open(path, "r", encoding=enc, newline="") as f:
                sample = f.read(4096)
                f.seek(0)
                try:
                    dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
                except csv.Error:
                    dialect = csv.excel

                reader = csv.DictReader(f, dialect=dialect)
                rows: List[Dict[str, str]] = []
                for row in reader:
                    if row is None:
                        continue
                    rows.append(row)
                return rows
        except UnicodeDecodeError as e:
            last_error = e
            continue

    if last_error is not None:
        raise last_error

    return []


def _read_xlsx_rows(path: str) -> List[Dict[str, str]]:
    ns = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    rows: List[List[str]] = []

    with zipfile.ZipFile(path) as zf:
        shared_strings: List[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in root.findall("a:si", ns):
                text_parts = [t.text or "" for t in si.findall(".//a:t", ns)]
                shared_strings.append("".join(text_parts))

        sheet_name = next((n for n in zf.namelist() if n.startswith("xl/worksheets/sheet")), None)
        if sheet_name is None:
            return []

        sheet_root = ET.fromstring(zf.read(sheet_name))
        sheet_data = sheet_root.find("a:sheetData", ns)
        if sheet_data is None:
            return []

        for row in sheet_data.findall("a:row", ns):
            values: List[str] = []
            for cell in row.findall("a:c", ns):
                ref = cell.attrib.get("r", "")
                col_idx = _column_index_from_ref(ref)

                while len(values) < col_idx:
                    values.append("")

                text_value = ""
                cell_type = cell.attrib.get("t")
                value_elem = cell.find("a:v", ns)

                if cell_type == "s" and value_elem is not None:
                    try:
                        idx = int(value_elem.text or "0")
                    except ValueError:
                        idx = 0
                    if 0 <= idx < len(shared_strings):
                        text_value = shared_strings[idx]
                elif cell_type == "inlineStr":
                    inline = cell.find("a:is", ns)
                    if inline is not None:
                        text_value = "".join(t.text or "" for t in inline.findall(".//a:t", ns))
                elif value_elem is not None and value_elem.text is not None:
                    text_value = value_elem.text

                values.append(text_value)

            rows.append(values)

    if not rows:
        return []

    max_len = max(len(r) for r in rows)
    normalized_rows = [r + [""] * (max_len - len(r)) for r in rows]

    header = [str(cell or "").strip().lower() for cell in normalized_rows[0]]
    data_rows = []
    for data in normalized_rows[1:]:
        if all(not str(cell).strip() for cell in data):
            continue
        row_dict: Dict[str, str] = {}
        for idx, key in enumerate(header):
            if not key:
                continue
            value = data[idx]
            row_dict[key] = value.strip() if isinstance(value, str) else value
        data_rows.append(row_dict)

    return data_rows


def _column_index_from_ref(ref: str) -> int:
    col_letters = "".join(ch for ch in ref if ch.isalpha()).upper()
    if not col_letters:
        return len(ref)

    idx = 0
    for ch in col_letters:
        idx = idx * 26 + (ord(ch) - 64)
    return max(idx - 1, 0)
