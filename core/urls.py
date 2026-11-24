from django.urls import path

from . import views

urlpatterns = [
    path("", views.home, name="home"),
    path("settings/", views.settings_home, name="settings_home"),
    path("settings/edit/<str:section>/", views.settings_edit, name="settings_edit"),
    path("settings/staff/", views.staff_list, name="staff_list"),
    path("settings/staff/add/", views.staff_edit, name="staff_add"),
    path("settings/staff/<int:pk>/", views.staff_edit, name="staff_edit"),
    path("counter/", views.counter_pick, name="counter_pick"),
    path("counter/<int:num>/", views.counter_number, name="counter_number"),
    path("settings/backups/", views.backups, name="backups"),
    path("settings/backups/now/", views.backup_now, name="backup_now"),
    path("settings/backups/find-drive/", views.backup_find_drive, name="backup_find_drive"),
    path("settings/backups/verify/", views.backup_verify, name="backup_verify"),
    path("settings/backups/file/<str:name>/", views.backup_download, name="backup_download"),
    path("settings/audit/", views.audit_log, name="audit_log"),
]
