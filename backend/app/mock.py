from __future__ import annotations

import textwrap
import uuid
from datetime import datetime, timezone
from typing import Any


def mock_plan(topic: str | None, question: str) -> dict[str, Any]:
    """
    无 LLM Key 时的可用回退：仍然生成符合前端/后端协议的学习流程。
    主题默认 asyncio/multiprocessing。
    """

    topic = (topic or "asyncio / multiprocessing").strip()
    outline = textwrap.dedent(
        f"""
        学习主题：{topic}
        目标：把“异步 + 多进程”融入真实项目，能正确做并发控制、超时取消、阻塞接入与性能验证。

        流程：
        1) asyncio 心智模型（事件循环/await）
        2) 任务管理（create_task/gather/异常）
        3) 超时与取消（wait_for/cancel）
        4) 限流与共享状态（Semaphore/Lock）
        5) 阻塞接入（to_thread / executor）
        6) CPU 并行（ProcessPool / multiprocessing）
        7) IO+CPU 混合流水线（asyncio + 进程池）
        """
    ).strip()

    nodes = []
    specs = [
        ("async/await 与事件循环", "理解 await 让出控制权，单线程也能并发 IO。", "写 5 个不同 sleep 的协程并发运行，验证总耗时≈最大 sleep。", 70),
        ("Task 与异常汇总", "会用 create_task/gather 管理并发任务与异常。", "并发 20 个任务，统计成功/失败与异常原因列表。", 75),
        ("超时与取消", "理解 wait_for 的取消语义与清理写法。", "实现带超时的重试器，打印每次尝试结果并最终成功或失败。", 75),
        ("限流与竞态", "会用 Semaphore 限并发、Lock 保护共享状态。", "100 个任务最多并发 8 个，验证峰值并发数不超标。", 80),
        ("阻塞接入事件循环", "会用 to_thread 把阻塞函数移出事件循环。", "心跳每 0.1s 输出不中断，同时并发跑 10 个阻塞函数。", 75),
        ("多进程并行 CPU", "知道何时用多进程绕开 GIL 并做性能对比。", "同一 CPU 密集任务对比单进程 vs 进程池耗时并解释差异。", 75),
        ("混合并发流水线", "用 asyncio 编排 IO，再把 CPU 段丢进进程池。", "异步生成输入 + 进程池处理 + 保序汇总输出。", 80),
    ]

    for idx, (title, goal, task, pass_score) in enumerate(specs, start=1):
        node_id = str(uuid.uuid4())
        hint_code = _hint_code(idx)
        nodes.append(
            {
                "node_id": node_id,
                "order": idx,
                "title": title,
                "knowledge_goal": goal,
                "practice_task": task,
                "hint_code": hint_code,
                "grading_rubric": [
                    "是否可运行且输出/耗时验证点明确",
                    "是否正确使用本知识点的关键 API",
                    "是否解释/验证了并发语义（顺序/耗时/正确性）",
                    "代码是否有基本的异常处理与边界条件",
                ],
                "pass_score": pass_score,
            }
        )
    return {"outline": outline, "nodes": nodes}


def _hint_code(i: int) -> str:
    # 不同于练习：给可迁移的模式壳（10-30 行左右，带注释）
    if i == 1:
        return textwrap.dedent(
            """
            import asyncio, time

            async def ping(tag: str, delay: float) -> str:
                # await asyncio.sleep 是“让出控制权”的典型等待点
                print(f"{tag} -> start {time.time():.2f}")
                await asyncio.sleep(delay)
                print(f"{tag} -> end   {time.time():.2f}")
                return tag

            async def main():
                t0 = time.perf_counter()
                # gather 并发等待多个协程（不是线程并行）
                out = await asyncio.gather(ping("X", 0.3), ping("Y", 0.1), ping("Z", 0.2))
                print("out:", out, "elapsed:", round(time.perf_counter() - t0, 3))

            asyncio.run(main())
            """
        ).strip()
    if i == 2:
        return textwrap.dedent(
            """
            import asyncio, random

            async def fetch(i: int) -> int:
                await asyncio.sleep(random.random() * 0.2)
                if i % 5 == 0:
                    raise RuntimeError(f"boom:{i}")
                return i * 2

            async def main():
                tasks = [asyncio.create_task(fetch(i)) for i in range(1, 8)]
                # return_exceptions=True：异常会作为结果返回，便于统一统计
                results = await asyncio.gather(*tasks, return_exceptions=True)
                for r in results:
                    print("item:", repr(r))

            asyncio.run(main())
            """
        ).strip()
    if i == 3:
        return textwrap.dedent(
            """
            import asyncio

            async def slow():
                try:
                    await asyncio.sleep(1.0)
                    return "OK"
                except asyncio.CancelledError:
                    # 超时触发取消时，做清理，然后把取消继续抛出
                    print("cancel cleanup")
                    raise

            async def main():
                task = asyncio.create_task(slow())
                try:
                    print(await asyncio.wait_for(task, timeout=0.2))
                except asyncio.TimeoutError:
                    print("timeout")
                    try:
                        await task
                    except asyncio.CancelledError:
                        print("cancel confirmed")

            asyncio.run(main())
            """
        ).strip()
    if i == 4:
        return textwrap.dedent(
            """
            import asyncio, random

            sem = asyncio.Semaphore(2)  # 限流：最多同时 2 个进入关键区
            lock = asyncio.Lock()       # 锁：保护共享变量避免竞态
            in_flight = 0

            async def work(name: str):
                global in_flight
                async with sem:
                    async with lock:
                        in_flight += 1
                        print("enter", name, "in_flight=", in_flight)
                    await asyncio.sleep(random.random() * 0.3)
                    async with lock:
                        in_flight -= 1
                        print("exit ", name, "in_flight=", in_flight)

            asyncio.run(asyncio.gather(*(work(f"W{i}") for i in range(6))))
            """
        ).strip()
    if i == 5:
        return textwrap.dedent(
            """
            import asyncio, time

            def blocking(x: int) -> int:
                # 同步阻塞函数：放在线程里跑，避免卡死事件循环
                time.sleep(0.3)
                return x * x

            async def main():
                # to_thread：把同步函数挪到线程池，返回可 await 的对象
                jobs = [asyncio.to_thread(blocking, i) for i in range(3)]
                res = await asyncio.gather(*jobs)
                print("res:", res)

            asyncio.run(main())
            """
        ).strip()
    if i == 6:
        return textwrap.dedent(
            """
            import time
            from concurrent.futures import ProcessPoolExecutor

            def cpu(n: int) -> int:
                s = 0
                for i in range(1, n):
                    s += (i * i) % 97
                return s

            if __name__ == "__main__":  # 多进程必须保护入口
                t0 = time.perf_counter()
                with ProcessPoolExecutor() as ex:
                    out = list(ex.map(cpu, [200_000, 220_000, 240_000, 260_000]))
                print("out:", out, "elapsed:", round(time.perf_counter() - t0, 3))
            """
        ).strip()
    return textwrap.dedent(
        """
        import asyncio
        from concurrent.futures import ProcessPoolExecutor

        def cpu_step(x: int) -> int:
            acc = 0
            for i in range(50_000):
                acc = (acc + x * i) % 1_000_003
            return acc

        async def main():
            loop = asyncio.get_running_loop()
            with ProcessPoolExecutor() as pool:
                futs = [loop.run_in_executor(pool, cpu_step, x) for x in [3, 5, 7]]
                out = await asyncio.gather(*futs)
            print(out)

        asyncio.run(main())
        """
    ).strip()


def mock_grade(pass_score: int, answer: str) -> dict[str, Any]:
    """
    无 LLM 时的可用评分回退：
    - 基于长度与关键字做“可解释”的伪评分，让解锁流程可跑通
    """

    a = answer.strip()
    keywords = ["asyncio", "await", "gather", "create_task", "Semaphore", "Lock", "to_thread", "ProcessPool"]
    hit = sum(1 for k in keywords if k.lower() in a.lower())
    score = min(95, 40 + len(a) // 20 + hit * 5)
    passed = score >= pass_score
    return {
        "score": int(score),
        "passed": bool(passed),
        "feedback": "（mock）基于回答长度与关键 API 关键词命中做的临时评分；配置 LLM Key 后可获得更真实的批改。",
        "strengths": ["包含了一些关键并发概念/接口" if hit else "回答结构清晰（若补充关键 API 会更好）"],
        "improvements": ["补充可验证点（耗时/顺序/正确性）", "加入异常处理/边界条件说明"],
    }

