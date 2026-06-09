/**
 * 单生产者/单消费者异步队列。
 *
 * 反向通道把对端推来的事件（无背压的 ws message 回调）转成 `for await` 可消费的拉取流：
 * 生产者 `push()` 入队，消费者 `pull()` 取，`close()` 标记结束。用于 RemoteAgentAdapter
 * 把一次 run 的 AgentEvent 流逐条交给上层 runTurn。
 */
export class AsyncQueue<T> {
    private readonly items: T[] = []
    private resolvers: Array<(r: IteratorResult<T>) => void> = []
    private closed = false

    push(item: T): void {
        if (this.closed) return
        const resolve = this.resolvers.shift()
        if (resolve) resolve({ value: item, done: false })
        else this.items.push(item)
    }

    close(): void {
        if (this.closed) return
        this.closed = true
        for (const resolve of this.resolvers) resolve({ value: undefined, done: true })
        this.resolvers = []
    }

    private pull(): Promise<IteratorResult<T>> {
        if (this.items.length > 0) {
            return Promise.resolve({ value: this.items.shift() as T, done: false })
        }
        if (this.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => this.resolvers.push(resolve))
    }

    async *[Symbol.asyncIterator](): AsyncIterator<T> {
        while (true) {
            const next = await this.pull()
            if (next.done) return
            yield next.value
        }
    }
}
