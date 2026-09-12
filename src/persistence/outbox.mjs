import { createHash } from 'node:crypto';
import { renderSession } from '../discord/render.mjs';

export class Outbox {
  constructor(store, discord) { this.store = store; this.discord = discord; this.busy = false; }
  panelKey(sessionId) { return `outbox.panel.${sessionId}`; }
  async publish(item, payload, marker) {
    const isPanel = item.payload?.trpgSession && !item.payload?.history;
    const panel = isPanel ? this.store.getValue(this.panelKey(item.session_id)) : null;
    if (panel && this.discord.request) {
      try {
        return await this.discord.request(`/channels/${item.channel_id}/messages/${panel}`, 'PATCH', payload);
      } catch (error) {
        if (error.status !== 404) throw error;
        this.store.setValue(this.panelKey(item.session_id), null);
      }
    }
    const message = await this.discord.send(item.channel_id, payload, createHash('sha256').update(item.id).digest('hex').slice(0, 24));
    if (isPanel && message?.id) this.store.setValue(this.panelKey(item.session_id), message.id);
    return message;
  }
  async flush(now = Date.now()) {
    if (this.busy) return;
    this.busy = true;
    try {
      const blocked = new Set();
      for (const item of this.store.pending(now)) {
        if (blocked.has(item.channel_id)) continue;
        const marker = `[trpg:${item.id}]`;
        try {
            if (['SENDING','UNKNOWN'].includes(item.status)) {
              const found = await this.discord.find(item.channel_id, marker);
            if (found) {
              if (item.payload?.trpgSession && !item.payload?.history) this.store.setValue(this.panelKey(item.session_id), found.id);
              this.store.delivery(item.id, 'SENT', { messageId: found.id }); continue;
            }
            // A timed-out POST might have succeeded. Do not blindly repeat it.
            // An existing panel can be safely re-PATCHed because PATCH is
            // idempotent for the desired current state.
            const panel = item.payload?.trpgSession && !item.payload?.history ? this.store.getValue(this.panelKey(item.session_id)) : null;
            if (panel && this.discord.request) {
              const { trpgSession, history, actionControls, ...body } = item.payload;
              const payload = trpgSession ? renderSession(trpgSession, body.content, { actionControls: actionControls !== false }) : body;
              payload.content = `${String(payload.content || '').slice(0, 1840)}\n${marker}`;
              await this.discord.request(`/channels/${item.channel_id}/messages/${panel}`, 'PATCH', payload);
              this.store.delivery(item.id, 'SENT', { messageId: panel }); continue;
            }
            this.store.delivery(item.id, 'UNKNOWN', { nextAt: now + 60000 }); blocked.add(item.channel_id); continue;
          }
          const { trpgSession, history, actionControls, ...body } = item.payload;
          const payload = trpgSession ? renderSession(trpgSession, body.content, { actionControls: actionControls !== false }) : body;
          payload.content = `${String(payload.content || '').slice(0, 1840)}\n${marker}`;
          this.store.delivery(item.id, 'SENDING');
          const message = await this.publish(item, payload, marker);
          this.store.delivery(item.id, 'SENT', { messageId: message.id });
        } catch (error) {
          const status = error.status || error.statusCode;
          const state = status === 429 ? 'READY' : status >= 400 && status < 500 ? 'FAILED' : 'UNKNOWN';
          this.store.delivery(item.id, state, { nextAt: now + 60000 });
          // A definitive client-side rejection cannot be reconciled and must
          // not hold newer messages in the same channel.  Rate limits and
          // uncertain transport failures still preserve channel ordering.
          if (state !== 'FAILED') blocked.add(item.channel_id);
          console.error(`Discord 발송 보류: ${state} (${status || '연결 오류'})`);
        }
      }
    } finally { this.busy = false; }
  }
}
