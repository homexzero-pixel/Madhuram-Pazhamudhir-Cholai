from django.urls import path

from . import views

urlpatterns = [
    path("products/", views.product_list, name="product_list"),
    path("products/add/", views.product_edit, name="product_create"),
    path("products/<int:pk>/edit/", views.product_edit, name="product_edit"),
    path("products/<int:pk>/delete/", views.product_delete, name="product_delete"),
    path("categories/", views.category_list, name="category_list"),
    path("categories/add/", views.category_edit, name="category_create"),
    path("categories/<int:pk>/edit/", views.category_edit, name="category_edit"),
    path("categories/<int:pk>/delete/", views.category_delete, name="category_delete"),
    path("suppliers/", views.supplier_list, name="supplier_list"),
    path("suppliers/add/", views.supplier_edit, name="supplier_create"),
    path("suppliers/<int:pk>/edit/", views.supplier_edit, name="supplier_edit"),
    path("suppliers/<int:pk>/delete/", views.supplier_delete, name="supplier_delete"),
    path("purchases/", views.purchase_list, name="purchase_list"),
    path("purchases/add/", views.purchase_create, name="purchase_create"),
    path("purchases/<int:pk>/edit/", views.purchase_edit, name="purchase_edit"),
    path("purchases/<int:pk>/delete/", views.purchase_delete, name="purchase_delete"),
    path("api/products/", views.api_products, name="api_products"),
    path("api/products/<int:pk>/", views.api_product_detail, name="api_product_detail"),
]
