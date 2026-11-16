"""AI 封面 prompt 构建测试：方案素材必须真的进 prompt，不同剧本必出不同图。"""

from __future__ import annotations

from agents._lib.cover import (
    build_cover_prompt,
    pick_hero,
    pick_prop,
    pick_scene,
)

PLAN = {
    "title": "雪落无声的第七夜",
    "background": "背景：暴雪封山的云顶山庄，一场寿宴变成告别。\n其余背景……",
    "victim": {"name": "顾寒山", "scene": "反锁的书房，壁炉将熄"},
    "characters": [
        {"name": "周慈", "identity": "管家", "look": ""},
        {"name": "白棠", "identity": "养女", "look": "二十五岁，黑长直发，深灰色大衣"},
        {"name": "沈墨", "identity": "医生", "look": "四十岁，花白背头，白大褂"},
    ],
    "clues_public": [
        {"id": "C1", "name": "调快的怀表", "points_to": "指向白棠"},
        {"id": "C2", "name": "白棠的证词", "points_to": "不在场证明"},
        {"id": "C3", "name": "壁炉里烧剩的信", "points_to": "作案手法"},
    ],
    "clues_deep": [{"id": "D1", "name": "内壁残留苦味的药瓶", "points_to": "毒物来源"}],
}

BRIEF = {"genre": "本格", "era": "民国", "players": "6人"}


def test_character_prompt_注入角色外形锚点() -> None:
    spec = build_cover_prompt("character", "雪落无声的第七夜", BRIEF, PLAN)
    # 外形锚点优先：第一个有 look 的角色是白棠，不是排第一的周慈
    assert "黑长直发" in spec["prompt"]
    assert "深灰色大衣" in spec["prompt"]
    assert "养女" in spec["prompt"]


def test_character_prompt_注入真实道具而非写死的怀表三件套() -> None:
    spec = build_cover_prompt("character", "雪落无声的第七夜", BRIEF, PLAN)
    assert "调快的怀表" in spec["prompt"]
    # 旧模板的写死文案不应再出现
    assert "怀表/信件/匕首" not in spec["prompt"]
    assert "老宅走廊与暗红帷幔" not in spec["prompt"]


def test_character_prompt_注入现场与题材时代() -> None:
    spec = build_cover_prompt("character", "雪落无声的第七夜", BRIEF, PLAN)
    assert "反锁的书房" in spec["prompt"]
    assert "本格题材" in spec["prompt"]
    assert "民国背景" in spec["prompt"]


def test_character_prompt_抽象线索不充当道具() -> None:
    plan = {"clues_public": [{"id": "C1", "name": "白棠的证词"}, {"id": "C2", "name": "不在场证明"}]}
    spec = build_cover_prompt("character", "某本", {}, plan)
    assert "证词" not in spec["prompt"]
    # 兜底文案不写死具体道具
    assert "贴合剧情的关键道具" in spec["prompt"]


def test_seed_不同剧本必不同_同剧本稳定() -> None:
    a = build_cover_prompt("character", "雪落无声的第七夜", BRIEF, PLAN)
    b = build_cover_prompt("character", "断电七分钟", BRIEF, PLAN)
    c = build_cover_prompt("character", "雪落无声的第七夜", BRIEF, PLAN)
    d = build_cover_prompt("scene", "雪落无声的第七夜", BRIEF, PLAN)
    assert a["seed"] != b["seed"]
    assert a["seed"] == c["seed"]
    assert a["seed"] != d["seed"]  # 风格也参与哈希
    assert 0 <= a["seed"] < 2**31


def test_group_人数来自方案不写死五人() -> None:
    # 机位会随 nonce 轮换，但无论哪种句式都必须用方案里的实际人数
    for nonce in ("", "n1", "n2", "n3"):
        spec = build_cover_prompt("group", "雪落无声的第七夜", BRIEF, PLAN, nonce=nonce)
        assert "6人" in spec["prompt"]
        assert "五人" not in spec["prompt"]
        assert "反锁的书房" in spec["prompt"]


def test_group_人数上限收在3到8() -> None:
    plan = {"characters": [{"name": f"角色{i}"} for i in range(12)]}
    spec = build_cover_prompt("group", "某本", {}, plan)
    assert "8人" in spec["prompt"]
    brief = {"players": "2人"}
    spec2 = build_cover_prompt("group", "某本", brief, {})
    assert "3人" in spec2["prompt"]


def test_scene_prompt_不含标题文字_防止模型画字() -> None:
    spec = build_cover_prompt("scene", "雪落无声的第七夜", BRIEF, PLAN)
    assert "雪落无声的第七夜" not in spec["prompt"]
    assert "反锁的书房" in spec["prompt"]


def test_空方案优雅退化不抛错() -> None:
    for style in ("character", "group", "scene"):
        spec = build_cover_prompt(style, "未命名", None, None)
        assert spec["prompt"]
        assert spec["negative"]
    # 兜底现场描述仍然给画面留了内容
    spec = build_cover_prompt("character", "未命名", {}, {})
    assert "暗色帷幔" in spec["prompt"]


def test_长背景截断不灌爆prompt() -> None:
    brief = {"era": "", "background": "这是一个非常长的背景设定" * 10}
    spec = build_cover_prompt("character", "某本", brief, {})
    assert len(spec["prompt"]) < 600


def test_pick_hero_三级退路() -> None:
    # 有 look 的优先
    assert pick_hero(PLAN)["name"] == "白棠"
    # 没 look 就挑有身份的
    plan = {"characters": [{"name": "甲"}, {"name": "乙", "identity": "医生"}]}
    assert pick_hero(plan)["name"] == "乙"
    # 都没有就第一个
    plan = {"characters": [{"name": "甲"}, {"name": "乙"}]}
    assert pick_hero(plan)["name"] == "甲"
    assert pick_hero({}) == {}


def test_pick_scene_现场优先_背景退路去掉行首标签() -> None:
    assert pick_scene(PLAN) == "反锁的书房，壁炉将熄"
    assert pick_scene({"background": "背景：暴雪封山的云顶山庄"}) == "暴雪封山的云顶山庄"
    assert pick_scene({}) == ""


# ── 「换一张」：nonce 决定 seed 与构图 ──


def test_换_nonce_就换图_同_nonce_可复现() -> None:
    a = build_cover_prompt("character", "雪落无声的第七夜", BRIEF, PLAN, nonce="x1")
    b = build_cover_prompt("character", "雪落无声的第七夜", BRIEF, PLAN, nonce="x2")
    c = build_cover_prompt("character", "雪落无声的第七夜", BRIEF, PLAN, nonce="x1")
    assert a["seed"] != b["seed"]
    assert a["prompt"] != b["prompt"]
    assert a["seed"] == c["seed"]
    assert a["prompt"] == c["prompt"]
    assert a["nonce"] == "x1"


def test_连续六次生成_画风机位光源全不重复() -> None:
    """同一剧本连点「换一张」，画风与机位/光源不应反复回到同一套。

    这是用户最直接的抱怨来源：「一直都是一个人只是背景变了」——
    所以断言里必须包含画风（media），只比机位/色调不足以证明观感真的变。
    """
    seen = set()
    medias = set()
    for i in range(6):
        spec = build_cover_prompt("character", "雪落无声的第七夜", BRIEF, PLAN, nonce=f"n{i}")
        prompt = spec["prompt"]
        medias.add(spec["media"])
        shot = next(
            x
            for x in (
                "右侧三分之二",
                "居中偏左",
                "画面左侧",
                "背对镜头回头",
                "过肩视角",
                "大特写",
                "逆光深色剪影",
                "纯背影构图",
            )
            if x in prompt
        )
        light = next(x for x in ("左上方", "暖色烛光", "天窗硬光", "背后逆光") if x in prompt)
        seen.add((spec["media"], shot, light))
    assert len(seen) == 6
    # 画风必须真的在换，不能六张都是同一个画种
    assert len(medias) >= 4


def test_三种风格都受_nonce_影响() -> None:
    for style in ("character", "group", "scene"):
        a = build_cover_prompt(style, "同标题", BRIEF, PLAN, nonce="a")
        b = build_cover_prompt(style, "同标题", BRIEF, PLAN, nonce="b")
        assert a["seed"] != b["seed"], style


# ───────────────────── 画风维度（media）：观感差异的主要来源 ─────────────────────


def test_画风池覆盖十种画种且_key_唯一() -> None:
    from agents._lib.cover import _MEDIA

    keys = [item["key"] for item in _MEDIA]
    labels = [item["label"] for item in _MEDIA]
    assert len(_MEDIA) == 10
    assert len(set(keys)) == 10
    assert len(set(labels)) == 10
    # 必须包含画种跨度大的几类，否则「换一张」还是同一个世界
    for key in ("cine", "noir", "ukiyoe", "ink", "screenprint"):
        assert key in keys


def test_显式指定画风时_prompt_真的换成对应画种() -> None:
    cine = build_cover_prompt("character", "雪落", BRIEF, PLAN, nonce="a", media="cine")
    ink = build_cover_prompt("character", "雪落", BRIEF, PLAN, nonce="a", media="ink")
    assert "实拍剧照" in cine["prompt"]
    assert "水墨" in ink["prompt"]
    assert cine["prompt"] != ink["prompt"]
    assert cine["media"] == "cine"
    assert ink["media"] == "ink"


def test_画风决定反向词_写实排除插画_插画排除照片() -> None:
    cine = build_cover_prompt("character", "雪落", BRIEF, PLAN, nonce="a", media="cine")
    ink = build_cover_prompt("character", "雪落", BRIEF, PLAN, nonce="a", media="ink")
    # 写实类要压住卡通味
    assert "卡通" in cine["negative"]
    assert "平面插画" in cine["negative"]
    # 插画类反过来要压住照片味，且不能把「平面插画」自己排掉
    assert "写实照片" in ink["negative"]
    assert "卡通" not in ink["negative"]
    assert "平面插画" not in ink["negative"]
    # 两类都要保留的基础忌词
    for spec in (cine, ink):
        assert "水印" in spec["negative"]
        assert "低质量" in spec["negative"]


def test_平面画风用平面色板而不是胶片颗粒() -> None:
    ink = build_cover_prompt("character", "雪落", BRIEF, PLAN, nonce="a", media="ink")
    cine = build_cover_prompt("character", "雪落", BRIEF, PLAN, nonce="a", media="cine")
    assert "胶片颗粒" not in ink["prompt"]
    assert any(t in ink["prompt"] for t in ("朱红与靛蓝", "墨黑与米白", "土黄与赭石", "青绿与赭红"))
    assert any(t in cine["prompt"] for t in ("胶片颗粒", "冷凝青蓝", "暖褐复古", "黑白摄影"))


def test_同_nonce_不同画风_seed_必须不同() -> None:
    a = build_cover_prompt("character", "雪落", BRIEF, PLAN, nonce="same", media="cine")
    b = build_cover_prompt("character", "雪落", BRIEF, PLAN, nonce="same", media="noir")
    assert a["seed"] != b["seed"]


def test_未知画风回退到随机而不是报错() -> None:
    spec = build_cover_prompt("character", "雪落", BRIEF, PLAN, nonce="a", media="不存在的画风")
    assert spec["media"] in {item["key"] for item in __import__("agents._lib.cover", fromlist=["_MEDIA"])._MEDIA}
    assert spec["prompt"]


def test_三种风格都能指定画风() -> None:
    for style in ("character", "group", "scene"):
        spec = build_cover_prompt(style, "同标题", BRIEF, PLAN, nonce="a", media="ukiyoe")
        assert spec["media"] == "ukiyoe"
        assert "浮世绘" in spec["prompt"]
        assert spec["media_label"] == "浮世绘"


def test_返回画风标签供前端提示() -> None:
    spec = build_cover_prompt("character", "雪落", BRIEF, PLAN, nonce="a", media="cyberpunk")
    assert spec["media_label"] == "赛博朋克"
