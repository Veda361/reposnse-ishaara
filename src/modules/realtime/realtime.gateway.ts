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
} from "./realtime.types";
import { VoiceSessionStatus } from "../voice/sessions/voice-session.model";
import { InputMode } from "../voice/voice.types";
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
   * Attaches the gateway to the HTTP server, intercepting upgrade requests to /api/v1/voice/realtime.
   */
  attach(server: HttpServer): void {
    server.on("upgrade", async (req: IncomingMessage, socket, head) => {
      const pathname = parseUrl(req.url || "").pathname;

      if (pathname !== "/api/v1/voice/realtime") {
        return; // Allow other upgrade handlers (or 404)
      }

      try {
        const authContext = await this.authService.authenticateUpgradeRequest(req);

        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit("connection", ws, req, authContext);
        });
      } catch (err: any) {
        logger.warn("WebSocket upgrade authentication rejected", {
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
    });

    logger.info("RealtimeGateway mounted at /api/v1/voice/realtime");
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
              activeContext.transport.send("SESSION_ENDED", {
                reason: "Cancelled by driver client",
                finalStatus: VoiceSessionStatus.CANCELLED,
              } as SessionEndedPayload);
              await cleanupSession("Client cancelled", VoiceSessionStatus.CANCELLED);
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

  getWebSocketServer(): WebSocketServer {
    return this.wss;
  }
}

export const realtimeGateway = new RealtimeGateway();
