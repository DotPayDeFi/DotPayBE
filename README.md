# DotPay Backend

Express.js backend for DotPay. Starting point for user storage and APIs.

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Environment**

   Copy `.env.example` to `.env` and set your MongoDB password:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and replace `<db_password>` in `MONGODB_URI` with your Atlas user password.

   Optional:

   - `PORT` – server port (default `4000`)
   - `CLIENT_ORIGINS` – allowed CORS origins (comma-separated, no trailing slash). Example: `https://dot-pay.vercel.app,http://localhost:3000`
   - `CLIENT_ORIGIN` – legacy single-origin option (still supported)
   - `DOTPAY_BACKEND_JWT_SECRET` – required for authenticated M-Pesa user endpoints
   - `MPESA_ENABLED` – set `true` to enable Daraja flows (`false` keeps routes disabled)
   - `MPESA_ENV` – `sandbox` or `production`
   - `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`
   - `MPESA_INITIATOR_NAME`, `MPESA_SECURITY_CREDENTIAL`
   - `MPESA_RESULT_BASE_URL`, `MPESA_TIMEOUT_BASE_URL`
   - Treasury refund (for real on-chain refunds): `TREASURY_RPC_URL`, `TREASURY_PRIVATE_KEY`, `TREASURY_USDC_CONTRACT`, `TREASURY_CHAIN_ID`

3. **Run**

   ```bash
   npm run dev   # development (with --watch)
   npm start    # production
   ```

   Server runs at `http://localhost:4000` (or your `PORT`).

## API

### Health

- **GET** `/health` – `{ ok: true, service: "dotpay-backend" }`
- **GET** `/api/health` – same response (useful for serverless deployments)

### Users

- **POST** `/api/users` – create or update user (from DotPay sign-in/sign-up).

  Body (matches frontend `SessionUser`):

  ```json
  {
    "address": "0x...",
    "email": "user@example.com",
    "phone": null,
    "userId": "thirdweb-user-id",
    "authMethod": "google",
    "createdAt": "2025-01-01T00:00:00.000Z",
    "username": "your_name"
  }
  ```

  Response includes `username` and generated `dotpayId`:
  `{ success: true, data: { id, address, username, dotpayId, email, phone, ... } }`

- **PATCH** `/api/users/:address/identity` – set username and provision DotPay ID.

  Body:

  ```json
  {
    "username": "your_name"
  }
  ```

- **GET** `/api/users/:address` – get user by wallet address.

  Response: `{ success: true, data: { id, address, username, dotpayId, email, phone, ... } }`

### M-Pesa (Daraja)

- `POST /api/mpesa/quotes`
- `POST /api/mpesa/onramp/stk/initiate`
- `POST /api/mpesa/offramp/initiate`
- `POST /api/mpesa/merchant/paybill/initiate`
- `POST /api/mpesa/merchant/buygoods/initiate`
- `GET /api/mpesa/transactions/:id`
- `GET /api/mpesa/transactions`
- `POST /api/mpesa/internal/reconcile` (internal key)
- Webhooks:
  - `POST /api/mpesa/webhooks/stk`
  - `POST /api/mpesa/webhooks/b2c/result`
  - `POST /api/mpesa/webhooks/b2c/timeout`
  - `POST /api/mpesa/webhooks/b2b/result`
  - `POST /api/mpesa/webhooks/b2b/timeout`

User-initiated M-Pesa endpoints require a bearer token signed with `DOTPAY_BACKEND_JWT_SECRET`.

## Frontend integration

1. **Backend must be running** (e.g. `npm run dev`).
2. In the **Next.js app** `.env`, set:
   ```bash
   NEXT_PUBLIC_DOTPAY_API_URL=http://localhost:4000
   ```
   (Use your backend URL in production.)
3. Users are synced automatically:
   - **On login/signup**: The app sends the wallet address to `POST /api/users` right after thirdweb auth, then sends full profile (email, phone, etc.) when the session user is loaded.

From the DotPay app, after sign-in/sign-up, the session user is sent to the backend automatically. To call manually:

```ts
// Example: call from AuthSessionContext or after redirect to /home
const sessionUser = useAuthSession().sessionUser;
if (sessionUser) {
  await fetch("http://localhost:4000/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address: sessionUser.address,
      email: sessionUser.email,
      phone: sessionUser.phone,
      userId: sessionUser.userId,
      authMethod: sessionUser.authMethod,
      createdAt: sessionUser.createdAt,
    }),
  });
}
```

Use an env var (e.g. `NEXT_PUBLIC_DOTPAY_API_URL`) for the backend URL in production.

## MongoDB

Uses MongoDB Atlas. The `User` model is stored in the default database; you can add a database name to the URI if needed:

```
mongodb+srv://...@cluster0.v4yk9ay.mongodb.net/dotpay?appName=Cluster0
```

## Next steps

- Add authentication (e.g. verify thirdweb JWT or API key) before accepting `POST /api/users`.
- Add more collections and routes (wallets, transactions, etc.).

## Deploy to Vercel

This repo is set up to deploy on Vercel as serverless functions.

1. Push this repo to GitHub.
2. In Vercel: **Add New Project** -> import the GitHub repo.
3. Add these **Environment Variables** in Vercel (Production + Preview if you use preview deployments):
   - `MONGODB_URI` (required)
   - `CLIENT_ORIGINS` (recommended, used for CORS in production, include your frontend origin)
   - `DOTPAY_INTERNAL_API_KEY` (required for `/api/notifications/*`)
4. Deploy.

Notes:
- API endpoints remain at `/api/*` (e.g. `/api/users`).
- `/health` is rewritten to `/api/health` via `vercel.json`.

## Local Callback Tunnel (No ngrok token)

Use Cloudflare Tunnel (cloudflared) quick tunnels to expose your local backend and auto-update callback env values
without any auth tokens:

```bash
cd /Users/Shared/odero/DotPay/DotPayBE
./scripts/start-local-tunnel.sh
```

This updates these keys in `.env`:

- `MPESA_RESULT_BASE_URL`
- `MPESA_TIMEOUT_BASE_URL`

Then restart backend:

```bash
npm start
```

Optional: if you want to use `localhost.run` instead (not recommended because anonymous sessions can rotate hostnames),
set:

```bash
TUNNEL_PROVIDER=localhostrun ./scripts/start-local-tunnel.sh
```

Stop the tunnel:

```bash
./scripts/stop-local-tunnel.sh
```
