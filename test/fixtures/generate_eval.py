"""Generate a synthetic 120-slide corpus + 60 ToT-style queries for recall eval.

This is a *synthetic* baseline: unique remembered phrases, vague years and
filler words. It measures plumbing and page-level ranking, not the father's
real corpus.
"""

from __future__ import annotations

import json
from pathlib import Path

from pptx import Presentation
from pptx.util import Inches

HERE = Path(__file__).resolve().parent
CORPUS = HERE / "eval-corpus"
QUERIES = HERE / "eval-queries.json"

TOPICS = [
    "城市更新", "生态修复", "教育信息化", "医疗供应链", "文旅规划",
    "智能制造", "乡村振兴", "金融风控", "能源转型", "交通治理",
    "社区养老", "产业园区", "跨境电商", "数字政务", "食品安全",
    "应急管理", "职业教育", "绿色建筑", "水资源管理", "公共文化",
    "体育产业", "科技孵化", "物流枢纽", "碳交易", "海洋经济",
    "中医药", "会展经济", "普惠金融", "智慧农业", "城市安全",
]
MARKERS = [
    "梯次利用", "海绵城市", "碳汇核算", "分区治理", "弹性排班",
    "冷链断点", "适老化改造", "数字孪生", "以旧换新", "错峰调蓄",
    "柔性引才", "统仓共配", "飞地经济", "沙盒监管", "需求侧响应",
]


def build_corpus() -> list[dict]:
    CORPUS.mkdir(parents=True, exist_ok=True)
    for existing in CORPUS.glob("*.pptx"):
        existing.unlink()

    queries = []
    for deck, topic in enumerate(TOPICS):
        prs = Presentation()
        layout = prs.slide_layouts[5]  # title only
        for slide_index in range(4):
            marker = MARKERS[(deck + slide_index) % len(MARKERS)]
            phrase = f"{topic}{marker}"
            slide = prs.slides.add_slide(layout)
            slide.shapes.title.text = f"{topic}工作方案 第{slide_index + 1}部分"
            box = slide.shapes.add_textbox(Inches(0.8), Inches(1.8), Inches(8.4), Inches(3))
            box.text_frame.text = (
                f"主题：{topic}。\n"
                f"核心动作：{phrase}。\n"
                f"配套措施：围绕{topic}建立年度台账与跨部门协同机制。"
            )
        filename = f"deck-{deck:02d}-{topic}.pptx"
        prs.save(CORPUS / filename)

        # 60 queries: the first 15 decks (4 slides each).
        if deck < 15:
            for slide_index in range(4):
                marker = MARKERS[(deck + slide_index) % len(MARKERS)]
                phrase = f"{topic}{marker}"
                query = (
                    f"还记得大概是 20{18 + (deck + slide_index) % 6} 年那个"
                    f"「{topic}」的方案吗，里面有一页写着「{phrase}」，帮我找找"
                )
                queries.append(
                    {
                        "query": query,
                        "gold": {"file": filename, "page": slide_index + 1},
                        "topic": topic,
                        "phrase": phrase,
                    }
                )

    QUERIES.write_text(json.dumps(queries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return queries


if __name__ == "__main__":
    result = build_corpus()
    print(f"wrote {len(result)} queries, {len(list(CORPUS.glob('*.pptx')))} decks to {CORPUS}")
