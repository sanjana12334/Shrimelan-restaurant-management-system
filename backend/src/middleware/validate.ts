import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";

/** Validates and REPLACES req.body with the parsed, typed result — nothing
 *  unvalidated ever reaches a controller. */
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: "Invalid request", details: result.error.flatten() });
    }
    req.body = result.data;
    next();
  };
}
