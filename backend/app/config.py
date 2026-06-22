"""Run configuration and static algorithm metadata (PRD §9.1, §7.1).

This module is the source of truth for the control-plane contract:
- `RunConfig` is the body of `POST /api/session/start` and `PATCH /api/config`.
- `ALGORITHMS` drives `GET /api/algorithms`, from which the frontend builds its
  control panel (param sliders, ranges, defaults).

Keep these shapes in lockstep with the frontend; both ends depend on them.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# ── Enumerable vocabularies ─────────────────────────────────────────────────

AlgorithmKey = Literal[
    "token_bucket",
    "leaky_bucket",
    "fixed_window",
    "sliding_log",
    "sliding_counter",
]

Pattern = Literal["steady", "burst", "ramp", "spike"]


# ── Per-algorithm tunable params ────────────────────────────────────────────


class TokenBucketParams(BaseModel):
    capacity: float = 10
    refill_rate: float = 5  # tokens/sec


class LeakyBucketParams(BaseModel):
    capacity: float = 10
    leak_rate: float = 5  # drained requests/sec


class FixedWindowParams(BaseModel):
    limit: int = 10
    window_s: float = 1


class SlidingLogParams(BaseModel):
    limit: int = 10
    window_s: float = 1


class SlidingCounterParams(BaseModel):
    limit: int = 10
    window_s: float = 1


class RunParams(BaseModel):
    """Params for every algorithm, so compare mode has them all on hand."""

    token_bucket: TokenBucketParams = Field(default_factory=TokenBucketParams)
    leaky_bucket: LeakyBucketParams = Field(default_factory=LeakyBucketParams)
    fixed_window: FixedWindowParams = Field(default_factory=FixedWindowParams)
    sliding_log: SlidingLogParams = Field(default_factory=SlidingLogParams)
    sliding_counter: SlidingCounterParams = Field(default_factory=SlidingCounterParams)

    def for_algorithm(self, algo: AlgorithmKey) -> BaseModel:
        return getattr(self, algo)


# ── Run configuration ───────────────────────────────────────────────────────


class DistributedConfig(BaseModel):
    """Distributed-mode demo settings (PRD §10).

    `shared` keeps limiter state in one place (all replicas share a key);
    `local` gives each replica isolated state, so the effective global limit is
    multiplied by `replicas` — the race the demo exposes.
    """

    enabled: bool = False
    replicas: int = Field(default=2, ge=2, le=4)
    mode: Literal["shared", "local"] = "shared"


class RunConfig(BaseModel):
    """Full configuration for a load-generation session (PRD §9.1)."""

    algorithm: AlgorithmKey = "token_bucket"
    # compare length >= 2 activates comparison mode and takes precedence.
    compare: list[AlgorithmKey] = Field(default_factory=list)
    rps: float = Field(default=20, gt=0, le=500)
    pattern: Pattern = "steady"
    client_count: int = Field(default=1, ge=1, le=16)
    params: RunParams = Field(default_factory=RunParams)
    distributed: DistributedConfig = Field(default_factory=DistributedConfig)

    def active_algorithms(self) -> list[AlgorithmKey]:
        """Algorithms to evaluate each request against.

        `compare` (>= 2 entries) wins; otherwise the single `algorithm`.
        """
        if len(self.compare) >= 2:
            return list(self.compare)
        return [self.algorithm]

    @property
    def compare_mode(self) -> bool:
        return len(self.compare) >= 2


# ── Static algorithm metadata (drives GET /api/algorithms) ───────────────────


class ParamSpec(BaseModel):
    name: str
    label: str
    type: Literal["int", "float"]
    default: float
    min: float
    max: float
    step: float


class AlgorithmMeta(BaseModel):
    key: AlgorithmKey
    label: str
    description: str
    params: list[ParamSpec]
    state_fields: list[str]  # keys present in a decision's `state` for this algo


ALGORITHMS: list[AlgorithmMeta] = [
    AlgorithmMeta(
        key="token_bucket",
        label="Token Bucket",
        description="Tokens refill at a fixed rate up to capacity; each request spends one. Allows bursts.",
        params=[
            ParamSpec(name="capacity", label="Capacity", type="float", default=10, min=1, max=100, step=1),
            ParamSpec(name="refill_rate", label="Refill rate (tok/s)", type="float", default=5, min=0.5, max=100, step=0.5),
        ],
        state_fields=["tokens", "capacity", "refill_rate"],
    ),
    AlgorithmMeta(
        key="leaky_bucket",
        label="Leaky Bucket",
        description="Requests queue and drain at a constant rate; overflow is rejected. Smooths output.",
        params=[
            ParamSpec(name="capacity", label="Capacity", type="float", default=10, min=1, max=100, step=1),
            ParamSpec(name="leak_rate", label="Leak rate (req/s)", type="float", default=5, min=0.5, max=100, step=0.5),
        ],
        state_fields=["queue_depth", "capacity", "leak_rate", "est_wait_ms"],
    ),
    AlgorithmMeta(
        key="fixed_window",
        label="Fixed Window",
        description="Count requests per fixed time bucket; reset on the boundary.",
        params=[
            ParamSpec(name="limit", label="Limit", type="int", default=10, min=1, max=200, step=1),
            ParamSpec(name="window_s", label="Window (s)", type="float", default=1, min=0.25, max=10, step=0.25),
        ],
        state_fields=["count", "limit", "window_s", "resets_in_s"],
    ),
    AlgorithmMeta(
        key="sliding_log",
        label="Sliding Window Log",
        description="Store timestamps; count those within the trailing window.",
        params=[
            ParamSpec(name="limit", label="Limit", type="int", default=10, min=1, max=200, step=1),
            ParamSpec(name="window_s", label="Window (s)", type="float", default=1, min=0.25, max=10, step=0.25),
        ],
        state_fields=["count", "limit", "window_s", "timestamps"],
    ),
    AlgorithmMeta(
        key="sliding_counter",
        label="Sliding Window Counter",
        description="Weighted blend of the current and previous fixed window.",
        params=[
            ParamSpec(name="limit", label="Limit", type="int", default=10, min=1, max=200, step=1),
            ParamSpec(name="window_s", label="Window (s)", type="float", default=1, min=0.25, max=10, step=0.25),
        ],
        state_fields=["curr_count", "prev_count", "weight", "estimate", "limit"],
    ),
]

ALGORITHMS_BY_KEY: dict[str, AlgorithmMeta] = {a.key: a for a in ALGORITHMS}
