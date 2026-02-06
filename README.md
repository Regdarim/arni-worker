# Arni Worker

Autonomous Agent Platform on Cloudflare Workers.

## Features

- **Webhooks** - Receive and store webhooks from external services
- **Memory (KV)** - Persistent key-value storage
- **Tasks** - Task management
- **Notes** - Note taking
- **Logs** - Activity logging
- **Proxy** - HTTP proxy through Cloudflare
- **Cron** - Scheduled jobs

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Status page |
| GET | `/health` | Health check |
| POST | `/webhook` | Receive webhook |
| GET | `/webhooks` | List webhooks |
| GET | `/memory` | List keys |
| GET/PUT/DELETE | `/memory/:key` | CRUD operations |
| GET/POST | `/tasks` | List/Create tasks |
| PUT/DELETE | `/tasks/:id` | Update/Delete task |
| GET/POST | `/notes` | List/Create notes |
| PUT/DELETE | `/notes/:id` | Update/Delete note |
| GET | `/logs` | Activity logs |
| GET/PUT | `/config` | Configuration |
| POST | `/proxy` | HTTP proxy |
| GET | `/stats` | Usage statistics |

## Deployment

```bash
npm install
npm run deploy
```

## Live

https://arni-webhook.dswiercz91.workers.dev/
