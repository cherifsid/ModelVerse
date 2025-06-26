#!/bin/bash

echo "Starting Ollama Chat UI..."

# Start the model installation in the background
/app/scripts/install-models.sh &

# Start the Flask application
python backend/app.py