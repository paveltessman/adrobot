FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --create-home --uid 10001 adrobot \
    && mkdir /data && chown adrobot:adrobot /data

COPY adrobot ./adrobot
USER adrobot
EXPOSE 8000
CMD ["uvicorn", "adrobot.httpserver.server:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
