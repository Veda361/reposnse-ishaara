import { Server as HttpServer, IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { parse as parseUrl } from "url";
import { RealtimeAuthService, realtimeAuthService, AuthenticatedDriverContext } from "./realtime.auth";
import { RealtimeSessionService, realtimeSessionService } from "./realtime.session.service";
import { RealtimeSpeechOrchestrator, realtimeSpeechOrchestrator } from "../voice/realtime-speech.orchestrator";
import { RealtimeSpeechProvider } from "../voice/realtime-speech.provider";
import { VoiceService, voiceService } from "../voice/voice.service";
import { WebSocketTransport } from "./transports/websocket.transport";
import { RealtimeEventBuilder } from "./realtime.events";
import {
  RealtimeEnvelope,
  SessionStartPayload,
  AudioChunkPayload,
  SessionEndedPayload,
  ServerMessageType,
} from "./realtime.types";
import { VoiceSessionStatus } from "../voice/sessions/voice-session.model";
import { InputMode } from "../voice/voice.types";
import { IUserDocument } from "../users/user.types";
import { DiscoverySessionModel } from "../matching/discovery-session.model";
import { discoverySubscriptionIndex } from "./discovery-subscription.index";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { ERROR_CODES } from "../../shared/errors/error-codes";

interface ActiveSessionContext {
  transport: WebSocketTransport;
  auth: AuthenticatedDriverContext;
  sessionId: string;
  speechProvider?: RealtimeSpeechProvider;
  idleTimer?: NodeJS.Timeout;
  maxSessionTimer?: NodeJS.Timeout;
  clientSequence: number;
}

export class RealtimeGateway {
  private wss: WebSocketServer;
  private authService: RealtimeAuthService;
  private sessionService: RealtimeSessionService;
  private speechOrchestrator: RealtimeSpeechOrchestrator;
  private voiceSvc: VoiceService;
  private activeSessions: Map<string, ActiveSessionContext> = new Map();

  constructor(
    authService?: RealtimeAuthService,
    sessionService?: RealtimeSessionService,
    speechOrchestrator?: RealtimeSpeechOrchestrator,
    voiceSvc?: VoiceService
  ) {
    this.authService = authService ?? realtimeAuthService;
    this.sessionService = sessionService ?? realtimeSessionService;
    this.speechOrchestrator = speechOrchestrator ?? realtimeSpeechOrchestrator;
    this.voiceSvc = voiceSvc ?? voiceService;
    this.wss = new WebSocketServer({ noServer: true });
    this.setupConnectionHandling();
  }

  /**
   * Attaches the gateway to the HTTP server, intercepting upgrade requests to:
   * 1. /api/v1/voice/realtime (Driver conductor voice interaction)
   * 2. /api/v1/discovery/realtime (Passenger trip discovery stream)
   */
  attach(server: HttpServer): void {
    server.on("upgrade", async (req: IncomingMessage, socket, head) => {
      const pathname = parseUrl(req.url || "").pathname;

      if (pathname === "/api/v1/voice/realtime") {
        try {
          const authContext = await this.authService.authenticateUpgradeRequest(req);

          this.wss.handleUpgrade(req, socket, head, (ws) => {
            this.wss.emit("connection", ws, req, authContext);
          });
        } catch (err: any) {
          logger.warn("Voice WebSocket upgrade authentication rejected", {
            error: err.message,
            code: err.code || err.errorCode,
          });

          const statusCode = err.statusCode || 401;
          const statusMessage = err.message || "Unauthorized";
          socket.write(
            `HTTP/1.1 ${statusCode} ${statusMessage}\r\n` +
            `Connection: close\r\n` +
            `Content-Type: application/json\r\n\r\n` +
            JSON.stringify({ error: err.message, code: err.code || err.errorCode })
          );
          socket.destroy();
        }
      } else if (pathname === "/api/v1/discovery/realtime") {
        try {
          const user = await this.authService.authenticateDiscoveryUpgradeRequest(req);

          this.wss.handleUpgrade(req, socket, head, (ws) => {
            this.handleDiscoveryConnection(ws, req, user);
          });
        } catch (err: any) {
          logger.warn("Discovery WebSocket upgrade authentication rejected", {
            error: err.message,
            code: err.code || err.errorCode,
          });

          const statusCode = err.statusCode || 401;
          const statusMessage = err.message || "Unauthorized";
          socket.write(
            `HTTP/1.1 ${statusCode} ${statusMessage}\r\n` +
            `Connection: close\r\n` +
            `Content-Type: application/json\r\n\r\n` +
            JSON.stringify({ error: err.message, code: err.code || err.errorCode })
          );
          socket.destroy();
        }
      }
    });

    logger.info("RealtimeGateway mounted at /api/v1/voice/realtime and /api/v1/discovery/realtime");
  }

  private setupConnectionHandling(): void {
    this.wss.on(
      "connection",
      async (ws: WebSocket, req: IncomingMessage, authContext: AuthenticatedDriverContext) => {
        const urlObj = parseUrl(req.url || "", true);
        const querySessionId = urlObj.query.sessionId as string | undefined;

        let activeContext: ActiveSessionContext | undefined;

        const cleanupSession = async (reason: string, finalStatus?: VoiceSessionStatus) => {
          if (!activeContext) return;
          const { sessionId, transport, speechProvider, idleTimer, maxSessionTimer } = activeContext;

          if (idleTimer) clearInterval(idleTimer);
          if (maxSessionTimer) clearTimeout(maxSessionTimer);

          if (speechProvider) {
            try {
              await speechProvider.close();
            } catch (err) {
              logger.error("Error closing speech provider", { sessionId, err });
            }
          }

          if (finalStatus) {
            try {
              await this.sessionService.updateStatus(sessionId, finalStatus);
            } catch (err) {
              logger.error("Error updating session status on cleanup", { sessionId, err });
            }
          }

          this.activeSessions.delete(sessionId);
          logger.info("Realtime session cleaned up", { sessionId, reason });
        };

        const initializeSession = async (
          sessionId: string,
          options?: SessionStartPayload
        ) => {
          try {
            await this.sessionService.activateSession(
              sessionId,
              authContext.driverProfile._id
            );

            const transport = new WebSocketTransport(ws, sessionId);
            const speechProvider = this.speechOrchestrator.createSession({
              sessionId,
              languageHint: options?.languageHint,
              sampleRate: options?.sampleRate,
              encoding: options?.encoding,
            });

            // Bind speech provider streaming events
            speechProvider.onEvent(async (event) => {
              if (!transport.isOpen()) return;

              switch (event.type) {
                case "TRANSCRIPT_PARTIAL":
                  // STRICT: Partial transcript is purely for mobile UI display
                  transport.send("TRANSCRIPT_PARTIAL", {
                    text: event.text || "",
                    isFinal: false,
                    confidence: event.confidence,
                  });
                  break;

                case "TRANSCRIPT_FINAL":
                  // 1. Emit final transcript to client
                  transport.send("TRANSCRIPT_FINAL", {
                    text: event.text || "",
                    isFinal: true,
                    confidence: event.confidence,
                    language: event.language,
                  });

                  // 2. Authoritative NLP Intent Extraction + Geocoding Draft Creation
                  try {
                    await this.sessionService.updateStatus(
                      sessionId,
                      VoiceSessionStatus.PROCESSING
                    );

                    const draft = await this.voiceSvc.createDraftFromFinalTranscript(
                      authContext.driverProfile._id,
                      event.text || "",
                      {
                        languageHint: options?.languageHint,
                        inputMode: InputMode.REALTIME_STREAM,
                      }
                    );

                    // 3. Emit structured draft to client
                    transport.send("VOICE_DRAFT_READY", { draft });

                    await this.sessionService.updateStatus(
                      sessionId,
                      VoiceSessionStatus.COMPLETED
                    );

                    transport.send("SESSION_ENDED", {
                      reason: "Draft created successfully",
                      finalStatus: VoiceSessionStatus.COMPLETED,
                    } as SessionEndedPayload);

                    transport.close(1000, "Draft ready");
                  } catch (draftErr: any) {
                    logger.error("Draft creation from realtime transcript failed", {
                      sessionId,
                      error: draftErr.message,
                      code: draftErr.code || draftErr.errorCode,
                    });

                    transport.send("SESSION_ERROR", {
                      code: draftErr.code || draftErr.errorCode || ERROR_CODES.INTERNAL_SERVER_ERROR,
                      message: draftErr.message || "Failed to create trip draft.",
                      fatal: true,
                    });

                    await this.sessionService.updateStatus(
                      sessionId,
                      VoiceSessionStatus.FAILED,
                      { error: draftErr.message }
                    );

                    transport.close(1011, "Draft creation failed");
                  }
                  break;

                case "TRANSCRIPTION_ERROR":
                  transport.send("TRANSCRIPTION_ERROR", {
                    code: event.error?.code || ERROR_CODES.VOICE_TRANSCRIPTION_FAILED,
                    message: event.error?.message || "Speech transcription failed.",
                  });
                  break;

                case "SESSION_ENDED":
                  break;
              }
            });

            await speechProvider.startSession({
              sessionId,
              languageHint: options?.languageHint,
              sampleRate: options?.sampleRate,
              encoding: options?.encoding,
            });

            // Idle timer setup
            const idleTimeoutSeconds = env.REALTIME_IDLE_TIMEOUT_SECONDS || 30;
            let lastHeartbeat = Date.now();

            const idleTimer = setInterval(async () => {
              if (Date.now() - lastHeartbeat > idleTimeoutSeconds * 1000) {
                logger.warn("Voice realtime session idle timeout", { sessionId });
                transport.send("SESSION_ERROR", {
                  code: ERROR_CODES.VOICE_SESSION_IDLE_TIMEOUT,
                  message: `Session timed out after ${idleTimeoutSeconds}s of inactivity.`,
                  fatal: true,
                });
                await cleanupSession("Idle timeout", VoiceSessionStatus.EXPIRED);
                transport.close(4408, "Idle timeout");
              }
            }, 5000);

            // Max session duration timer
            const maxSessionSeconds = env.REALTIME_MAX_SESSION_SECONDS || 60;
            const maxSessionTimer = setTimeout(async () => {
              logger.warn("Voice realtime session reached max duration", { sessionId });
              transport.send("SESSION_ERROR", {
                code: ERROR_CODES.VOICE_REALTIME_TIMEOUT,
                message: `Session exceeded max allowed duration of ${maxSessionSeconds}s.`,
                fatal: true,
              });
              await cleanupSession("Max duration exceeded", VoiceSessionStatus.EXPIRED);
              transport.close(4408, "Max session duration exceeded");
            }, maxSessionSeconds * 1000);

            activeContext = {
              transport,
              auth: authContext,
              sessionId,
              speechProvider,
              idleTimer,
              maxSessionTimer,
              clientSequence: 0,
            };

            this.activeSessions.set(sessionId, activeContext);

            // Send confirmation to client
            transport.send("SESSION_STARTED", {
              sessionId,
              driverId: authContext.driverProfile._id.toString(),
            });

            logger.info("Realtime session fully initialized", { sessionId });
          } catch (err: any) {
            logger.error("Failed to initialize realtime session", {
              sessionId,
              err: err.message,
            });
            const transport = new WebSocketTransport(ws, sessionId);
            transport.send("SESSION_ERROR", {
              code: err.code || err.errorCode || ERROR_CODES.INTERNAL_SERVER_ERROR,
              message: err.message || "Failed to initialize session.",
              fatal: true,
            });
            transport.close(1011, err.message);
          }
        };

        // If sessionId provided in URL query, initialize immediately
        if (querySessionId) {
          await initializeSession(querySessionId);
        }

        // Handle incoming WebSocket messages
        ws.on("message", async (data: Buffer | string, isBinary: boolean) => {
          if (isBinary) {
            // Binary audio streaming
            if (!activeContext || !activeContext.speechProvider) {
              return;
            }
            try {
              const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
              await activeContext.speechProvider.sendAudio(buffer);
              await this.sessionService.touchActivity(activeContext.sessionId);
            } catch (err: any) {
              logger.error("Error processing binary audio chunk", { err });
              activeContext.transport.send("SESSION_ERROR", {
                code: err.code || err.errorCode || ERROR_CODES.VOICE_AUDIO_CHUNK_INVALID,
                message: err.message,
              });
            }
            return;
          }

          // JSON text envelope
          let envelope: RealtimeEnvelope;
          try {
            envelope = RealtimeEventBuilder.parseClientMessage(data.toString());
          } catch (parseErr: any) {
            logger.warn("Malformed client message received", { error: parseErr.message });
            ws.send(
              JSON.stringify({
                type: "SESSION_ERROR",
                sessionId: querySessionId || "unknown",
                sequence: 0,
                timestamp: new Date().toISOString(),
                payload: {
                  code: parseErr.code || parseErr.errorCode || ERROR_CODES.BAD_REQUEST,
                  message: parseErr.message,
                },
              })
            );
            return;
          }

          switch (envelope.type) {
            case "SESSION_START": {
              if (activeContext) {
                activeContext.transport.send("SESSION_ERROR", {
                  code: ERROR_CODES.VOICE_SESSION_ALREADY_ACTIVE,
                  message: "Session is already started.",
                });
                return;
              }
              await initializeSession(envelope.sessionId, envelope.payload as SessionStartPayload);
              break;
            }

            case "AUDIO_CHUNK": {
              if (!activeContext || !activeContext.speechProvider) {
                return;
              }
              try {
                const payload = envelope.payload as AudioChunkPayload;
                if (payload.audio) {
                  const chunkBuffer = Buffer.from(payload.audio, "base64");
                  await activeContext.speechProvider.sendAudio(chunkBuffer);
                  await this.sessionService.touchActivity(activeContext.sessionId);
                }
              } catch (err: any) {
                logger.error("Error processing text audio chunk", { err });
                activeContext.transport.send("SESSION_ERROR", {
                  code: err.code || err.errorCode || ERROR_CODES.VOICE_AUDIO_CHUNK_INVALID,
                  message: err.message,
                });
              }
              break;
            }

            case "AUDIO_END": {
              if (!activeContext || !activeContext.speechProvider) {
                return;
              }
              logger.info("Client marked AUDIO_END", { sessionId: activeContext.sessionId });
              await activeContext.speechProvider.endSession();
              break;
            }

            case "SESSION_CANCEL": {
              if (!activeContext) return;
              logger.info("Client requested SESSION_CANCEL", { sessionId: activeContext.sessionId });
              try {
                await this.sessionService.updateStatus(
                  activeContext.sessionId,
                  VoiceSessionStatus.CANCELLED
                );
              } catch (err) {
                logger.error("Error updating session status on cancel", { err });
              }
              activeContext.transport.send("SESSION_ENDED", {
                reason: "Cancelled by driver client",
                finalStatus: VoiceSessionStatus.CANCELLED,
              } as SessionEndedPayload);
              await cleanupSession("Client cancelled");
              activeContext.transport.close(1000, "Session cancelled");
              break;
            }

            case "PING": {
              if (activeContext) {
                activeContext.transport.send("PONG", { pongAt: new Date().toISOString() });
              }
              break;
            }
          }
        });

        ws.on("close", async (code, reason) => {
          logger.info("WebSocket connection closed", {
            code,
            reason: reason.toString(),
            sessionId: activeContext?.sessionId,
          });
          await cleanupSession("Socket closed", VoiceSessionStatus.CANCELLED);
        });

        ws.on("error", async (err) => {
          logger.error("WebSocket socket error", {
            err,
            sessionId: activeContext?.sessionId,
          });
          await cleanupSession("Socket error", VoiceSessionStatus.FAILED);
        });
      }
    );
  }

  private handleDiscoveryConnection(
    ws: WebSocket,
    req: IncomingMessage,
    user: IUserDocument
  ): void {
    const urlObj = parseUrl(req.url || "", true);
    const initialSessionId = urlObj.query.discoverySessionId as string | undefined;

    let activeSessionId: string | undefined;
    let transport: WebSocketTransport | undefined;
    let expirationTimer: NodeJS.Timeout | undefined;
    let pingTimer: NodeJS.Timeout | undefined;

    const cleanup = (reason: string) => {
      if (activeSessionId) {
        discoverySubscriptionIndex.removeSubscriber(activeSessionId);
        logger.info("Discovery subscriber removed", {
          sessionId: activeSessionId,
          userId: user._id.toString(),
          reason,
        });
        activeSessionId = undefined;
      }
      if (expirationTimer) {
        clearTimeout(expirationTimer);
        expirationTimer = undefined;
      }
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = undefined;
      }
    };

    const subscribeToSession = async (sessionId: string) => {
      if (!sessionId || typeof sessionId !== "string") {
        ws.send(
          JSON.stringify({
            type: "DISCOVERY_ERROR",
            sessionId: "unknown",
            sequence: 0,
            timestamp: new Date().toISOString(),
            payload: {
              code: ERROR_CODES.VALIDATION_ERROR,
              message: "discoverySessionId is required to subscribe",
              fatal: false,
            },
          })
        );
        return;
      }

      try {
        const session = await DiscoverySessionModel.findOne({
          sessionId,
          userId: user._id,
          expiresAt: { $gt: new Date() },
        });

        if (!session) {
          ws.send(
            JSON.stringify({
              type: "DISCOVERY_ERROR",
              sessionId,
              sequence: 0,
              timestamp: new Date().toISOString(),
              payload: {
                code: ERROR_CODES.DISCOVERY_SESSION_NOT_FOUND,
                message: "Discovery session not found or has expired",
                fatal: true,
              },
            })
          );
          ws.close(4004, "Session not found or expired");
          return;
        }

        // Clean up previous subscription if switching sessions on same socket
        if (activeSessionId && activeSessionId !== session.sessionId) {
          discoverySubscriptionIndex.removeSubscriber(activeSessionId);
          if (expirationTimer) clearTimeout(expirationTimer);
        }

        activeSessionId = session.sessionId;
        transport = new WebSocketTransport(ws, activeSessionId);

        discoverySubscriptionIndex.addSubscriber(session, ws, transport);

        transport.send("DISCOVERY_SUBSCRIBED", {
          discoverySessionId: session.sessionId,
          expiresAt: session.expiresAt.toISOString(),
          pickup: [session.origin.longitude, session.origin.latitude],
          destination: [session.destination.longitude, session.destination.latitude],
        });

        const ttlMs = Math.max(0, session.expiresAt.getTime() - Date.now());
        if (expirationTimer) clearTimeout(expirationTimer);
        expirationTimer = setTimeout(() => {
          if (transport?.isOpen()) {
            transport.send("DISCOVERY_EXPIRED", {
              discoverySessionId: session.sessionId,
            });
            transport.close(1000, "Discovery session expired");
          }
          cleanup("TTL Expired");
        }, ttlMs);
      } catch (err: any) {
        logger.error("Error subscribing to discovery session", {
          sessionId,
          userId: user._id.toString(),
          err,
        });
        ws.send(
          JSON.stringify({
            type: "DISCOVERY_ERROR",
            sessionId,
            sequence: 0,
            timestamp: new Date().toISOString(),
            payload: {
              code: ERROR_CODES.INTERNAL_SERVER_ERROR,
              message: "Failed to subscribe to discovery session",
              fatal: true,
            },
          })
        );
      }
    };

    // Auto-subscribe if initial discoverySessionId is in URL query
    if (initialSessionId) {
      subscribeToSession(initialSessionId);
    }

    // Heartbeat ping every 30s
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);

    ws.on("message", async (data: any, isBinary: boolean) => {
      if (isBinary) {
        // Discovery protocol only supports JSON control frames
        return;
      }

      let envelope: RealtimeEnvelope<any>;
      try {
        envelope = RealtimeEventBuilder.parseClientMessage(data.toString());
      } catch (err) {
        logger.warn("Received malformed JSON on discovery WebSocket", { err });
        ws.send(
          JSON.stringify({
            type: "DISCOVERY_ERROR",
            sessionId: activeSessionId || "unknown",
            sequence: 0,
            timestamp: new Date().toISOString(),
            payload: {
              code: ERROR_CODES.BAD_REQUEST,
              message: "Payload must be valid JSON matching RealtimeEnvelope",
              fatal: false,
            },
          })
        );
        return;
      }

      switch (envelope.type) {
        case "PING": {
          if (transport) {
            transport.send("PONG", { pongAt: new Date().toISOString() });
          } else {
            ws.send(
              JSON.stringify({
                type: "PONG",
                sessionId: "unknown",
                sequence: 0,
                timestamp: new Date().toISOString(),
                payload: { pongAt: new Date().toISOString() },
              })
            );
          }
          break;
        }

        case "DISCOVERY_SUBSCRIBE": {
          const sid = envelope.payload?.discoverySessionId || envelope.sessionId;
          await subscribeToSession(sid);
          break;
        }

        case "DISCOVERY_UNSUBSCRIBE": {
          cleanup("Client unsubscribed");
          break;
        }
      }
    });

    ws.on("close", (code, reason) => {
      logger.info("Discovery WebSocket connection closed", {
        userId: user._id.toString(),
        sessionId: activeSessionId,
        code,
        reason: reason.toString(),
      });
      cleanup("Socket closed");
    });

    ws.on("error", (err) => {
      logger.error("Discovery WebSocket socket error", {
        userId: user._id.toString(),
        sessionId: activeSessionId,
        err,
      });
      cleanup("Socket error");
    });
  }

  getWebSocketServer(): WebSocketServer {
    return this.wss;
  }
}

export const realtimeGateway = new RealtimeGateway();
