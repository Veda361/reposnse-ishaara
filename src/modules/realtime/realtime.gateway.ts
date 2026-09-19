import { Server as HttpServer, IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
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

import { randomUUID } from "crypto";
import { IDriverProfileDocument } from "../drivers/driver.types";
import { RideModel } from "../rides/ride.model";
import { RideStatus } from "../rides/ride.constants";
import {
  DriverLocationUpdatedPayload,
  RideTrackingUpdatedPayload,
  RideTrackingEndedPayload,
} from "./realtime.types";
import { trackingService } from "../tracking/tracking.service";
import { ROLES } from "../../shared/constants/roles.constants";

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
  private rideRequestUserSubscribers: Map<string, Set<WebSocketTransport>> = new Map();
  private rideRequestDriverSubscribers: Map<string, Set<WebSocketTransport>> = new Map();
  private rideLocationSubscribers: Map<string, Set<WebSocketTransport>> = new Map();
  private rideTrackingSubscribers: Map<string, Set<WebSocketTransport>> = new Map();

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
      const pathname = new URL(req.url || "", "http://localhost").pathname;

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
      } else if (pathname === "/api/v1/ride-requests/realtime" || pathname === "/api/v1/rides/realtime") {
        try {
          const authResult = await this.authService.authenticateRideRequestUpgrade(req);

          this.wss.handleUpgrade(req, socket, head, (ws) => {
            this.handleRideRequestConnection(ws, req, authResult);
          });
        } catch (err: any) {
          logger.warn("Ride WebSocket upgrade authentication rejected", {
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

    logger.info("RealtimeGateway mounted at /api/v1/voice/realtime, /api/v1/discovery/realtime, /api/v1/ride-requests/realtime, and /api/v1/rides/realtime");
  }

  private setupConnectionHandling(): void {
    this.wss.on(
      "connection",
      async (ws: WebSocket, req: IncomingMessage, authContext: AuthenticatedDriverContext) => {
        const urlObj = new URL(req.url || "", "http://localhost");
        const querySessionId = urlObj.searchParams.get("sessionId") || undefined;

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
    const urlObj = new URL(req.url || "", "http://localhost");
    const initialSessionId = urlObj.searchParams.get("discoverySessionId") || undefined;

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

  private handleRideRequestConnection(
    ws: WebSocket,
    _req: IncomingMessage,
    authContext: { user: IUserDocument; driverProfile?: IDriverProfileDocument | null }
  ): void {
    const userId = authContext.user._id.toString();
    const driverProfileId = authContext.driverProfile?._id?.toString();
    const connectionId = `rreq_${randomUUID().replace(/-/g, "")}`;
    const transport = new WebSocketTransport(ws, connectionId);

    // Register user subscription
    let userTransports = this.rideRequestUserSubscribers.get(userId);
    if (!userTransports) {
      userTransports = new Set();
      this.rideRequestUserSubscribers.set(userId, userTransports);
    }
    userTransports.add(transport);

    // Register driver subscription if applicable
    if (driverProfileId) {
      let driverTransports = this.rideRequestDriverSubscribers.get(driverProfileId);
      if (!driverTransports) {
        driverTransports = new Set();
        this.rideRequestDriverSubscribers.set(driverProfileId, driverTransports);
      }
      driverTransports.add(transport);
    }

    logger.info("RideRequest WebSocket client connected", {
      userId,
      driverProfileId: driverProfileId ?? null,
      connectionId,
    });

    let pingTimer: NodeJS.Timeout | undefined = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);

    const subscribedRideIds = new Set<string>();
    const subscribedTrackingRideIds = new Set<string>();

    const cleanup = () => {
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = undefined;
      }

      const currentUsers = this.rideRequestUserSubscribers.get(userId);
      if (currentUsers) {
        currentUsers.delete(transport);
        if (currentUsers.size === 0) {
          this.rideRequestUserSubscribers.delete(userId);
        }
      }

      if (driverProfileId) {
        const currentDrivers = this.rideRequestDriverSubscribers.get(driverProfileId);
        if (currentDrivers) {
          currentDrivers.delete(transport);
          if (currentDrivers.size === 0) {
            this.rideRequestDriverSubscribers.delete(driverProfileId);
          }
        }
      }

      // Cleanup ride location subscriptions
      for (const rideId of subscribedRideIds) {
        const subscribers = this.rideLocationSubscribers.get(rideId);
        if (subscribers) {
          subscribers.delete(transport);
          if (subscribers.size === 0) {
            this.rideLocationSubscribers.delete(rideId);
          }
        }
      }
      subscribedRideIds.clear();

      // Cleanup ride tracking subscriptions (Phase 11)
      for (const rideId of subscribedTrackingRideIds) {
        const subscribers = this.rideTrackingSubscribers.get(rideId);
        if (subscribers) {
          subscribers.delete(transport);
          if (subscribers.size === 0) {
            this.rideTrackingSubscribers.delete(rideId);
          }
        }
      }
      subscribedTrackingRideIds.clear();

      logger.info("RideRequest WebSocket client disconnected", {
        userId,
        driverProfileId: driverProfileId ?? null,
        connectionId,
      });
    };

    const handleRideLocationSubscribe = async (message: any) => {
      const payload = message.payload || {};
      const rideId = payload.rideId || message.rideId;

      if (!rideId || typeof rideId !== "string") {
        transport.send("RIDE_LOCATION_ERROR", {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: "rideId is required to subscribe to ride location",
          rideId: rideId || "unknown",
        });
        return;
      }

      try {
        const ride = await RideModel.findById(rideId).exec();
        if (!ride) {
          transport.send("RIDE_LOCATION_ERROR", {
            code: ERROR_CODES.RIDE_NOT_FOUND,
            message: "Ride not found",
            rideId,
          });
          return;
        }

        // Authorization: caller must be the passenger or driver
        const isPassenger = ride.userId.toString() === userId;
        const isDriver = driverProfileId && ride.driverId.toString() === driverProfileId;

        if (!isPassenger && !isDriver) {
          transport.send("RIDE_LOCATION_ERROR", {
            code: ERROR_CODES.RIDE_NOT_AUTHORIZED,
            message: "You are not authorized to track location for this ride",
            rideId,
          });
          return;
        }

        // State check: cannot subscribe to terminal rides
        const activeRideStatuses: string[] = [
          RideStatus.CREATED,
          RideStatus.DRIVER_ARRIVING,
          RideStatus.PICKED_UP,
          RideStatus.IN_PROGRESS,
        ];
        if (!activeRideStatuses.includes(ride.status)) {
          transport.send("RIDE_LOCATION_ERROR", {
            code: ERROR_CODES.RIDE_INVALID_STATE,
            message: `Cannot track ride in terminal state ${ride.status}`,
            rideId,
          });
          return;
        }

        let subscribers = this.rideLocationSubscribers.get(rideId);
        if (!subscribers) {
          subscribers = new Set();
          this.rideLocationSubscribers.set(rideId, subscribers);
        }
        subscribers.add(transport);
        subscribedRideIds.add(rideId);

        logger.info("Client subscribed to ride location", {
          userId,
          driverProfileId: driverProfileId ?? null,
          rideId,
        });

        transport.send("RIDE_LOCATION_SUBSCRIBED", {
          rideId,
          driverId: ride.driverId.toString(),
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        logger.error("Error subscribing to ride location", { rideId, err });
        transport.send("RIDE_LOCATION_ERROR", {
          code: ERROR_CODES.INTERNAL_SERVER_ERROR,
          message: "Failed to subscribe to ride location",
          rideId,
        });
      }
    };

    const handleRideLocationUnsubscribe = (message: any) => {
      const payload = message.payload || {};
      const rideId = payload.rideId || message.rideId;
      if (!rideId) return;

      const subscribers = this.rideLocationSubscribers.get(rideId);
      if (subscribers) {
        subscribers.delete(transport);
        if (subscribers.size === 0) {
          this.rideLocationSubscribers.delete(rideId);
        }
      }
      subscribedRideIds.delete(rideId);

      logger.info("Client unsubscribed from ride location", {
        userId,
        rideId,
      });
    };

    const handleRideTrackingSubscribe = async (message: any) => {
      const payload = message.payload || {};
      const rideId = payload.rideId || message.rideId;

      if (!rideId || typeof rideId !== "string") {
        transport.send("RIDE_TRACKING_ERROR", {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: "rideId is required to subscribe to ride tracking",
          rideId: rideId || "unknown",
        });
        return;
      }

      try {
        const ride = await RideModel.findById(rideId).exec();
        if (!ride) {
          transport.send("RIDE_TRACKING_ERROR", {
            code: ERROR_CODES.RIDE_NOT_FOUND,
            message: "Ride not found",
            rideId,
          });
          return;
        }

        // Authorization: caller must be the passenger or driver
        const isPassenger = ride.userId.toString() === userId;
        const isDriver = Boolean(
          driverProfileId && ride.driverId.toString() === driverProfileId
        );

        if (!isPassenger && !isDriver) {
          transport.send("RIDE_TRACKING_ERROR", {
            code: ERROR_CODES.RIDE_NOT_AUTHORIZED,
            message: "You are not authorized to track this ride",
            rideId,
          });
          return;
        }

        // State check: cannot subscribe to terminal rides
        const activeRideStatuses: string[] = [
          RideStatus.CREATED,
          RideStatus.DRIVER_ARRIVING,
          RideStatus.PICKED_UP,
          RideStatus.IN_PROGRESS,
        ];
        if (!activeRideStatuses.includes(ride.status)) {
          transport.send("RIDE_TRACKING_ERROR", {
            code: ERROR_CODES.RIDE_INVALID_STATE,
            message: `Cannot track ride in terminal state ${ride.status}`,
            rideId,
          });
          return;
        }

        let subscribers = this.rideTrackingSubscribers.get(rideId);
        if (!subscribers) {
          subscribers = new Set();
          this.rideTrackingSubscribers.set(rideId, subscribers);
        }
        subscribers.add(transport);
        subscribedTrackingRideIds.add(rideId);

        logger.info("Client subscribed to ride tracking", {
          userId,
          driverProfileId: driverProfileId ?? null,
          rideId,
        });

        // 1. Send subscription confirmation
        transport.send("RIDE_TRACKING_SUBSCRIBED", {
          rideId,
          driverId: ride.driverId.toString(),
          timestamp: new Date().toISOString(),
        });

        // 2. Initial Snapshot: compute and send immediate tracking snapshot
        const snapshot = await trackingService.getRideTracking(
          {
            userId,
            role: isPassenger ? ROLES.USER : ROLES.DRIVER_CONDUCTOR,
            driverProfileId: isDriver ? driverProfileId : undefined,
          },
          rideId
        );
        transport.send("TRACKING_SNAPSHOT", snapshot);
      } catch (err: any) {
        logger.error("Error subscribing to ride tracking", { rideId, err });
        transport.send("RIDE_TRACKING_ERROR", {
          code: ERROR_CODES.INTERNAL_SERVER_ERROR,
          message: "Failed to subscribe to ride tracking",
          rideId,
        });
      }
    };

    const handleRideTrackingUnsubscribe = (message: any) => {
      const payload = message.payload || {};
      const rideId = payload.rideId || message.rideId;
      if (!rideId) return;

      const subscribers = this.rideTrackingSubscribers.get(rideId);
      if (subscribers) {
        subscribers.delete(transport);
        if (subscribers.size === 0) {
          this.rideTrackingSubscribers.delete(rideId);
        }
      }
      subscribedTrackingRideIds.delete(rideId);

      logger.info("Client unsubscribed from ride tracking", {
        userId,
        rideId,
      });
    };

    ws.on("message", async (data: any, isBinary: boolean) => {
      if (isBinary) return;

      try {
        const parsed = JSON.parse(data.toString());
        if (parsed?.type === "PING") {
          transport.send("PONG", { pongAt: new Date().toISOString() });
        } else if (parsed?.type === "RIDE_LOCATION_SUBSCRIBE") {
          await handleRideLocationSubscribe(parsed);
        } else if (parsed?.type === "RIDE_LOCATION_UNSUBSCRIBE") {
          handleRideLocationUnsubscribe(parsed);
        } else if (parsed?.type === "RIDE_TRACKING_SUBSCRIBE") {
          await handleRideTrackingSubscribe(parsed);
        } else if (parsed?.type === "RIDE_TRACKING_UNSUBSCRIBE") {
          handleRideTrackingUnsubscribe(parsed);
        }
      } catch {
        // ignore malformed client control frame
      }
    });

    ws.on("close", cleanup);
    ws.on("error", cleanup);
  }

  /**
   * Dispatches a typed realtime event to an active passenger session.
   */
  sendToRideRequestUser(userId: string, type: ServerMessageType, payload: any): void {
    const transports = this.rideRequestUserSubscribers.get(userId);
    if (!transports || transports.size === 0) return;

    for (const transport of transports) {
      if (transport.isOpen()) {
        transport.send(type, payload);
      }
    }
  }

  /**
   * Dispatches a typed realtime event to an active driver session.
   */
  sendToRideRequestDriver(driverProfileId: string, type: ServerMessageType, payload: any): void {
    const transports = this.rideRequestDriverSubscribers.get(driverProfileId);
    if (!transports || transports.size === 0) return;

    for (const transport of transports) {
      if (transport.isOpen()) {
        transport.send(type, payload);
      }
    }
  }

  /**
   * Dispatches a typed realtime event to an active passenger session for ride lifecycle.
   */
  sendToRideUser(userId: string, type: ServerMessageType, payload: any): void {
    this.sendToRideRequestUser(userId, type, payload);
  }

  /**
   * Dispatches a typed realtime event to an active driver session for ride lifecycle.
   */
  sendToRideDriver(driverProfileId: string, type: ServerMessageType, payload: any): void {
    this.sendToRideRequestDriver(driverProfileId, type, payload);
  }

  /**
   * Phase 10: Dispatches targeted live driver GPS updates strictly to authorized subscribers of a specific Ride.
   */
  sendToRideLocationSubscribers(rideId: string, payload: DriverLocationUpdatedPayload): void {
    const transports = this.rideLocationSubscribers.get(rideId);
    if (!transports || transports.size === 0) return;

    for (const transport of transports) {
      if (transport.isOpen()) {
        transport.send("DRIVER_LOCATION_UPDATED", payload);
      }
    }
  }

  /**
   * Phase 11: Dispatches authoritative live ride tracking updates to subscribers of a specific Ride.
   */
  sendToRideTrackingSubscribers(rideId: string, payload: any): void {
    const transports = this.rideTrackingSubscribers.get(rideId);
    if (!transports || transports.size === 0) return;

    for (const transport of transports) {
      if (transport.isOpen()) {
        transport.send("RIDE_TRACKING_UPDATED", payload);
      }
    }
  }

  /**
   * Phase 11: Ends live tracking for a ride (e.g. COMPLETED or CANCELLED) and notifies subscribers.
   */
  notifyRideTrackingEnded(rideId: string, status: string, reason?: string): void {
    const transports = this.rideTrackingSubscribers.get(rideId);
    if (!transports || transports.size === 0) return;

    const payload: RideTrackingEndedPayload = {
      rideId,
      status,
      reason,
      timestamp: new Date().toISOString(),
    };

    for (const transport of transports) {
      if (transport.isOpen()) {
        transport.send("RIDE_TRACKING_ENDED", payload);
      }
    }

    this.rideTrackingSubscribers.delete(rideId);
  }

  /**
   * Phase 17: Dispatches authoritative payment confirmation to the driver/conductor realtime channel.
   * Realtime is purely an asynchronous synchronization notification.
   */
  emitDriverPaymentConfirmed(
    driverProfileId: string,
    payload: {
      rideId: string;
      paymentId: string;
      grossAmountMinor: number;
      currency: string;
      capturedAt: string;
      providerPaymentId?: string | null;
    }
  ): void {
    this.sendToRideDriver(driverProfileId, "driver:payment_confirmed", payload);
  }

  getWebSocketServer(): WebSocketServer {
    return this.wss;
  }
}

export const realtimeGateway = new RealtimeGateway();
