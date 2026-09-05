# Containers — Docker/podman, Postgres, Redis, nginx, OpenSSL

The engine is `docker` or `podman` (`<engine>` below). `scripts/docker-verify.mjs`
(`pnpm run verify:docker`) and `validate-sim-macos.sh` start their OWN containers on
OFFSET ports bound to the loopback and tear them down in an EXIT trap.
`scripts/check-container-native-base.mjs` (preflight + CI) gates every Dockerfile.
`scripts/src/lib/db-guard.ts` decides whether a database may be destroyed. Verified
2026-09-04.

## Images and networking

1. **SAYS** `docker create --expose 6379 redis:3.0.2` — "`--expose 5432` exposes a port".
   **BREAKS** a running container is NOT reachable from the host unless a port is PUBLISHED;
   `--expose` only advertises to other containers. This bit the harness once.
   **DO** publish explicitly and probe the HOST side: `<engine> run -d --name
   signalgrid-verify-redis -p 6380:6379 docker.io/library/redis:7` (docker-verify) /
   `-p 6381:6379` (harness), then `redis-cli -p 6381 ping` → `PONG`. `<engine> port <c>`
   prints the live publish map — and prints NOTHING when nothing is published, which is the
   first thing to check when a probe fails.
2. **SAYS** short image names — `nginx`, `redis:3.0.2`, `docker/getting-started`.
   **BREAKS** `check-container-native-base.mjs` FAILS any `FROM` without a registry host;
   `docker-verify.mjs` pins `docker.io/library/postgres:16`.
   **DO** always write the registry: `docker.io/library/redis:7`, `docker.io/library/postgres:16`,
   `docker.io/library/nginx:alpine`, `docker.io/library/node:22-bookworm-slim`. Never an
   ancient tag like `redis:3.0.2`.
3. **SAYS** `docker build .` with whatever base the Dockerfile names and no platform pin.
   **BREAKS** `check-container-native-base.mjs` requires every stage that runs a bundler build
   to pin `--platform` to a triple the workspace ships a COMPLETE native set for
   (linux-x64-gnu — the overrides strip everything else).
   **DO** `FROM --platform=linux/amd64 docker.io/library/node:22-bookworm-slim AS builder`
   (as `Dockerfile.api` and `Dockerfile.web` do); runtime-only stages may stay native-arch.
   Then `node scripts/check-container-native-base.mjs`.
4. **SAYS** `docker commit nginx` ("save a container as an image"); `curl …/Dockerfile |
   docker build -f - .`; `docker login` / `docker push user/image`.
   **BREAKS** the release-assurance chain (`supply-chain.yml` image-evidence: syft SBOM →
   grype → cosign keyless sign; `scheduled-verification.yml` daily `--fail-on critical`)
   covers only images built from the TREE.
   **DO** change `Dockerfile.api` / `Dockerfile.web` in the tree, build with `-f`, and let
   the per-PR image-evidence job scan the result — read the severity COUNT, not the job's
   green: it runs grype report-only for non-critical findings.
5. **SAYS** batch clean: `docker rm -f $(docker ps -aq)`, `docker rmi -f $(docker images -q)`,
   `docker volume prune`, `docker system prune -a`.
   **BREAKS** ask-first destructive; multiple lanes and the harness share this Mac;
   `sg_pgdata` (`docker-compose.prod.yml`) is the durable Postgres volume.
   **DO** name the target: `<engine> rm -f signalgrid-verify-pg signalgrid-verify-redis`;
   `volume rm <name>` only after the owner confirms. Let `verify:docker` teardown and the
   harness EXIT trap do their own cleanup.
6. **SAYS** `sudo apt install nginx`, `systemctl reload nginx`, `certbot --nginx -d …`, edit
   `/etc/nginx/conf.d/*.conf` on the host.
   **BREAKS** there is no host nginx here (macOS — no apt, no systemd); nginx is
   `docker.io/library/nginx:alpine` with `./nginx.conf` mounted read-only at
   `/etc/nginx/conf.d/default.conf`.
   **DO** edit `nginx.conf` / `docker/nginx-web.conf` in the tree, then `docker compose exec
   nginx nginx -t` and `docker compose exec nginx nginx -s reload` (or `up -d --build` for the
   web image). Location match order: exact `=` > `^~` prefix > regex `~`/`~*` (first match) >
   longest plain prefix. `server_tokens off;` in the `server` block.

## Postgres

7. **SAYS** `CREATE USER u WITH PASSWORD '…'`, `ALTER ROLE u WITH PASSWORD '…'`, `psql -W`.
   **BREAKS** `docs/DEPLOYMENT.md` step 2: never inline a password into a command; the Bash
   classifier blocks credential-shaped commands anyway.
   **DO** the prompting form: `psql "$ADMIN_DATABASE_URL" -c '\password signalgrid_runtime'`.
   Role creation is migration v2 (`pnpm run db:migrate` with the admin credential), never
   hand SQL.
8. **SAYS** `DROP DATABASE IF EXISTS …`, `DROP TABLE … CASCADE`, `DELETE FROM t` ("delete all").
   **BREAKS** `db-guard.ts`: pointing `DATABASE_URL` at a server is NOT consent. Every
   real-Postgres proof DROPs its tables and the role-split proof re-passwords roles.
   **DO** destructive proofs only through `pnpm run verify:docker` — it created the container,
   so it sets `SIGNALGRID_DB_DISPOSABLE=1` as a FACT — or against a scratch container you
   started yourself with that flag.
9. **SAYS** remote access: `listen_addresses = '*'`, `host all all 0.0.0.0/0 md5` in pg_hba.
   **BREAKS** `docker-compose.prod.yml` publishes NO database port on purpose;
   `docker-compose.migrate.yml` publishes `127.0.0.1:55432:5432` loopback-only for the
   migrate-then-boot sequence and is not to be left up.
   **DO** `docker compose -f docker-compose.prod.yml -f docker-compose.migrate.yml up -d db`,
   migrate against `postgres://sg:sg@127.0.0.1:55432/signalgrid`, then `docker compose -f
   docker-compose.prod.yml up -d` (which drops the publish).
10. **SAYS** `psql -U user mydb < backup.sql`, `pg_restore -d mydb backup -c`, `pg_dumpall >
    all.sql`.
    **BREAKS** `docs/BACKUP_AND_RESTORE.md`: a restore REFUSES an archive without its manifest,
    recomputes SHA-256, and compares the restored audit head hash to the manifest before
    exiting green.
    **DO** `DATABASE_URL=… pnpm run db:backup -- <dir>` (writes `.dump` = `pg_dump
    --format=custom` + `.manifest.json`), `pnpm run db:verify-backup -- <archive>` on a
    schedule, `pnpm run db:restore -- <archive>`.

## Redis

11. **SAYS** `FLUSHALL`, `FLUSHDB`, `KEYS *`; getting started with `redis-server` on 6379.
    **BREAKS** destructive-action rule, and `validate-sim-macos.sh` HONOURS a `REDIS_URL` a
    person set ("someone set it deliberately") — you cannot know what it points at.
    **DO** FLUSH only a container you started this session (`signalgrid-verify-redis` /
    `sgval-redis`) — better, `rm -f` it and start fresh. Never `export REDIS_URL`
    process-wide: a process-wide export once flipped ~110 harness results (BUG 1 in the
    harness's own history). `DEBUG SEGFAULT` and `SHUTDOWN` are listed as plain server
    commands — never against a shared instance.

## Forms that survived — keep these

- `<engine> inspect <c> --format '{{json .State.Health}}'` and `.NetworkSettings.Ports`;
  `<engine> logs <c>` for the boot; `<engine> history <image>` for the layers that shipped.
- The runtime image's shell is `sh`, not `bash`; inside there is `wget` and no `curl`.
- Redis primitives the code relies on: `SET key value PX <ms> NX` (lock acquire), `EVAL`
  (compare-and-release), `WATCH`/`MULTI`/`EXEC` (optimistic write), `PTTL key`, `MONITOR`.
- psql on the KEPT verify container: `psql postgres://sg:sg@localhost:5433/signalgrid`, then
  `\conninfo`, `SHOW server_version;`, `\dt`; `\password [USER]` prompts; `pg_dump -F c` is the
  custom archive; `\copy (SELECT …) TO '<path>' CSV` pulls rows out without a superuser.
- TLS: `openssl s_client -showcerts -connect host:443` dumps what an endpoint presents;
  `openssl x509 -noout -dates -fingerprint -sha256 -in cert.pem`; `openssl pkcs12 -info -in
  identity.p12`.
- The host's `openssl version` (Homebrew 3.6.x) says NOTHING about the image. Verify inside
  it: `<engine> run --rm <image> apk info -v libssl3 libcrypto3` — the check that confirmed
  #407 on hardware (3.5.8-r0, both CVEs absent).
- Mac-lane finding (2026-09-04): `docker build` from a headless shell on this Mac HANGS
  SILENTLY on `docker-credential-desktop get` (Keychain). Fix: `DOCKER_CONFIG=<dir holding an
  empty {} config.json>` so no credsStore is invoked — public bases pull anonymously. And a
  `| tail` on a long build BUFFERS every line until exit; log to a file instead.
