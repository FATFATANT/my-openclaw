import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { issueClawToken, verifyClawToken, verifyWorkbenchToken } from "./token.js";

const secret = "test-secret-with-enough-entropy";

function workbenchToken(expOffsetSeconds = 3600): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      iss: "ai-workbench",
      sub: "user-1",
      name: "测试用户",
      role: "manager",
      iat: now,
      exp: now + expOffsetSeconds,
    }),
  ).toString("base64url");
  const content = `${header}.${payload}`;
  const signature = crypto.createHmac("sha256", secret).update(content).digest("base64url");
  return `${content}.${signature}`;
}

describe("workbench claw tokens", () => {
  it("exchanges a valid workbench token for a claw token", () => {
    const identity = verifyWorkbenchToken(workbenchToken(), secret);
    expect(identity).toEqual({ sub: "user-1", name: "测试用户", role: "manager" });
    const issued = issueClawToken(identity!, secret, 3600);
    expect(verifyClawToken(issued.token, secret)).toEqual(identity);
  });

  it("rejects expired and tampered tokens", () => {
    expect(verifyWorkbenchToken(workbenchToken(-1), secret)).toBeNull();
    expect(verifyWorkbenchToken(`${workbenchToken()}x`, secret)).toBeNull();
  });
});
