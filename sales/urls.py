from django.urls import path

from . import views

urlpatterns = [
    path("pos/", views.pos, name="pos"),
    path("pos/add/", views.cart_add, name="cart_add"),
    path("pos/update/<int:product_id>/", views.cart_update, name="cart_update"),
    path("pos/clear/", views.cart_clear, name="cart_clear"),
    path("pos/checkout/", views.checkout, name="checkout"),
    path("", views.sale_list, name="sale_list"),
    path("<int:pk>/", views.sale_detail, name="sale_detail"),
    path("<int:pk>/receipt/", views.sale_receipt, name="sale_receipt"),
    path("<int:pk>/void/", views.sale_void, name="sale_void"),
]
