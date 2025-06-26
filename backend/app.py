from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO, emit
import requests
import json
import os
import base64
from werkzeug.utils import secure_filename
from ollama_manager import OllamaManager
import database as db

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

UPLOAD_FOLDER = 'uploads'
UPLOAD_FOLDER_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), UPLOAD_FOLDER)
os.makedirs(UPLOAD_FOLDER_PATH, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER_PATH

db.init_db()

OLLAMA_HOST = os.getenv('OLLAMA_HOST', 'http://localhost:11434')
ollama = OllamaManager(OLLAMA_HOST)

@app.route('/')
def index():
    return send_from_directory('../frontend', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('../frontend', path)

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/api/upload', methods=['POST'])
def upload_image():
    if 'images[]' not in request.files:
        return jsonify({'error': 'No image part in request'}), 400
    
    files = request.files.getlist('images[]')
    image_paths = []
    
    if not files:
        return jsonify({'error': 'No selected image'}), 400
        
    for file in files:
        if file and file.filename != '':
            filename = secure_filename(file.filename)
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)
            image_paths.append(f'uploads/{filename}')
            
    return jsonify({'image_paths': image_paths})

@app.route('/api/chats', methods=['GET'])
def get_all_chats():
    chats = db.get_chats()
    return jsonify(chats)

@app.route('/api/chats', methods=['POST'])
def create_new_chat():
    data = request.get_json()
    title = data.get('title', 'New Chat') if data else 'New Chat'
    chat_id = db.create_chat(title=title)
    return jsonify({'chat_id': chat_id})

@app.route('/api/chats/<int:chat_id>/messages', methods=['GET'])
def get_chat_messages(chat_id):
    messages = db.get_messages(chat_id)
    return jsonify(messages)
    
@app.route('/api/chats/<int:chat_id>', methods=['DELETE'])
def delete_single_chat(chat_id):
    db.delete_chat(chat_id)
    return jsonify({'success': True})

@app.route('/api/chats/<int:target_chat_id>/import', methods=['POST'])
def import_chat_context(target_chat_id):
    data = request.get_json()
    source_chat_id = data.get('source_chat_id')
    if not source_chat_id:
        return jsonify({'error': 'Source chat ID is required'}), 400
    try:
        source_title = db.get_chat_title(source_chat_id)
        db.import_messages(source_chat_id, target_chat_id, source_title)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/models', methods=['GET'])
def get_models():
    try:
        ollama_models = ollama.list_models()
        vision_models = db.get_vision_models()
        for model in ollama_models:
            model['is_vision'] = model['name'] in vision_models
        return jsonify({'models': ollama_models})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@socketio.on('install_model')
def handle_install_model(data):
    model_name = data.get('model')
    is_vision = data.get('is_vision', False)
    if not model_name:
        emit('install_error', {'error': 'Model name is required'})
        return
    def progress_callback(progress_data):
        if 'status' in progress_data:
            emit('install_progress', {'message': f"{model_name}: {progress_data['status']}"})
    try:
        emit('install_progress', {'message': f'Starting installation of {model_name}...'})
        success = ollama.pull_model(model_name, progress_callback)
        if success:
            db.set_model_vision_capability(model_name, is_vision)
            emit('model_installed', {'status': 'completed', 'model': model_name})
        else:
            emit('install_error', {'error': f'Failed to install {model_name}'})
    except Exception as e:
        emit('install_error', {'error': str(e)})

@socketio.on('chat_stream')
def handle_chat_stream(data):
    model = data.get('model')
    message = data.get('message')
    chat_id = data.get('chat_id')
    options = data.get('options', {})
    image_paths = data.get('image_paths', [])

    if not all([model, chat_id]):
        emit('response_error', {'error': 'Model and chat_id are required'})
        return
    
    context = db.get_messages(chat_id)
    db.add_message(chat_id, 'user', message, model=None, image_paths=image_paths)
    
    user_message = {"role": "user", "content": message}
    
    if image_paths:
        encoded_images = []
        try:
            for image_path in image_paths:
                abs_image_path = os.path.join(app.config['UPLOAD_FOLDER'], os.path.basename(image_path))
                with open(abs_image_path, "rb") as image_file:
                    encoded_images.append(base64.b64encode(image_file.read()).decode('utf-8'))
            user_message['images'] = encoded_images
        except Exception as e:
            emit('response_error', {'error': f"Error reading image(s): {e}", 'chat_id': chat_id})
            return

    payload = {
        "model": model,
        "messages": context + [user_message],
        "stream": True,
        "options": options
    }
    
    try:
        response = requests.post(f"{OLLAMA_HOST}/api/chat", json=payload, stream=True)
        response.raise_for_status()
        
        full_response = ""
        for line in response.iter_lines():
            if line:
                chunk = json.loads(line)
                if 'message' in chunk and 'content' in chunk['message']:
                    content = chunk['message']['content']
                    full_response += content
                    socketio.emit('response_chunk', {'content': content, 'chat_id': chat_id})
                if chunk.get('done'):
                    db.add_message(chat_id, 'assistant', full_response, model=model)
                    socketio.emit('response_complete', {'chat_id': chat_id})
                    break
                    
    except requests.exceptions.RequestException as e:
        socketio.emit('response_error', {'error': str(e), 'chat_id': chat_id})
    except Exception as e:
        socketio.emit('response_error', {'error': f"An unexpected error occurred: {e}", 'chat_id': chat_id})

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True)