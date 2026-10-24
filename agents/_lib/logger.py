"""轻量日志：输出到 stdout/stderr，由 Makers 运行时统一采集。"""

from __future__ import annotations

import json
import sys
import traceback


class Logger:
    def __init__(self, name: str):
        self.name = name

    def _write(self, level: str, *args: object) -> None:
        parts = []
        for item in args:
            if isinstance(item, str):
                parts.append(item)
            else:
                try:
                    parts.append(json.dumps(item, ensure_ascii=False, default=str))
                except Exception:
                    parts.append(str(item))
        line = f"[trick-designer:{self.name}] {level} " + " ".join(parts)
        print(line, file=sys.stderr if level in {"ERROR", "WARN"} else sys.stdout, flush=True)

    def log(self, *args: object) -> None:
        self._write("INFO", *args)

    def warn(self, *args: object) -> None:
        self._write("WARN", *args)

    def error(self, *args: object) -> None:
        self._write("ERROR", *args)

    def exception(self, message: str, exc: BaseException) -> None:
        self.error(message, f"{type(exc).__name__}: {exc}")
        traceback.print_exc(file=sys.stderr)


def create_logger(name: str) -> Logger:
    return Logger(name)
