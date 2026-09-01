/**
 * Per-test teardown for the `ui` suite.
 *
 * Testing Library registers its own `afterEach(cleanup)` only when Vitest is
 * running with globals, and this project is not. Without this file each test
 * renders on top of the DOM the previous one left behind, and `getByRole`
 * starts reporting that it found two of everything.
 */

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);
