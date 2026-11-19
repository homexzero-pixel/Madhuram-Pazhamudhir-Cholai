from django.urls import path

from . import views

urlpatterns = [
    path("", views.report_index, name="report_index"),
    path("view/", views.report_view, name="report_view"),
    path("dashboard/", views.dashboard, name="dashboard"),
]
