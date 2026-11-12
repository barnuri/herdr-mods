import { stat } from 'node:fs/promises';
import type { StateStore } from './stateStore.ts';

/** Follows the messages a pane sends back (`ui.send`), from the end of the file at the time it starts. */
export class MessageWatcher {
  private static readonly POLL_MS = 250;

  static watch(store: StateStore, path: string, handler: (message: unknown) => void): () => void {
    let offset = -1;
    let isReading = false;
    const timer = setInterval(async () => {
      if (isReading) {
        return;
      }
      isReading = true;
      try {
        if (offset < 0) {
          offset = await stat(path).then((info) => info.size).catch(() => 0);
          return;
        }
        const next = await store.readMessages(path, offset);
        offset = next.offset;
        for (const message of next.messages) {
          handler(message);
        }
      } finally {
        isReading = false;
      }
    }, MessageWatcher.POLL_MS);
    return () => clearInterval(timer);
  }
}
