import requests
import json

class OllamaManager:
    def __init__(self, host):
        self.host = host
        
    def list_models(self):
        """List all installed models"""
        response = requests.get(f"{self.host}/api/tags")
        if response.status_code == 200:
            data = response.json()
            return [{
                'name': model['name'],
                'size': model['size'],
                'modified': model['modified_at']
            } for model in data.get('models', [])]
        return []
    
    def generate(self, model, messages):
        """Generate response from model"""
        response = requests.post(
            f"{self.host}/api/chat",
            json={
                'model': model,
                'messages': messages,
                'stream': False
            }
        )
        if response.status_code == 200:
            return response.json()['message']['content']
        raise Exception(f"Generation failed: {response.text}")
    
    def pull_model(self, model_name, progress_callback=None):
        """Pull a new model with progress updates"""
        response = requests.post(
            f"{self.host}/api/pull",
            json={'name': model_name},
            stream=True
        )
        
        for line in response.iter_lines():
            if line:
                data = json.loads(line)
                if progress_callback:
                    progress_callback(data)
                if 'error' in data:
                    raise Exception(data['error'])
                    
        return True