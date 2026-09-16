import { WebSocket } from "ws";
import { RealtimeEnvelope, ServerMessageType } from "../realtime.types";
import { RealtimeEventBuilder } from "../realtime.events";
import { logger } from "../../../config/logger";

export class WebSocketTransport {
  private socket: WebSocket;
  private sessionId: string;
  private serverSequence: number = 0;
  private isAlive: boolean = true;

  constructor(socket: WebSocket, sessionId: string) {
    this.socket = socket;
    this.sessionId = sessionId;
  }

  getSocket(): WebSocket {
    return this.socket;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  markAlive(): void {
    this.isAlive = true;
  }

  checkHeartbeat(): boolean {
    if (!this.isAlive) {
      return false;
    }
    this.isAlive = false;
    if (this.isOpen()) {
      this.socket.ping();
    }
    return true;
  }

  /**
   * Transmits a standardized protocol envelope to the connected client.
   */
  send<T>(type: ServerMessageType, payload: T): boolean {
    if (!this.isOpen()) {
      logger.warn("Attempted to send over closed WebSocket", {
        sessionId: this.sessionId,
        type,
      });
      return false;
    }

    const envelope: RealtimeEnvelope<T> = RealtimeEventBuilder.createMessage(
      type,
      this.sessionId,
      this.serverSequence++,
      payload
    );

    try {
      this.socket.send(RealtimeEventBuilder.serialize(envelope));
      return true;
    } catch (err) {
      logger.error("Failed to transmit WebSocket message", {
        sessionId: this.sessionId,
        type,
        err,
      });
      return false;
    }
  }

  /**
   * Safely closes the underlying connection.
   */
  close(code: number = 1000, reason?: string): void {
    if (
      this.socket.readyState === WebSocket.OPEN ||
      this.socket.readyState === WebSocket.CONNECTING
    ) {
      try {
        this.socket.close(code, reason);
      } catch (err) {
        logger.error("Error closing WebSocket transport", { err });
      }
    }
  }
}
