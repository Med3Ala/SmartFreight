"""SmartFreight AI agent: system prompt and output contract."""

from functools import cache
from pathlib import Path

from .schemas import BestFormulaMatrix

PROMPTS_DIR = Path(__file__).parent / "prompts"


@cache
def system_prompt() -> str:
    return (PROMPTS_DIR / "best_formula_matrix.md").read_text(encoding="utf-8")


__all__ = ["BestFormulaMatrix", "system_prompt"]
