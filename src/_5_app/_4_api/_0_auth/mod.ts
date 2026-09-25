import type { Fault, WalletIdentityPort } from "../../../_kernel/mod";

type Challenge = { owner: string; message: string; issuedAtMs: number; expiresAtMs: number };
type Session = { owner: string; issuedAtMs: number; expiresAtMs: number };
export class AuthenticationError extends Error {}
export class WalletSessions {
  private closed = false;
  private readonly challenges = new Map<string, Challenge>();
  private readonly sessions = new Map<string, Session>();
  constructor(private readonly origin: string, private readonly identity: WalletIdentityPort,
    private readonly log: (fault: Fault) => void, private readonly now = Date.now) {
    const url = new URL(origin);
    if (url.origin !== origin || (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1"))) {
      throw new Error("Authentication requires a canonical secure origin");
    }
  }
  private reject(reason: string): never {
    this.log({ code: "INVALID", message: "Authentication rejected", retryable: false,
      context: { component: "wallet-auth", reason } });
    throw new AuthenticationError("Authentication rejected");
  }
  private checkOrigin(origin: string) { if (this.closed) this.reject("closed"); if (origin !== this.origin) this.reject("origin"); }
  private fresh(value: Session, now: number) { return now >= value.issuedAtMs && now < value.expiresAtMs; }
  private prune(now: number) {
    for (const [id, value] of this.challenges) if (!this.fresh(value, now)) this.challenges.delete(id);
    for (const [id, value] of this.sessions) if (!this.fresh(value, now)) this.sessions.delete(id);
  }
  private token(): string { return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url"); }
  challenge(origin: string, owner: string): { id: string; message: string; expiresAtMs: number } {
    this.checkOrigin(origin);
    if (!this.identity.validOwner(owner)) this.reject("owner");
    const now = this.now(); this.prune(now);
    if (this.challenges.size >= 1024) this.reject("challenge-capacity");
    const id = this.token(), expiresAtMs = now + 300000;
    const message = `${new URL(this.origin).host} requests sign-in to HoldSafe.\n\n` +
      `Account: ${owner}\nThis sign-in does not authorize transactions or token spending.\n\n` +
      `URI: ${this.origin}\nVersion: 1\nChain: ${this.identity.chain.namespace}:${this.identity.chain.reference}\n` +
      `Nonce: ${id}\nIssued At: ${new Date(now).toISOString()}\nExpiration Time: ${new Date(expiresAtMs).toISOString()}`;
    this.challenges.set(id, { owner, message, issuedAtMs: now, expiresAtMs });
    return { id, message, expiresAtMs };
  }
  async verify(origin: string, id: string, signatureBase64: string): Promise<{ token: string; expiresAtMs: number }> {
    this.checkOrigin(origin);
    const pending = this.challenges.get(id); this.challenges.delete(id);
    const now = this.now(); this.prune(now);
    if (pending === undefined || !this.fresh(pending, now)) this.reject("challenge-expired-or-used");
    let verified: boolean;
    try { verified = await this.identity.verify(pending.owner, pending.message, signatureBase64); }
    catch { return this.reject("verification-unavailable"); }
    this.checkOrigin(origin);
    if (!verified) this.reject("signature");
    const issuedAtMs = this.now(); this.prune(issuedAtMs);
    if (!this.fresh(pending, issuedAtMs)) this.reject("challenge-expired-during-verification");
    if (this.sessions.size >= 1024) this.reject("session-capacity");
    const token = this.token(), expiresAtMs = issuedAtMs + 1800000;
    this.sessions.set(token, { owner: pending.owner, issuedAtMs, expiresAtMs });
    return { token, expiresAtMs };
  }
  owner(origin: string, token: string): string {
    this.checkOrigin(origin);
    const now = this.now(); this.prune(now);
    const session = this.sessions.get(token);
    if (session === undefined) this.reject("session-expired-or-unknown");
    return session.owner;
  }
  logout(origin: string, token: string): void { this.checkOrigin(origin); this.sessions.delete(token); }
  close(): void { this.closed = true; this.challenges.clear(); this.sessions.clear(); }
}
