import type { Session, TranscriptMessage } from "./types.js";

export class SessionStore {
  private sessions = new Map<string, Session>();

  getOrCreate(sessionId: string): Session {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }
    const session: Session = {
      id: sessionId,
      transcript: [],
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  append(sessionId: string, message: TranscriptMessage) {
    const session = this.getOrCreate(sessionId);
    session.transcript.push(message);
  }

  read(sessionId: string): Session {
    return this.getOrCreate(sessionId);
  }
}
