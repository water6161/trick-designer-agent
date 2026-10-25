"""高德开放平台查询：特殊设定包含真实地名时，取当地天气增强环境细节。

仅用于虚构剧本的环境质感（海拔/气候/季节细节），输出仍遵循"虚构不可复刻"边界。
不引入新依赖，用 urllib + asyncio.to_thread，单请求短超时，失败静默降级。
"""

from __future__ import annotations

import asyncio
import json
import re
import urllib.parse
import urllib.request
from typing import Any

_TIMEOUT_SECONDS = 12

# 行政区划（市/县/区/镇/村/自治州）才用于天气查询；纯地貌名（山/岛/湖）geocode 易跑偏，不查
_ADMIN_PLACE_PATTERN = re.compile(r"[\u4e00-\u9fa5]{2,6}?(?:自治州|市|县|区|镇|村)")
_STRIP_WORDS = re.compile(r"^(?:在|的|去|往|位于|附近|边上|旁边)+")


def extract_place(text: str) -> str:
    """从特殊设定文本中提取第一个像真实行政区划地名的词；无则返回空。"""
    if not text:
        return ""
    for match in _ADMIN_PLACE_PATTERN.finditer(text):
        word = match.group(0)
        # 去掉粘连的前置修饰：如 "山附近的二道白河镇" → "二道白河镇"
        if "附近的" in word:
            word = word.rsplit("附近的", 1)[-1]
        word = _STRIP_WORDS.sub("", word)
        # 残留的 "近的/边的" 等截断修饰
        word = re.sub(r"^.{0,2}的", "", word)
        if len(word) >= 2:
            return word
    return ""


def _http_get_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": "trick-designer-agent/1.0"})
    with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8", errors="replace"))


async def _get_json(url: str) -> dict[str, Any]:
    return await asyncio.to_thread(_http_get_json, url)


async def fetch_weather_note(amap_key: str, place: str) -> dict[str, Any] | None:
    """地名 → adcode → 实况+预报天气。任何一步失败返回 None。"""
    if not amap_key or not place:
        return None
    try:
        geo_url = "https://restapi.amap.com/v3/geocode/geo?" + urllib.parse.urlencode(
            {"key": amap_key, "address": place}
        )
        geo = await _get_json(geo_url)
        geocodes = geo.get("geocodes") or []
        if geo.get("status") != "1" or not geocodes:
            return None
        adcode = str(geocodes[0].get("adcode") or "")
        district = str(geocodes[0].get("district") or place)
        if not adcode:
            return None

        weather_url = "https://restapi.amap.com/v3/weather/weatherInfo?" + urllib.parse.urlencode(
            {"key": amap_key, "city": adcode, "extensions": "all"}
        )
        weather = await _get_json(weather_url)
        forecasts = weather.get("forecasts") or []
        if weather.get("status") != "1" or not forecasts:
            return None
        forecast = forecasts[0]
        casts = forecast.get("casts") or []
        if not casts:
            return None

        day = casts[0]
        summary = (
            f"{district}近期天气参考：白天{day.get('dayweather', '')} {day.get('daytemp', '')}℃ / "
            f"夜间{day.get('nightweather', '')} {day.get('nighttemp', '')}℃，"
            f"风力 {day.get('daypower', '')} 级；"
        )
        if len(casts) > 1:
            nxt = casts[1]
            summary += f"次日{nxt.get('dayweather', '')}，温差约 {abs(int(day.get('daytemp', 0) or 0) - int(nxt.get('daytemp', 0) or 0))}℃。"

        return {
            "title": f"高德天气·{district}",
            "snippet": summary + "（真实气象仅用于环境细节质感，剧本时间线为虚构，不要求与真实天气一致）",
            "href": "",
            "source": "amap",
        }
    except Exception:
        return None
