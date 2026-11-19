from django.db import migrations

ROLES = {
    "Admin": "Full access: staff, store settings, stock, billing, expenses and reports.",
    "Manager": "Manages products, purchases, expenses and views reports.",
    "Cashier": "Runs the billing counter (POS) and sees own sales.",
}


def create_roles(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    RoleProfile = apps.get_model("accounts", "RoleProfile")
    for name, description in ROLES.items():
        group, _ = Group.objects.get_or_create(name=name)
        RoleProfile.objects.get_or_create(group=group, defaults={"description": description})


class Migration(migrations.Migration):
    dependencies = [("accounts", "0001_initial")]
    operations = [migrations.RunPython(create_roles, migrations.RunPython.noop)]
