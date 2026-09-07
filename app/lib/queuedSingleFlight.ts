type QueuedRun<Argument, Result> = {
  argument: Argument;
  promise: Promise<Result>;
  resolve: (value: Result) => void;
  reject: (reason?: unknown) => void;
};

/** Run one worker at a time and collapse calls made in flight into one trailing run. */
export function createQueuedSingleFlight<Argument, Result>(worker: (argument: Argument) => Promise<Result>) {
  let active: Promise<Result> | null = null;
  let queued: QueuedRun<Argument, Result> | null = null;

  const start = (argument: Argument): Promise<Result> => {
    const run = worker(argument);
    active = run;
    const finish = () => {
      if (active !== run) return;
      active = null;
      const trailing = queued;
      queued = null;
      if (trailing) start(trailing.argument).then(trailing.resolve, trailing.reject);
    };
    void run.then(finish, finish);
    return run;
  };

  return (argument: Argument): Promise<Result> => {
    if (!active) return start(argument);
    if (!queued) {
      let resolve!: (value: Result) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<Result>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
      });
      queued = { argument, promise, resolve, reject };
    } else {
      queued.argument = argument;
    }
    return queued.promise;
  };
}
