"""Constrained types shared by request bodies and route parameters."""

import json
from typing import Annotated

from annotated_types import Interval
from fastapi import HTTPException
from pydantic import AfterValidator, TypeAdapter, ValidationError

# A row id SQLite can hold. The driver raises OverflowError (a 500) on a
# bigger one, so it is turned away as a 422 with the other bad ids.
Id = Annotated[int, Interval(ge=1, le=2**63 - 1)]
_id = TypeAdapter(Id)


def as_id(value) -> int | None:
    """`value` (an int or a numeric string from a hand-parsed payload) as an Id, or None."""
    try:
        return _id.validate_python(value)
    except ValidationError:
        return None


def _small(pricing: dict) -> dict:
    # Pydantic passes an HTTPException through, so this stays a 413, not a 422.
    if len(json.dumps(pricing)) > 8 * 1024:
        raise HTTPException(413, "Pricing too large (max 8 KB)")
    return pricing


# Pricing settings are an object the frontend owns; this caps what a client may store.
Pricing = Annotated[dict, AfterValidator(_small)]
