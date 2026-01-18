import type { IncomingMessage } from "node:http";

function splitBuffer(buffer: Buffer, delimiter: Buffer) {
  const parts: Buffer[] = [];
  let start = 0;
  let index = buffer.indexOf(delimiter, start);
  while (index !== -1) {
    parts.push(buffer.slice(start, index));
    start = index + delimiter.length;
    index = buffer.indexOf(delimiter, start);
  }
  parts.push(buffer.slice(start));
  return parts;
}

export function parseMultipart(buffer: Buffer, contentType: string) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "") ?? [];
  const boundaryMatch = match[1] || match[2];
  if (!boundaryMatch) {
    throw new Error("Missing multipart boundary");
  }
  const boundary = boundaryMatch;
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = splitBuffer(buffer, delimiter);
  const fields: Record<string, string> = {};

  for (const part of parts) {
    if (part.length === 0) continue;
    if (part.equals(Buffer.from("--\r\n")) || part.equals(Buffer.from("--"))) {
      continue;
    }

    const trimmed = part.slice(part.indexOf("\r\n") + 2);
    const headerEnd = trimmed.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const headerText = trimmed.slice(0, headerEnd).toString("utf8");
    const content = trimmed.slice(headerEnd + 4);
    const contentTrimmed = content.slice(0, content.length - 2);

    const nameMatch = /name="([^"]+)"/i.exec(headerText);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    fields[name] = contentTrimmed.toString("utf8");
  }

  return fields;
}

export async function readRequestBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
