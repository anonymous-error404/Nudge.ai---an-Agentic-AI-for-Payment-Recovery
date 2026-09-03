import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const redis = new IORedis(REDIS_URL);

async function clean() {
  console.log("Flushing Redis DB...");
  await redis.flushall();
  console.log("✅ Cleared all BullMQ queues and jobs from Redis.");
  process.exit(0);
}

clean().catch(console.error);
