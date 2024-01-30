export async function promiseAllWithLimit<T>(
  maxParallelism: number,
  workToDo: (() => Promise<T>)[]
): Promise<Awaited<T>[]> {
  console.log(
    `promiseAllWithLimit(maxParallelism=${maxParallelism}, workToDo=${workToDo.length})`
  );
  const res: Awaited<T>[] = [];
  let cursor = workToDo.entries();
  const par = Array(maxParallelism)
    .fill(null)
    .map((asyncThreadIndex) =>
      (async () => {
        for (let [index, work] of cursor) {
          var r: Awaited<T> = await work();
          res.push(r);
        }
      })()
    );
  await Promise.all(par);
  return res;
}

export async function promiseAllWithLimitByServer<T>(
  maxParallelism: number,
  workTodoByServer: Record<string, (() => Promise<T>)[]>
): Promise<Awaited<T>[]> {
  console.log(
    `promiseAllWithLimitByServer(maxParallelism=${maxParallelism}, workTodoByServer=${workTodoByServer.length})`
  );
  const res: Awaited<T>[] = [];
  const fullServerPromises: Promise<Awaited<T>[]>[] = [];
  for (const promises of Object.values(workTodoByServer)) {
    fullServerPromises.push(promiseAllWithLimit(maxParallelism, promises));
  }
  const allRes = await Promise.all(fullServerPromises);
  for (const r of allRes) {
    res.push(...r);
  }
  return res;
}
