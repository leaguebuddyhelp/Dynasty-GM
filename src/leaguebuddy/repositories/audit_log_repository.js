import { appendAuditEvent, buildActorFromInteraction, listRecentAuditEvents } from '../audit.js';

export function append(event) {
  return appendAuditEvent(event);
}

export { buildActorFromInteraction };
export { listRecentAuditEvents };

export default {
  append,
  buildActorFromInteraction,
  listRecentAuditEvents,
};
