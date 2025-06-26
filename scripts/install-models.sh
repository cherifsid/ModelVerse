#!/bin/bash

echo "Waiting for Ollama to be ready..."

# Wait for Ollama to be available
while ! curl -s http://ollama:11434/api/tags > /dev/null; do
    echo "Waiting for Ollama server..."
    sleep 5
done

echo "Ollama is ready. Checking installed models..."

# Read models from file
MODELS_FILE="/app/models.txt"

if [ -f "$MODELS_FILE" ]; then
    echo "Found models.txt, installing models..."
    
    # Read each model from the file
    while IFS= read -r model || [ -n "$model" ]; do
        # Skip empty lines and comments
        if [[ -z "$model" || "$model" =~ ^# ]]; then
            continue
        fi
        
        echo "Checking model: $model"
        
        # Check if model is already installed
        if curl -s http://ollama:11434/api/tags | grep -q "\"name\":\"$model\""; then
            echo "Model $model is already installed"
        else
            echo "Installing model: $model"
            curl -X POST http://ollama:11434/api/pull \
                -H "Content-Type: application/json" \
                -d "{\"name\": \"$model\"}" \
                --no-buffer
            echo "Finished installing: $model"
        fi
    done < "$MODELS_FILE"
    
    echo "All models processed!"
else
    echo "No models.txt file found. Skipping automatic model installation."
fi

echo "Model installation script completed."