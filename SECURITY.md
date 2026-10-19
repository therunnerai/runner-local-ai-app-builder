# Security

Runner Builder runs on your own machine, with your own accounts. The surfaces
that matter are the local HTTP API, the agent sandbox, the GitHub and Expo
credentials the builder uses on your behalf, and the projects it writes.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private
vulnerability reporting on this repository ("Report a vulnerability" under the
Security tab), or email security@therunner.ai. Include steps to reproduce and
the version or commit you tested.

You will get an acknowledgement, a fix or a mitigation plan, and credit in the
release notes if you want it.

## Scope notes

- The builder listens on loopback only. Exposing it on a network is not a
  supported configuration.
- Accounts and workspaces are a convenience on one trusted machine, not a
  security boundary between people with shell access to that machine.
- The agent runs in the Codex CLI sandbox with write access limited to the
  project directory. Report anything that lets generated code or a prompt reach
  outside that directory, the builder's data home, or your credentials.
