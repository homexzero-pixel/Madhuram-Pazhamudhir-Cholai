from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import User


@admin.register(User)
class StaffAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (("Store", {"fields": ("role", "name_ta", "phone")}),)
    list_display = ("username", "first_name", "role", "is_active")
