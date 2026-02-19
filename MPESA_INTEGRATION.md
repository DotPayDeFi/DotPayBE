# M-Pesa Integration (DotPayBE)

This backend now exposes minimal Daraja-backed M-Pesa APIs with database tracking for:

- `C2B` (customer pays via STK push)
- `B2C` (business pays customer phone)
- `B2B` (business paybill/till settlement)

## Added Components

- `src/routes/mpesa.js`
- `src/services/mpesa.js`
- `src/models/MpesaTransaction.js`
- `src/routes/usdc.js` (conversion-rate helper used by frontend)

## Route Map

### C2B

- `POST /api/mpesa/deposit`
- `POST /api/mpesa/buy-crypto`

Both trigger STK push (`CustomerPayBillOnline`) and store state in `MpesaTransaction`.

### B2C

- `POST /api/mpesa/withdraw`
- `POST /api/mpesa/crypto-to-mpesa`

Both trigger B2C payment requests and track callback state.

### Offramp (USDC -> Treasury -> M-Pesa)

For `POST /api/mpesa/crypto-to-mpesa`, backend accepts optional funding metadata:

- `usdcAmount`
- `treasuryAddress`
- `treasuryTransferHash` (or `cryptoTransactionHash`)

If `MPESA_REQUIRE_ONCHAIN_FUNDING=true`, `treasuryTransferHash` is required before B2C request is sent to Daraja.

### B2B

- `POST /api/mpesa/pay/paybill` (`BusinessPayBill`)
- `POST /api/mpesa/pay/till` (`BusinessBuyGoods`)
- `POST /api/mpesa/pay-with-crypto` (maps `targetType` to B2B command)

### Callback Endpoints

- `POST /api/mpesa/stk-callback`
- `POST /api/mpesa/b2c-callback`
- `POST /api/mpesa/b2b-callback`
- `POST /api/mpesa/queue-timeout`

Optional callback validation token:

- `MPESA_CALLBACK_TOKEN` (checked against `?token=` or header `x-mpesa-callback-token`)

### Utility Endpoints

- `GET /api/mpesa/transaction/:transactionId`
- `POST /api/mpesa/submit-receipt`
- `GET /api/usdc/conversionrate`

## Security Controls

- Initiation endpoints require either:
  - Bearer auth header with token-like value, or
  - valid `x-dotpay-internal-key` matching `DOTPAY_INTERNAL_API_KEY`
- In-memory request throttling is applied on initiation routes.
- Sensitive request fields (`SecurityCredential`, STK password) are never stored in plain form.

## Required Env Vars

Use `.env.example` as source of truth. At minimum set:

- `MPESA_ENV`
- `MPESA_DEV_CONSUMER_KEY`
- `MPESA_DEV_CONSUMER_SECRET`
- `MPESA_DEV_SHORTCODE`
- `MPESA_DEV_PASSKEY`
- `MPESA_DEV_INITIATOR_NAME`
- `MPESA_DEV_SECURITY_CREDENTIAL`
- `MPESA_WEBHOOK_URL`

For production, also set corresponding `MPESA_PROD_*` keys and switch `MPESA_ENV=production`.

Additional offramp controls:

- `MPESA_REQUIRE_ONCHAIN_FUNDING=true|false`
- `TREASURY_PLATFORM_ADDRESS=0x...`
