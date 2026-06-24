"""Auth + tenancy resolution (M12).

A request's **project** (tenant) is resolved one of two ways:

- **Keyed mode** — if `PROJECT_KEYS` (a JSON map of `{token: project}`) is set in
  the environment, every `/v1/*` request must present `Authorization: Bearer
  <token>`; the token *is* the tenant credential and determines the project. A
  missing/unknown token is a 401.
- **Open mode** (default, zero-config for the demo) — no `PROJECT_KEYS`; the
  project comes from the optional `X-Project` header, defaulting to `"default"`.

Resolving the project here means every gateway concern (live session, policy,
settings, alerts, history, limiter state, metrics) is isolated per tenant just by
keying on the returned string.
"""

from __future__ import annotations

import json
import os

from fastapi import Header, HTTPException

DEFAULT_PROJECT = "default"


def _project_keys() -> dict[str, str]:
    raw = os.environ.get("PROJECT_KEYS", "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return {str(k): str(v) for k, v in parsed.items()}
    except (ValueError, AttributeError):
        return {}


def auth_enabled() -> bool:
    return bool(_project_keys())


def resolve_project(
    authorization: str | None = Header(default=None),
    x_project: str | None = Header(default=None),
) -> str:
    """FastAPI dependency: the caller's project (raises 401 in keyed mode)."""
    keys = _project_keys()
    if keys:
        token = None
        if authorization and authorization.lower().startswith("bearer "):
            token = authorization[7:].strip()
        project = keys.get(token or "")
        if not project:
            raise HTTPException(status_code=401, detail="invalid or missing project token")
        return project
    return (x_project or DEFAULT_PROJECT).strip() or DEFAULT_PROJECT
