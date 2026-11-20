from django.urls import path

from . import views

urlpatterns = [
    path("", views.purchase_home, name="purchase_home"),
    path("orders/new/", views.po_new, name="po_new"),
    path("orders/<int:pk>/", views.po_detail, name="po_detail"),
    path("orders/<int:pk>/close/", views.po_close, name="po_close"),
    path("grn/new/", views.grn_new, name="grn_new"),
    path("grn/<int:pk>/", views.grn_detail, name="grn_detail"),
    path("returns/new/", views.purchase_return_new, name="purchase_return_new"),
    path("suppliers/", views.supplier_list, name="supplier_list"),
    path("suppliers/new/", views.supplier_edit, name="supplier_add"),
    path("suppliers/<int:pk>/", views.supplier_detail, name="supplier_detail"),
    path("suppliers/<int:pk>/edit/", views.supplier_edit, name="supplier_edit"),
    path("suppliers/<int:pk>/pay/", views.supplier_pay, name="supplier_pay"),
]
