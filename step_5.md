# Step 5 — P2 Dashboard (L2 Monitoring)

> **Дата**: 13.03.2026  
> **Версія**: P2 v0.1.0  
> **Додаток**: P2_Dashboard/

---

## Що зроблено

### 1. P2_Dashboard Electron App
Окрема Electron програма для моніторингу L2 Backbone.

| Файл | Призначення |
|------|------------|
| `package.json` | Electron 28.3.3, scripts через launch.cjs |
| `launch.cjs` | VS Code ELECTRON_RUN_AS_NODE fix |
| `main.cjs` | API proxy — 7 IPC handlers до Django |
| `preload.cjs` | contextBridge IPC bridge |
| `renderer/index.html` | Premium dark-theme dashboard |

### 2. Dashboard Panels
| Панель | API Endpoint | Дані |
|--------|-------------|------|
| 📨 Messages | `/api/v1/analytics/summary/` | total, synced, pending, conflicts |
| 🖥 Nodes | `/api/v1/analytics/nodes/` | node list, message count, sync status |
| 🔄 Sync Queue | `/api/v1/analytics/sync-queue/` | queue breakdown, last 20 syncs |
| 💚 Health | `/api/v1/analytics/health/` | PostgreSQL status, DB size |

### 3. Необхідні залежності Django
- `apps/analytics/views.py` — 4 view functions
- `apps/analytics/urls.py` — URL routing
- `config/urls.py` — `/api/v1/analytics/` route
- Docker image **ТРЕБА ПЕРЕБУДУВАТИ** при змінах бекенду!

### 4. Docker rebuild fix
- Стара проблема: контейнер працював на образі без analytics URLs → 404
- Рішення: `docker build -t eatpan_backbone -f docker/Dockerfile.backbone .`

---

## Запуск

```bash
# 1. Docker backbone (обов'язково для даних)
cd B_EatPan
docker compose up -d postgres valkey
docker run -d --name eatpan_backbone --network b_eatpan_default -p 8000:8000 \
  -e DJANGO_SETTINGS_MODULE=config.settings.local \
  -e POSTGRES_HOST=eatpan_postgres \
  -e POSTGRES_DB=eatpan -e POSTGRES_USER=eatpan -e POSTGRES_PASSWORD=eatpan123 \
  eatpan_backbone

# 2. P2 Dashboard
cd P2_Dashboard
npm install
npm start
```

---

## Підтверджені дані (13.03.2026)
```
HEALTH:  ✓ healthy, DB: 8375 kB
SUMMARY: 11 messages (9 synced, 2 conflicts), 5 nodes, GSN: #11
```
