# Bike GR Calendar

Community event calendars (Rides & Events, Advocacy) for the Greater Grand Rapids Bicycle Coalition.
Replace the Tockify calendar embedded at https://www.bikegr.org/events and
https://www.bikegr.org/make-a-difference.

- [CONTEXT.md](CONTEXT.md) — domain terms. Use them in code, docs, and commits.
- [docs/design.md](docs/design.md) — decisions, data model, Tockify import plan, open items.
- [docs/build-plan.md](docs/build-plan.md) — milestones, in build order.
- [docs/adr/](docs/adr/) — architecture decision records.

## Local development

1. Copy `.env.example` to `.env.local`, then `pnpm install`, `pnpm db:up`, `pnpm db:migrate`, and
   `pnpm db:seed`.
2. `pnpm dev`. With no `RESEND_API_KEY`, magic links and emails print to the console.
3. The public Submission form (`/submit`) needs Turnstile keys. For local work, set
   `TURNSTILE_TEST_KEYS=1` in `.env.local` (and leave both Turnstile keys empty): Cloudflare's
   always-pass test keys. Without keys or this opt-in, the form says "Submissions are closed".
