import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

describe('test environment', () => {
  it('renders a React component', () => {
    render(<div>hello</div>);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });
});
