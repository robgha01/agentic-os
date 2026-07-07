/**
 * Local-only guards for the gateway's HTTP/WS control plane. The gateway is a
 * single-user localhost tool, but a hostile web page (CSRF / DNS-rebinding) can
 * still reach 127.0.0.1 from the user's browser — so we only trust requests
 * that provably come from a local origin.
 */

const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/** Browser origin is local, or absent entirely (CLI clients, same-origin GETs). */
export function isLocalOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  return LOCAL_ORIGIN_RE.test(origin);
}

/** Host header names this machine — the DNS-rebinding defense. */
export function isLocalHostHeader(host: string | undefined): boolean {
  if (!host) return false;
  const bare = host.replace(/:\d+$/, "").toLowerCase();
  return bare === "localhost" || bare === "127.0.0.1" || bare === "[::1]";
}
