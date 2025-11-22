# SmartVendor Backend

Backend service for SmartVendor — provides OCR + AI-driven receipt parsing and basic receipt storage APIs.

This repository contains a small Express service written in TypeScript that:
- Accepts a POST `/parse-receipt` with an image URI and vendorId, runs Google Cloud Vision OCR, calls Vertex/GenAI to parse receipt text into structured JSON, and saves receipts to Firestore.
- Provides a simple `/add-receipt` helper route to add receipts directly.

This README explains how to run the service locally, required environment variables, how to provide Google credentials, and how to test endpoints.

## Prerequisites
- Node.js (recommended >= 18)
- npm
- If you plan to call Google Cloud APIs: a Google Cloud project with Vision API, Vertex/GenAI and Firestore enabled.
- `gcloud` CLI (optional but helpful)

## Important environment variables
- `GOOGLE_CLOUD_PROJECT` — your GCP project id.
- `GOOGLE_APPLICATION_CREDENTIALS` — path to your service account JSON key (see notes below).
- `DEBUG` — set to `true` to enable additional logs from the server (default debug on when NODE_ENV != production).
- `VERTEX_TIMEOUT_MS` — optional parse timeout in ms (default `15000`).
- `PORT` — port to run on locally (default `8080`).

### Setting up Google credentials (local development)
1. Create a service account in Google Cloud Console with minimal roles needed (Vision, Vertex/GenAI or appropriate roles, Firestore Datastore User).
2. Create and download a JSON key file to a safe local path (e.g. `~/keys/smartvendor-key.json`).
3. Set the env var in your shell (zsh):
```bash
export GOOGLE_APPLICATION_CREDENTIALS="/Users/you/keys/smartvendor-key.json"
```
Add the same line to `~/.zshrc` to persist.

Or use Application Default Credentials for quick local testing:
```bash
gcloud auth application-default login
```

## Install & Build
```bash
npm install
npm run build    # compile TypeScript to dist/
```

## Run (dev)
Quick dev run using `ts-node` (requires `ts-node` in devDependencies):
```bash
DEBUG=true npx ts-node index.ts
```

## Run (production)
```bash
DEBUG=true node dist/index.js
```

## API Endpoints

1) Parse receipt (OCR + AI + save to Firestore)

POST /parse-receipt
Headers: `Content-Type: application/json`
Body:
```json
{ "imageUrl": "gs://your-bucket/receipt.jpg", "vendorId": "vendor_123", "date": "2025-11-14" }
```

Quick validation-only request (no external API call):
```bash
curl -s -X POST http://localhost:8080/parse-receipt \
  -H "Content-Type: application/json" \
  -d '{"vendorId":"vendor_123"}' -w "\nHTTP_STATUS:%{http_code}\n"
```
Expected: a 400 response indicating `imageUrl` is required — useful to verify the route and server are running.

Full parse example (may require proper GCS URI and working credentials):
```bash
curl -s -X POST http://localhost:8080/parse-receipt \
  -H "Content-Type: application/json" \
  -d '{"imageUrl":"gs://your-bucket/receipt.jpg","vendorId":"vendor_123"}' -w "\nHTTP_STATUS:%{http_code}\n" --max-time 60
```

2) Add receipt (manual)

POST /add-receipt
Body example:
```json
{ "vendorId": "vendor_123", "totalAmount": 2500, "items": [ {"item":"Apple","quantity":1,"price":2500} ], "date": "2025-11-14" }
```

3) Get analytics (hook)

POST /get-analytics/:vendorId
This route calls `updateAnalyticsOnReceiptCreate` in `app/analytics.ts`.

## Debugging & Logs
- Set `DEBUG=true` for verbose logging. Example:
```bash
DEBUG=true node dist/index.js
```
- When running on Cloud Run / Cloud Functions, view logs in Google Cloud Console -> Logging.
- If requests hang or return no response, common causes include missing `GOOGLE_APPLICATION_CREDENTIALS` or network/firewall restrictions to Google APIs.

## Security notes
- Do NOT commit your service account JSON to git. Use the included `.gitignore` to avoid accidental commits.
- Use least privilege for service account roles.

## Deployment
- Cloud Run: build a Docker image and deploy. Mount or provide credentials securely (Secret Manager or runtime mount) — do not bake keys into images.
- Firebase Functions: there is a `smartvendor-functions` folder (if present) and you can use `firebase deploy --only functions` — follow Firebase docs for credentials and environment config.

## Troubleshooting model parsing failures
- The service logs both OCR output length and AI candidate output. If the AI output is not valid JSON, the server will log the raw returned text; increase `VERTEX_TIMEOUT_MS` for slow responses.

## Mock Mode (recommended for judges / hackathons)
If you want to run and test the backend without Google Cloud credentials or network access, enable the mock mode. This is useful for judges to quickly validate the API behavior locally.

- `MOCK_OCR=true` — skips Vision OCR and uses canned receipt text.
- `MOCK_AI=true` — skips Vertex/GenAI and returns a canned parsed JSON structure.

Example (run with both mocks enabled):
```bash
MOCK_OCR=true MOCK_AI=true DEBUG=true npx ts-node index.ts
```

Then exercise the endpoint (no GCS image required):
```bash
curl -s -X POST http://localhost:8080/parse-receipt \
  -H "Content-Type: application/json" \
  -d '{"imageUrl":"https://example.com/receipt.jpg","vendorId":"judge_1"}' -w "\nHTTP_STATUS:%{http_code}\n"
```

Expected: the service will return a 201 and a mocked parsed JSON payload (no external APIs called).


## Want a mock mode?
If you prefer quick local testing without Google APIs, open an issue or request and a `MOCK` mode can be added to return canned OCR+parsed data.

---
If you'd like, I can add that mock mode now, or help you create a service account/key and test an end-to-end parse.
