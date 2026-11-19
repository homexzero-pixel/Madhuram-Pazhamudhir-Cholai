from django.urls import path

from . import views

urlpatterns = [
    path("", views.overview, name="report_overview"),
    path("stock/", views.stock_report, name="report_stock"),
    path("export/<str:kind>/", views.export_csv, name="report_export"),
]
