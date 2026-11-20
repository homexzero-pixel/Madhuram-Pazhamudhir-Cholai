from django.db import migrations

NAMES = ["Rent", "Electricity", "Salaries & wages", "Transport & loading", "Packaging & carry bags", "Repairs & maintenance",
         "Tea & staff welfare", "Cleaning", "Miscellaneous"]


def add(apps, schema_editor):
    Cat = apps.get_model("expenses", "ExpenseCategory")
    for n in NAMES:
        Cat.objects.get_or_create(name=n)


class Migration(migrations.Migration):
    dependencies = [("expenses", "0002_initial")]
    operations = [migrations.RunPython(add, migrations.RunPython.noop)]
