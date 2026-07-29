/**
 * AddressDisplay.test.tsx
 *
 * Unit tests for the AddressDisplay component.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { AddressDisplay } from './AddressDisplay';

const FULL_ADDRESS = 'GABC1234567890WXYZ1234567890ABCDE1234567890WXYZ1234567890AB';

describe('AddressDisplay', () => {
  describe('when no label is found', () => {
    const noLabel = () => null;

    it('renders the truncated address', () => {
      render(<AddressDisplay address={FULL_ADDRESS} getLabel={noLabel} truncateLen={4} />);
      // FULL_ADDRESS is 59 chars; slice(0,4)='GABC', slice(-4)='90AB'
      expect(screen.getByText('GABC…90AB')).toBeInTheDocument();
    });

    it('includes the full address in title attribute', () => {
      render(<AddressDisplay address={FULL_ADDRESS} getLabel={noLabel} />);
      const el = screen.getByTitle(FULL_ADDRESS);
      expect(el).toBeInTheDocument();
    });

    it('includes aria-label with full address', () => {
      render(<AddressDisplay address={FULL_ADDRESS} getLabel={noLabel} />);
      expect(screen.getByLabelText(`Address: ${FULL_ADDRESS}`)).toBeInTheDocument();
    });

    it('applies the font-mono class', () => {
      const { container } = render(
        <AddressDisplay address={FULL_ADDRESS} getLabel={noLabel} />,
      );
      expect(container.firstChild).toHaveClass('font-mono');
    });
  });

  describe('when a label is found', () => {
    const withLabel = () => 'Netflix Merchant';

    it('renders the label text', () => {
      render(<AddressDisplay address={FULL_ADDRESS} getLabel={withLabel} />);
      expect(screen.getByText('Netflix Merchant')).toBeInTheDocument();
    });

    it('also renders the truncated address as a subtitle', () => {
      render(
        <AddressDisplay address={FULL_ADDRESS} getLabel={withLabel} truncateLen={6} />,
      );
      // FULL_ADDRESS is 59 chars; slice(0,6)='GABC12', slice(-6)='7890AB'
      expect(screen.getByText(/GABC12…7890AB/)).toBeInTheDocument();
    });

    it('includes the full address in the title attribute', () => {
      render(<AddressDisplay address={FULL_ADDRESS} getLabel={withLabel} />);
      const el = screen.getByTitle(FULL_ADDRESS);
      expect(el).toBeInTheDocument();
    });

    it('has an aria-label combining label and full address', () => {
      render(<AddressDisplay address={FULL_ADDRESS} getLabel={withLabel} />);
      expect(
        screen.getByLabelText(`Netflix Merchant (${FULL_ADDRESS})`),
      ).toBeInTheDocument();
    });
  });

  describe('truncation', () => {
    const noLabel = () => null;

    it('uses 6 as the default truncateLen', () => {
      render(<AddressDisplay address={FULL_ADDRESS} getLabel={noLabel} />);
      // Default truncateLen=6: slice(0,6)='GABC12', slice(-6)='7890AB'
      const expected = `${FULL_ADDRESS.slice(0, 6)}…${FULL_ADDRESS.slice(-6)}`;
      expect(screen.getByText(expected)).toBeInTheDocument();
    });

    it('respects a custom truncateLen', () => {
      render(
        <AddressDisplay address={FULL_ADDRESS} getLabel={noLabel} truncateLen={4} />,
      );
      // slice(0,4)='GABC', slice(-4)='90AB'
      const expected = `${FULL_ADDRESS.slice(0, 4)}…${FULL_ADDRESS.slice(-4)}`;
      expect(screen.getByText(expected)).toBeInTheDocument();
    });
  });

  describe('extra className', () => {
    it('applies extra className to the wrapper element', () => {
      const { container } = render(
        <AddressDisplay
          address={FULL_ADDRESS}
          getLabel={() => null}
          className="text-green-400"
        />,
      );
      expect(container.firstChild).toHaveClass('text-green-400');
    });
  });
});
