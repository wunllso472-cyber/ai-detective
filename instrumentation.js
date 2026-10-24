// Next.js 启动时执行一次：在 Node 运行时里启动盯梢调度
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startWatchScheduler } = await import('./core/watch.mjs');
    startWatchScheduler();
  }
}
