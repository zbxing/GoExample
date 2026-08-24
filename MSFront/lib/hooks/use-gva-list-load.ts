'use client';

import { useEffect, type DependencyList } from 'react';
import { isGvaPageLeaving, subscribeGvaPageLeaveEnd } from '@/lib/utils/gva-page-leave';

/**
 * 对齐 GVA `transition mode="out-in"`：
 * 列表数据在旧页离场结束后再请求（相当于新页 setup 里调 getTableData）。
 * 同页刷新（搜索/分页/CRUD）时不在离场中，会立即执行。
 */
export function useGvaListLoad(
  load: () => void | (() => void),
  deps: DependencyList,
) {
  useEffect(() => {
    let cancelled = false;
    let cleanup: void | (() => void);
    let unsubscribeLeave: (() => void) | undefined;

    function run() {
      if (cancelled) {
        return;
      }
      cleanup = load();
    }

    if (isGvaPageLeaving()) {
      unsubscribeLeave = subscribeGvaPageLeaveEnd(() => {
        unsubscribeLeave?.();
        unsubscribeLeave = undefined;
        run();
      });
    } else {
      run();
    }

    return () => {
      cancelled = true;
      unsubscribeLeave?.();
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller owns deps
  }, deps);
}
