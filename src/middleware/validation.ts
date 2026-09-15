import { Request, Response, NextFunction, RequestHandler } from "express";
import { ZodSchema, ZodError } from "zod";

/**
 * Validates req.body using the provided Zod schema.
 * Replaces req.body with the parsed (and sanitized/transformed) data.
 */
export const validateBody = (schema: ZodSchema): RequestHandler => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync(req.body);
      req.body = parsed;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(error);
      } else {
        next(error);
      }
    }
  };
};

/**
 * Validates req.query using the provided Zod schema.
 */
export const validateQuery = (schema: ZodSchema): RequestHandler => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync(req.query);
      req.query = parsed as any;
      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Validates req.params using the provided Zod schema.
 */
export const validateParams = (schema: ZodSchema): RequestHandler => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync(req.params);
      req.params = parsed as any;
      next();
    } catch (error) {
      next(error);
    }
  };
};
