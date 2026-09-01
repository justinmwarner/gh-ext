/**
 * Opening the options page.
 *
 * Its own module rather than a line inside the setup state, because it is the
 * second place `ui/` touches the extension APIs and tests need to replace it
 * without also replacing the messaging transport.
 */

import { browser } from 'wxt/browser';

export function openOptions(): void {
  // Fire and forget: the tab either opens or it does not, and there is nothing
  // useful the setup state could say about the difference.
  void browser.runtime.openOptionsPage();
}
