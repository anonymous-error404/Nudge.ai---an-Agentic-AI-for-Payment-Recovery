# 🤖 AI Payment Recovery Agent (Razorpay)

An intelligent, multi-agent system designed to automatically recover failed payments. Instead of relying on static retry logic, this system leverages Large Language Models (Claude 3.5) to dynamically analyze failure contexts, query merchant data, write personalized notifications, and execute the optimal recovery strategy—while strictly adhering to safety guardrails.

---

## 🏗 System Architecture

The architecture is explicitly decoupled into two main components to maintain a strict trust boundary:
1. **The Merchant App**: Where the sensitive PII (Customer Data, Razorpay API keys) lives.
2. **The MCP Server**: The centralized AI intelligence hub that coordinates Claude agents but never directly accesses merchant databases or PII.

### Interaction Flow Diagram

`mermaid
sequenceDiagram
    participant U as User / Razorpay
    participant M as Merchant App (Port 3000)
    participant S as MCP Server (Port 3001)
    participant R as Redis (BullMQ)
    participant C as Claude (Anthropic API)

    U->>M: Payment Fails
    Note over M: Orchestrator applies guardrails<br/>(e.g., Fraud = Do Nothing)
    M->>S: POST /api/recovery-jobs (Anonymized Context)
    S->>R: Enqueue Recovery Job
    R-->>S: Worker Picks Up Job
    S->>C: 🧠 Agent 1: Analyze & Decide
    C-->>S: 🔧 Tool Use: query_failure_context
    
    %% Async Tool Relay Loop
    S->>M: POST /mcp/tool-call (Relay to Merchant)
    Note over S,R: Worker polls Redis for tool result...
    M->>M: Execute Tool Locally (DB Query)
    M->>S: POST /api/tool-results (Enriched Context)
    S->>R: Save result to Redis (Unblocks Worker)
    R-->>S: Feed result back to Claude
    
    S->>C: Provide Context Result
    C-->>S: 🔧 Tool Use: send_notification
    S->>C: ✍️ Agent 3: Write Notification Copy
    C-->>S: "Subject: Complete your purchase..."
    S->>M: POST /mcp/tool-call (deliver_notification)
    M->>U: Send Email / SMS
    M->>S: POST /api/tool-results
    
    C-->>S: End Turn
    S->>M: POST /mcp/job-complete
    M->>M: Update local Audit DB
`

---

## 🧩 Core Components

### 1. Merchant Application (/merchant-app)
A simulated e-commerce backend built with a strict Route -> Controller -> Service -> Repository architecture.
* **Failure Simulator**: An endpoint to artificially trigger edge-case Razorpay payment failures (Insufficient Funds, PSP Timeout, Wrong PIN, Fraud Block).
* **Recovery Orchestrator**: Applies initial deterministic guardrails. Decides if a failure should be instantly retried, hard-blocked (fraud), or escalated to the AI (delayed recovery).
* **MCP Client**: Strips PII from the context and submits jobs to the MCP Server. 
* **Tool Registry**: Houses the actual execution code for tools that Claude can request.
* **Callback Endpoints**: Receives POST /mcp/tool-call and POST /mcp/job-complete from the MCP Server to execute local actions.

### 2. MCP Server (/mcp-server)
The intelligence layer. It maintains its own anonymized audit log and job queue.
* **BullMQ Queue**: Handles asynchronous AI processing to ensure the Anthropic API is never overwhelmed and failed jobs can be safely retried.
* **Tool Relay Mechanism**: Since the MCP server lacks DB access, when Claude requests a tool, the MCP Server relays the request to the Merchant App, parks the worker via a Redis polling loop, and resumes once the Merchant App POSTs the result back.
* **Audit Database (Prisma)**: Tracks FailureEvents and RecoveryActions cross-merchant.

---

## 🧠 The Multi-Agent Setup

The system uses specialized agents to break down the problem efficiently:

1. **Agent 1: Recovery Decision Agent (Claude 3.5 Sonnet)**
   * **Role**: The orchestrator. Analyzes the failure context (attempt count, amount bucket, failure reason).
   * **Abilities**: Chooses between tools like etry_payment, send_notification, scalate_to_human, or do_nothing.
   * **Logic**: Can optionally call query_failure_context to fetch historical customer payment behavior before making a final decision.

2. **Agent 3: Notification Writer Agent (Claude 3.5 Haiku)**
   * **Role**: The copywriter. Triggered automatically if Agent 1 decides to send_notification.
   * **Abilities**: Drafts channel-appropriate copy (SMS under 160 chars, friendly Emails, or WhatsApp messages) based on the exact failure reason.

*(Note: Agent 2 is a planned background cron agent that will review batch data to discover cross-merchant failure patterns).*

---

## 🛠 Available Tools (The Tool Registry)

These tools are dynamically exposed to Claude via JSON schemas, but executed securely in the Merchant App:
* query_failure_context: Fetches enriched order history, previous recovery attempts, and customer success rates (No PII).
* etry_payment: Generates a fresh Razorpay checkout link for the customer.
* send_notification: Determines the channel and template for a nudge.
* scalate_to_human: Flags ambiguous or high-risk payments for manual review.
* do_nothing: Explicitly records that automated intervention was blocked (e.g., mandate revoked).

---

## 💻 Tech Stack

| Category | Technology | Purpose |
| :--- | :--- | :--- |
| **Language** | TypeScript / Node.js | Strong typing across the boundaries. |
| **Web Framework** | Express.js | API routing for both servers. |
| **Database ORM** | Prisma | Schema management & queries. |
| **Databases** | SQLite | Dual isolated DBs (dev.db & mcp.db). |
| **Job Queue** | BullMQ + Redis | Robust, concurrent background processing. |
| **AI Provider** | Anthropic SDK | Claude 3.5 Sonnet (Logic) & Haiku (Copy). |
| **Validation** | Zod | Runtime schema validation for APIs. |

---

## 🚀 Getting Started

### Prerequisites
* Node.js (v18+)
* Redis running locally (default port 6379)
* An Anthropic API Key

### Installation

1. **Clone & Install Dependencies**
   `ash
   cd merchant-app && npm install
   cd ../mcp-server && npm install
   `

2. **Database Setup**
   `ash
   # Initialize Merchant App DB
   cd merchant-app
   npx prisma migrate dev --name init

   # Initialize MCP Server DB
   cd ../mcp-server
   npx prisma migrate dev --name init
   `

3. **Environment Variables**
   * Copy .env.example to .env in **both** directories.
   * Add your ANTHROPIC_API_KEY to the mcp-server/.env file.

### Running the Servers

You need to run both servers concurrently in separate terminal windows:

**Terminal 1 (Merchant App - Port 3000):**
`ash
cd merchant-app
npm run dev
`

**Terminal 2 (MCP Server - Port 3001):**
`ash
cd mcp-server
npm run dev
`

### Testing the Pipeline
Once both servers are running, you can hit the Merchant App's failure simulator endpoints to trigger dummy failures and watch the MCP Server queue pick them up, evaluate them, and issue tool callbacks!
