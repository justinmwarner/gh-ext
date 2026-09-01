/**
 * The canary for the `ui` Vitest project.
 *
 * It asserts nothing about this extension. It asserts that a React component
 * can be rendered and queried at all — that jsdom is the environment, that TSX
 * is transformed with the automatic JSX runtime, and that Testing Library can
 * see what React produced. When every other UI test fails at once, this one
 * says whether the cause is the code or the harness.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

function Greeting({ name }: { name: string }) {
  return <p>Hello, {name}.</p>;
}

describe('the ui test environment', () => {
  it('renders a component into a document', () => {
    render(<Greeting name="reviewer" />);
    expect(screen.getByText('Hello, reviewer.')).toBeDefined();
  });
});
