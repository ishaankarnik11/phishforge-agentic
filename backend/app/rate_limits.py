"""Rate-limit constants (STORY-7.4).

Kept in a dedicated module so ops can tweak limits without redeploying core
service logic.  The per-user limits reset at UTC midnight; the per-emailer
limit is an all-time cap.
"""

from __future__ import annotations

from typing import Final

# Per-user, per-UTC-day limits
USER_DAILY_GENERATIONS: Final[int] = 20
USER_DAILY_REFINEMENTS: Final[int] = 100

# Per-emailer all-time cap on refinement turns
EMAILER_REFINEMENT_TURNS: Final[int] = 30
