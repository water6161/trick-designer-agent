"""剧本杀诡计设计师 Agent：POST /trick-designer

平台按目录名生成路由，业务实现放在私有包 agents/_lib/ 中。
"""

from __future__ import annotations

import sys
from pathlib import Path

_AGENTS_DIR = str(Path(__file__).resolve().parents[1])
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

from _lib.app import handler  # noqa: E402,F401
