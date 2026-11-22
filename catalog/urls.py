from django.urls import path

from . import views

urlpatterns = [
    path("", views.item_list, name="item_list"),
    path("new/", views.item_edit, name="item_add"),
    path("quick/", views.quick_add_page, name="quick_add"),
    path("<int:pk>/", views.item_detail, name="item_detail"),
    path("<int:pk>/edit/", views.item_edit, name="item_edit"),
    path("<int:pk>/verify/", views.item_verify, name="item_verify"),
    path("<int:pk>/barcodes/add/", views.barcode_add, name="barcode_add"),
    path("<int:pk>/barcodes/<int:bid>/delete/", views.barcode_delete, name="barcode_delete"),
    path("labels/", views.labels, name="labels"),
    path("practice-barcodes/", views.practice_barcodes, name="practice_barcodes"),
    path("import/", views.import_start, name="import_start"),
    path("import/preview/", views.import_preview, name="import_preview"),
    path("import/apply/", views.import_apply, name="import_apply"),
    path("import/<int:pk>/undo/", views.import_undo, name="import_undo"),
    path("import/template.<str:fmt>", views.import_template, name="import_template"),
    path("export/", views.export_products, name="export_products"),
]
