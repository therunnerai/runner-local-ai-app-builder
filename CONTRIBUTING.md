# Contributing to Runner Builder

Thank you for considering a contribution. Runner Builder is a local-first app
builder: a chat drives a coding agent that writes a real project to disk, and
the person watches it come to life in a live preview, then ships it. It is
maintained by [Runner AI](https://therunner.ai) and released under the GNU
AGPL-3.0, with commercial licenses available from the maintainer.

## How contributions are accepted

- Open an issue first for anything bigger than a small fix, so the direction can
  be agreed before you spend time on it.
- Every change arrives as a pull request against `main`. Pull requests are
  welcome from anyone; they are merged only after a maintainer's approval
  (see `.github/CODEOWNERS`). Maintainers may ask for changes, or decline a
  change that does not fit the product.
- Every contributor accepts the [Contributor License Agreement](CLA.md) once,
  by saying so in their first pull request (the template has the line). It lets
  the maintainer license the project under the AGPL and under commercial terms,
  and it leaves you every right to your own work.
- Keep a pull request to one subject. A refactor and a feature are two pull
  requests.

## What the product is

The rules that keep the product coherent, so a contribution lands well:

- **Local first.** No account of record in the cloud, no data leaving the
  machine except the model calls the person's own subscription already makes.
  Anything that needs a server is a non-goal unless it is optional and off by
  default.
- **Your own subscription or model.** The code generator is a CLI the person
  already has (today the Codex CLI; more providers and local models are on the
  roadmap). Never add a hard dependency on a hosted builder service.
- **One agent turn = one commit.** Revert must stay instant and exact.
- **Design is the bar.** The builder UI follows Apple's fluid-interface
  principles: system typography, semantic colours, interruptible springs,
  translucent chrome, a `prefers-reduced-motion` path. Generated apps are held
  to the same bar through the agent's preamble and skills. Generic "AI app"
  chrome, lorem ipsum, placeholder art and purple gradients are not accepted.
- **Plain language for people who do not code.** Every error and status that
  a person sees says what happened and what to do next.

## Setting up

```bash
npm install
npm run setup     # installs the templates' dependencies once
npm run dev       # orchestrator on :4310, builder UI on :4311
```

You need Node 22 or newer and a logged-in Codex CLI (`codex login`). A mobile
project also wants the Expo CLI login (`npx expo login`) and, for the phone
preview, Expo Go signed in to the same account. See the README for the
environment variables.

## Code conventions

- TypeScript, strict. `tsc -p apps/server` and `tsc -p apps/web` must pass.
- Comments explain why, not what; a comment that restates the code is removed
  in review.
- Server and UI share contracts through `packages/shared`. Add a type there
  before you use it on both sides.
- Prefer small, named modules over growing `routes.ts`. A new capability gets
  its own file with a short header comment saying what it owns.
- No new runtime dependency without a reason stated in the pull request.
- Commit messages: a short imperative subject, a body that says why.

## Reporting a security issue

Please do not open a public issue. See `SECURITY.md`.

## Code of conduct

Everyone interacting in this repository is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).
