import { createServer, type Server } from "http";
import type { Express } from "express";
import { getOrCreateAuthToken } from "./auth-token.js";
import { getRuntimeLogger } from "../core/logger.js";
import { HTTP_AUTH_TOKEN_READY } from "../core/runtime-log-events.js";

export function createHttpServer(_projectRoot: string, app: Express): Server {
  getOrCreateAuthToken();
  getRuntimeLogger().info(HTTP_AUTH_TOKEN_READY);
  return createServer(app);
}
