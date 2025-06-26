FROM python:3.11-slim

WORKDIR /app

# Copy backend requirements and install
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY models.txt ./models.txt

# Copy install script
COPY scripts/install_models.py ./scripts/install_models.py
RUN chmod +x ./scripts/install_models.py

# Expose port
EXPOSE 5000

# Run the install script in background and start Flask app
CMD bash -c "python ./scripts/install_models.py & python backend/app.py"