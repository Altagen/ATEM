# Security

## Reporting a vulnerability

Do not open a public issue. Report it privately: the repository's **Security**
tab, then **Report a vulnerability**. A fix is released before the problem is
made public.

Include the version (`ATEM_VERSION`), what an attacker can do, and the steps to
reproduce.

## Supported versions

Only the latest release. Fixes ship as a new version, not as backports.
Upgrading: [`docs/deployment.md`](../docs/deployment.md).

## Instance configuration

An instance needs a long random `JWT_SECRET`, a strong administrator password,
HTTPS in front, and `ATEM_TRUSTED_PROXIES` naming the reverse proxy. See
[`docs/deployment.md`](../docs/deployment.md).
