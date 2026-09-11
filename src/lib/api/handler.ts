import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { z } from "zod";
import { apiError, type ApiErrorCode } from "@/lib/api/response";
import { clientEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type HandlerContext<TBody, TParams> = {
  request: NextRequest;
  user: User;
  supabase: SupabaseClient;
  body: TBody;
  params: TParams;
  requestId: string;
};

export type HandlerOptions<TBody, TParams> = {
  params?: z.ZodType<TParams>;
  body?: z.ZodType<TBody>;
  notFoundMessage?: string;
  unauthenticatedMessage?: string;
  validationMessage?: string;
};

type RouteContext = { params: Promise<Record<string, string>> };

function withRequestId(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function withApiHandler<TBody = undefined, TParams = Record<string, never>>(
  options: HandlerOptions<TBody, TParams>,
  handler: (ctx: HandlerContext<TBody, TParams>) => Promise<Response>,
) {
  return async (request: NextRequest, context: RouteContext): Promise<Response> => {
    const requestId = request.headers.get("x-request-id") ?? randomUUID();
    const respond = (response: Response) => withRequestId(response, requestId);
    try {
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(clientEnv.NEXT_PUBLIC_SITE_URL).origin) {
        return respond(apiError(403, "FORBIDDEN", "This resource was not found."));
      }

      let params = {} as TParams;
      if (options.params) {
        const parsed = options.params.safeParse(await context.params);
        if (!parsed.success) {
          return respond(apiError(404, "NOT_FOUND", options.notFoundMessage ?? "Not found."));
        }
        params = parsed.data;
      }

      let body = undefined as TBody;
      if (options.body) {
        const raw: unknown = await request.json().catch(() => null);
        const parsed = options.body.safeParse(raw);
        if (!parsed.success) {
          return respond(
            apiError(
              422,
              "VALIDATION_ERROR",
              options.validationMessage ?? "Check the request and try again.",
              parsed.error.flatten(),
            ),
          );
        }
        body = parsed.data;
      }

      const supabase = await createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        return respond(
          apiError(
            401,
            "UNAUTHENTICATED",
            options.unauthenticatedMessage ?? "Sign in to continue.",
          ),
        );
      }

      return respond(
        await handler({ request, user: auth.user, supabase, body, params, requestId }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "api.unhandled",
          requestId,
          name: error instanceof Error ? error.name : "unknown",
        }),
      );
      return respond(
        apiError(
          500,
          "INTERNAL_ERROR",
          "Something went wrong. Quote this request id when reporting it.",
          {
            requestId,
          },
        ),
      );
    }
  };
}

const RPC_ERROR_MAP: Record<string, { status: number; code: ApiErrorCode }> = {
  "28000": { status: 401, code: "UNAUTHENTICATED" },
  P0002: { status: 404, code: "NOT_FOUND" },
  "42501": { status: 403, code: "FORBIDDEN" },
  "22023": { status: 422, code: "VALIDATION_ERROR" },
  "23505": { status: 409, code: "CONFLICT" },
  "40001": { status: 409, code: "CONFLICT" },
};

export function mapRpcError(
  error: { code?: string; message?: string } | null,
  options: { message: string; requestId: string; projectScoped?: boolean },
): Response {
  const mapped = error?.code ? RPC_ERROR_MAP[error.code] : undefined;
  if (!mapped) {
    return apiError(
      500,
      "INTERNAL_ERROR",
      "Something went wrong. Quote this request id when reporting it.",
      {
        requestId: options.requestId,
      },
    );
  }
  if (mapped.code === "FORBIDDEN" && options.projectScoped) {
    return apiError(404, "NOT_FOUND", options.message);
  }
  return apiError(mapped.status, mapped.code, options.message);
}

export function firstRow<T>(data: T | T[] | null): T | null {
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

export const json = NextResponse.json.bind(NextResponse);
