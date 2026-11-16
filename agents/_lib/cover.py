"""AI 封面 prompt 构建：把方案里的差异化素材（角色外形锚点、真实线索道具、现场）
注入生图提示词，避免「不同剧本、同一张图」。

此前 character 风格的 prompt 只有 genre/era 两个变量，构图与道具全部写死
（怀表/信件/匕首、老宅走廊与暗红帷幔），两个同题材的本会生成几乎相同的画面。
现在：
- 主角形象来自角色表「外形锚点」（年龄/发型发色/体型/服装主色/标志物）
- 道具来自线索表里的真实道具名（不再是写死的怀表）
- 场景来自死者现场的描述
- seed 与构图变体由 nonce 决定：每次生成都换一张（后端缺省给随机 nonce），
  传同一个 nonce 可复现同一张图
"""

from __future__ import annotations

import re
from typing import Any

# 线索名里这些词是「口头信息」，画出来没有实物感
_ABSTRACT_CLUE_WORDS = (
    "证词",
    "不在场",
    "时间线",
    "动机",
    "秘密",
    "证明",
    "记录",
    "口供",
    "疑点",
    "矛盾",
    "传说",
)

_MAX_SEED = 2**31 - 1

# ───────────────────────── 构图变体池 ─────────────────────────
# 单一机位/光源/色调 = 每张图都长一个样。这里每个维度给几套，
# 由 nonce 决定取哪套，保证「换一张」时构图真的会变。

_HERO_SHOTS = (
    "半身特写占据画面右侧三分之二，侧身回望镜头，眼神沉静而锐利",
    "近景胸像居中偏左，正面对镜头微抬下巴，目光越过观者",
    "三分之二身位于画面左侧，侧脸望向画外光源，神情疏离",
    "全身立于画面中央偏右，背对镜头回头看向观者，衣摆带风",
    "过肩视角，主角位于前景右下角侧脸出画，视线投向画面深处",
    "大特写只取眉眼与半张脸，其余部分没入黑暗",
    "逆光深色剪影，只余轮廓与视线方向，面部细节全部隐入暗处",
    "纯背影构图，只露出肩线与发梢的轮廓，人物正望向画面深处",
)

_LIGHTS = (
    "单一冷光从左上方打在脸侧，另半边脸沉入阴影",
    "右侧一盏暖色烛光照亮半张脸，另一侧陷进深影",
    "顶部天窗硬光垂直落下，眼窝与颧骨留下锐利阴影",
    "背后逆光勾出人物轮廓，正面只剩微弱的反射光",
)

_TONES = (
    "胶片颗粒质感，褪色色调",
    "冷凝青蓝色调，高对比",
    "暖褐复古色调，轻雾感",
    "高反差黑白摄影质感",
)

_GROUP_SHOTS = (
    "昏暗长桌旁围坐{count}人，各怀心思互不对视",
    "俯拍视角，{count}人沿长桌两侧落座，桌面烛台居中",
    "低角度平视，{count}人分列长桌两端，中央的空椅子格外扎眼",
)

_SCENE_SHOTS = (
    "广角俯视整个空间，陈设与痕迹一览无余",
    "低角度仰视，前景留一处关键物件做引导",
    "透过半开的门缝向内窥视，画面边缘被门框压暗",
)


# ───────────────────────── 画风变体池 ─────────────────────────
# 这是「换一张」时观感差异最大的维度：媒介/画种一变，整张图换了个世界。
# 每项带自己的画质后缀与反向词——写实类要排除插画，插画类要排除照片，
# 否则「水墨+排除平面插画」会互相打架，模型只能出四不像。

_MEDIA = (
    {
        "key": "cine",
        "label": "电影剧照",
        "style": "电影级实拍剧照质感，浅景深镜头语言",
        "quality": "高度写实，摄影级画质",
        "avoid": "卡通, 动漫, 二次元, 平面插画, 拼贴, 分格",
        "flat": False,
    },
    {
        "key": "hk90",
        "label": "九十年代港片",
        "style": "九十年代港产片胶片质感，暖黄褪色，颗粒与轻微漏光",
        "quality": "胶片颗粒感，复古电影画面",
        "avoid": "现代数码感, 冷蓝色调, 高清锐利",
        "flat": False,
    },
    {
        "key": "noir",
        "label": "黑白黑色电影",
        "style": "黑白黑色电影硬光摄影，浓重阴影，烟雾与百叶窗的光影切割",
        "quality": "高反差黑白，银盐颗粒",
        "avoid": "彩色, 鲜艳色彩, 明亮通透",
        "flat": False,
    },
    {
        "key": "ukiyoe",
        "label": "浮世绘",
        "style": "日式浮世绘木版画风格，扁平色块，墨线勾边，和纸纹理",
        "quality": "版画质感，色块利落分明",
        "avoid": "写实照片, 3D 渲染, 逼真皮肤, 景深虚化",
        "flat": True,
    },
    {
        "key": "ink",
        "label": "水墨写意",
        "style": "中国水墨写意风格，墨色浓淡晕染，大片留白，淡彩点缀",
        "quality": "宣纸质感，墨韵自然流动",
        "avoid": "写实照片, 3D 渲染, 浓艳色彩, 硬边线条",
        "flat": True,
    },
    {
        "key": "papercut",
        "label": "剪纸拼贴",
        "style": "多层剪纸拼贴风格，硬边轮廓，纸张纤维纹理，层叠投影",
        "quality": "手工纸艺质感，层次分明",
        "avoid": "写实照片, 3D 渲染, 平滑渐变, 景深虚化",
        "flat": True,
    },
    {
        "key": "cyberpunk",
        "label": "赛博朋克",
        "style": "赛博朋克霓虹夜景，青紫与洋红交织，雨夜湿滑反光",
        "quality": "高对比霓虹光效，细节锐利",
        "avoid": "复古暖黄, 素描, 低饱和",
        "flat": False,
    },
    {
        "key": "oil",
        "label": "古典油画",
        "style": "古典油画厚涂，明显笔触，伦勃朗式明暗对照",
        "quality": "画布纹理，颜料厚重感",
        "avoid": "写实照片, 3D 渲染, 平涂色块",
        "flat": False,
    },
    {
        "key": "screenprint",
        "label": "双色丝网印",
        "style": "极简双色丝网印刷海报，大面积平涂，轻微套版错位",
        "quality": "印刷网点质感，极简构图",
        "avoid": "写实照片, 3D 渲染, 复杂渐变, 细碎细节",
        "flat": True,
    },
    {
        "key": "wetplate",
        "label": "湿版老照片",
        "style": "十九世纪湿版摄影，棕褐单色调，边缘暗角与药膜划痕",
        "quality": "银盐质感，老照片颗粒",
        "avoid": "彩色, 现代感, 高清锐利",
        "flat": False,
    },
)

# 平面画风的配色描述：写实的那套「胶片颗粒 / 冷凝青蓝」放到木版画里会打架
_FLAT_TONES = (
    "朱红与靛蓝的克制双色",
    "墨黑与米白的单色调",
    "土黄与赭石的暖旧色板",
    "青绿与赭红的对撞色板",
)

_MEDIA_BY_KEY = {item["key"]: item for item in _MEDIA}

_MEDIA_KEYS = tuple(item["key"] for item in _MEDIA)


def resolve_media(nonce: str, media: str = "") -> dict[str, Any]:
    """确定这一张用哪种画风：显式指定优先，否则按 nonce 从池里挑。"""
    key = str(media or "").strip()
    if key in _MEDIA_BY_KEY:
        return _MEDIA_BY_KEY[key]
    return _pick(_MEDIA, nonce, 0)


def _fnv1a(text: str) -> int:
    """FNV-1a 32 位哈希（与前端 illustration.ts 的 characterSeed 同族）。"""
    h = 0x811C9DC5
    for ch in text.encode("utf-8"):
        h ^= ch
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def pick_hero(plan: dict[str, Any]) -> dict[str, str]:
    """挑封面主角：优先有外形锚点的角色，其次有身份的，再退到第一个角色。"""
    characters = [c for c in (plan.get("characters") or []) if isinstance(c, dict) and c.get("name")]
    if not characters:
        return {}
    for char in characters:
        if str(char.get("look") or "").strip():
            return char
    for char in characters:
        if str(char.get("identity") or "").strip():
            return char
    return characters[0]


def pick_prop(plan: dict[str, Any]) -> str:
    """从线索表挑一件「实物感」道具：线索名短、不含抽象词。公开线索优先。"""
    clues = list(plan.get("clues_public") or []) + list(plan.get("clues_deep") or [])
    for clue in clues:
        if not isinstance(clue, dict):
            continue
        name = str(clue.get("name") or "").strip()
        if not 2 <= len(name) <= 14:
            continue
        if any(word in name for word in _ABSTRACT_CLUE_WORDS):
            continue
        return name
    return ""


def pick_scene(plan: dict[str, Any]) -> str:
    """现场描述：优先死者小节的「现场：」行，否则取背景第一句。"""
    victim = plan.get("victim") or {}
    scene = str(victim.get("scene") or "").strip() if isinstance(victim, dict) else ""
    if scene:
        return scene[:40]
    background = str(plan.get("background") or "").strip()
    if background:
        # 第一行往往带「背景：」前缀之类，统一去掉行首标签
        first_line = background.splitlines()[0].strip()
        first_line = re.sub(r"^[^：:]{1,6}[：:]\s*", "", first_line)
        return first_line[:40]
    return ""


def _players_count(brief: dict[str, Any], plan: dict[str, Any]) -> int:
    players = str(brief.get("players") or brief.get("player_count") or "")
    match = re.search(r"(\d+)\s*人", players)
    if match:
        return max(3, min(int(match.group(1)), 8))
    characters = [c for c in (plan.get("characters") or []) if isinstance(c, dict) and c.get("name")]
    if characters:
        return max(3, min(len(characters), 8))
    return 5


def _pick(pool: tuple[str, ...], nonce: str, shift: int = 0) -> str:
    """按 nonce 从变体池取一套：同一 nonce 恒定，不同 nonce 分散。

    三个维度从同一个哈希的不同位段取值（而不是各自再哈希一次）——
    独立哈希容易在取模时撞车，出现「机位和光源同时相同」的假重复。
    """
    return pool[(_fnv1a(nonce) >> shift) % len(pool)]


def _era_part(brief: dict[str, Any]) -> str:
    era = str(brief.get("era") or brief.get("background") or "").strip()
    # brief.background 可能是整段设定，只取短句防 prompt 被灌爆
    if len(era) > 30:
        era = era[:30].rstrip("，。；,;")
    return f"，{era}背景" if era else ""


def build_cover_prompt(
    style: str,
    title: str,
    brief: dict[str, Any] | None,
    plan: dict[str, Any] | None,
    nonce: str = "",
    media: str = "",
) -> dict[str, Any]:
    """构建生图请求参数。返回 prompt / negative / seed / model / size / nonce / media。

    nonce 决定 seed 与全部变体（画风/机位/光源/色调）：每次生成传不同 nonce
    就是「换一张」，传相同 nonce 可复现同一张。缺省空串时退化为「按标题固定」。
    media 可显式指定画风（见 _MEDIA 的 key）；缺省则按 nonce 从画风池随机。

    plan/brief 缺字段时逐项优雅退化，不抛错——封面生成永远不该因为
    方案解析不全而失败。
    """
    brief = brief if isinstance(brief, dict) else {}
    plan = plan if isinstance(plan, dict) else {}
    genre = str(brief.get("genre") or "").strip()
    genre_part = f"{genre}题材" if genre else "悬疑"
    era_part = _era_part(brief)

    # 画风是观感差异最大的维度：先定它，其余变体的措辞跟着它走
    media_conf = resolve_media(nonce, media)
    media_style = media_conf["style"]
    quality = media_conf["quality"]
    is_flat = bool(media_conf["flat"])
    tone = _pick(_FLAT_TONES if is_flat else _TONES, nonce, 12)

    if style == "group":
        count = _players_count(brief, plan)
        scene = pick_scene(plan)
        scene_part = f"，{scene}" if scene else ""
        shot = _pick(_GROUP_SHOTS, nonce, 4).format(count=count)
        light = _pick(_LIGHTS, nonce, 8)
        prompt = (
            f"{media_style}，{genre_part}{era_part}悬疑群像，{shot}，"
            f"{count}人年龄性别身份各不相同、服装贴合时代背景{scene_part}，"
            f"{light}，背景深色木墙与阴影，{tone}，强烈明暗对比，"
            f"{quality}，画面留有顶部标题空间，画面中无任何文字水印"
        )
        model = "wan2.5-t2i-preview"
        size = "960*1280"
    elif style == "scene":
        scene = pick_scene(plan)
        scene_part = f"，画面核心场景：{scene}" if scene else ""
        shot = _pick(_SCENE_SHOTS, nonce, 4)
        light = _pick(_LIGHTS, nonce, 8)
        prompt = (
            f"{media_style}，{genre_part}{era_part}悬疑场景，{scene_part}，"
            f"{shot}，{light}，{tone}，细节丰富，"
            f"{quality}，画面中不要出现任何文字、字母或水印"
        )
        model = "wanx2.1-t2i-turbo"
        size = "720*960"
    else:  # character（默认）：主角人物海报
        hero = pick_hero(plan)
        look = str(hero.get("look") or "").strip() if hero else ""
        identity = str(hero.get("identity") or "").strip() if hero else ""
        # 主角描述：外形锚点是现成的生图描述（年龄/发型发色/服装主色/标志物）
        hero_desc = ""
        if identity:
            hero_desc += f"{identity}，"
        hero_desc += look if look else "一位主角"
        prop = pick_prop(plan)
        prop_desc = f"手中握着关键道具（{prop}）" if prop else "手中握着一件贴合剧情的关键道具"
        scene = pick_scene(plan)
        scene_desc = f"背景是虚化的{scene}" if scene else "背景是虚化的室内环境与暗色帷幔"
        shot = _pick(_HERO_SHOTS, nonce, 4)
        light = _pick(_LIGHTS, nonce, 8)
        prompt = (
            f"{media_style}，剧本杀悬疑海报，{genre_part}{era_part}，"
            f"{hero_desc}，{shot}，"
            f"{prop_desc}，"
            f"{light}，"
            f"{scene_desc}，强烈明暗对比，"
            f"{tone}，{quality}，画面留有干净的标题区，"
            "画面中无任何文字水印"
        )
        model = "wan2.5-t2i-preview"
        size = "960*1280"

    # 反向词与画风一致：写实类排除插画，插画类排除照片——否则互相压制出四不像
    base_negative = "文字, 字母, 水印, 血腥, 恐怖恶心, 低质量, 模糊, 变形, 多余手指"
    if not is_flat:
        base_negative += ", 面部扭曲, 脸部畸形, 五官错位"
    negative = f"{base_negative}, {media_conf['avoid']}"

    # seed 由 标题+风格+画风+nonce 决定：换剧本必换图，换画风/换 nonce 也换图，同 nonce 可复现
    seed = _fnv1a(f"{title}|{style}|{media_conf['key']}|{nonce}") % _MAX_SEED
    return {
        "prompt": prompt,
        "negative": negative,
        "seed": seed,
        "model": model,
        "size": size,
        "nonce": nonce,
        "media": media_conf["key"],
        "media_label": media_conf["label"],
    }
