# AdRobot

AdRobot is a campaign management UI for Keitaro, built with FastAPI, SQLAlchemy
and Next.js. It creates campaigns and lets you edit their streams and offers.

## Deploy without cloning

Create an empty deployment directory and save the following as
`docker-compose.yml` (also available as [docker-compose.yml](docker-compose.yml)
in this repository):

```yaml
services:
  backend:
    image: ghcr.io/paveltessman/adrobot-backend:${ADROBOT_IMAGE_TAG:-latest}
    restart: unless-stopped
    environment:
      ADROBOT_KEITARO_BASE_URL: ${ADROBOT_KEITARO_BASE_URL:?Set ADROBOT_KEITARO_BASE_URL in .env}
      ADROBOT_KEITARO_API_KEY: ${ADROBOT_KEITARO_API_KEY:?Set ADROBOT_KEITARO_API_KEY in .env}
      ADROBOT_DATABASE_URL: sqlite+aiosqlite:////data/adrobot.sqlite3
    volumes:
      - adrobot-data:/data
    healthcheck:
      test:
        [
          "CMD",
          "python",
          "-c",
          "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/openapi.json', timeout=3)",
        ]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s

  frontend:
    image: ghcr.io/paveltessman/adrobot-frontend:${ADROBOT_IMAGE_TAG:-latest}
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      backend:
        condition: service_healthy

volumes:
  adrobot-data:
```

Create `.env` beside it, replacing the example values:

```dotenv
ADROBOT_KEITARO_BASE_URL=https://keitaro.example/admin_api/v1/
ADROBOT_KEITARO_API_KEY=replace-with-your-keitaro-api-key
```

SQLite state is initialized automatically and persists in `adrobot-data` docker
volume.

Pull and start the stack:

```sh
docker compose pull
docker compose up -d --wait
```

The app is available at `http://localhost:3000`.

## Local development

```sh
python3.14 -m venv .venv
.venv/bin/pip install -r requirements.txt
# Set the two ADROBOT_KEITARO_* values in a root .env file.
.venv/bin/python run.py
```

In a second terminal, run `npm ci` and `npm run dev` from `frontend/` using Node.js 24. See [frontend/README.md](frontend/README.md) for frontend setup and checks.
Run backend tests with pytest.
