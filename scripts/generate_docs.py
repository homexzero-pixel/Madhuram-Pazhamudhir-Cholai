"""Regenerate docs/SCHEMA.md, data/ import templates and docs/Practice_Barcodes.html from the code.

    MPC_MODE=demo python manage.py shell < scripts/generate_docs.py
"""
from pathlib import Path

from django.apps import apps
from django.conf import settings
from django.test import Client, RequestFactory

root = Path(settings.BASE_DIR)
APPS = ["core", "accounts", "catalog", "inventory", "purchasing", "customers", "sales", "expenses"]
out = ["# Database schema", "", "Generated from the Django models (`scripts/generate_docs.py`). SQLite file, one per mode "
       "(store / practice). Money: DECIMAL(…,2) rupees. Quantities: DECIMAL(…,3) (kg to the gram). All changes go through "
       "migrations in each app's `migrations/` folder.", ""]
for label in APPS:
    for m in apps.get_app_config(label).get_models():
        out.append(f"## {m._meta.db_table}  ({m.__name__})")
        if m.__doc__ and not m.__doc__.startswith(m.__name__ + "("):
            out.append(" ".join(m.__doc__.split()))
        out += ["", "| Column | Type | Notes |", "|---|---|---|"]
        for f in m._meta.concrete_fields:
            t = f.get_internal_type()
            if f.is_relation:
                t = f"→ {f.related_model._meta.db_table}"
            notes = []
            if f.primary_key: notes.append("primary key")
            if f.unique and not f.primary_key: notes.append("unique")
            if getattr(f, "db_index", False) and not f.unique: notes.append("indexed")
            if f.null: notes.append("nullable")
            if getattr(f, "max_digits", None): t += f"({f.max_digits},{f.decimal_places})"
            if f.help_text: notes.append(str(f.help_text))
            out.append(f"| {f.column} | {t} | {'; '.join(notes)} |")
        cons = [c.name for c in m._meta.constraints] + [", ".join(u) for u in m._meta.unique_together]
        idx = [", ".join(i.fields) for i in m._meta.indexes]
        if cons: out.append(f"\nConstraints: {'; '.join(cons)}")
        if idx: out.append(f"\nExtra indexes: {'; '.join(idx)}")
        out.append("")
(root / "docs" / "SCHEMA.md").write_text("\n".join(out), encoding="utf-8")

from accounts.models import User
c = Client(HTTP_HOST="127.0.0.1")
c.force_login(User.objects.filter(role="owner").first())
(root / "data" / "import_template.xlsx").write_bytes(c.get("/products/import/template.xlsx").content)
(root / "data" / "import_template.csv").write_bytes(c.get("/products/import/template.csv").content)
html = c.get("/products/practice-barcodes/").content.decode()
html = html.replace('<link href="/static/css/app.css" rel="stylesheet">', "")
(root / "docs" / "Practice_Barcodes.html").write_text(html, encoding="utf-8")
print("docs generated")
