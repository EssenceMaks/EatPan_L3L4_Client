# Step 6 — P1 Admin (L1 Backup & Control)

> **Дата**: 13.03.2026  
> **Версія**: P1 v0.1.0  
> **Додаток**: P1_Admin/

---

## Що зроблено

### 1. P1_Admin Electron App
Окрема Electron програма для L1 Backup Admin та повного контролю мережі.

| Файл | Призначення |
|------|------------|
| `package.json` | Electron 28, scripts через launch.cjs |
| `launch.cjs` | VS Code ELECTRON_RUN_AS_NODE fix |
| `main.cjs` | API proxy + pg_dump + Docker monitor (10 IPC handlers) |
| `preload.cjs` | admin IPC bridge |
| `renderer/index.html` | 5-tab premium admin dashboard |

### 2. Dashboard Tabs
| Tab | Функціональність |
|-----|-----------------|
| 📊 Overview | KPI cards (Messages, Nodes, Health, Backups) + node list + recent syncs |
| 🌐 Topology | Visual L1→L2→L3→L4 network map з Docker containers |
| 💾 Backups | pg_dump trigger → Documents/*.sql + файл-лист |
| 🐳 Docker | Таблиця всіх Docker containers (name, status, ports) |
| 🔄 Sync Log | Sync queue breakdown + last 20 syncs з GSN |

### 3. IPC Handlers (main.cjs)
| Handler | Функція |
|---------|---------|
| `api-summary` | L2 analytics summary |
| `api-nodes` | L2 node list |
| `api-sync-queue` | L2 sync queue |
| `api-health` | L2 health check |
| `api-history` | L2 chat history |
| `api-rooms` | L2 chat rooms |
| `trigger-backup` | pg_dump → .sql file |
| `list-backups` | List backup files |
| `docker-containers` | Docker ps |
| `get-config` | App config |

### 4. Design
- **Gold/amber accent** — символізує L1 authority
- **Tag**: `LEVEL 1` + `ADMIN`
- Auto-refresh кожні 5с
- Responsive cards і таблиці

---

## Запуск

```bash
cd P1_Admin
npm install
npm start
```

Для backup — Docker postgres має бути запущений:
```bash
docker compose -f B_EatPan/docker-compose.yml up -d postgres
```
