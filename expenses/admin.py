from django.contrib import admin

from .models import Expense, ExpenseCategory

admin.site.register(ExpenseCategory)


@admin.register(Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = ("spent_on", "category", "description", "amount", "created_by")
    list_filter = ("category",)
