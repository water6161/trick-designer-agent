"""用户级限流的单元测试。"""

import sys
import time

sys.path.insert(0, ".")

from agents._lib.app import _RATE_BUCKETS, _RATE_LIMIT_RULES, _check_rate_limit


def setup_function():
    _RATE_BUCKETS.clear()


class TestRateLimit:
    def test未超限时放行(self):
        for _ in range(_RATE_LIMIT_RULES["generate"][0]):
            assert _check_rate_limit("user-aaaaaa", "generate") == 0

    def test超出额度后返回等待秒数(self):
        limit = _RATE_LIMIT_RULES["generate"][0]
        for _ in range(limit):
            _check_rate_limit("user-bbbbbb", "generate")
        wait = _check_rate_limit("user-bbbbbb", "generate")
        assert wait > 0
        assert wait <= _RATE_LIMIT_RULES["generate"][1] + 1

    def test不同用户互不影响(self):
        limit = _RATE_LIMIT_RULES["generate"][0]
        for _ in range(limit):
            _check_rate_limit("user-cccccc", "generate")
        assert _check_rate_limit("user-cccccc", "generate") > 0
        assert _check_rate_limit("user-dddddd", "generate") == 0

    def test不同类别分别计数(self):
        limit = _RATE_LIMIT_RULES["ai_cover"][0]
        for _ in range(limit):
            _check_rate_limit("user-eeeeee", "ai_cover")
        assert _check_rate_limit("user-eeeeee", "ai_cover") > 0
        # 生图用满不影响生成
        assert _check_rate_limit("user-eeeeee", "generate") == 0

    def test匿名用户额度放宽(self):
        normal = _RATE_LIMIT_RULES["generate"][0]
        for _ in range(normal):
            assert _check_rate_limit("anonymous", "generate") == 0
        # 普通用户此刻已被限，匿名还有余量
        assert _check_rate_limit("anonymous", "generate") == 0

    def test窗口过期后重新放行(self):
        key = "generate:user-ffffff"
        limit, window = _RATE_LIMIT_RULES["generate"]
        # 手工塞入一组早已过期的记录
        _RATE_BUCKETS[key] = [time.time() - window - 10 for _ in range(limit)]
        assert _check_rate_limit("user-ffffff", "generate") == 0

    def test未知类别不影响主流程(self):
        # 内部异常必须放行（这里用非法 kind 触发 KeyError 分支）
        assert _check_rate_limit("user-gggggg", "unknown-kind") == 0

    def test桶数量膨胀时自动清理(self):
        for i in range(210):
            _RATE_BUCKETS[f"generate:stale-{i}"] = [time.time() - 5000]
        _check_rate_limit("user-hhhhhh", "generate")
        assert len(_RATE_BUCKETS) < 210
