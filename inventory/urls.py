from django.urls import path

from . import views

urlpatterns = [
    path("", views.stock_home, name="stock_home"),
    path("lot/<int:lot_id>/adjust/", views.write_off, name="write_off"),
    path("counts/", views.counts, name="counts"),
    path("counts/<int:pk>/", views.count_detail, name="count_detail"),
    path("ledger/", views.ledger, name="ledger"),
]
