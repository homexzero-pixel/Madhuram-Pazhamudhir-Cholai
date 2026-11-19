from django.urls import path

from . import views

urlpatterns = [
    path("", views.customer_list, name="customer_list"),
    path("new/", views.customer_edit, name="customer_add"),
    path("<int:pk>/", views.customer_detail, name="customer_detail"),
    path("<int:pk>/edit/", views.customer_edit, name="customer_edit"),
    path("<int:pk>/collect/", views.collect_credit, name="collect_credit"),
    path("offers/", views.offer_list, name="offer_list"),
    path("offers/new/", views.offer_edit, name="offer_add"),
    path("offers/<int:pk>/", views.offer_edit, name="offer_edit"),
]
