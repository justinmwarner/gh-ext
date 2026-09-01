/**
 * The review page's only way to reach the outside world.
 *
 * The background worker holds the token, the `GitHubClient` and the cache, so
 * the review page never calls `fetch` — it asks the worker and renders the
 * reply. Keeping that in one module means "does the UI talk to GitHub directly"
 * is answerable by reading one file, and gives tests a single seam to mock.
 */

import { browser } from 'wxt/browser';
import {
  type MessageKind,
  type MessageOf,
  type Ok,
  type ResponseOf,
  isErr,
} from '@/lib/messages';

/**
 * Send a request and get its reply.
 *
 * The cast below is the one point where the protocol's types stop being
 * enforced — nothing at runtime proves the worker's reply matches `ResultOf<K>`
 * — so it is confined here and every caller above it stays type-safe.
 *
 * This never rejects. A dead worker is a state the page has to render, not an
 * exception every call site has to remember to catch.
 */
export async function request<K extends MessageKind>(
  msg: MessageOf<K>,
): Promise<ResponseOf<K>> {
  let reply: unknown;
  try {
    reply = await browser.runtime.sendMessage(msg);
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: 'unknown',
        message: error instanceof Error ? error.message : String(error),
        resetAt: null,
      },
    };
  }

  if (isErr(reply)) return reply;
  if (typeof reply === 'object' && reply !== null && (reply as Ok<unknown>).ok === true) {
    return reply as ResponseOf<K>;
  }

  return {
    ok: false,
    error: {
      kind: 'unknown',
      // sendMessage resolves undefined when the worker failed to start.
      message: 'The background worker did not reply. Try reloading the extension.',
      resetAt: null,
    },
  };
}
