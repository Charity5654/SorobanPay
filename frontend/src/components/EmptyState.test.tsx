/**
 * EmptyState.test.tsx
 *
 * Unit tests for actionable EmptyState components:
 *  - EmptyFilteredResults
 *  - EmptyPlansList
 *  - EmptyAnalyticsState
 *  - EmptyWebhookList
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  EmptyFilteredResults,
  EmptyPlansList,
  EmptyAnalyticsState,
  EmptyWebhookList,
} from './EmptyState';

describe('Actionable Empty States', () => {
  it('renders EmptyFilteredResults with functional primary and secondary CTAs', () => {
    const onClear = jest.fn();
    const onReset = jest.fn();

    render(
      <EmptyFilteredResults
        onClearFilters={onClear}
        onResetSearch={onReset}
      />,
    );

    expect(screen.getByText(/no matching records found/i)).toBeInTheDocument();
    const clearBtn = screen.getByRole('button', { name: /clear filters/i });
    const resetBtn = screen.getByRole('button', { name: /reset search/i });

    fireEvent.click(clearBtn);
    expect(onClear).toHaveBeenCalledTimes(1);

    fireEvent.click(resetBtn);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('renders EmptyPlansList with actionable create and browse buttons', () => {
    const onCreate = jest.fn();
    const onBrowse = jest.fn();

    render(
      <EmptyPlansList
        onCreatePlan={onCreate}
        onImportTemplates={onBrowse}
      />,
    );

    expect(screen.getByText(/no pricing plans yet/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /create new plan/i }));
    expect(onCreate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /browse templates/i }));
    expect(onBrowse).toHaveBeenCalledTimes(1);
  });

  it('renders EmptyAnalyticsState with guide CTA', () => {
    const onGetStarted = jest.fn();

    render(<EmptyAnalyticsState onGetStarted={onGetStarted} />);

    expect(screen.getByText(/no analytics data available/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /integration guide/i }));
    expect(onGetStarted).toHaveBeenCalledTimes(1);
  });

  it('renders EmptyWebhookList with add webhook CTA', () => {
    const onAdd = jest.fn();

    render(<EmptyWebhookList onAddWebhook={onAdd} />);

    expect(screen.getByText(/no webhooks configured/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add webhook/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
