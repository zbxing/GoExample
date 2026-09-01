'use client';

import { useEffect, type DependencyList } from 'react';
import { beginFnaListAwaiting, endFnaListAwaiting } from '@/lib/utils/fna-page-loading';
import { isFnaPageLeaving, subscribeFnaPageLeaveEnd } from '@/lib/utils/fna-page-leave';

/**
 * 对齐 gin-vue-admin `transition mode="out-in"`：
 * 列表数据在旧页离场结束后再请求（相当于新页 setup 里调 getTableData）。
 * 同页刷新（搜索/分页/CRUD）时不在离场中，会立即执行。
 *
 * 开始等待时立刻 beginFnaListAwaiting，避免表格先闪「暂无数据」。
 */
export function useFnaListLoad(
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
      beginFnaListAwaiting();
      cleanup = load();
    }

    if (isFnaPageLeaving()) {
      unsubscribeLeave = subscribeFnaPageLeaveEnd(() => {
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
      endFnaListAwaiting();
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller owns deps
  }, deps);
}
