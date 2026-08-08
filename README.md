# Fashion Canvas Server

> [!IMPORTANT]
> **This entire repository, including the application, design, tests, documentation, and deployment setup was made with AI.**

Turn a mirror selfie into a stylized, person-free outfit canvas plus an array of individually rendered pieces with descriptive labels. The same service includes a React admin console at `/`, a separate React test studio at `/studio.html`, interactive Swagger API documentation at `/api-docs/`, and a JSON API intended for a future mobile client. Vite compiles the frontend while Express serves the production assets and API.

## Screenshots

![Fashion Canvas admin console](docs/screenshot.jpg)

![Fashion Canvas test studio](docs/studio-screenshot.jpg)

## API

The admin navigation links to an interactive Swagger client at `/api-docs/`. Its OpenAPI 3.0 document can also be downloaded as JSON from `/api-docs/openapi.json`. Both routes use the same HTTP Basic protection as the rest of the admin console. The document describes user bearer authentication, administrator authentication, request bodies, responses, error codes, rate-limit headers, and every current endpoint.

Register with `POST /api/auth/register` using a JSON `username` and `password`, then log in through `POST /api/auth/login`. Usernames contain 3–32 lowercase letters, numbers, underscores, or hyphens; passwords contain 8–128 characters. Registration starts in a pending state. An administrator can approve the account directly or generate a single-use approval voucher from `/users.html`.

A logged-in pending user redeems a voucher through `POST /api/auth/vouchers/redeem` with `Authorization: Bearer <token>` and a JSON body such as `{ "voucher": "FC-…" }`. Successful redemption atomically consumes the voucher and approves the account. Invalid vouchers return `400 invalid_voucher`, previously redeemed vouchers return `409 voucher_already_used`, and already-approved accounts return `409 account_already_approved`. The full code is returned only when `POST /api/admin/vouchers` generates it; SQLite stores only its SHA-256 hash and a short prefix for the admin voucher history returned by `GET /api/admin/vouchers`.

Login returns a bearer token and the account's approval state. `POST /api/outfits` requires that token in `Authorization: Bearer <token>` and accepts `multipart/form-data` with one `photo` field (JPEG, PNG, WebP, HEIC, or HEIF; maximum 12 MB). Missing or invalid authentication returns `401 authentication_required`; a valid account awaiting approval returns `403 approval_required`.

```json
{
  "styledOutfit": "data:image/jpeg;base64,...",
  "pieces": [
    {
      "id": "outerwear-1",
      "label": "Cropped denim jacket",
      "description": "Washed indigo denim with a boxy fit and silver buttons",
      "category": "outerwear",
      "image": "data:image/jpeg;base64,..."
    }
  ]
}
```

Each client IP may start 10 upload requests in a rolling five-minute window. The rate-limit events are stored in SQLite, so limits survive application restarts. `GET /api/debug/rate-limits` returns the current counters used by the dashboard.

The admin upload history records the authenticated username, request timestamp, client IP, `X-App-Version` header (or `web`), uploaded file size, completion status, token usage, and estimated/calculated USD price. It deliberately stores neither source photos nor generated images. `GET /api/admin/uploads?limit=100` returns the newest metadata records (up to 500). Records created before username tracking display as an unknown user.

The Coolify deployment sets `TRUST_PROXY=2` for its two-proxy topology, so Express resolves the public client address from the right side of `X-Forwarded-For` without accepting a spoofed address prepended by the client. Without an override, the server trusts loopback, link-local, and private-network proxies. Set `TRUST_PROXY` to a comma-separated Express trust list or the exact hop count when the topology differs.

Each successful debug result also shows the OpenAI models, image dimensions and byte sizes, token usage when returned, stage timings, output settings, request ID, and estimated USD cost. Cost is an estimate based on standard API pricing rather than an invoice total; when image-edit token usage is unavailable, the estimate excludes those input tokens and says so in the UI.

## Local development

```sh
cp .env.example .env
npm ci
npm run dev
```

Open `http://localhost:3000`. The OpenAI key stays server-side. Run `npm test`, `npm run test:e2e`, and `npm run build` before shipping.

## Deployment

The Docker image listens on port 3000 and exposes `/health`. Configure `OPENAI_API_KEY` as a secret environment variable. Optional model settings are documented in `.env.example`.

SQLite defaults to `/data/fashion-canvas.sqlite` in the container. Mount a persistent volume at `/data`; the included Compose definition uses the named `fashion-canvas-data` volume. Back up that volume to retain user accounts, hashed login sessions, approval state and vouchers, upload history, and rate-limit state across server replacement. Passwords are scrypt-hashed with individual random salts, and only SHA-256 hashes of bearer tokens and voucher codes are persisted.

The admin console, user administration, test studio, and operational APIs use HTTP Basic Auth in production. Mount the username and password as files at `/run/secrets/admin_username` and `/run/secrets/admin_password`; credentials are read from `ADMIN_USERNAME_FILE` and `ADMIN_PASSWORD_FILE`. The service fails to start in production when either secret is missing or empty. Registration, user login, and `/health` remain public; `POST /api/outfits` is protected by user bearer authentication and approval.

The Gitea workflow keeps build, unit test, browser test, and image publishing in separate jobs. It authenticates to Gitea's container registry with the built-in per-run token, so no custom registry secrets are required. Coolify deployments are triggered manually after a successful pipeline and pull the published image rather than building source.

## Privacy

Uploaded photos are held in memory only for processing and are not persisted by this service. They are sent to OpenAI to analyze and generate the requested images. Review the applicable OpenAI data controls before production use. Operational diagnostics remain behind administrator authentication.

The browser offers an adjustable edge crop and submits a new cropped JPEG with a maximum 1280px long edge, so discarded room and mirror pixels are never sent to OpenAI. The server repeats the same no-upscaling normalization as a safeguard. Override `INPUT_MAX_DIMENSION` to trade input-image cost and latency against fine garment detail. Generated outputs use GPT Image's low-quality mode: 1024×1024 for the complete outfit and 816×816 for each individual piece.

## License

Fashion Canvas Server is available under the [PolyForm Noncommercial License 1.0.0](LICENSE). It is free to use, modify, and share for noncommercial purposes. Commercial use or monetization is reserved to the licensor and requires a separate commercial license.

This is a source-available license, not an OSI-approved open-source license.
