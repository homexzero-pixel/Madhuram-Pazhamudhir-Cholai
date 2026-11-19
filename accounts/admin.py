from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import RoleProfile, User


@admin.register(User)
class StaffAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (("Contact", {"fields": ("phone",)}),)


admin.site.register(RoleProfile)
