import { randomUUID } from 'node:crypto'

/**
 * Minimal in-memory TypeORM-Repository stand-in for unit tests (create / save /
 * findOne / find / update). Not exhaustive — only what the group services use.
 */
export function makeRepo() {
    const store: Record<string, unknown>[] = []
    const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
        Object.keys(where).every((k) => row[k] === where[k])

    const repo = {
        store,
        create: (o: Record<string, unknown>) => ({ ...o }),
        save: async (o: Record<string, unknown> | Record<string, unknown>[]): Promise<unknown> => {
            if (Array.isArray(o)) {
                const out: unknown[] = []
                for (const x of o) out.push(await repo.save(x))
                return out
            }
            if (!o.id) o.id = randomUUID()
            if (!o.createdAt) o.createdAt = new Date()
            o.updatedAt = new Date()
            const idx = store.findIndex((r) => r.id === o.id)
            if (idx >= 0) store[idx] = o
            else store.push(o)
            return o
        },
        findOne: async ({ where }: { where: Record<string, unknown> }) =>
            store.find((r) => matches(r, where)) ?? null,
        find: async (
            opts: {
                where?: Record<string, unknown>
                order?: Record<string, 'ASC' | 'DESC'>
                take?: number
                skip?: number
            } = {}
        ) => {
            let rows = opts.where ? store.filter((r) => matches(r, opts.where!)) : [...store]
            if (opts.order) {
                const [k, dir] = Object.entries(opts.order)[0]
                rows = [...rows].sort(
                    (a, b) => ((a[k] as number) > (b[k] as number) ? 1 : -1) * (dir === 'DESC' ? -1 : 1)
                )
            }
            if (opts.skip) rows = rows.slice(opts.skip)
            if (opts.take) rows = rows.slice(0, opts.take)
            return rows
        },
        update: async (where: Record<string, unknown>, patch: Record<string, unknown>) => {
            for (const r of store.filter((x) => matches(x, where))) Object.assign(r, patch)
        }
    }
    return repo
}

/** Minimal ioredis stand-in (get/set), ignores EX/NX args. */
export function makeFakeRedis() {
    const map = new Map<string, string>()
    return {
        get: async (k: string) => map.get(k) ?? null,
        set: async (k: string, v: string) => {
            map.set(k, v)
            return 'OK'
        }
    }
}
