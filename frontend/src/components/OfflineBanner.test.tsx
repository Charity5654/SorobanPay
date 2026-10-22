import { render } from '@testing-library/react';
import { useOfflineQueue } from './OfflineBanner';
import { useEffect } from 'react';

function HookHarness() {
  const { isOnline, queueItems, addItem } = useOfflineQueue();

  useEffect(() => {
    if (queueItems.length === 0) {
      addItem({ id: 'a', label: 'Test action', status: 'queued' });
    }
  }, [queueItems.length, addItem]);

  return (
    <div>
      <span data-testid="status">{isOnline ? 'online' : 'offline'}</span>
      <span data-testid="count">{queueItems.length}</span>
    </div>
  );
}

describe('useOfflineQueue', () => {
  it('registers online/offline listeners once and cleans them up on unmount', () => {
    const addSpy = jest.spyOn(window, 'addEventListener');
    const removeSpy = jest.spyOn(window, 'removeEventListener');

    const { rerender, unmount } = render(<HookHarness />);

    expect(addSpy.mock.calls.filter(([eventName]) => eventName === 'online')).toHaveLength(1);
    expect(addSpy.mock.calls.filter(([eventName]) => eventName === 'offline')).toHaveLength(1);

    rerender(<HookHarness />);

    expect(addSpy.mock.calls.filter(([eventName]) => eventName === 'online')).toHaveLength(1);
    expect(addSpy.mock.calls.filter(([eventName]) => eventName === 'offline')).toHaveLength(1);

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('online', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('offline', expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
