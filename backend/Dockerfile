FROM python:3.12-slim

WORKDIR /app

RUN pip install uv

COPY backend/ ./backend/
COPY frontend/ ./frontend/

WORKDIR /app/backend

RUN uv sync --no-dev

EXPOSE 8080

CMD ["uv", "run", "python3", "server.py"]
