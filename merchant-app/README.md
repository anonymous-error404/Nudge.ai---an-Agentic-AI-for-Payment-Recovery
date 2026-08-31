# Mock Merchant App — TechZone

A simple e-commerce demo app for the **AI Payment Recovery Agent** (Razorpay AI Buildathon 2026). This is the merchant-side host: it runs the storefront, payment layer, webhook receiver, and (later) the MCP client + recovery orchestrator.

## Quick Start

### 1. Install dependencies

```bash
cd merchant-app
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` with your Razorpay **test-mode** credentials:

| Variable | Where to get it |
|---|---|
| `RAZORPAY_KEY_ID` | [Razorpay Dashboard → Settings → API Keys](https://dashboard.razorpay.com/app/keys) (test mode) |
| `RAZORPAY_KEY_SECRET` | Same page |
| `WEBHOOK_SECRET` | [Dashboard → Settings → Webhooks](https://dashboard.razorpay.com/app/webhooks) → create a webhook → copy the secret |

### 3. Set up the database

```bash
npm run db:migrate   # Creates dev.db and runs schema migration
npm run db:seed      # Seeds 5 customers, 5 products, 5 pre-failed payments
```

### 4. Start the server

```bash
npm run dev
```

Visit:
- **Storefront:** http://localhost:3000
- **Admin Panel:** http://localhost:3000/admin
- **Webhook URL:** http://localhost:3000/webhook/razorpay

---

## Project Structure

```
merchant-app/
├── prisma/
│   ├── schema.prisma          # DB schema (5 tables)
│   └── seed.ts                # Seeds all demo data
├── src/
│   ├── server.ts              # Express entry point
│   ├── routes/
│   │   ├── shop.ts            # GET /api/products, /api/orders, /api/failure-events
│   │   ├── checkout.ts        # POST /api/checkout, GET /api/payment/:id/status
│   │   └── webhook.ts         # POST /webhook/razorpay (signature verified)
│   ├── services/
│   │   ├── razorpay.ts        # Razorpay SDK wrapper
│   │   └── paymentStore.ts    # DB helpers + failure classifier
│   └── lib/
│       └── prismaClient.ts    # Singleton Prisma client
├── public/
│   ├── index.html             # Storefront
│   ├── product.html           # Product detail + Razorpay Checkout.js
│   ├── success.html           # Post-payment confirmation
│   ├── admin.html             # Recovery agent dashboard
│   └── style.css
└── .env.example
```

---

## Seeded Failure Data

The seed creates **5 pre-failed payments** covering the full recovery taxonomy. These are immediately available for the recovery agent:

| # | Category | Customer | Product | Amount | Recovery Posture |
|---|---|---|---|---|---|
| 1 | `insufficient_funds` | Arjun Sharma | Portable SSD | ₹5,999 | Delayed retry + suggest alt. method |
| 2 | `wrong_pin` | Priya Patel | Gaming Keyboard | ₹3,499 | Immediate retry prompt |
| 3 | `abandoned` | Ravi Kumar | Smart Watch Pro | ₹12,999 | Cart-abandonment nudge |
| 4 | `do_not_honor` | Sneha Iyer | Headphones | ₹7,999 | Short-delay retry → alt. method |
| 5 | `psp_timeout` | Vikram Nair | USB-C Hub | ₹1,499 | Reconcile first, then auto-retry |

---

## Webhook Setup (for live testing)

Razorpay can't reach `localhost` directly. Two options:

### Option A: ngrok (recommended for real-time testing)

```bash
# Install ngrok: https://ngrok.com/download
ngrok http 3000
# Copy the https://xxxx.ngrok.io URL
```

Then in [Razorpay Dashboard → Webhooks](https://dashboard.razorpay.com/app/webhooks):
- URL: `https://xxxx.ngrok.io/webhook/razorpay`
- Events: `payment.failed`, `payment.authorized`, `payment.captured`, `order.paid`
- Secret: copy into `WEBHOOK_SECRET` in your `.env`

### Option B: Use seeded data (no webhook needed)

The seed script pre-populates all failure events directly into the DB. The recovery agent can work against these immediately — no live webhook required.

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/products` | List all products |
| `GET` | `/api/products/:id` | Get a single product |
| `GET` | `/api/customers` | List all customers |
| `GET` | `/api/orders` | List all orders with payments + failure events |
| `GET` | `/api/failure-events` | List all failure events with recovery actions |
| `POST` | `/api/checkout` | Create a Razorpay Order → returns `order_id` + `key_id` |
| `POST` | `/api/payment/verify` | Verify Razorpay payment signature post-checkout |
| `GET` | `/api/payment/:id/status` | Fetch live payment status from Razorpay (reconciliation) |
| `POST` | `/webhook/razorpay` | Razorpay webhook receiver (signature-verified) |

---

## Database Commands

```bash
npm run db:migrate    # Run migrations
npm run db:seed       # Seed demo data
npm run db:studio     # Open Prisma Studio (visual DB browser)
npm run db:reset      # Reset DB and re-seed (destructive)
```

---

## Test Payment Credentials (Razorpay Test Mode)

Use these in the Razorpay Checkout modal:

| Method | Details |
|---|---|
| **Card (success)** | `4111 1111 1111 1111` · any future expiry · any CVV |
| **Card (failure)** | `4000 0000 0000 0002` |
| **UPI (success)** | `success@razorpay` |
| **UPI (failure)** | `failure@razorpay` |

Full test credentials: https://razorpay.com/docs/payments/payments/test-card-upi-details/
