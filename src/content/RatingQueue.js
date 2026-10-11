// A small viewport-prioritized queue. Running reads finish; abandoned queued
// reads never start, and their resolver stops between network stages.
(function (root) {
  root.createRatingQueue = function (limit = 4) {
    let pending = [], running = new Set(), scheduled = false;
    const priority = node => {
      if (!node?.isConnected) return Infinity;
      const r = node.getBoundingClientRect();
      // display:none cards (including hidden layout wrappers) have an empty
      // rectangle at the origin. They are not visible, but still get resolved
      // after rendered cards so unrated titles can eventually pass a filter.
      if (r.right <= r.left || r.bottom <= r.top) return Infinity;
      const horizontal = Math.max(0, -r.right, r.left - root.innerWidth);
      const vertical = Math.max(0, -r.bottom, r.top - root.innerHeight);
      return Math.hypot(horizontal, vertical);
    };
    function drain() {
      scheduled = false;
      pending.sort((a, b) => priority(a.node) - priority(b.node));
      while (running.size < limit && pending.length) {
        const job = pending.shift();
        if (!job.node.isConnected) { job.resolve(null); continue; }
        running.add(job);
        Promise.resolve().then(() => job.work(job.controller.signal)).then(job.resolve, job.reject)
          .finally(() => { running.delete(job); schedule(); });
      }
    }
    function schedule() { if (!scheduled) { scheduled = true; Promise.resolve().then(drain); } }
    return {
      add(node, work) { return new Promise((resolve, reject) => { pending.push({ node, work, resolve, reject, controller: new AbortController() }); schedule(); }); },
      clear() { for (const job of pending) { job.controller.abort(); job.resolve(null); } pending = []; for (const job of running) job.controller.abort(); },
      reprioritize: schedule
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
