# ZynqOS Remote Python Runtime (FastAPI + Docker)

This service provides a server-side CPython runtime with a shared virtual environment and a persistent `/home` for syncing to the ZynqOS VFS.

## Endpoints (high level)

- `GET /health`
- `GET /v1/python/version`
- `POST /v1/run`
- `POST /v1/pip/install`
- `GET /v1/pip/list`
- `POST /v1/fs/write`
- `GET /v1/fs/read`
- `GET /v1/fs/list`
- `POST /v1/fs/delete`
- `GET /v1/tools/list`
- `POST /v1/tools/run`
- `POST /v1/tools/install`

## Auth

If `API_KEY` is set, requests must include `X-Api-Key`.

If `X-User-Id` is provided, the service isolates files and tool state under
`/data/users/<user-id>`. Allowed characters: letters, numbers, `.`, `_`, `-`.

## Tool Execution

Remote tools run with an allowlist. Configure it via:

- `ALLOWED_TOOLS` (default includes curl/wget/nmap/dig/nslookup/traceroute/git/node/npm/pnpm)
- `ALLOWED_APT_PACKAGES` (default includes common base tools)

## EC2 (t2.micro) deployment

1. Launch an Ubuntu 22.04 t2.micro instance.
2. Open port 8000 in the security group (or use a reverse proxy).
3. SSH into the instance and install Docker:

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
```

4. (Recommended) Add a swap file for pip builds:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

5. Copy this `server/py-runtime` folder to the instance.
6. Create `.env` from `.env.example` and set `API_KEY`.
7. Build and run:

```bash
docker compose up -d --build
```

Service will listen on `http://<EC2_IP>:8000`.

## Example usage

```bash
curl -X POST http://localhost:8000/v1/run \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: change-me" \
  -d '{"code":"print(2+2)"}'
```

## Notes

- The shared virtualenv is stored under `/data/users/default/venv`.
- Files are stored under `/data/users/default/home` and persist across restarts.
- This is not a hardened sandbox. For untrusted code, run in locked-down containers or a dedicated sandbox.
