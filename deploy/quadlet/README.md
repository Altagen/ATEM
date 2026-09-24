# Quadlet units — ATEM under systemd, with podman

An alternative to `compose.yaml` for podman hosts. Each container is a systemd
service: ordering is systemd's, restart-on-boot is systemd's, and there is no
compose implementation in between — `podman-compose` 1.3.0, which Debian and
Ubuntu package, cannot resolve this stack's dependency graph and does not
expand `${VAR:-default}`.

Rootless is the intended shape: a container escape lands as an unprivileged
user rather than as root.

```sh
# Once, as root: let the user's services run without a login session, and let
# a rootless container bind 80/443 (only needed for the reverse proxy).
loginctl enable-linger prod
echo 'net.ipv4.ip_unprivileged_port_start=80' > /etc/sysctl.d/80-unprivileged-ports.conf
sysctl --system

# As the service user:
mkdir -p ~/services/atem ~/.config/containers/systemd
cp deploy/quadlet/* ~/.config/containers/systemd/     # except this README
cp .env.example ~/services/atem/.env                  # then fill it in
```

`~/services/atem/.env` needs the required values (`JWT_SECRET`, the
administrator, `POSTGRES_PASSWORD`) plus the address the API and the migration
connect to — compose builds it, here it is written once:

```sh
echo "DATABASE_URL=postgres://atem:<POSTGRES_PASSWORD>@atem-db:5432/atem" >> ~/services/atem/.env
```

Then start them in order — systemd holds it afterwards:

```sh
systemctl --user daemon-reload
systemctl --user start atem-db
systemctl --user start atem-migrate
systemctl --user start atem-api atem-web
```

`atem-web` publishes nothing: put it on the same network as your reverse proxy
(`edge` here) and proxy to `atem-web:80`. To expose it directly instead, add
`PublishPort=127.0.0.1:8080:80` to `atem-web.container`.

The card catalogue, once: `podman exec atem-api node dist/modules/referential/sync.js`.
