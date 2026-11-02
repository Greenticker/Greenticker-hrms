"""
Built-in letter template gallery.

These are read-only starting points shown in the "Template Gallery". An admin can copy
one into their organisation's own letter templates and edit it from there. Content uses
the same {{token}} merge fields as organisation templates (see
ModulesStore.merge_letter_tokens). Text in [square brackets] is a manual fill-in for
details the HRMS does not store. The templates themselves live in the seed file.
"""

from typing import Optional

from app.stores.seed import letter_gallery

LETTER_TEMPLATE_GALLERY: list = letter_gallery()


def get_gallery_template(key: str) -> Optional[dict]:
    return next((t for t in LETTER_TEMPLATE_GALLERY if t.get("key") == key), None)
