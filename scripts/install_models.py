#!/usr/bin/env python3
import requests
import time
import json
import os

OLLAMA_HOST = os.getenv('OLLAMA_HOST', 'http://ollama:11434')
MODELS_FILE = '/app/models.txt'

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
        print("Waiting for Ollama server...")
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
    """Install all models from models.txt"""
    wait_for_ollama()
    
    if not os.path.exists(MODELS_FILE):
        print("No models.txt file found. Skipping automatic model installation.")
        return
    
    installed = get_installed_models()
    print(f"Already installed models: {installed}")
    
    with open(MODELS_FILE, 'r') as f:
        models = [line.strip() for line in f if line.strip() and not line.startswith('#')]
    
    for model in models:
        if model in installed:
            print(f"Model {model} is already installed, skipping...")
        else:
            pull_model(model)
    
    print("All models processed!")

if __name__ == "__main__":
    install_models()