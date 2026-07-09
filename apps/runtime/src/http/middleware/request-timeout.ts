import type { Request, Response, NextFunction, RequestHandler } from "express";

export function requestTimeoutMiddleware(timeoutMs: number): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    void req;
    const timer = setTimeout(() => {
      if (!res.writableEnded) res.destroy();
    }, timeoutMs);
    res.on("close", () => clearTimeout(timer));
    res.on("finish", () => clearTimeout(timer));
    next();
  };
}
