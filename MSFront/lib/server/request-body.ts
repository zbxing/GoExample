import 'server-only';
import { type ZodType, type infer as Infer } from 'zod';
import { privateJson } from '@/lib/server/response-security';

const defaultMaxJsonBodyBytes = 1024 * 1024;
const maxReportedIssues = 10;

export type RequestBodyErrorCode =
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'PAYLOAD_TOO_LARGE'
  | 'INVALID_JSON'
  | 'INVALID_REQUEST_BODY';

export interface RequestBodyIssue {
  path: string;
  message: string;
}

export class RequestBodyError extends Error {
  constructor(
    readonly code: RequestBodyErrorCode,
    readonly status: number,
    message: string,
    readonly issues: RequestBodyIssue[] = [],
  ) {
    super(message);
    this.name = 'RequestBodyError';
  }
}

export async function readJsonBody<Schema extends ZodType>(
  request: Request,
  schema: Schema,
  maxBytes = defaultMaxJsonBodyBytes,
): Promise<Infer<Schema>> {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json' && !mediaType?.endsWith('+json')) {
    throw new RequestBodyError(
      'UNSUPPORTED_MEDIA_TYPE',
      415,
      'Content-Type must be application/json.',
    );
  }

  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw payloadTooLarge(maxBytes);
  }

  const bytes = await readLimitedBody(request.body, maxBytes);
  let value: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    throw new RequestBodyError('INVALID_JSON', 400, 'Request body must contain valid JSON.');
  }

  const result = schema.safeParse(value);
  if (!result.success) {
    throw new RequestBodyError(
      'INVALID_REQUEST_BODY',
      422,
      'Request body validation failed.',
      result.error.issues.slice(0, maxReportedIssues).map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export function apiErrorResponse(error: unknown, fallbackMessage: string, status = 500) {
  if (error instanceof RequestBodyError) {
    return privateJson(
      {
        message: error.message,
        error: {
          code: error.code,
          issues: error.issues,
        },
      },
      { status: error.status },
    );
  }

  console.error(fallbackMessage, error);
  return privateJson({ message: fallbackMessage }, { status });
}

async function readLimitedBody(body: ReadableStream<Uint8Array> | null, maxBytes: number) {
  if (!body) {
    return new Uint8Array();
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw payloadTooLarge(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function payloadTooLarge(maxBytes: number) {
  return new RequestBodyError(
    'PAYLOAD_TOO_LARGE',
    413,
    `Request body exceeds the ${maxBytes}-byte limit.`,
  );
}
