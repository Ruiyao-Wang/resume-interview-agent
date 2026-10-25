"""Deterministic, explainable matching for resumes and project variants."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable


STOPWORDS = {
    "负责", "相关", "工作", "岗位", "要求", "具备", "优先", "以及", "进行", "完成",
    "能力", "经验", "方向", "参与", "良好", "使用", "能够", "以上", "以下",
    "the", "and", "with", "for", "of", "in", "to", "or", "is", "a", "an",
    "experience", "required", "requirements", "responsibilities", "engineer", "engineering",
}

# These are spelling/language aliases, not evidence of proficiency. In particular,
# knowing AI does not automatically imply experience with every AI framework.
CONCEPT_ALIASES = {
    "人工智能": ("人工智能", "artificial intelligence", "AI"),
    "计算机视觉": ("计算机视觉", "机器视觉", "computer vision", "CV"),
    "机器学习": ("机器学习", "machine learning", "ML"),
    "深度学习": ("深度学习", "deep learning", "DL"),
    "PyTorch": ("PyTorch", "Py Torch"),
    "TensorFlow": ("TensorFlow", "Tensor Flow"),
    "Python": ("Python",),
    "C++": ("C++", "CPP"),
    "C": ("C", "C语言"),
    "Java": ("Java",),
    "MATLAB": ("MATLAB",),
    "卷积神经网络": ("卷积神经网络", "convolutional neural network", "CNN"),
    "Transformer": ("Transformer", "Transformers"),
    "大语言模型": ("大语言模型", "大型语言模型", "large language model", "LLM", "LLMs"),
    "强化学习": ("强化学习", "reinforcement learning", "RL"),
    "模仿学习": ("模仿学习", "imitation learning"),
    "多模态": ("多模态", "multimodal", "multi-modal"),
    "语义分割": ("语义分割", "semantic segmentation"),
    "目标检测": ("目标检测", "object detection"),
    "模型评测": ("模型评测", "模型评估", "model evaluation", "model assessment"),
    "鲁棒性": ("鲁棒性", "robustness"),
    "自动化测试": ("自动化测试", "automated testing", "test automation"),
    "性能测试": ("性能测试", "performance testing"),
    "数据清洗": ("数据清洗", "data cleaning", "data cleansing"),
    "数据泄漏": ("数据泄漏", "data leakage"),
    "数据质量": ("数据质量", "data quality"),
    "mIoU": ("mIoU", "mean intersection over union"),
    "IoU": ("IoU", "intersection over union", "交并比"),
    "MAE": ("MAE", "mean absolute error", "平均绝对误差"),
    "无线通信": ("无线通信", "无线通讯", "wireless communication", "wireless communications"),
    "卫星通信": ("卫星通信", "卫星通讯", "satellite communication", "satellite communications"),
    "链路预算": ("链路预算", "link budget"),
    "信号处理": ("信号处理", "signal processing"),
    "物联网": ("物联网", "internet of things", "IoT"),
    "嵌入式": ("嵌入式", "embedded"),
    "STM32": ("STM32",),
    "LoRaWAN": ("LoRaWAN", "LoRa WAN"),
    "LoRa": ("LoRa",),
    "TCP/IP": ("TCP/IP", "TCP IP", "TCP-IP"),
    "Wi-Fi": ("Wi-Fi", "WiFi", "Wi Fi", "无线局域网"),
    "GNSS": ("GNSS", "全球导航卫星系统", "global navigation satellite system"),
    "DVB-S2": ("DVB-S2", "DVB S2"),
    "DVB-S": ("DVB-S", "DVB S"),
    "Linux": ("Linux",),
    "Git": ("Git",),
    "SQL": ("SQL",),
    "MySQL": ("MySQL",),
    "Redis": ("Redis",),
}


def _alias_pattern(alias: str) -> re.Pattern:
    body = re.escape(alias).replace(r"\ ", r"[\s_-]+")
    # Latin identifiers may be next to Chinese prose, but not embedded in words
    # ('AI' in training, 'C' in C++, 'IoU' in mIoU, 'SQL' in MySQL).
    prefix = r"(?<![a-z0-9_+#])" if re.match(r"[a-z0-9]", alias, re.I) else ""
    suffix = r"(?![a-z0-9_+#])" if re.search(r"[a-z0-9+#]$", alias, re.I) else ""
    return re.compile(prefix + body + suffix, re.I)


ALIAS_PATTERNS = sorted(
    [(concept, alias, _alias_pattern(alias)) for concept, aliases in CONCEPT_ALIASES.items() for alias in aliases],
    key=lambda item: -len(item[1]),
)


def _features(text: str) -> tuple[set[str], set[str]]:
    remaining = (text or "").lower()
    concepts: set[str] = set()
    # Consume longest aliases first, so one phrase does not earn duplicate credit.
    for concept, _alias, pattern in ALIAS_PATTERNS:
        if pattern.search(remaining):
            concepts.add(concept)
            remaining = pattern.sub(lambda match: " " * len(match.group()), remaining)
    latin = set(re.findall(r"[a-z][a-z0-9+#.-]+", remaining))
    chinese: set[str] = set()
    for run in re.findall(r"[\u4e00-\u9fff]{2,}", remaining):
        for size in (2, 3, 4):
            chinese.update(run[index:index + size] for index in range(len(run) - size + 1))
    return concepts, (latin | chinese) - STOPWORDS


def tokenize(text: str) -> set[str]:
    concepts, words = _features(text)
    return concepts | words


def split_tags(tags: str | Iterable[str]) -> list[str]:
    if isinstance(tags, str):
        # Slash is part of common technical tags such as C/C++ and TCP/IP.
        values = re.split(r"[,，、;；|\n]+", tags)
    else:
        values = list(tags)
    return list(dict.fromkeys(value.strip() for value in values if value and value.strip()))


@dataclass
class Score:
    value: float
    matched_keywords: list[str]


def score_text(job_text: str, candidate_text: str, tags: str | Iterable[str] = ()) -> Score:
    job_concepts, job_words = _features(job_text)
    candidate_concepts, candidate_words = _features(candidate_text)
    tag_list = split_tags(tags)
    tag_concepts, tag_words = _features("\n".join(tag_list))
    concept_overlap = job_concepts & (candidate_concepts | tag_concepts)
    word_overlap = job_words & (candidate_words | tag_words)
    # Known terms carry the main evidence; overlapping Chinese character ngrams
    # share a fixed small budget. Repeated tags and synonyms cannot inflate it.
    word_budget = 2.0 if job_words else 0.0
    denominator = 4.0 * len(job_concepts) + word_budget
    if not denominator:
        return Score(value=0.0, matched_keywords=[])
    coverage = (4.0 * len(concept_overlap) + word_budget * len(word_overlap) / max(1, len(job_words))) / denominator
    tag_coverage = (4.0 * len(job_concepts & tag_concepts) + word_budget * len(job_words & tag_words) / max(1, len(job_words))) / denominator
    # A ranking score, not an estimate of eligibility or interview probability.
    value = round(100.0 * (0.9 * coverage + 0.1 * tag_coverage), 1)
    matched_tags = [tag for tag in tag_list if tokenize(tag) & (job_concepts | job_words)]
    longest_words = [word for word in word_overlap if not any(word != other and word in other for other in word_overlap)]
    explanations = matched_tags[:8] + sorted(concept_overlap) + sorted(longest_words, key=lambda token: (-len(token), token))[:6]
    return Score(value=value, matched_keywords=list(dict.fromkeys(explanations)))


def rank_materials(job_title: str, job_description: str, resumes: list[dict], projects: list[dict], max_projects: int = 3) -> dict:
    job_text = f"{job_title}\n{job_description}".strip()
    ranked_resumes = []
    for resume in resumes:
        score = score_text(job_text, f"{resume.get('name', '')}\n{resume.get('description', '')}\n{resume.get('extracted_text', '')}", resume.get("tags", []))
        ranked_resumes.append({**resume, "score": score.value, "matched_keywords": score.matched_keywords})
    ranked_resumes.sort(key=lambda item: (-item["score"], item.get("name", "")))

    ranked_projects = []
    for project in projects:
        variants = []
        for variant in project.get("variants", []):
            combined_tags = split_tags(project.get("tags", [])) + split_tags(variant.get("tags", []))
            score = score_text(job_text, f"{project.get('name', '')}\n{variant.get('name', '')}\n{variant.get('content', '')}", combined_tags)
            candidate = {
                "project_id": project.get("id"),
                "project_name": project.get("name"),
                "category": project.get("category"),
                "variant_name": variant.get("name"),
                "content": variant.get("content"),
                **{key: variant.get(key, "") for key in ("start_date", "end_date", "role", "organization", "responsibilities")},
                "score": score.value,
                "matched_keywords": score.matched_keywords,
            }
            variants.append(candidate)
        variants.sort(key=lambda item: -item["score"])
        if variants:
            ranked_projects.append({**variants[0], "variants": variants})
    ranked_projects.sort(key=lambda item: (-item["score"], item.get("project_name", "")))

    return {
        "job_title": job_title,
        "recommended_resume": ranked_resumes[0] if ranked_resumes else None,
        "resume_candidates": ranked_resumes,
        "recommended_projects": ranked_projects[:max(1, min(max_projects, 6))],
        "project_candidates": ranked_projects,
    }
