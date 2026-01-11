export interface ResourcePool {
  name: string;
  current: number;
  max: number;
}

export function spendResource(pool: ResourcePool, amount: number): ResourcePool {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error(`Invalid spend amount: ${amount}`);
  }
  if (pool.current < amount) {
    throw new Error(`Insufficient ${pool.name}: ${pool.current} < ${amount}`);
  }
  return { ...pool, current: pool.current - amount };
}
