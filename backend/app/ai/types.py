from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional


@dataclass
class ProviderResult:
    answer_text: str
    entities: List[Dict[str, object]]
    actions: List[Dict[str, object]]
    tools_used: List[Dict[str, object]]
    meta: Optional[Dict[str, object]] = None
