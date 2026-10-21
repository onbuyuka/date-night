import planner from "./index";

type ApiEnv = Parameters<typeof planner.fetch>[1];
interface ProductionEnv extends ApiEnv {
  ASSETS: Fetcher;
}
const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000",
};

export default {
  async fetch(request: Request, env: ProductionEnv): Promise<Response> {
    const url = new URL(request.url);
    const response = url.pathname === "/api" || url.pathname.startsWith("/api/")
      ? await planner.fetch(request, { ...env, LOCAL_DEV: "false", LOCAL_WEB_FETCH_ORIGIN: undefined, LOCAL_LOOKUP_ORIGIN: undefined })
      : await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
