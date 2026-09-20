const UPSTREAM = (process.env.UPSTREAM_API_BASE || "https://clonr.co/api").replace(/\/$/, "");
const TERMINAL = new Set(["completed", "partial", "failed", "expired"]);
const MAX_WAIT_MS = Math.min(Number(process.env.MAX_WAIT_MS || 20000), 25000);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function safeUrl(value) {
  try { const u = new URL(value); return /^https?:$/.test(u.protocol) && /(^|\.)mega\.nz$/i.test(u.hostname) ? u.toString() : null; } catch { return null; }
}
function auth(request) {
  const expected = process.env.API_KEY;
  return !expected || request.headers.get("x-api-key") === expected || request.headers.get("authorization") === `Bearer ${expected}`;
}
async function upstream(path, init = {}) {
  const r = await fetch(`${UPSTREAM}${path}`, { ...init, headers: { accept: "application/json", ...(init.headers || {}) } });
  const text = await r.text(); let body; try { body = text ? JSON.parse(text) : null; } catch { body = { error: text }; }
  if (!r.ok) throw Object.assign(new Error(body?.error || `Upstream HTTP ${r.status}`), { status: r.status, body });
  return body;
}
function metadata(x, fallbackId) {
  const files = Array.isArray(x?.files) ? x.files : [];
  return {
    job_id: x?.id || fallbackId,
    state: x?.state || x?.cache_state || "unknown",
    name: x?.name || null,
    total_files: x?.total_files ?? files.length,
    total_size: x?.total_size ?? null,
    completed_files: x?.completed_files ?? null,
    failed_files: x?.failed_files ?? null,
    zip_url: x?.zip_url || null,
    files: files.map(f => ({
      name: f.name || null,
      size: f.size ?? null,
      state: f.state || null,
      poster: f.poster || null,
      download_url: f.url || null,
      width: f.width ?? null,
      height: f.height ?? null,
      duration_s: f.duration_s ?? null
    }))
  };
}
function idFrom(body) { return body?.id || body?.job_id; }

export async function GET(request) {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (!auth(request)) return json({ error: "unauthorized" }, 401);
  const input = new URL(request.url, "https://vercel.local").searchParams.get("url");
  const megaUrl = safeUrl(input);
  if (!megaUrl) return json({ error: "invalid_url", message: "Provide a valid mega.nz file or folder URL. Encode # as %23 in the query string." }, 400);
  try {
    const add = await upstream("/clone/add", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: megaUrl, turnstile_token: process.env.TURNSTILE_TOKEN || "" }) });
    const id = idFrom(add); if (!id) return json({ error: "upstream_invalid_response" }, 502);
    const cached = add.already_cached === true || add.cache_state === "completed";
    if (!cached) await upstream(`/clone/${encodeURIComponent(id)}/start`, { method: "POST" });
    let status = await upstream(`/clone/${encodeURIComponent(id)}`);
    const deadline = Date.now() + MAX_WAIT_MS;
    while (!TERMINAL.has(status?.state) && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1000));
      const states = await upstream("/clone/states", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [id] }) });
      const brief = states?.states?.[id];
      if (brief?.state) status = { ...status, ...brief };
      if (TERMINAL.has(status?.state)) break;
      status = await upstream(`/clone/${encodeURIComponent(id)}`);
    }
    const result = metadata(status, id);
    return json(result, TERMINAL.has(result.state) ? 200 : 202);
  } catch (e) { return json({ error: "upstream_error", message: e.message }, e.status && e.status < 500 ? e.status : 502); }
}

export const config = { runtime: "nodejs", maxDuration: 30 };
