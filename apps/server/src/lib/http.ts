import type { FastifyReply, FastifyRequest } from "fastify";
import type { Permission, Role } from "@mfc/core";
import { can } from "@mfc/core";
import { z } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export const notFound = (what = "Not found") => new HttpError(404, what, "not_found");
export const forbidden = (what = "You do not have permission to do that") => new HttpError(403, what, "forbidden");
export const badRequest = (what: string) => new HttpError(400, what, "bad_request");

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    throw badRequest(msg);
  }
  return r.data;
}

export interface AuthedUser {
  id: string;
  email: string;
  name: string | null;
  locale: string | null;
  prefs: Record<string, unknown>;
}

export interface WorkspaceAccess {
  workspaceId: string;
  role: Role;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthedUser;
    access?: WorkspaceAccess;
  }
}

export function requireUser(req: FastifyRequest): AuthedUser {
  if (!req.user) throw new HttpError(401, "Sign in required", "unauthenticated");
  return req.user;
}

export function requirePerm(req: FastifyRequest, perm: Permission): WorkspaceAccess {
  const a = req.access;
  if (!a) throw forbidden("Workspace access required");
  if (!can(a.role, perm)) throw forbidden();
  return a;
}

export function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message, code: err.code });
  throw err;
}
