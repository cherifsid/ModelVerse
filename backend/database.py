import sqlite3
import os
import json

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'chat_history.db')

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    with conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                model TEXT,
                image_path TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS model_metadata (
                model_name TEXT PRIMARY KEY,
                is_vision INTEGER NOT NULL DEFAULT 0
            )
        ''')
    conn.close()

def create_chat(title="New Chat"):
    conn = get_db_connection()
    with conn:
        cursor = conn.cursor()
        cursor.execute("INSERT INTO chats (title) VALUES (?)", (title,))
        chat_id = cursor.lastrowid
    conn.close()
    return chat_id

def get_chats():
    conn = get_db_connection()
    chats = conn.execute("SELECT id, title, created_at FROM chats ORDER BY created_at DESC").fetchall()
    conn.close()
    return [dict(chat) for chat in chats]

def get_messages(chat_id):
    conn = get_db_connection()
    messages = conn.execute(
        "SELECT role, content, image_path FROM messages WHERE chat_id = ? ORDER BY timestamp ASC",
        (chat_id,)
    ).fetchall()
    conn.close()
    return [dict(msg) for msg in messages]

def add_message(chat_id, role, content, model=None, image_paths=None):
    conn = get_db_connection()
    # Store multiple image paths as a JSON string
    image_paths_json = json.dumps(image_paths) if image_paths else None
    with conn:
        conn.execute(
            "INSERT INTO messages (chat_id, role, content, model, image_path) VALUES (?, ?, ?, ?, ?)",
            (chat_id, role, content, model, image_paths_json)
        )
    conn.close()
    
def delete_chat(chat_id):
    conn = get_db_connection()
    with conn:
        conn.execute("DELETE FROM chats WHERE id = ?", (chat_id,))
    conn.close()

def get_chat_title(chat_id: int) -> str:
    conn = get_db_connection()
    chat = conn.execute("SELECT title FROM chats WHERE id = ?", (chat_id,)).fetchone()
    conn.close()
    return chat['title'] if chat else "Unknown Chat"

def import_messages(source_chat_id: int, target_chat_id: int, source_chat_title: str):
    conn = get_db_connection()
    source_messages = conn.execute(
        "SELECT role, content, model, image_path FROM messages WHERE chat_id = ? ORDER BY timestamp ASC",
        (source_chat_id,)
    ).fetchall()
    with conn:
        separator_content = f"--- Imported context from: {source_chat_title} ---"
        conn.execute(
            "INSERT INTO messages (chat_id, role, content, model) VALUES (?, ?, ?, ?)",
            (target_chat_id, 'system', separator_content, 'import-tool')
        )
        for msg in source_messages:
            conn.execute(
                "INSERT INTO messages (chat_id, role, content, model, image_path) VALUES (?, ?, ?, ?, ?)",
                (target_chat_id, msg['role'], msg['content'], msg['model'], msg['image_path'])
            )
    conn.close()

def set_model_vision_capability(model_name: str, is_vision: bool):
    conn = get_db_connection()
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO model_metadata (model_name, is_vision) VALUES (?, ?)",
            (model_name, 1 if is_vision else 0)
        )
    conn.close()

def get_vision_models() -> set:
    conn = get_db_connection()
    rows = conn.execute("SELECT model_name FROM model_metadata WHERE is_vision = 1").fetchall()
    conn.close()
    return {row['model_name'] for row in rows}