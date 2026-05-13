"""add order delivery photo columns

Revision ID: 75181f2bcafb
Revises: 4d2a9f51e7b1
Create Date: 2026-05-13 13:40:37.467211

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "75181f2bcafb"
down_revision: Union[str, Sequence[str], None] = "4d2a9f51e7b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add nullable columns for optional delivery-proof photo per order.

    Bytes live on disk at `data/orders/{id}.bin`; the column stores the
    absolute path. `_uploaded_at` distinguishes "no photo yet" from
    "photo was uploaded at T" for display ordering.
    """
    op.add_column("orders", sa.Column("delivery_photo_path", sa.String(length=512), nullable=True))
    op.add_column("orders", sa.Column("delivery_photo_mime", sa.String(length=64), nullable=True))
    op.add_column("orders", sa.Column("delivery_photo_uploaded_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "delivery_photo_uploaded_at")
    op.drop_column("orders", "delivery_photo_mime")
    op.drop_column("orders", "delivery_photo_path")
