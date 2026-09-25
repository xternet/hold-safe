export async function staticAsset(request: Request): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  if (url.search !== "") return null;
  const file = url.pathname === "/" || url.pathname === "/index.html" ? "index.html" :
    /^\/assets\/[A-Za-z0-9_-]+\.(js|css)$/.test(url.pathname) ? url.pathname.slice(1) : null;
  if (file === null) return null;
  const asset = Bun.file(new URL(`../../../../dist/${file}`, import.meta.url));
  if (!await asset.exists()) return new Response("Application build unavailable", { status: 503, headers: { "cache-control": "no-store" } });
  return new Response(request.method === "HEAD" ? null : asset, { headers: {
    "content-type": file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8",
    "cache-control": file === "index.html" ? "no-store" : "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  } });
}
