from django.urls import path

from . import views

public = [
    path("", views.shop_home, name="shop_home"),
    path("api/items/", views.shop_items, name="shop_items"),
    path("api/order/", views.shop_order, name="shop_order"),
    path("o/<uuid:token>/", views.shop_track, name="shop_track"),
]
staff = [
    path("", views.order_list, name="order_list"),
    path("<int:pk>/", views.order_detail, name="order_detail"),
    path("<int:pk>/action/", views.order_action, name="order_action"),
    path("api/badge/", views.order_badge, name="order_badge"),
    path("poster/", views.order_poster, name="order_poster"),
]
