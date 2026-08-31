# AI Revenue Recovery Agent — System Design

**Track:** 03 — AI Revenue Recovery (Razorpay AI Buildathon 2026)
**Goal:** Detect revenue at risk, diagnose the root cause, and execute a bounded, auditable recovery workflow — across payment failures, checkout abandonment, failed subscriptions, and overdue receivables.

---

## 1. Problem framing

Revenue loss on a payments platform rarely happens as one clean event. It's a chain:

```
payment degrades → checkout abandoned → subscription fails → invoice overdue
```

Most UPI failures in India are *business declines* (insufficient balance, wrong PIN, timeouts, cancellations) rather than technical failures — meaning most of what looks like "lost revenue" is actually recoverable if you intervene with the right action, at the right time, through the right channel.

The system's job: **detect → classify → decide → act → log**, with hard guardrails so it never over-retries, harasses a customer, or double-charges anyone.

---

## 2. Failure taxonomy

This taxonomy drives the classification step. Each category maps to a different recovery posture.

### 2.1 Customer-side failures
| Failure | Cause | Recovery posture |
|---|---|---|
| Insufficient balance | Not enough funds at debit time | Delayed retry (payday-aware), suggest alt. method |
| Wrong UPI PIN | Mistyped PIN | Immediate retry prompt |
| Transaction timeout | Didn't approve in time | Fresh payment link + reminder |
| Manual cancel / drop-off | Abandoned checkout | Cart-abandonment nudge |
| Daily UPI limit exceeded | NPCI per-day cap hit | Suggest alt. payment mode |
| Invalid/unlinked VPA | Wrong or unlinked UPI ID | Prompt to re-enter |

### 2.2 Bank (issuer) failures
| Failure | Cause | Recovery posture |
|---|---|---|
| "Do Not Honor" | Generic issuer risk decline | Short-delay retry, then alt. method |
| Issuer/NPCI link down | Bank-side outage | Transient — auto-retry on schedule |
| Risk/fraud block | Issuer's fraud engine | **Do not retry** — flag only |

### 2.3 Technical / network failures
| Failure | Cause | Recovery posture |
|---|---|---|
| PSP–NPCI–bank timeout | Multi-hop timeout | Safe to auto-retry |
| App crash / connectivity drop | Client-side interruption | Reconcile via status check before retry |
| **Payment status unknown** | Debited but confirmation lost | **Status-check API first — never blindly re-collect** |
| Duplicate transaction | False-positive duplicate | Suppress, no action |

### 2.4 Mandate / UPI Autopay failures (for the later recurring-payment feature)
| Failure | Cause | Recovery posture |
|---|---|---|
| Insufficient balance on debit date | Mandate fires, account short | Smart-timed retry (near salary date) |
| Mandate revoked | Customer cancelled standing instruction | Route to re-registration, don't retry |
| Mandate expired | Validity lapsed | Prompt renewal |
| E-mandate setup failed | One-time registration incomplete | Resume setup flow |

### 2.5 Merchant / gateway-side issues
| Failure | Cause | Recovery posture |
|---|---|---|
| PG timeout to acquiring bank | Slow PG response | Silent retry, no customer messaging |
| Amount/currency mismatch | Merchant order config issue | Merchant-side alert, not customer-facing |

---

## 3. High-level architecture

```
Customer checkout (mock e-commerce app)
        │
        ▼
Payment layer (Razorpay Orders API + Checkout)
        │
        ▼
      Razorpay ──success──▶ Order paid (done)
        │
     failure
        ▼
  Webhook receiver (verifies signature, logs raw event, ACKs fast)
        │
        ▼
  Recovery agent (classify → decide → act → log)
        │
   ┌────┴────┐
   ▼         ▼
Notify    Retry payment
customer   (loops back through the payment layer)
```

**Key design rule:** the payment layer is the *only* component that talks to Razorpay directly. Everything downstream reacts to webhook events and the local database — except when the recovery agent needs to re-verify a payment's true status before acting (critical for the "payment status unknown" case, to avoid double-charging).

---

## 4. Execution model: local tools, remote LLM decision

This is the core architectural decision, modeled on how agentic IDEs (e.g., Claude Code) work: the LLM is a remote reasoning service; the tools, credentials, and data stay local.

### 4.1 Trust boundary

```
┌─ Mock merchant app (trust boundary) ─────────────┐
│                                                   │
│   Orchestrator (MCP client + toolbox + guardrails)│
│        │        │         │                       │
│        ▼        ▼         ▼                       │
│    [Retry]   [Notify]  [Query DB]                  │
│                                                   │
└──────────────────┬────────────────────────────────┘
                    │  failure metadata only (out)
                    ▼
                  Claude
              (decides the action)
                    │  action + params (back)
                    ▲
                    └──────────────────┘
```

The **mock merchant app is where the MCP client and the entire tool box live** — it's the same component described in Section 3 as the merchant-side app (customer checkout, payment layer, webhook receiver all live in this same app; the orchestrator is just the next stage in that same codebase). There is no separate "merchant backend" — the mock e-commerce app *is* the merchant-side host.

- **Inside the boundary:** Razorpay API keys, customer PII, the MCP client, and all tool implementations (retry, notify, query DB, log). Nothing here ever leaves the merchant's own infrastructure.
- **Outside the boundary:** Claude, called via the tool-use API. It receives only classified, non-identifying metadata — e.g. `failure_category`, `amount_bucket`, `attempt_count`, `days_since_failure`, `customer_tier`. No names, phone numbers, or emails ever cross the boundary.
- **The guardrail layer is deterministic code, not the LLM.** Claude *proposes* a tool call; the orchestrator validates it against hard rules (e.g. `attempt_count <= 3`, amount must match the original failed payment) before executing. This is what makes the system "bounded and gated" rather than just trusting model output.

### 4.2 Why this design, specifically

- **Reusability / scale story:** a second merchant only needs to stand up the same local tool set (retry, notify, query DB) and wire up the orchestrator inside their own app — the decision-making logic doesn't need to be rebuilt per merchant.
- **Privacy by construction:** since only classified metadata crosses the boundary, "the LLM never sees PII" is a concrete, demonstrable claim — not a slide bullet.
- **Explainability:** every Claude decision is a structured tool call with named parameters, which is trivially loggable — this *is* the audit trail the track's bar requires.

### 4.3 Central MCP server — cross-merchant audit log

Alongside the per-merchant orchestrator, the system includes one small **central MCP server** that every merchant's orchestrator writes to after executing a locally-approved action. This is *not* where execution happens and *not* where PII lives — it exists purely so that failure and recovery data can be aggregated and audited across merchants without exposing any one merchant's customer data to another.

```
Mock merchant app A ──┐
  (writes redacted     │
   log entries,        ▼
   tagged merchant_id)  Central MCP server
                         (failure_events + recovery_actions,
Mock merchant app B ──▶  scoped by merchant_id)
  (writes redacted
   log entries,
   tagged merchant_id)
```

- The orchestrator calls a `log_recovery_outcome(merchant_id, failure_category, action_type, outcome, amount_bucket, attempt_number)` tool on the central server after every completed action.
- Every row is tagged with `merchant_id` so one merchant's records are never visible when querying another's — this is the multi-tenancy boundary on the server side, mirroring the PII boundary on the client side.
- What crosses to the central server is the same redacted, non-identifying shape of data Claude sees in Section 4.1 — no names, phone numbers, or emails, ever.
- This central log is what lets you demonstrate the "measured recovery across a batch" requirement at a platform level, not just per-merchant, and gives judges a single place to see the audit trail regardless of which merchant generated it.

---

## 5. MCP tool schemas

Tools exposed to Claude via the tool-use API. Claude selects one per failure event (never more than one action per event, enforced by the orchestrator).

```json
{
  "name": "retry_payment",
  "description": "Retries a failed payment through the original payment method",
  "input_schema": {
    "type": "object",
    "properties": {
      "payment_id": { "type": "string" },
      "delay_minutes": { "type": "integer" }
    },
    "required": ["payment_id"]
  }
}
```

```json
{
  "name": "send_notification",
  "description": "Sends a recovery nudge to the customer via a specified channel",
  "input_schema": {
    "type": "object",
    "properties": {
      "customer_id": { "type": "string" },
      "channel": { "type": "string", "enum": ["sms", "email", "whatsapp"] },
      "template": { "type": "string" }
    },
    "required": ["customer_id", "channel", "template"]
  }
}
```

```json
{
  "name": "escalate_to_human",
  "description": "Flags the failure for manual review instead of automated recovery",
  "input_schema": {
    "type": "object",
    "properties": {
      "payment_id": { "type": "string" },
      "reason": { "type": "string" }
    },
    "required": ["payment_id", "reason"]
  }
}
```

```json
{
  "name": "do_nothing",
  "description": "Explicitly records that no recovery action should be taken for this failure",
  "input_schema": {
    "type": "object",
    "properties": {
      "payment_id": { "type": "string" },
      "reason": { "type": "string" }
    },
    "required": ["payment_id", "reason"]
  }
}
```

Including an explicit `do_nothing` tool matters: it forces Claude to actively choose not to recover a case (e.g. a fraud block) rather than the system inferring that from silence — which also gives a cleaner audit trail.

---

## 6. Data model

The data model is split across the two sides of the trust boundary from Section 4: full detail lives with the merchant, and only a redacted, merchant-tagged copy lives centrally.

### 6.1 Merchant-side database (inside the mock merchant app)

This is the merchant's own database — the full-detail, PII-holding source of truth. It never leaves the mock merchant app.

| Table | Key fields |
|---|---|
| `customers` | id, name, phone, email, notification_preferences |
| `orders` | id, customer_id, amount, status, razorpay_order_id |
| `payments` | id, order_id, razorpay_payment_id, status, error_code, error_reason, error_source, timestamps |
| `failure_events` | payment_id, classified_category, detected_at, root_cause |
| `recovery_actions` | failure_event_id, action_type, channel, executed_at, outcome, attempt_number |

`recovery_actions.attempt_number` is what powers the stopping-rule logic (e.g. "max 3 nudges, then escalate"). `failure_events` and `recovery_actions` here can reference real `payment_id`/`customer_id` values freely, since this database stays entirely inside the merchant's own trust boundary.

### 6.2 Central MCP server database (cross-merchant audit log)

A separate, much thinner store on the central MCP server described in Section 4.3. Every row is scoped by `merchant_id` so records from different merchants are never comingled or cross-visible, and no field here identifies an individual customer.

| Table | Key fields |
|---|---|
| `failure_events` | id, merchant_id, classified_category, amount_bucket, detected_at |
| `recovery_actions` | id, merchant_id, failure_event_id, action_type, outcome, attempt_number, executed_at |

Note these are deliberately same-named-but-distinct tables from Section 6.1 — same shape in spirit, but the central versions hold aggregable, redacted rows keyed by `merchant_id` instead of merchant-internal `payment_id`/`customer_id` references. Keep the two schemas namespaced separately in code (e.g. separate services/databases entirely) so it's never possible to accidentally query one store as if it were the other.

---

## 7. Razorpay integrations required

| Integration | Purpose |
|---|---|
| **Payments Webhooks** (`payment.failed`, `payment.authorized`, `payment.captured`) | Primary failure signal; payload includes `error_code`, `error_description`, `error_source`, `error_step`, `error_reason` — direct input to the classifier |
| **Orders API** | Detect abandoned checkouts (orders stuck in `created`/`attempted` past a time threshold) |
| **Payment Fetch API** | Reconciliation check before any recovery action — confirms a payment truly failed (guards against late authorization / "status unknown" cases) |
| **Subscriptions / UPI Autopay Webhooks** (`subscription.pending`, `subscription.halted`, `subscription.charged`, mandate lifecycle events) | Mandate-retry direction; Razorpay already auto-retries subscription charges twice same-day before halting — the agent takes over *after* that |
| **Webhook signature verification** | Non-negotiable; prevents spoofed failure events from triggering recovery actions |
| **S2S UPI Autopay integration** (future) | Token-based recurring charge execution for the later "agent pays via UPI" feature |

---

## 8. Mapping to "the bar"

The track requires: *"Don't just identify the problem. Show measured money recovered across a batch, with compliant escalation, stopping rules, and an audit trail."*

| Requirement | How this design satisfies it |
|---|---|
| Measured money recovered | `recovery_actions.outcome` + `payments.status` let you compute ₹ recovered / ₹ at risk across a test batch |
| Compliant escalation | `escalate_to_human` tool + guardrail rules (never auto-retry fraud blocks or revoked mandates) |
| Stopping rules | `attempt_number` cap enforced in the orchestrator, independent of what Claude proposes |
| Audit trail | Every classification + every tool call + every outcome logged, end to end |
| Graceful failure handling | Reconciliation check (Payment Fetch API) before any retry-driven recovery, to avoid double-charging on "status unknown" cases |

---

## 9. Prototype scope vs. roadmap

**In scope for the buildathon prototype:**
- One mock e-commerce merchant app (customers, orders, payments)
- Payment layer using Razorpay test-mode Orders + Checkout
- Webhook receiver + failure event store
- Orchestrator + 3–5 local tools + Claude-based decision step
- A batch of simulated failed transactions (via Razorpay test-mode) to demonstrate measured recovery
- 4–5 failure types covering: safe-to-auto-retry, needs-customer-nudge, and should-not-retry cases (to demonstrate judgment, not just automation)

**Explicitly deferred (mentioned in the pitch as roadmap, not built):**
- Second real merchant integration (architecture supports it; not required to prove it)
- Agent-initiated UPI payments via S2S Autopay tokens (the "agent pays on the merchant's behalf" feature)
- Full multi-tenant auth/onboarding flow for the MCP tool layer

---

## 10. Open decisions / things to firm up next

- [ ] Final list of failure types to implement for the demo (recommend 4–5, spanning all three postures above)
      failure types list : I think we should make a list of 5 failure types which have unique recovery methods (bcz many have same like retries,etc)

- [ ] Guardrail rule set — exact thresholds for attempt caps, amount-match checks
      To be decided

- [ ] Notification channel(s) to actually wire up for the demo (SMS/email mock vs. real)
      SMS/email mock will work for prototype
      
- [ ] Whether `decide_recovery_action` logic for the fuzzier cases (e.g. reading a "promise to pay" reply) uses an LLM call or stays rule-based for v1
      To be decided