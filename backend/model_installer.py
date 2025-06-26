import requests
import time
import json
import threading

OLLAMA_HOST = "http://ollama:11434"

models = [
    "gemma3:12b",
]

def wait_for_ollama():
    """Wait for Ollama to be ready"""
    print("Waiting for Ollama to be ready...")
    while True:
        try:
            response = requests.get(f"{OLLAMA_HOST}/api/tags")
            if response.status_code == 200:
                print("Ollama is ready!")
                return
        except:
            pass
        time.sleep(5)

def get_installed_models():
    """Get list of already installed models"""
    try:
        response = requests.get(f"{OLLAMA_HOST}/api/tags")
        if response.status_code == 200:
            data = response.json()
            return [model['name'] for model in data.get('models', [])]
    except:
        return []

def pull_model(model_name):
    """Pull a single model"""
    print(f"Installing model: {model_name}")
    try:
        response = requests.post(
            f"{OLLAMA_HOST}/api/pull",
            json={"name": model_name},
            stream=True
        )
        
        for line in response.iter_lines():
            if line:
                data = json.loads(line)
                if 'status' in data:
                    print(f"{model_name}: {data['status']}")
                if 'error' in data:
                    print(f"Error installing {model_name}: {data['error']}")
                    return False
        
        print(f"Successfully installed: {model_name}")
        return True
    except Exception as e:
        print(f"Failed to install {model_name}: {str(e)}")
        return False

def install_models():
    """Install all models"""
    wait_for_ollama()
    
    installed = get_installed_models()
    print(f"Already installed models: {installed}")
    
    for model in models:
        if model in installed:
            print(f"Model {model} is already installed, skipping...")
        else:
            pull_model(model)

if __name__ == "__main__":
    # Run in a separate thread to not block the main app
    thread = threading.Thread(target=install_models)
    thread.daemon = True
    thread.start()
    print("Model installation started in background")