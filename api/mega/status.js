const UPSTREAM = (process.env.UPSTREAM_API_BASE || "https://clonr.co/api").replace(/\/$/, "");
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }
function auth(request) { const key = process.env.API_KEY; return !key || request.headers.get("x-api-key") === key || request.headers.get("authorization") === `Bearer ${key}`; }
function metadata(x, id) { return { job_id: x?.id || id, state: x?.state || x?.cache_state || "unknown", name: x?.name || null, total_files: x?.total_files ?? null, total_size: x?.total_size ?? null, completed_files: x?.completed_files ?? null, failed_files: x?.failed_files ?? null, zip_url: x?.zip_url || null, files: (x?.files || []).map(f => ({ name: f.name || null, size: f.size ?? null, state: f.state || null, poster: f.poster || null, download_url: f.url || null, width: f.width ?? null, height: f.height ?? null, duration_s: f.duration_s ?? null })) }; }
export async function GET(request) {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (!auth(request)) return json({ error: "unauthorized" }, 401);
  const id = new URL(request.url, "https://vercel.local").searchParams.get("id"); if (!id) return json({ error: "missing_id" }, 400);
  try { const r = await fetch(`${UPSTREAM}/clone/${encodeURIComponent(id)}`, { headers: { accept: "application/json" } }); const b = await r.json(); if (!r.ok) return json({ error: "upstream_error", message: b?.error || `HTTP ${r.status}` }, 502); const out = metadata(b, id); return json(out, ["completed", "partial", "failed", "expired"].includes(out.state) ? 200 : 202); }
  catch (e) { return json({ error: "upstream_error", message: e.message }, 502); }
}
export const config = { runtime: "nodejs", maxDuration: 10 };
