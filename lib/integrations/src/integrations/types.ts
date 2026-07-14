export type IntegrationEventType =
  | "session.start"
  | "session.end"
  | "badge.enroll"
  | "badge.delete"
  | "auth.failure"
  | "asset.location.observed";

export type IntegrationEvent = {
  type: IntegrationEventType;
  occurredAt: number; // epoch ms
  deviceId?: string;
  userId?: string;
  badgeUid?: string;
  payload: Record<string, any>;
};
