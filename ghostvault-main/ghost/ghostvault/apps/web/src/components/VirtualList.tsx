import { useState, useEffect, useRef, useMemo } from 'react';

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  containerHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  overscan?: number;
}

/**
 * Virtual scrolling component for large lists
 * Only renders visible items for better performance
 */
export default function VirtualList<T>({
  items,
  itemHeight,
  containerHeight,
  renderItem,
  overscan = 5,
}: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Calculate visible range
  const visibleRange = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
      items.length - 1,
      Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
    );
    return { startIndex, endIndex };
  }, [scrollTop, itemHeight, containerHeight, overscan, items.length]);

  // Handle scroll events
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  // Get visible items
  const visibleItems = useMemo(() => {
    return items.slice(visibleRange.startIndex, visibleRange.endIndex + 1);
  }, [items, visibleRange]);

  // Calculate total height
  const totalHeight = items.length * itemHeight;

  // Calculate offset for visible items
  const offsetY = visibleRange.startIndex * itemHeight;

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      style={{
        height: containerHeight,
        overflow: 'auto',
        position: 'relative',
      }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            top: offsetY,
            left: 0,
            right: 0,
          }}
        >
          {visibleItems.map((item, index) =>
            renderItem(item, visibleRange.startIndex + index)
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Optimized list item component with memoization
 */
export function MemoizedListItem<T>({
  item,
  index,
  renderItem,
}: {
  item: T;
  index: number;
  renderItem: (item: T, index: number) => React.ReactNode;
}) {
  return useMemo(() => renderItem(item, index), [item, index, renderItem]);
}

/**
 * Infinite scroll hook for loading more items
 */
export function useInfiniteScroll(
  loadMore: () => void,
  hasMore: boolean,
  threshold = 100
) {
  const [isLoading, setIsLoading] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasMore || isLoading) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setIsLoading(true);
          loadMore();
          // Reset loading state after a short delay
          setTimeout(() => setIsLoading(false), 500);
        }
      },
      { threshold: 0.1, rootMargin: `${threshold}px` }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => {
      observerRef.current?.disconnect();
    };
  }, [hasMore, isLoading, loadMore, threshold]);

  return { loadMoreRef, isLoading };
}

/**
 * Debounced scroll handler for performance
 */
export function useDebouncedScroll(
  callback: (scrollTop: number) => void,
  delay = 100
) {
  const [scrollTop, setScrollTop] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const newScrollTop = e.currentTarget.scrollTop;
    setScrollTop(newScrollTop);

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      callback(newScrollTop);
    }, delay);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [callback, delay]);

  return { scrollTop, handleScroll };
}
