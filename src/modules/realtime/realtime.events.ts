import {
  RealtimeEnvelope,
  ClientMessageType,
  ServerMessageType,
} from "./realtime.types";
import { AppError } from "../../shared/errors/app-error";
import { ERROR_CODES } from "../../shared/errors/error-codes";

export class RealtimeEventBuilder {
  /**
   * Constructs a typed, timestamped server envelope.
   */
  static createMessage<T>(
    type: ServerMessageType,
    sessionId: string,
    sequence: number,
    payload: T
  ): RealtimeEnvelope<T> {
    return {
      type,
      sessionId,
      sequence,
      timestamp: new Date().toISOString(),
      payload,
    };
  }

  /**
   * Serializes an envelope to a UTF-8 JSON string.
   */
  static serialize<T>(message: RealtimeEnvelope<T>): string {
    return JSON.stringify(message);
  }

  /**
   * Parses and validates raw client text messages.
   */
  static parseClientMessage(raw: string): RealtimeEnvelope {
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        "Malformed WebSocket message: must be valid JSON.",
        400
      );
    }

    if (!parsed || typeof parsed !== "object") {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        "Malformed WebSocket envelope: root must be an object.",
        400
      );
    }

    const { type, sessionId, sequence, payload } = parsed;

    if (!type || typeof type !== "string") {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        "Malformed WebSocket envelope: missing or invalid 'type'.",
        400
      );
    }

    if (!sessionId || typeof sessionId !== "string") {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        "Malformed WebSocket envelope: missing or invalid 'sessionId'.",
        400
      );
    }

    if (typeof sequence !== "number" || sequence < 0) {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        "Malformed WebSocket envelope: 'sequence' must be a non-negative number.",
        400
      );
    }

    return {
      type: type as ClientMessageType,
      sessionId,
      sequence,
      timestamp: parsed.timestamp || new Date().toISOString(),
      payload: payload || {},
    };
  }
}
