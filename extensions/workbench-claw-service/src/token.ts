import crypto from "node:crypto";

export type WorkbenchIdentity = {
  sub: string;
  name: string;
  role: string;
  lineCodes: string[];
  positionCodes: string[];
};

type JwtClaims = WorkbenchIdentity & {
  iss: string;
  aud?: string;
  iat: number;
  exp: number;
  jti?: string;
};

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function sign(content: string, secret: string): Buffer {
  return crypto.createHmac("sha256", secret).update(content).digest();
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function identityFromClaims(claims: JwtClaims): WorkbenchIdentity {
  return {
    sub: claims.sub,
    name: claims.name,
    role: claims.role,
    lineCodes: stringArray(claims.lineCodes),
    positionCodes: stringArray(claims.positionCodes),
  };
}

function parseClaims(token: string, secret: string): JwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
    const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")) as {
      alg?: unknown;
    };
    if (header.alg !== "HS256") return null;
    const expected = sign(`${headerPart}.${payloadPart}`, secret);
    const supplied = Buffer.from(signaturePart, "base64url");
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied))
      return null;
    const claims = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as JwtClaims;
    if (
      typeof claims.iss !== "string" ||
      typeof claims.sub !== "string" ||
      typeof claims.name !== "string" ||
      typeof claims.role !== "string" ||
      typeof claims.iat !== "number" ||
      typeof claims.exp !== "number" ||
      claims.sub.trim().length === 0 ||
      claims.exp <= Math.floor(Date.now() / 1000)
    )
      return null;
    return claims;
  } catch {
    return null;
  }
}

export function verifyWorkbenchToken(token: string, secret: string): WorkbenchIdentity | null {
  const claims = parseClaims(token, secret);
  return claims?.iss === "ai-workbench" ? identityFromClaims(claims) : null;
}

export function issueClawToken(identity: WorkbenchIdentity, secret: string, ttlSeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const claims: JwtClaims = {
    iss: "openclaw-workbench",
    aud: "ai-workbench-mcp",
    ...identity,
    iat: now,
    exp: now + ttlSeconds,
    jti: crypto.randomUUID(),
  };
  const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = encode(JSON.stringify(claims));
  const content = `${header}.${payload}`;
  return { token: `${content}.${encode(sign(content, secret))}`, expiresAt: claims.exp };
}

export function verifyClawToken(token: string, secret: string): WorkbenchIdentity | null {
  const claims = parseClaims(token, secret);
  return claims?.iss === "openclaw-workbench" && claims.aud === "ai-workbench-mcp"
    ? identityFromClaims(claims)
    : null;
}
