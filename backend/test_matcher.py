from matcher import rank_materials, score_text, split_tags, tokenize


resumes = [
    {"id": "r1", "name": "通信版", "description": "通信系统仿真", "extracted_text": "MATLAB DVB-S LoRaWAN", "tags": ["通信", "MATLAB"]},
    {"id": "r2", "name": "视觉版", "description": "计算机视觉", "extracted_text": "PyTorch 语义分割", "tags": ["算法", "视觉"]},
]
projects = [
    {"id": "p1", "name": "SG-BEV", "category": "项目", "tags": ["视觉"], "variants": [
        {"name": "算法版", "tags": ["PyTorch", "语义分割"], "content": "使用PyTorch完成语义分割实验"},
        {"name": "项目版", "tags": ["数据整理"], "content": "完成数据整理和报告"},
    ]},
    {"id": "p2", "name": "DVB-S", "category": "项目", "tags": ["通信"], "variants": [
        {"name": "通信版", "tags": ["MATLAB", "链路预算"], "content": "使用MATLAB完成卫星链路预算"}
    ]},
]

result = rank_materials("通信系统工程师", "熟悉MATLAB、卫星通信和链路预算", resumes, projects)
assert result["recommended_resume"]["name"] == "通信版"
assert result["recommended_projects"][0]["project_name"] == "DVB-S"

# A JD and material can use different languages/spellings for the same skill.
assert score_text("CV / CNN / model evaluation / MAE", "计算机视觉、卷积神经网络、模型评估、平均绝对误差").value == 90
assert score_text("IoT wireless communications link budget", "物联网、无线通信、链路预算").value == 90
assert score_text("PyTorch", "Py Torch").value == 90
assert score_text("semantic segmentation", "语义分割").value == 90
assert score_text("CV", "计算机视觉").matched_keywords == ["计算机视觉"]

# Short keywords must be identifiers, not substrings of an unrelated word.
for job, material in [("AI", "training"), ("C", "C++"), ("IoU", "mIoU"), ("SQL", "MySQL"), ("LoRa", "LoRaWAN")]:
    assert score_text(job, material).value == 0, (job, material)
assert "人工智能" in tokenize("熟悉AI，熟练Python")
assert "C++" in tokenize("掌握C++编程")
assert score_text("Python", "人工智能").value == 0  # no invented parent/child skills
assert score_text("2026 3 5", "2026 3 5").value == 0  # numbers are not skills

# Slashes in language/protocol names survive storage; tags are deduplicated.
assert split_tags("C/C++、TCP/IP，Python; Python\n通信") == ["C/C++", "TCP/IP", "Python", "通信"]
assert {"C", "C++", "TCP/IP"} <= tokenize("C/C++ TCP/IP")
assert score_text("C++ TCP/IP", "", "C/C++、TCP/IP").value == 100

# A long alias/tag list and ngram overlap cannot swamp stronger technical matches.
single = score_text("AI Python C++", "", ["AI"])
repeated = score_text("AI Python C++", "", ["AI", "人工智能", "artificial intelligence"] * 30)
full = score_text("AI Python C++", "人工智能 Python C++")
assert single.value == repeated.value < full.value < 100
weak = score_text("测试流程 问题分析 Python PyTorch C++", "测试流程 问题分析")
assert weak.value < 15
assert score_text("", "Python").value == 0

# Variant fields and the existing result schema remain available to form filling.
mixed_project = {"id": "p3", "name": "实验", "category": "科研", "tags": "人工智能", "variants": [
    {"name": "中文评测版", "tags": "模型评估、PyTorch", "content": "计算机视觉实验", "role": "成员", "organization": "实验室", "responsibilities": "模型评估", "start_date": "2025-01", "end_date": "2025-06"},
    {"name": "通信版", "tags": ["MATLAB"], "content": "链路预算"},
]}
cross_language = rank_materials("CV engineer", "model evaluation with PyTorch", resumes, [mixed_project])
chosen = cross_language["recommended_projects"][0]
assert chosen["variant_name"] == "中文评测版"
assert chosen["role"] == "成员" and chosen["organization"] == "实验室"
assert chosen["start_date"] == "2025-01" and chosen["end_date"] == "2025-06"
assert chosen["responsibilities"] == "模型评估" and len(chosen["variants"]) == 2
assert set(cross_language) == {"job_title", "recommended_resume", "resume_candidates", "recommended_projects", "project_candidates"}
print("backend matcher tests passed")
