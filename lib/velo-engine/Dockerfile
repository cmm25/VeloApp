FROM python:3.11-slim

WORKDIR /app

ENV VISION_ENGINE=yolo \
    YOLO_WEIGHTS=yolo11s-pose.pt \
    PIP_NO_CACHE_DIR=1 \
    # ultralytics: no telemetry, no config-dir writes at runtime
    YOLO_CONFIG_DIR=/app/.ultralytics

# System deps for OpenCV / ffmpeg (libgl1 covers ultralytics' opencv too)
RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libgl1 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# CPU-only torch FIRST (Koyeb/Render have no GPU) — avoids the ~2GB CUDA pull
# that the default torch wheel drags in. ultralytics then sees torch satisfied.
RUN pip install torch==2.5.1 torchvision==0.20.1 \
    --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY src ./src

# Pre-bake pose weights into the image → fast cold start, no runtime download.
RUN python -c "from ultralytics import YOLO; YOLO('yolo11s-pose.pt')"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')"

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
