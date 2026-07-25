# Deployment Runbook (AWS EC2 + Docker + nginx + Let's Encrypt)

The app runs as a Docker container published **only on loopback**; host **nginx** reverse-proxies
your domain to it over TLS. PostgreSQL runs as a **host service** on the EC2 instance (not a
container), which the app reaches via `host.docker.internal`. Uploaded media goes to **S3** using
the instance's **IAM role** (no access keys in env).

## 0. Prerequisites

- An EC2 instance (Ubuntu) with Docker + the Compose plugin installed.
- PostgreSQL 16 installed on the instance (host service).
- nginx and certbot installed on the host.
- A domain pointing at the instance's public IP.
- (Optional, for media) an S3 bucket and an IAM role attached to the instance.

## 1. Host PostgreSQL

Create the database and role:

```bash
sudo -u postgres psql
CREATE DATABASE billanta;
CREATE USER billanta WITH PASSWORD 'a-strong-password';
GRANT ALL PRIVILEGES ON DATABASE billanta TO billanta;
\q
```

Let the Docker bridge reach the host Postgres (the app connects via `host.docker.internal`, which
Compose maps to the docker gateway):

- In `postgresql.conf`: `listen_addresses = 'localhost,172.17.0.1'` (the docker0 gateway; confirm
  with `ip addr show docker0`).
- In `pg_hba.conf`: allow the docker subnet, e.g.
  `host  billanta  billanta  172.16.0.0/12  scram-sha-256`.
- `sudo systemctl restart postgresql`.
- **Keep port 5432 CLOSED in the EC2 security group** — only the local docker bridge needs it.

## 2. Environment (`.env` on the instance)

Create `.env` next to the repo (never commit it):

```
DATABASE_URL=postgresql://billanta:a-strong-password@host.docker.internal:5432/billanta?schema=public
JWT_SECRET=$(openssl rand -hex 32)
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
ADMIN_API_KEY=$(openssl rand -hex 32)

# Optional media (IAM role supplies credentials — do NOT put AWS keys here):
S3_BUCKET=billanta-media
AWS_REGION=ap-south-1
# S3_PUBLIC_BASE_URL=https://cdn.example.com   # if fronting the bucket with CloudFront

# Optional admin panel login:
ADMIN_PANEL_USER=admin
ADMIN_PANEL_PASSWORD=a-strong-password

# Host loopback port nginx will proxy to (published on 127.0.0.1 only):
APP_HOST_PORT=8091
```

The app **fails fast** at startup if any required var is missing.

For S3 media: create the bucket, attach an IAM role to the instance granting `s3:PutObject` /
`s3:DeleteObject` on it, and serve the objects publicly (a public-read bucket policy or CloudFront).
No ACL is set by the app.

## 3. First deploy

Migrations are a **discrete step** — they never run on container start.

```bash
# 1) Run pending migrations (build the image so the migration matches the schema):
docker compose -f docker-compose.prod.yml run --rm --build migrate

# 2) Start the app:
docker compose -f docker-compose.prod.yml up -d --build app

# 3) (Optional) publish the starter templates. Run once in the builder image (it has ts-node +
#    src + all deps), overriding the migrate service's command, against the same host DB:
docker compose -f docker-compose.prod.yml run --rm --build migrate \
  npx ts-node src/scripts/seedTemplates.ts
```

> ⚠️ **The migrate gotcha.** `docker compose run --rm migrate` **without `--build`** will happily
> run a STALE image and report "No pending migrations" even though you changed the schema. Always
> pass `--build`, and rebuild the app too so its regenerated Prisma client matches the new schema.

Verify: `curl http://127.0.0.1:8091/` → `Billanta Backend Running`.

## 4. nginx reverse proxy

`/etc/nginx/sites-available/billanta`:

```nginx
server {
    listen 80;
    server_name api.billanta.example;

    client_max_body_size 3m;   # template sources / media uploads

    location / {
        proxy_pass http://127.0.0.1:8091;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/billanta /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 5. TLS (Let's Encrypt)

```bash
sudo certbot --nginx -d api.billanta.example
```
certbot rewrites the server block to listen on 443 and sets up auto-renewal. Confirm renewal:
`sudo certbot renew --dry-run`.

## 6. Redeploying an update

```bash
git pull
# If the schema changed, migrate FIRST (always --build):
docker compose -f docker-compose.prod.yml run --rm --build migrate
# Rebuild + restart the app:
docker compose -f docker-compose.prod.yml up -d --build app
```

Isolation: the stack is named `billanta` (containers/network are `billanta_*`), the app publishes
only on `127.0.0.1`, and it runs no Postgres — so it can safely share a box with other projects.

## 7. Before launch — legal pages

The pages at `/privacy`, `/terms` and `/delete-account` are **templates**. Have them reviewed by a
qualified professional and confirm the product name, contact email and effective date
(`src/modules/legal/legalLayout.ts`) before submitting to Google Play, which requires reachable
Privacy Policy and Account Deletion URLs.

## Troubleshooting

- **App can't reach the DB** — check `host.docker.internal` resolves (the `extra_hosts:
  host-gateway` mapping is in `docker-compose.prod.yml`), and that `pg_hba.conf`/`listen_addresses`
  allow the docker subnet.
- **`POST /media` returns 503** — `S3_BUCKET`/`AWS_REGION` are unset, or the instance role lacks S3
  permissions. Everything else works regardless.
- **"No pending migrations" after a schema change** — you forgot `--build` on the migrate step.
- **`prisma generate` EPERM on a dev box (Windows)** — a stray `ts-node-dev` is holding the query
  engine DLL; stop it and retry.
