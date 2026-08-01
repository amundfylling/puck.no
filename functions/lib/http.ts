export class BodyTooLargeError extends Error {}

async function readStreamTextLimited(
  stream: ReadableStream<Uint8Array> | null,
  declaredLength: string | null,
  maxBytes: number,
): Promise<string> {
  const declared = Number(declaredLength);
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  if (!stream) return '';

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new BodyTooLargeError();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export function readRequestTextLimited(request: Request, maxBytes: number): Promise<string> {
  return readStreamTextLimited(request.body, request.headers.get('Content-Length'), maxBytes);
}

export function readResponseTextLimited(response: Response, maxBytes: number): Promise<string> {
  return readStreamTextLimited(response.body, response.headers.get('Content-Length'), maxBytes);
}
