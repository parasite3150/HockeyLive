// Tiny client for the Upstash Redis REST API (added to Vercel as a Storage integration).
// Vercel sets either KV_REST_API_URL/TOKEN or UPSTASH_REDIS_REST_URL/TOKEN.

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const storeReady = Boolean(URL_ && TOKEN);

/** Run one Redis command, e.g. redis("SET", "key", "value"). */
export async function redis(...command) {
  if (!storeReady) throw new Error("Storage isn't set up.");
  const res = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

export const getJSON = async (key) => {
  const raw = await redis("GET", key);
  return raw ? JSON.parse(raw) : null;
};
export const setJSON = (key, value, seconds) =>
  seconds ? redis("SET", key, JSON.stringify(value), "EX", String(seconds)) : redis("SET", key, JSON.stringify(value));
