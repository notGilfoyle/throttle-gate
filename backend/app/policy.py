"""Policy engine (M9): per-route / per-method / per-key rules.

A `Policy` is an ordered list of `PolicyRule`s. For each real request the gate
walks the rules and the **first match wins**, choosing the algorithm, params, and
cost to apply (or hard-denying the request). Anything that matches no rule falls
back to the Live session's default limiter.

Each rule gets its own limiter state namespace (its `name`), so different routes
or tiers don't share a bucket even when they use the same algorithm.
"""

from __future__ import annotations

from fnmatch import fnmatch

from pydantic import BaseModel, Field

from .config import AlgorithmKey


class PolicyMatch(BaseModel):
    """Conditions for a rule to apply. A `None` field means "any"; all set
    fields must match (AND)."""

    route: str | None = None  # glob, e.g. "/api/*" or "/login"
    methods: list[str] | None = None  # e.g. ["POST", "PUT"]; case-insensitive
    keys: list[str] | None = None  # exact keys / tiers, e.g. ["free-tier-9"]


class PolicyRule(BaseModel):
    name: str = "rule"  # also the limiter state namespace for this rule
    match: PolicyMatch = Field(default_factory=PolicyMatch)
    deny: bool = False  # hard block (no limiter consulted)
    algorithm: AlgorithmKey | None = None  # None → Live session default
    params: dict | None = None  # per-rule override of that algorithm's params
    cost: int = 1  # weight charged for requests matching this rule


class Policy(BaseModel):
    rules: list[PolicyRule] = Field(default_factory=list)
    # Per-key burst overrides: key → multiplier applied to the matched rule's
    # size param (token/leaky `capacity`, window `limit`). Lets a VIP key get,
    # say, 3× the limit without writing a separate rule.
    overrides: dict[str, float] = Field(default_factory=dict)


# The "size" param each algorithm scales for a burst override.
SIZE_PARAM: dict[AlgorithmKey, str] = {
    "token_bucket": "capacity",
    "leaky_bucket": "capacity",
    "fixed_window": "limit",
    "sliding_log": "limit",
    "sliding_counter": "limit",
    "gcra": "burst",
    "concurrency": "limit",
}


def resolve(policy: Policy, key: str, route: str, method: str) -> PolicyRule | None:
    """Return the first rule matching (key, route, method), or None."""
    for rule in policy.rules:
        m = rule.match
        if m.route is not None and not fnmatch(route, m.route):
            continue
        if m.methods is not None and method.upper() not in {x.upper() for x in m.methods}:
            continue
        if m.keys is not None and key not in m.keys:
            continue
        return rule
    return None
