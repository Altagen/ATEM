# Security

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Report it
privately through GitHub: the repository's **Security** tab, then **Report a
vulnerability**. You will get an answer, and a fix will be released before the
problem is made public.

Useful in a report: the version (`ATEM_VERSION`), what an attacker can do, and
the steps to reproduce it.

## Supported versions

Only the latest release is supported: fixes are released as a new version, not
backported. Upgrading is described in [`docs/deployment.md`](docs/deployment.md).

## What an instance relies on

An instance is only as safe as its configuration: a long random `JWT_SECRET`,
a strong administrator password, HTTPS in front, and `ATEM_TRUSTED_PROXIES`
naming the reverse proxy — all described in
[`docs/deployment.md`](docs/deployment.md).
