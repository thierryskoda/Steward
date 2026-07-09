/**
 * Canonical endpoint registry. Single source of truth for path and HTTP method per route.
 * Project runtime routes and menubar client must import from here.
 */

/** Lowercase for Express router; use toUpperCase() for fetch. */
export type IHttpMethod = "get" | "post" | "patch";

export type IRouteSpec = { path: string; method: IHttpMethod };

const ROUTE_SPECS = {
  HEALTH: { path: "/health", method: "get" as const },
  RUNTIME_STATUS: { path: "/v1/runtime/status", method: "get" as const },
  RUNTIME_SHUTDOWN: { path: "/v1/runtime/shutdown", method: "post" as const },
  INBOX_FINDINGS: { path: "/v1/inbox/findings", method: "get" as const },
  INBOX_RULES: { path: "/v1/inbox/rules", method: "get" as const },
  FINDINGS_APPROVE: { path: "/v1/findings/:id/approve", method: "post" as const },
  FINDINGS_REJECT: { path: "/v1/findings/:id/reject", method: "post" as const },
  FINDINGS_UNDO: { path: "/v1/findings/:id/undo", method: "post" as const },
  RULES_SNAPSHOT: { path: "/v1/rules/snapshot", method: "get" as const },
  ITEMS: { path: "/v1/items", method: "get" as const },
  RULES_APPROVE: { path: "/v1/rules/:id/approve", method: "post" as const },
  RULES_REJECT: { path: "/v1/rules/:id/reject", method: "post" as const },
  CONFIG_GET: { path: "/v1/config", method: "get" as const },
  CONFIG_UPDATE: { path: "/v1/config", method: "patch" as const },
  CONFIG_INITIALIZE: { path: "/v1/config/initialize", method: "post" as const },
  SCANNING_STATUS: { path: "/v1/scanning/status", method: "get" as const },
  SCANNING_RESUME: { path: "/v1/scanning/resume", method: "post" as const },
  SCANNING_PAUSE: { path: "/v1/scanning/pause", method: "post" as const },
} satisfies Record<string, IRouteSpec>;

export const ROUTES = ROUTE_SPECS;

/** Keys excluded from startup "every route mounted" assertion (e.g. POST shutdown, not-yet-implemented). */
export const ROUTES_KEYS_SKIP_STARTUP_ASSERTION: (keyof typeof ROUTES)[] = ["RUNTIME_SHUTDOWN"];

export type IRoutePath = (typeof ROUTES)[keyof typeof ROUTES]["path"];

function replaceParams(template: string, params: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(`:${key}`, value);
  }
  return result;
}

export function buildRoute(template: IRoutePath, params: { id: string }): string {
  return replaceParams(template, params);
}
